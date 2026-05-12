import type { Command, Signal } from "@openharden/shared"
import { match } from "./patterns"
import { classify } from "./llm"

export const parse = async (signal: Signal): Promise<Command> => {
  const hit = match(signal.text)
  if (hit) return hit
  const inferred = await classify(signal.text)
  if (inferred) return inferred
  return { kind: "route", text: signal.text }
}
