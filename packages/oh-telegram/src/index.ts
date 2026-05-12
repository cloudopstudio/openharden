import type { Signal } from "@openharden/shared"

export type Handler = (signal: Signal) => Promise<void>

export type Adapter = {
  start(handler: Handler): Promise<void>
  send(to: string, text: string): Promise<void>
  stop(): Promise<void>
}

export type Options = {
  token: string
}

export const create = (opts: Options): Adapter => {
  throw new Error("not implemented")
}
