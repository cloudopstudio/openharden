import type { Pool } from "@openharden/instances"
import type { Resolver } from "@openharden/resolver"
import type { Context, InstanceKey } from "@openharden/shared"
import { messages } from "@openharden/shared"

export type Notify = (msg: string) => Promise<void>

export type Deps = {
  pool: Pool
  resolver: Resolver
}

const extract = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  const info = d.info as Record<string, unknown> | undefined
  if (info && typeof info.content === "string" && info.content) return info.content
  const parts = d.parts
  if (!Array.isArray(parts)) return null
  const texts = parts
    .filter((p): p is Record<string, unknown> => p && typeof p === "object" && (p as Record<string, unknown>).type === "text")
    .map((p) => p.text)
    .filter((t): t is string => typeof t === "string")
  return texts.length > 0 ? texts.join("\n") : null
}

const send = async (deps: Deps, key: InstanceKey, sessionId: string, text: string): Promise<string> => {
  const result = await deps.pool.client(key).session.prompt({
    path: { id: sessionId },
    body: { parts: [{ type: "text", text }] },
  })
  if (result.error) return "(error procesando el mensaje)"
  return extract(result.data) ?? "(sin respuesta)"
}

export const route = async (deps: Deps, ctx: Context, text: string, notify: Notify): Promise<string | null> => {
  const inst = await deps.pool.acquire(ctx)
  if (inst.state === "spawning") {
    const first = inst.buffer.length === 0
    inst.buffer.push(text)
    if (!first) return null
    await notify(messages.starting(ctx.project))
    await deps.pool.awaitReady(inst.key)
    await notify(messages.spawned(ctx.project))
    const buffered = inst.buffer.splice(0)
    const combined = buffered.join("\n")
    return send(deps, inst.key, inst.sessionId, combined)
  }
  return send(deps, inst.key, inst.sessionId, text)
}

export const switchProject = async (deps: Deps, ctx: Context, project: string, notify: Notify): Promise<string> => {
  if (project === ctx.project) return `Ya estás trabajando en el proyecto ${project}.`
  const prev = ctx.project
  await deps.resolver.switchProject(ctx.identity.id, project)
  await deps.pool.close({ identity: ctx.identity.id, project: prev }).catch(() => null)
  await notify(messages.switched(prev, project))
  const inst = await deps.pool.acquire({ ...ctx, project })
  if (inst.state === "spawning") {
    await notify(messages.starting(project))
    await deps.pool.awaitReady(inst.key)
    return messages.spawned(project)
  }
  return messages.spawned(project)
}

export const close = async (deps: Deps, ctx: Context, project?: string): Promise<string> => {
  const target = project ?? ctx.project
  const closed = await deps.pool.close({ identity: ctx.identity.id, project: target })
  return closed ? messages.closed(target) : `No hay sesión activa para el proyecto ${target}.`
}

export const list = async (deps: Deps, ctx: Context): Promise<string> => {
  const mine = deps.pool.list().filter((i) => i.key.identity === ctx.identity.id)
  if (mine.length === 0) return messages.listEmpty
  return messages.list(mine.map((i) => i.key.project))
}

export const summary = async (deps: Deps, ctx: Context, notify: Notify): Promise<string | null> => {
  return route(deps, ctx, "Por favor, resume brevemente nuestra conversación hasta ahora.", notify)
}
