import type { Command, Signal } from "@openharden/shared"
import { match } from "./patterns"

export const parse = async (signal: Signal): Promise<Command> => {
  const hit = match(signal.text)
  if (hit) return hit
  return { kind: "route", text: signal.text }
}
