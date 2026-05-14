import { z } from "zod"
import { Channel, Identity, Scope } from "@openharden/shared"

const Binding = z.object({
  channel: Channel,
  from: z.string(),
  identity: Identity,
  project: z.string().optional(),
})

const Organization = z.object({
  mcps: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
})
export type Organization = z.infer<typeof Organization>

const Skill = z
  .object({
    path: z.string().optional(),
    url: z.string().optional(),
  })
  .refine((s) => s.path || s.url, { message: "skill must declare either path or url" })

const Logging = z.object({
  level: z.enum(["meta", "raw"]).default("meta"),
  path: z.string().optional(),
})
export type Logging = z.infer<typeof Logging>

const Dispatcher = z.object({
  enabled: z.boolean().default(true),
  model: z.string().optional(),
  historyTurns: z.number().int().positive().default(10),
})
export type Dispatcher = z.infer<typeof Dispatcher>

const Engram = z.object({
  enabled: z.boolean().default(true),
  binary: z.string().default("engram"),
  profile: z.string().optional(),
})
export type Engram = z.infer<typeof Engram>

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
  workspaceRoot: z.string().optional(),
  organizations: z.record(z.string(), Organization).default({}),
  mcps: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  agents: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  skills: z.record(z.string(), Skill).default({}),
  logging: Logging.optional(),
  dispatcher: Dispatcher.optional(),
  engram: Engram.optional(),
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
