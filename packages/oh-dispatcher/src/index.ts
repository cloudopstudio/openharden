import { createOpencode } from "@opencode-ai/sdk"
import { SYSTEM_PROMPT } from "./prompt"

export type Organization = { name: string }

export type CurrentState = {
  organization: string | null
  folder: string | null
  engramProject: string | null
}

export type HistoryTurn = { role: "user" | "assistant"; text: string }

export type DispatchInput = {
  message: string
  currentState: CurrentState
  organizations: Organization[]
  folders: string[]
  engramProjects: string[]
  history: HistoryTurn[]
}

export type Decision = {
  action: "route" | "switch" | "ask" | "unknown"
  organization: string | null
  folder: string | null
  engramProject: string | null
  message: string | null
}

export type LogLevel = "debug" | "info" | "warn" | "error"
export type LogFn = (level: LogLevel, msg: string) => void

export type Options = {
  model: string
  workspaceRoot?: string
  signal?: AbortSignal
  onLog?: LogFn
}

export type Dispatcher = {
  decide(input: DispatchInput): Promise<Decision>
  shutdown(): Promise<void>
}

const parseModel = (s: string): { providerID: string; modelID: string } => {
  const idx = s.indexOf("/")
  if (idx <= 0 || idx === s.length - 1) {
    throw new Error(`invalid dispatcher model "${s}", expected format "<provider>/<model>"`)
  }
  return { providerID: s.slice(0, idx), modelID: s.slice(idx + 1) }
}

const extractText = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null
  const parts = (data as Record<string, unknown>).parts
  if (!Array.isArray(parts)) return null
  const texts: string[] = []
  for (const p of parts) {
    if (!p || typeof p !== "object") continue
    const part = p as Record<string, unknown>
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
      texts.push(part.text)
    }
  }
  return texts.length > 0 ? texts.join("\n") : null
}

const summarizeParts = (data: unknown): string => {
  if (!data || typeof data !== "object") return "(no data)"
  const parts = (data as Record<string, unknown>).parts
  if (!Array.isArray(parts)) return `(no parts; keys=${Object.keys(data).join(",")})`
  const summary = parts.map((p, i) => {
    if (!p || typeof p !== "object") return `[${i}] ?`
    const part = p as Record<string, unknown>
    const type = part.type ?? "unknown"
    if (type === "text") {
      const txt = typeof part.text === "string" ? part.text : ""
      return `[${i}] text(len=${txt.length})${txt.length > 0 ? `: ${txt.slice(0, 80)}` : ""}`
    }
    if (type === "reasoning") {
      const txt = typeof part.text === "string" ? part.text : ""
      return `[${i}] reasoning(len=${txt.length})`
    }
    if (type === "tool") {
      const name = typeof part.tool === "string" ? part.tool : "?"
      return `[${i}] tool(${name})`
    }
    return `[${i}] ${type}`
  })
  return summary.join(" | ")
}

const extractInfoError = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null
  const info = (data as Record<string, unknown>).info as Record<string, unknown> | undefined
  if (!info || !info.error || typeof info.error !== "object") return null
  const err = info.error as Record<string, unknown>
  const name = typeof err.name === "string" ? err.name : "error"
  const payload = err.data as Record<string, unknown> | undefined
  const message = payload && typeof payload.message === "string" ? payload.message : null
  return message ? `[${name}] ${message}` : `[${name}]`
}

const tryParseDecision = (text: string): Decision | null => {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) return null
  const candidate = text.slice(start, end + 1)
  try {
    const obj = JSON.parse(candidate) as Record<string, unknown>
    if (!obj || typeof obj !== "object") return null
    const action = obj.action
    if (action !== "route" && action !== "switch" && action !== "ask" && action !== "unknown") return null
    return {
      action,
      organization: typeof obj.organization === "string" ? obj.organization : null,
      folder: typeof obj.folder === "string" ? obj.folder : null,
      engramProject: typeof obj.engramProject === "string" ? obj.engramProject : null,
      message: typeof obj.message === "string" ? obj.message : null,
    }
  } catch {
    return null
  }
}

const unknown = (message: string): Decision => ({
  action: "unknown",
  organization: null,
  folder: null,
  engramProject: null,
  message,
})

export const create = async (opts: Options): Promise<Dispatcher> => {
  const model = parseModel(opts.model)
  const log: LogFn = opts.onLog ?? (() => {})
  const oc = await createOpencode({
    port: 0,
    signal: opts.signal,
    cwd: opts.workspaceRoot,
  })

  const session = await oc.client.session.create({ body: { title: "openharden-dispatcher" } })
  if (session.error) {
    oc.server.close()
    throw new Error(`dispatcher session.create failed: ${JSON.stringify(session.error)}`)
  }
  const sessionId = session.data.id
  log("info", `session ready id=${sessionId} model=${opts.model}`)

  return {
    async decide(input) {
      const payload = JSON.stringify(input)
      log("debug", `payload: ${payload.length > 800 ? payload.slice(0, 800) + "...(truncated)" : payload}`)
      const r = await oc.client.session.prompt({
        path: { id: sessionId },
        body: {
          model,
          system: SYSTEM_PROMPT,
          parts: [{ type: "text", text: payload }],
        },
      })
      if (r.error) {
        const msg = `transport error: ${JSON.stringify(r.error)}`
        log("warn", msg)
        return unknown(`Dispatcher ${msg}`)
      }
      const providerErr = extractInfoError(r.data)
      if (providerErr) {
        log("warn", `provider error: ${providerErr}`)
        return unknown(`Dispatcher provider error: ${providerErr}`)
      }
      const text = extractText(r.data)
      if (!text) {
        const summary = summarizeParts(r.data)
        log("warn", `empty text response. parts: ${summary}`)
        return unknown(`Dispatcher sin texto. Parts: ${summary}`)
      }
      log("debug", `raw text: ${text.length > 400 ? text.slice(0, 400) + "...(truncated)" : text}`)
      const decision = tryParseDecision(text)
      if (!decision) {
        log("warn", `invalid format. raw text: ${text.slice(0, 400)}`)
        return unknown(`Dispatcher devolvió formato inválido: ${text.slice(0, 200)}`)
      }
      log("info", `decision action=${decision.action} folder=${decision.folder ?? "-"} engram=${decision.engramProject ?? "-"}`)
      return decision
    },
    async shutdown() {
      oc.server.close()
    },
  }
}
