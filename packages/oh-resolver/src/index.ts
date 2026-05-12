import type { Channel, Context, Identity, Signal } from "@openharden/shared"

export type Resolver = {
  resolve(signal: Signal): Promise<Context>
  bind(channel: Channel, token: string, identity: Identity): Promise<void>
  unbind(channel: Channel, token: string): Promise<void>
  whoami(channel: Channel, from: string): Promise<Identity | null>
}

export const create = (): Resolver => {
  throw new Error("not implemented")
}
