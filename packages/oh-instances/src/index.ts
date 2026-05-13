import { createOpencode, type createOpencodeClient } from "@opencode-ai/sdk"
import type { Context, InstanceKey } from "@openharden/shared"

export type State = "spawning" | "ready" | "closing"

export type Client = ReturnType<typeof createOpencodeClient>

export type Instance = {
  key: InstanceKey
  state: State
  url: string
  sessionId: string
  lastSeen: number
  buffer: string[]
}

export type Reason = "idle" | "evict" | "shutdown" | "spawn-failed"

export type Options = {
  max: number
  idleMs: number
  onEvict?: (inst: Instance, reason: Reason) => Promise<void>
}

export type Pool = {
  acquire(ctx: Context): Promise<Instance>
  awaitReady(key: InstanceKey): Promise<void>
  client(key: InstanceKey): Client
  release(key: InstanceKey): Promise<void>
  close(key: InstanceKey): Promise<Instance | null>
  list(): Instance[]
  evict(): Promise<Instance | null>
  shutdown(): Promise<void>
}

type Runtime = {
  instance: Instance
  client: Client
  close: () => void
  abort: AbortController
  timer: ReturnType<typeof setTimeout> | null
  ready: Promise<void>
}

const id = (k: InstanceKey) => `${k.identity}:${k.project}`

export const create = (opts: Options): Pool => {
  const pool = new Map<string, Runtime>()

  const arm = (rt: Runtime) => {
    if (rt.timer) clearTimeout(rt.timer)
    rt.timer = setTimeout(() => {
      void shut(rt, "idle")
    }, opts.idleMs)
  }

  const shut = async (rt: Runtime, reason: Reason) => {
    if (rt.instance.state === "closing") return
    rt.instance.state = "closing"
    if (rt.timer) clearTimeout(rt.timer)
    if (opts.onEvict && reason !== "shutdown") {
      await opts.onEvict(rt.instance, reason)
    }
    rt.abort.abort()
    rt.close()
    pool.delete(id(rt.instance.key))
  }

  const evict = async (): Promise<Instance | null> => {
    const ready = Array.from(pool.values()).filter((rt) => rt.instance.state === "ready")
    if (ready.length === 0) return null
    const oldest = ready.reduce((a, b) => (a.instance.lastSeen < b.instance.lastSeen ? a : b))
    const snap = { ...oldest.instance }
    await shut(oldest, "evict")
    return snap
  }

  const start = (key: InstanceKey, ctx: Context): Runtime => {
    const abort = new AbortController()
    let res: () => void = () => {}
    let rej: (e: Error) => void = () => {}
    const ready = new Promise<void>((r, j) => {
      res = r
      rej = j
    })
    const instance: Instance = {
      key,
      state: "spawning",
      url: "",
      sessionId: "",
      lastSeen: Date.now(),
      buffer: [],
    }
    const rt: Runtime = {
      instance,
      client: null as unknown as Client,
      close: () => {},
      abort,
      timer: null,
      ready,
    }
    pool.set(id(key), rt)

    void (async () => {
      const oc = await createOpencode({ port: 0, signal: abort.signal })
      const session = await oc.client.session.create({ body: { title: ctx.project } })
      if (session.error) {
        throw new Error(`session.create failed: ${JSON.stringify(session.error)}`)
      }
      instance.url = oc.server.url
      instance.sessionId = session.data.id
      instance.state = "ready"
      instance.lastSeen = Date.now()
      rt.client = oc.client
      rt.close = oc.server.close
      arm(rt)
      res()
    })().catch(async (err) => {
      const snap = { ...instance }
      pool.delete(id(key))
      if (opts.onEvict) {
        await opts.onEvict(snap, "spawn-failed").catch(() => {})
      }
      rej(err instanceof Error ? err : new Error(String(err)))
    })

    return rt
  }

  return {
    async acquire(ctx) {
      const key: InstanceKey = { identity: ctx.identity.id, project: ctx.project }
      const existing = pool.get(id(key))
      if (existing && existing.instance.state !== "closing") {
        existing.instance.lastSeen = Date.now()
        if (existing.instance.state === "ready") arm(existing)
        return existing.instance
      }
      if (pool.size >= opts.max) await evict()
      return start(key, ctx).instance
    },
    awaitReady(key) {
      const rt = pool.get(id(key))
      if (!rt) return Promise.reject(new Error(`no instance: ${id(key)}`))
      return rt.ready
    },
    client(key) {
      const rt = pool.get(id(key))
      if (!rt) throw new Error(`no instance: ${id(key)}`)
      if (rt.instance.state !== "ready") throw new Error(`instance not ready: ${id(key)}`)
      return rt.client
    },
    async release(key) {
      const rt = pool.get(id(key))
      if (!rt) return
      rt.instance.lastSeen = Date.now()
      if (rt.instance.state === "ready") arm(rt)
    },
    async close(key) {
      const rt = pool.get(id(key))
      if (!rt) return null
      const snap = { ...rt.instance }
      await shut(rt, "evict")
      return snap
    },
    list() {
      return Array.from(pool.values()).map((rt) => rt.instance)
    },
    evict,
    async shutdown() {
      const all = Array.from(pool.values())
      await Promise.all(all.map((rt) => shut(rt, "shutdown")))
    },
  }
}
