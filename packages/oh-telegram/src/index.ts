import type { Handler, Reply, Signal } from "@openharden/shared"

export type Options =
  | {
      mode: "polling"
      token: string
      pollTimeoutSec?: number
      backoffMs?: number
    }
  | {
      mode: "webhook"
      token: string
      port: number
      publicUrl: string
      path?: string
      secretToken?: string
    }

export type Adapter = {
  start(handler: Handler): Promise<void>
  send(to: string, text: string): Promise<void>
  stop(): Promise<void>
}

const API = "https://api.telegram.org"

type TgResponse<T> = { ok: true; result: T } | { ok: false; description: string; error_code: number }

type TgUpdate = {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number }
    from?: { id: number; username?: string }
    date: number
    text?: string
  }
}

const call = async <T,>(token: string, method: string, body?: unknown): Promise<T> => {
  const r = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await r.json()) as TgResponse<T>
  if (!json.ok) throw new Error(`telegram ${method} failed: [${json.error_code}] ${json.description}`)
  return json.result
}

const sendMessage = async (token: string, chatId: string, text: string): Promise<void> => {
  await call(token, "sendMessage", { chat_id: chatId, text })
}

const toSignal = (u: TgUpdate): Signal | null => {
  const m = u.message
  if (!m || !m.text) return null
  return {
    channel: "telegram",
    from: String(m.chat.id),
    text: m.text,
    ts: m.date * 1000,
  }
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms))

const sendChatAction = (token: string, chatId: string, action: "typing"): Promise<void> =>
  call(token, "sendChatAction", { chat_id: chatId, action }).then(() => {}).catch(() => {})

const TYPING_REFRESH_MS = 4000

const dispatch = async (token: string, handler: Handler, sig: Signal, reply: Reply): Promise<void> => {
  let active = true
  const keepTyping = async () => {
    while (active) {
      await sendChatAction(token, sig.from, "typing")
      const start = Date.now()
      while (active && Date.now() - start < TYPING_REFRESH_MS) {
        await sleep(100)
      }
    }
  }
  const indicator = keepTyping()
  try {
    const final = await handler(sig, reply).catch((err: unknown) => {
      console.error("[telegram] handler error:", err)
      return null
    })
    if (final) await reply(final).catch((err: unknown) => console.error("[telegram] reply error:", err))
  } finally {
    active = false
    await indicator.catch(() => {})
  }
}

const polling = (opts: Extract<Options, { mode: "polling" }>): Adapter => {
  const timeoutSec = opts.pollTimeoutSec ?? 50
  const backoff = opts.backoffMs ?? 1000
  let offset = 0
  let stopped = false
  let loop: Promise<void> | null = null
  let aborter: AbortController | null = null

  const tick = async (handler: Handler): Promise<void> => {
    while (!stopped) {
      aborter = new AbortController()
      try {
        const url = `${API}/bot${opts.token}/getUpdates?offset=${offset}&timeout=${timeoutSec}`
        const r = await fetch(url, { signal: aborter.signal })
        if (!r.ok) {
          await sleep(backoff)
          continue
        }
        const json = (await r.json()) as TgResponse<TgUpdate[]>
        if (!json.ok) {
          console.error(`[telegram] getUpdates: [${json.error_code}] ${json.description}`)
          await sleep(backoff)
          continue
        }
        for (const u of json.result) {
          offset = u.update_id + 1
          const sig = toSignal(u)
          if (!sig) continue
          const reply: Reply = (text) => sendMessage(opts.token, sig.from, text)
          await dispatch(opts.token, handler, sig, reply)
        }
      } catch (err) {
        if (stopped) return
        console.error("[telegram] poll error:", err)
        await sleep(backoff)
      }
    }
  }

  return {
    async start(handler) {
      stopped = false
      loop = tick(handler)
    },
    async send(to, text) {
      await sendMessage(opts.token, to, text)
    },
    async stop() {
      stopped = true
      aborter?.abort()
      if (loop) await loop.catch(() => {})
      loop = null
    },
  }
}

const webhook = (opts: Extract<Options, { mode: "webhook" }>): Adapter => {
  const path = opts.path ?? "/webhook"
  let server: ReturnType<typeof Bun.serve> | null = null

  return {
    async start(handler) {
      server = Bun.serve({
        port: opts.port,
        fetch: async (req) => {
          const url = new URL(req.url)
          if (url.pathname !== path) return new Response("not found", { status: 404 })
          if (req.method !== "POST") return new Response("method not allowed", { status: 405 })
          if (opts.secretToken) {
            const got = req.headers.get("x-telegram-bot-api-secret-token")
            if (got !== opts.secretToken) return new Response("forbidden", { status: 403 })
          }
          const u = (await req.json()) as TgUpdate
          const sig = toSignal(u)
          if (!sig) return new Response("ok")
          const reply: Reply = (text) => sendMessage(opts.token, sig.from, text)
          void dispatch(opts.token, handler, sig, reply)
          return new Response("ok")
        },
      })
      const hookUrl = new URL(path, opts.publicUrl).toString()
      await call(opts.token, "setWebhook", {
        url: hookUrl,
        secret_token: opts.secretToken,
      })
    },
    async send(to, text) {
      await sendMessage(opts.token, to, text)
    },
    async stop() {
      await call(opts.token, "deleteWebhook", {}).catch((err) =>
        console.error("[telegram] deleteWebhook error:", err),
      )
      server?.stop()
      server = null
    },
  }
}

export const create = (opts: Options): Adapter => {
  if (opts.mode === "polling") return polling(opts)
  return webhook(opts)
}
