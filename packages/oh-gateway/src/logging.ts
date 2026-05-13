import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type LogLevel = "meta" | "raw"

export type LogEvent = {
  identity: string
  channel: string
  project: string | null
  action: "incoming" | "response" | "notify" | "switch" | "close" | "error" | "dispatcher"
  text?: string
  response?: string
  detail?: Record<string, unknown>
}

export type Logger = {
  write(event: LogEvent): Promise<void>
  level: LogLevel
  path: string
}

const xdgStateHome = (): string => process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")

export const defaultLogPath = (): string => path.join(xdgStateHome(), "openharden", "log.jsonl")

export const create = async (opts: { level: LogLevel; path?: string }): Promise<Logger> => {
  const filePath = opts.path ?? defaultLogPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const handle = await fs.open(filePath, "a")
  return {
    level: opts.level,
    path: filePath,
    async write(event) {
      const base = {
        ts: Date.now(),
        identity: event.identity,
        channel: event.channel,
        project: event.project,
        action: event.action,
      }
      const line =
        opts.level === "raw"
          ? { ...base, text: event.text, response: event.response, detail: event.detail }
          : base
      await handle.write(JSON.stringify(line) + "\n")
    },
  }
}
