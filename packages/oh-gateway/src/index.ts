#!/usr/bin/env bun
import { createInterface } from "node:readline/promises"
import { create as createPool, type Reason } from "@openharden/instances"
import { create as createResolver } from "@openharden/resolver"
import { create as createTelegram, type Adapter } from "@openharden/telegram"
import { Channel, messages, type Handler, type Reply, type Signal } from "@openharden/shared"
import { parse } from "./parser"
import { load } from "./config"
import * as handlers from "./handlers"

const path = process.env.OPENHARDEN_CONFIG ?? "./openharden.config.json"

const log = (msg: string) => console.log(`[gateway] ${msg}`)

const main = async () => {
  const cfg = await load(path)
  log(`config loaded from ${path} (defaultProject=${cfg.defaultProject}, max=${cfg.max}, bindings=${cfg.bindings.length})`)

  const resolver = createResolver({
    defaultProject: cfg.defaultProject,
    defaultScope: cfg.defaultScope,
  })
  for (const b of cfg.bindings) {
    await resolver.bind(b.channel, b.from, b.identity, b.project)
  }

  const pool = createPool({
    max: cfg.max,
    idleMs: cfg.idleMs,
    onEvict: async (inst, reason: Reason) => {
      log(`evicted ${inst.key.project} (${reason})`)
    },
  })

  const deps = { pool, resolver }

  const handle: Handler = async (signal, reply) => {
    const ctx = await resolver.resolve(signal).catch(() => null)
    if (!ctx) return messages.unbound

    const cmd = await parse(signal)
    if (cmd.kind === "route") return handlers.route(deps, ctx, cmd.text, reply)
    if (cmd.kind === "switch") return handlers.switchProject(deps, ctx, cmd.project, reply)
    if (cmd.kind === "close") return handlers.close(deps, ctx, cmd.project)
    if (cmd.kind === "list") return handlers.list(deps, ctx)
    if (cmd.kind === "summary") return handlers.summary(deps, ctx, reply)
    return null
  }

  const adapters: Adapter[] = []
  if (cfg.telegram) {
    const tg = createTelegram(cfg.telegram)
    await tg.start(handle)
    adapters.push(tg)
    log(`telegram adapter started (mode=${cfg.telegram.mode})`)
  }

  const shutdown = async () => {
    log("shutting down...")
    for (const a of adapters) await a.stop().catch((err) => log(`adapter stop error: ${err}`))
    await pool.shutdown()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  log(`dev stdin loop ready. Format: <channel>:<from> <text>`)
  log(`example: telegram:123456789 trabajar en alpha`)

  const stdinReply: Reply = async (text) => log(`>>> ${text}`)
  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const m = trimmed.match(/^(\w+):(\S+)\s+(.+)$/)
    if (!m) {
      log(`format: <channel>:<from> <text>`)
      continue
    }

    const parsedChannel = Channel.safeParse(m[1])
    if (!parsedChannel.success) {
      log(`unknown channel: ${m[1]}`)
      continue
    }

    const signal: Signal = {
      channel: parsedChannel.data,
      from: m[2]!,
      text: m[3]!,
      ts: Date.now(),
    }

    const response = await handle(signal, stdinReply).catch((err: unknown) => {
      log(`error: ${err instanceof Error ? err.message : String(err)}`)
      return null
    })
    if (response) log(`>>> ${response}`)
  }

  log("stdin closed, shutting down...")
  for (const a of adapters) await a.stop().catch(() => {})
  await pool.shutdown()
  log("done")
}

main().catch((err) => {
  console.error("[gateway] fatal:", err)
  process.exit(1)
})
