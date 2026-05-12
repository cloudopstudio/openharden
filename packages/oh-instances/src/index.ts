import type { Context, InstanceKey } from "@openharden/shared"

export type State = "spawning" | "ready" | "closing"

export type Instance = {
  key: InstanceKey
  state: State
  pid: number
  port: number
  sessionId: string
  lastSeen: number
  buffer: string[]
}

export type Pool = {
  acquire(ctx: Context): Promise<Instance>
  release(key: InstanceKey): Promise<void>
  list(): Instance[]
  evict(): Promise<Instance | null>
  shutdown(): Promise<void>
}

export type Options = {
  max: number
  idleMs: number
}

export const create = (opts: Options): Pool => {
  throw new Error("not implemented")
}
