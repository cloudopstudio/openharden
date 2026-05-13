#!/usr/bin/env bun
import { create, type Reason } from "./index"
import type { Context, Identity } from "@openharden/shared"

const log = (label: string, data?: unknown) => {
  if (data === undefined) console.log(`[smoke] ${label}`)
  else console.log(`[smoke] ${label}`, JSON.stringify(data))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const identity: Identity = { id: "smoke-user" }
const ctx = (project: string): Context => ({
  project,
  scope: "personal",
  identity,
})

const lifecycleTest = async () => {
  log("=== lifecycle: spawn / reuse / LRU / shutdown ===")
  const pool = create({
    max: 2,
    idleMs: 60_000,
    onEvict: async (inst, reason: Reason) => {
      log(`onEvict ${reason}`, { project: inst.key.project, sessionId: inst.sessionId })
    },
  })

  const alpha = await pool.acquire(ctx("alpha"))
  await pool.awaitReady(alpha.key)
  log("alpha ready", { state: alpha.state, url: alpha.url, sessionId: alpha.sessionId })

  const alpha2 = await pool.acquire(ctx("alpha"))
  log("reuse alpha", { sameSession: alpha2.sessionId === alpha.sessionId, poolSize: pool.list().length })

  const beta = await pool.acquire(ctx("beta"))
  await pool.awaitReady(beta.key)
  log("beta ready", { state: beta.state, sessionId: beta.sessionId })

  await pool.acquire(ctx("beta"))
  log("touched beta")

  const gamma = await pool.acquire(ctx("gamma"))
  await pool.awaitReady(gamma.key)

  const after = pool.list().map((i) => i.key.project)
  const lru =
    after.length === 2 &&
    after.includes("beta") &&
    after.includes("gamma") &&
    !after.includes("alpha") &&
    alpha2.sessionId === alpha.sessionId

  log("close beta (explicit)")
  const closed = await pool.close(beta.key)
  const remaining = pool.list().map((i) => i.key.project)
  const closeOk = closed?.key.project === "beta" && remaining.length === 1 && remaining[0] === "gamma"

  const ok = lru && closeOk
  log(ok ? "LIFECYCLE OK" : "LIFECYCLE FAIL", { after, closed: closed?.key.project, remaining })

  await pool.shutdown()
  return ok
}

const idleTest = async () => {
  log("=== idle: timer-driven auto-close ===")
  let evictedReason: Reason | null = null
  const pool = create({
    max: 2,
    idleMs: 2_000,
    onEvict: async (inst, reason) => {
      evictedReason = reason
      log(`onEvict ${reason}`, { project: inst.key.project })
    },
  })

  const inst = await pool.acquire(ctx("idle-test"))
  await pool.awaitReady(inst.key)
  log("idle-test ready, waiting 3s for timeout...")
  await sleep(3_000)

  const remaining = pool.list().length
  const ok = remaining === 0 && evictedReason === "idle"
  log(ok ? "IDLE OK" : "IDLE FAIL", { remaining, evictedReason })

  await pool.shutdown()
  return ok
}

const concurrentTest = async () => {
  log("=== concurrent: 3 simultaneous acquires of same key ===")
  const pool = create({
    max: 2,
    idleMs: 60_000,
  })

  const c = ctx("concurrent-test")
  const [a, b, d] = await Promise.all([pool.acquire(c), pool.acquire(c), pool.acquire(c)])
  log("3 acquires fired", {
    poolSize: pool.list().length,
    allSameRef: a === b && b === d,
    state: a.state,
  })

  await pool.awaitReady(a.key)
  log("ready", { sessionId: a.sessionId })

  const ok =
    pool.list().length === 1 &&
    a === b &&
    b === d &&
    a.sessionId === d.sessionId &&
    a.sessionId.length > 0
  log(ok ? "CONCURRENT OK" : "CONCURRENT FAIL")

  await pool.shutdown()
  return ok
}

const main = async () => {
  const results = {
    lifecycle: await lifecycleTest(),
    idle: await idleTest(),
    concurrent: await concurrentTest(),
  }
  log("=== summary ===", results)
  const allOk = Object.values(results).every(Boolean)
  if (!allOk) {
    console.error("[smoke] SOME TESTS FAILED")
    process.exit(1)
  }
  log("ALL TESTS PASSED")
}

main().catch((err) => {
  console.error("[smoke] FAILED", err)
  process.exit(1)
})
