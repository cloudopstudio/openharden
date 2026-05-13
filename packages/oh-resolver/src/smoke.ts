#!/usr/bin/env bun
import { create } from "./index"
import type { Identity, Signal } from "@openharden/shared"

const log = (label: string, data?: unknown) => {
  if (data === undefined) console.log(`[smoke] ${label}`)
  else console.log(`[smoke] ${label}`, JSON.stringify(data))
}

const ruben: Identity = { id: "user-ruben", email: "ruben@example.com" }
const sig = (from: string, text: string): Signal => ({
  channel: "telegram",
  from,
  text,
  ts: Date.now(),
})

const main = async () => {
  log("=== resolver: bind / resolve / switch / unbind ===")
  const r = create({ defaultProject: "openharden", defaultScope: "project" })

  let threw = false
  await r.resolve(sig("123", "hola")).catch(() => {
    threw = true
  })
  log("unbound resolve throws", { threw })

  await r.bind("telegram", "123", ruben)
  log("after bind", { whoami: await r.whoami("telegram", "123") })

  const ctx1 = await r.resolve(sig("123", "hola"))
  log("resolve default project", ctx1)

  await r.switchProject(ruben.id, "engram")
  const ctx2 = await r.resolve(sig("123", "trabajemos"))
  log("resolve after switch", { project: ctx2.project })

  const bindings = await r.list()
  log("list", bindings)

  await r.unbind("telegram", "123")
  let threwAgain = false
  await r.resolve(sig("123", "hola")).catch(() => {
    threwAgain = true
  })
  log("after unbind resolve throws", { threwAgain })

  const ok =
    threw &&
    ctx1.project === "openharden" &&
    ctx1.identity.id === ruben.id &&
    ctx2.project === "engram" &&
    bindings.length === 1 &&
    threwAgain
  log(ok ? "RESOLVER OK" : "RESOLVER FAIL")
  if (!ok) process.exit(1)
}

main().catch((err) => {
  console.error("[smoke] FAILED", err)
  process.exit(1)
})
