import Anthropic from "@anthropic-ai/sdk"
import type { Command } from "@openharden/shared"

const MODEL = "claude-haiku-4-5-20251001"

const SYSTEM = `Eres un clasificador de intenciones para un orquestador de IA. Recibes mensajes en español neutro o inglés y debes determinar la intención.

Devuelve EXCLUSIVAMENTE un JSON válido, sin texto adicional, con esta estructura:

- {"kind": "route", "text": "..."} para cualquier mensaje normal que debe enviarse al agente de IA (consulta técnica, instrucción, pregunta general).
- {"kind": "switch", "project": "..."} cuando el usuario pide cambiar a otro proyecto. Extrae el nombre del proyecto del mensaje.
- {"kind": "close"} o {"kind": "close", "project": "..."} cuando el usuario pide cerrar la sesión actual o de un proyecto específico.
- {"kind": "list"} cuando el usuario pide listar sesiones activas o proyectos abiertos.
- {"kind": "summary"} cuando el usuario pide un resumen de la conversación actual.

Por defecto, ante duda, usa "route". No añadas explicaciones ni texto fuera del JSON.`

let client: Anthropic | null = null

const getClient = (): Anthropic | null => {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!client) client = new Anthropic()
  return client
}

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

const validate = (data: unknown, fallback: string): Command | null => {
  if (!data || typeof data !== "object") return null
  const obj = data as Record<string, unknown>
  if (typeof obj.kind !== "string") return null

  if (obj.kind === "route") {
    return { kind: "route", text: typeof obj.text === "string" && obj.text ? obj.text : fallback }
  }
  if (obj.kind === "switch") {
    if (typeof obj.project !== "string" || !obj.project) return null
    return { kind: "switch", project: obj.project }
  }
  if (obj.kind === "close") {
    if (typeof obj.project === "string" && obj.project) return { kind: "close", project: obj.project }
    return { kind: "close" }
  }
  if (obj.kind === "list") return { kind: "list" }
  if (obj.kind === "summary") return { kind: "summary" }
  return null
}

export const classify = async (text: string): Promise<Command | null> => {
  const c = getClient()
  if (!c) return null

  const result = await c.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: "user", content: text }],
  })

  const block = result.content.find((b) => b.type === "text")
  if (!block || block.type !== "text") return null

  return validate(safeJson(block.text), text)
}
