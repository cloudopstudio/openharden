#!/usr/bin/env bun
import { match } from "./patterns"
import type { Command } from "@openharden/shared"

type Case = [string, Command | null]

const cases: Case[] = [
  ["trabajar en alpha", { kind: "switch", project: "alpha" }],
  ["trabaja en beta", { kind: "switch", project: "beta" }],
  ["cambiar a gamma", { kind: "switch", project: "gamma" }],
  ["cambia a delta", { kind: "switch", project: "delta" }],
  ["cambiarme a epsilon", { kind: "switch", project: "epsilon" }],
  ["ir a zeta", { kind: "switch", project: "zeta" }],
  ["pasar a eta", { kind: "switch", project: "eta" }],
  ["abrir proyecto theta", { kind: "switch", project: "theta" }],
  ["abre el proyecto iota", { kind: "switch", project: "iota" }],
  ["switch to kappa", { kind: "switch", project: "kappa" }],
  ["cerrar", { kind: "close" }],
  ["cerrar sesión", { kind: "close" }],
  ["cerrar la sesión", { kind: "close" }],
  ["cerrar proyecto alpha", { kind: "close", project: "alpha" }],
  ["cierra la sesión", { kind: "close" }],
  ["terminar", { kind: "close" }],
  ["termina", { kind: "close" }],
  ["finalizar sesión", { kind: "close" }],
  ["close project beta", { kind: "close", project: "beta" }],
  ["listar", { kind: "list" }],
  ["lista", { kind: "list" }],
  ["mostrar", { kind: "list" }],
  ["qué proyectos tengo", { kind: "list" }],
  ["que tengo activo", { kind: "list" }],
  ["resumen", { kind: "summary" }],
  ["resumir", { kind: "summary" }],
  ["resúmeme lo último", { kind: "summary" }],
  ["resumeme", { kind: "summary" }],
  ["qué hicimos", { kind: "summary" }],
  ["hola, cómo estás", null],
  ["", null],
  ["explicame cómo funciona react", null],
]

const eq = (a: Command | null, b: Command | null): boolean => {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  if (a.kind !== b.kind) return false
  if (a.kind === "switch" && b.kind === "switch") return a.project === b.project
  if (a.kind === "close" && b.kind === "close") return a.project === b.project
  return true
}

const fmt = (c: Command | null): string => {
  if (!c) return "null"
  if (c.kind === "switch") return `switch:${c.project}`
  if (c.kind === "close") return `close${c.project ? `:${c.project}` : ""}`
  return c.kind
}

let pass = 0
let fail = 0
for (const [input, expected] of cases) {
  const actual = match(input)
  const ok = eq(actual, expected)
  if (ok) pass++
  else {
    fail++
    console.log(`FAIL: "${input}" → got ${fmt(actual)}, expected ${fmt(expected)}`)
  }
}
console.log(`[parser-smoke] ${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)
