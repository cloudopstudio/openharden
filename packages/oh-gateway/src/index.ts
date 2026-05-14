#!/usr/bin/env bun
import fs from "node:fs/promises"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { create as createPool, type Reason } from "@openharden/instances"
import { create as createResolver } from "@openharden/resolver"
import { create as createTelegram, type Adapter } from "@openharden/telegram"
import { create as createDispatcher, type CurrentState, type Dispatcher, type HistoryTurn } from "@openharden/dispatcher"
import { Channel, messages, type Handler, type Reply, type Signal } from "@openharden/shared"
import { parse } from "./parser"
import { load } from "./config"
import { buildSpawnConfig, loadGlobalCatalog } from "./opencode-global"
import { create as createLogger } from "./logging"
import { create as createContext, disabled as disabledContext, type Context } from "./context"
import * as handlers from "./handlers"

const configPath = process.env.OPENHARDEN_CONFIG ?? "./openharden.config.json"

type ConsoleLevel = "debug" | "info" | "warn" | "error"
const LEVEL_ORDER: Record<ConsoleLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const consoleLevel = ((process.env.OPENHARDEN_LOG_LEVEL ?? "info").toLowerCase() as ConsoleLevel)
const consoleThreshold = LEVEL_ORDER[consoleLevel] ?? LEVEL_ORDER.info

const emit = (level: ConsoleLevel, source: string, msg: string) => {
  if (LEVEL_ORDER[level] < consoleThreshold) return
  const tag = level === "info" ? "" : `[${level}] `
  console.log(`[${source}] ${tag}${msg}`)
}

const log = (msg: string) => emit("info", "gateway", msg)
const logWarn = (msg: string) => emit("warn", "gateway", msg)

const main = async () => {
  const cfg = await load(configPath)
  log(`config loaded from ${configPath} (defaultProject=${cfg.defaultProject}, max=${cfg.max}, bindings=${cfg.bindings.length})`)

  const logger = await createLogger({
    level: cfg.logging?.level ?? "meta",
    path: cfg.logging?.path,
  })
  log(`logging level=${logger.level} path=${logger.path}`)

  const context: Context = cfg.engram?.enabled === false
    ? disabledContext()
    : createContext({ binary: cfg.engram?.binary, profile: cfg.engram?.profile })
  log(
    context.enabled
      ? `context persistence enabled (binary=${cfg.engram?.binary ?? "engram"}${cfg.engram?.profile ? ", profile=" + cfg.engram.profile : ""})`
      : `context persistence disabled`,
  )

  const resolver = createResolver({
    defaultProject: cfg.defaultProject,
    defaultScope: cfg.defaultScope,
  })
  for (const b of cfg.bindings) {
    await resolver.bind(b.channel, b.from, b.identity, b.project)
  }

  const global = await loadGlobalCatalog()
  log(
    `global catalog loaded ` +
      `(mcps=${Object.keys(global.mcps).length}, agents=${Object.keys(global.agents).length}, ` +
      `skillsPaths=${global.skillsPaths.length}, skillsUrls=${global.skillsUrls.length})`,
  )
  log(
    `openharden catalog ` +
      `(mcps=${Object.keys(cfg.mcps).length}, agents=${Object.keys(cfg.agents).length}, ` +
      `skills=${Object.keys(cfg.skills).length})`,
  )
  const orgNames = Object.keys(cfg.organizations)
  log(`organizations configured: ${orgNames.length} (${orgNames.join(", ") || "none"})`)
  if (cfg.workspaceRoot) log(`workspace root: ${cfg.workspaceRoot}`)

  const own = { mcps: cfg.mcps, agents: cfg.agents, skills: cfg.skills }

  const orgFor = (folder: string): string | null => {
    const idx = folder.indexOf("-")
    if (idx <= 0) return null
    const candidate = folder.slice(0, idx)
    return cfg.organizations[candidate] ? candidate : null
  }

  const pool = createPool({
    max: cfg.max,
    idleMs: cfg.idleMs,
    onEvict: async (inst, reason) => {
      log(`evicted ${inst.key.project} (${reason})`)
      if (context.enabled && reason === "idle") {
        await context
          .saveSession(inst.key.identity, inst.key.project, `closed by ${reason}`)
          .catch((err: unknown) =>
            log(`context saveSession failed: ${err instanceof Error ? err.message : String(err)}`),
          )
      }
    },
    resolveSpawn: (project) => {
      const org = orgFor(project)
      const orgCfg = org ? cfg.organizations[org] : null
      const cwd = cfg.workspaceRoot ? path.join(cfg.workspaceRoot, project) : undefined
      if (!orgCfg) {
        if (cwd) log(`spawn ${project}: no org match, cwd=${cwd}`)
        return cwd ? { cwd } : undefined
      }
      const { config, summary } = buildSpawnConfig(global, own, orgCfg)
      const parts: string[] = [`org=${org}`]
      if (summary.mcpsDisabled.length) parts.push(`mcps off: ${summary.mcpsDisabled.join(",")}`)
      if (summary.mcpsAdded.length) parts.push(`mcps add: ${summary.mcpsAdded.join(",")}`)
      if (summary.agentsDisabled.length) parts.push(`agents off: ${summary.agentsDisabled.join(",")}`)
      if (summary.agentsAdded.length) parts.push(`agents add: ${summary.agentsAdded.join(",")}`)
      if (summary.skillsAdded.length) parts.push(`skills add: ${summary.skillsAdded.join(",")}`)
      if (cwd) parts.push(`cwd=${cwd}`)
      log(`spawn ${project}: ${parts.join(" | ")}`)
      return { config, cwd }
    },
  })

  const deps = { pool, resolver }

  let dispatcher: Dispatcher | null = null
  if (cfg.dispatcher?.enabled !== false && cfg.workspaceRoot) {
    try {
      dispatcher = await createDispatcher({
        model: cfg.dispatcher?.model,
        workspaceRoot: cfg.workspaceRoot,
        onLog: (level, msg) => emit(level, "dispatcher", msg),
      })
      log(`dispatcher ready (model=${cfg.dispatcher?.model ?? "(opencode default)"})`)
    } catch (err) {
      logWarn(`dispatcher failed to start: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else if (!cfg.workspaceRoot) {
    log(`dispatcher disabled: no workspaceRoot configured`)
  }
  log(`console log level=${consoleLevel} (set OPENHARDEN_LOG_LEVEL=debug for verbose)`)

  const historyMax = (cfg.dispatcher?.historyTurns ?? 10) * 2
  const historyByIdentity = new Map<string, HistoryTurn[]>()

  const listFolders = async (): Promise<string[]> => {
    if (!cfg.workspaceRoot) return []
    try {
      const entries = await fs.readdir(cfg.workspaceRoot, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort()
    } catch {
      return []
    }
  }

  const orgFromFolder = (folder: string | null): string | null => {
    if (!folder) return null
    const idx = folder.indexOf("-")
    if (idx <= 0) return null
    const candidate = folder.slice(0, idx)
    return cfg.organizations[candidate] ? candidate : null
  }

  const stateFor = async (identityId: string): Promise<CurrentState> => {
    const current = await resolver.currentProject(identityId)
    if (!current || current === cfg.defaultProject) {
      return { organization: null, folder: null, engramProject: null }
    }
    return {
      organization: orgFromFolder(current),
      folder: current,
      engramProject: current,
    }
  }

  const orgList = () => Object.keys(cfg.organizations).map((name) => ({ name }))

  const handle: Handler = async (signal, reply) => {
    const ctx = await resolver.resolve(signal).catch(() => null)
    const identity = ctx?.identity.id ?? signal.from
    const project = ctx?.project ?? null

    await logger
      .write({ identity, channel: signal.channel, project, action: "incoming", text: signal.text })
      .catch(() => {})

    if (!ctx) {
      await logger
        .write({ identity, channel: signal.channel, project, action: "error", detail: { reason: "unbound" } })
        .catch(() => {})
      return messages.unbound
    }

    const cmd = await parse(signal)
    let response: string | null = null

    if (cmd.kind === "close") {
      await logger
        .write({ identity, channel: signal.channel, project, action: "close", detail: { target: cmd.project ?? project } })
        .catch(() => {})
      response = await handlers.close(deps, ctx, cmd.project)
    } else if (cmd.kind === "list") {
      response = await handlers.list(deps, ctx)
    } else if (cmd.kind === "summary") {
      response = await handlers.summary(deps, ctx, reply)
    } else if (dispatcher) {
      const currentState = await stateFor(identity)
      const folders = await listFolders()
      const engramProjects = await context.listProjects().catch(() => [])
      const history = historyByIdentity.get(identity) ?? []
      const decision = await dispatcher.decide({
        message: signal.text,
        currentState,
        organizations: orgList(),
        folders,
        engramProjects,
        history,
      })
      await logger
        .write({
          identity,
          channel: signal.channel,
          project,
          action: "dispatcher",
          detail: { action: decision.action, folder: decision.folder, organization: decision.organization },
        })
        .catch(() => {})

      const newHistory = [
        ...history,
        { role: "user" as const, text: signal.text },
        ...(decision.message ? [{ role: "assistant" as const, text: decision.message }] : []),
      ].slice(-historyMax)
      historyByIdentity.set(identity, newHistory)

      if (decision.action === "switch" && decision.folder) {
        await resolver.switchProject(identity, decision.folder)
        await deps.pool.close({ identity, project: ctx.project }).catch(() => null)
        await context
          .saveState(
            identity,
            {
              folder: decision.folder,
              organization: decision.organization,
              engramProject: decision.engramProject,
            },
            "dispatcher",
          )
          .catch((err: unknown) =>
            log(`context saveState failed: ${err instanceof Error ? err.message : String(err)}`),
          )
        response = decision.message ?? messages.spawned(decision.folder)
      } else if (decision.action === "route") {
        const folder = decision.folder ?? currentState.folder
        if (!folder) {
          response = "No tengo un proyecto activo. ¿En cuál querés trabajar?"
        } else {
          const routeCtx = { ...ctx, project: folder }
          response = await handlers.route(deps, routeCtx, signal.text, reply)
        }
      } else {
        // ask | unknown
        response = decision.message
      }
    } else if (cmd.kind === "switch") {
      await logger
        .write({ identity, channel: signal.channel, project, action: "switch", detail: { to: cmd.project } })
        .catch(() => {})
      response = await handlers.switchProject(deps, ctx, cmd.project, reply)
    } else if (cmd.kind === "route") {
      response = await handlers.route(deps, ctx, cmd.text, reply)
    }

    if (response) {
      await logger
        .write({ identity, channel: signal.channel, project, action: "response", response })
        .catch(() => {})
    }
    return response
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
    if (dispatcher) await dispatcher.shutdown().catch(() => {})
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
