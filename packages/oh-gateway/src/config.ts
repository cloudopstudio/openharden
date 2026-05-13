import { z } from "zod"
import { Channel, Identity, Scope } from "@openharden/shared"

const Binding = z.object({
  channel: Channel,
  from: z.string(),
  identity: Identity,
  project: z.string().optional(),
})

const Telegram = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("polling"),
    token: z.string().min(1),
    pollTimeoutSec: z.number().int().positive().optional(),
    backoffMs: z.number().int().positive().optional(),
  }),
  z.object({
    mode: z.literal("webhook"),
    token: z.string().min(1),
    port: z.number().int().positive(),
    publicUrl: z.string().url(),
    path: z.string().optional(),
    secretToken: z.string().optional(),
  }),
])

export const Config = z.object({
  defaultProject: z.string().default("openharden"),
  defaultScope: Scope.optional(),
  max: z.number().int().positive().default(5),
  idleMs: z.number().int().positive().default(30 * 60 * 1000),
  bindings: z.array(Binding).default([]),
  telegram: Telegram.optional(),
})
export type Config = z.infer<typeof Config>

export const load = async (path: string): Promise<Config> => {
  const file = Bun.file(path)
  const exists = await file.exists()
  if (!exists) return Config.parse({})
  const raw = await file.json()
  return Config.parse(raw)
}
