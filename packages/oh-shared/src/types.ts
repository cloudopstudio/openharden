import { z } from "zod"

export const Channel = z.enum(["telegram", "whatsapp", "audio", "email", "rest"])
export type Channel = z.infer<typeof Channel>

export const Identity = z.object({
  id: z.string(),
  email: z.string().optional(),
})
export type Identity = z.infer<typeof Identity>

export const Scope = z.enum(["project", "personal"])
export type Scope = z.infer<typeof Scope>

export const Context = z.object({
  project: z.string(),
  topic: z.string().optional(),
  scope: Scope.default("project"),
  identity: Identity,
})
export type Context = z.infer<typeof Context>

export const Signal = z.object({
  channel: Channel,
  from: z.string(),
  thread: z.string().optional(),
  text: z.string(),
  ts: z.number(),
})
export type Signal = z.infer<typeof Signal>

export const InstanceKey = z.object({
  identity: z.string(),
  project: z.string(),
})
export type InstanceKey = z.infer<typeof InstanceKey>

export const Command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("route"), text: z.string() }),
  z.object({ kind: z.literal("switch"), project: z.string() }),
  z.object({ kind: z.literal("close"), project: z.string().optional() }),
  z.object({ kind: z.literal("list") }),
  z.object({ kind: z.literal("summary") }),
])
export type Command = z.infer<typeof Command>
