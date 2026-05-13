#!/usr/bin/env bun
import { create } from "./index"
import type { Context, Identity } from "@openharden/shared"

const log = (label: string, data?: unknown) => {
  if (data === undefined) console.log(`[multi] ${label}`)
  else console.log(`[multi] ${label}`, JSON.stringify(data))
}

const identity: Identity = { id: "smoke-multi" }
const ctx = (project: string): Context => ({ project, scope: "personal", identity })

const extractText = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null
  const parts = (data as Record<string, unknown>).parts
  if (!Array.isArray(parts)) return null
  const texts = parts
    .filter((p): p is Record<string, unknown> => p && typeof p === "object" && (p as Record<string, unknown>).type === "text")
    .map((p) => p.text)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
  return texts.length > 0 ? texts.join("\n") : null
}

const askMcpTools = async (pool: ReturnType<typeof create>, project: string): Promise<string> => {
  const inst = pool.list().find((i) => i.key.project === project)
  if (!inst) return "(no instance)"
  const r = await pool.client(inst.key).session.prompt({
    path: { id: inst.sessionId },
    body: {
      parts: [
        {
          type: "text",
          text: "Sin usar ninguna herramienta, lista SOLO los nombres de los servidores MCP que tienes disponibles, uno por línea. Nada más.",
        },
      ],
    },
  })
  if (r.error) return `(transport error: ${JSON.stringify(r.error)})`
  return extractText(r.data) ?? "(no text)"
}

const main = async () => {
  log("creating pool max=3")
  const pool = create({
    max: 3,
    idleMs: 60_000,
  })

  log("spawning alpha + beta in parallel...")
  const [a, b] = await Promise.all([pool.acquire(ctx("alpha")), pool.acquire(ctx("beta"))])
  await Promise.all([pool.awaitReady(a.key), pool.awaitReady(b.key)])

  const after = pool.list()
  log("parallel pool", after.map((i) => ({ project: i.key.project, url: i.url, sessionId: i.sessionId })))

  if (after.length !== 2) {
    log("PARALLEL FAIL: expected 2 instances")
    await pool.shutdown()
    process.exit(1)
  }
  log("PARALLEL OK: 2 opencodes running in parallel with distinct sessions")

  log("querying alpha for MCP tools (waiting up to ~30s per call)...")
  const alphaResp = await askMcpTools(pool, "alpha")
  log("alpha response:\n" + alphaResp)

  log("querying beta for MCP tools...")
  const betaResp = await askMcpTools(pool, "beta")
  log("beta response:\n" + betaResp)

  const alphaHasEngram = /engram/i.test(alphaResp)
  const betaHasEngram = /engram/i.test(betaResp)
  log("engram visibility", { alpha: alphaHasEngram, beta: betaHasEngram })

  log("shutdown")
  await pool.shutdown()

  if (alphaHasEngram && betaHasEngram) {
    log("ENGRAM OK: both opencodes report engram MCP available")
  } else {
    log("ENGRAM PARTIAL/FAIL — check responses above")
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("[multi] fatal:", err)
  process.exit(1)
})
