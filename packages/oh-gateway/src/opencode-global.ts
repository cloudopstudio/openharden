import os from "node:os"
import path from "node:path"
import type { Config } from "@opencode-ai/sdk"

export type EntryConfig = Record<string, unknown>

export type Catalog = {
  mcps: Record<string, EntryConfig>
  agents: Record<string, EntryConfig>
  skillsPaths: string[]
  skillsUrls: string[]
}

export type SkillDef = { path?: string; url?: string }

export type OpenhardenCatalogs = {
  mcps?: Record<string, EntryConfig>
  agents?: Record<string, EntryConfig>
  skills?: Record<string, SkillDef>
}

export type ProjectScope = {
  mcps?: string[]
  agents?: string[]
  skills?: string[]
}

const xdgConfigHome = (): string => process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")

const stripJsoncComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const readJsonish = async (filepath: string): Promise<Record<string, unknown> | null> => {
  const file = Bun.file(filepath)
  if (!(await file.exists())) return null
  const text = await file.text()
  if (!text.trim()) return null
  const cleaned = filepath.endsWith(".jsonc") ? stripJsoncComments(text) : text
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    return null
  }
}

const deepMerge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k]
    if (prev && typeof prev === "object" && !Array.isArray(prev) && v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

const asRecord = (value: unknown): Record<string, EntryConfig> => {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, EntryConfig>
}

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string")
}

export const loadGlobalCatalog = async (): Promise<Catalog> => {
  const dir = path.join(xdgConfigHome(), "opencode")
  const files = ["config.json", "opencode.json", "opencode.jsonc"]
  let merged: Record<string, unknown> = {}
  for (const f of files) {
    const data = await readJsonish(path.join(dir, f))
    if (data) merged = deepMerge(merged, data)
  }
  const skills = (merged.skills ?? {}) as Record<string, unknown>
  return {
    mcps: asRecord(merged.mcp),
    agents: asRecord(merged.agent),
    skillsPaths: asStringArray(skills.paths),
    skillsUrls: asStringArray(skills.urls),
  }
}

const buildMcpSection = (
  global: Record<string, EntryConfig>,
  own: Record<string, EntryConfig>,
  allowed: Set<string>,
): Record<string, EntryConfig> => {
  const out: Record<string, EntryConfig> = {}
  for (const [name, cfg] of Object.entries(global)) {
    if (!allowed.has(name)) out[name] = { ...cfg, enabled: false }
  }
  for (const [name, cfg] of Object.entries(own)) {
    if (allowed.has(name)) out[name] = cfg
  }
  return out
}

const buildAgentSection = (
  global: Record<string, EntryConfig>,
  own: Record<string, EntryConfig>,
  allowed: Set<string>,
): Record<string, EntryConfig> => {
  const out: Record<string, EntryConfig> = {}
  for (const name of Object.keys(global)) {
    if (!allowed.has(name)) out[name] = { disable: true }
  }
  for (const [name, cfg] of Object.entries(own)) {
    if (allowed.has(name)) out[name] = cfg
  }
  return out
}

const buildSkillsSection = (
  global: Catalog,
  own: Record<string, SkillDef>,
  allowed: Set<string>,
): { paths?: string[]; urls?: string[] } | undefined => {
  const ownPaths: string[] = []
  const ownUrls: string[] = []
  for (const [name, def] of Object.entries(own)) {
    if (!allowed.has(name)) continue
    if (def.path) ownPaths.push(def.path)
    if (def.url) ownUrls.push(def.url)
  }
  const paths = [...global.skillsPaths, ...ownPaths]
  const urls = [...global.skillsUrls, ...ownUrls]
  if (paths.length === 0 && urls.length === 0) return undefined
  const out: { paths?: string[]; urls?: string[] } = {}
  if (paths.length > 0) out.paths = paths
  if (urls.length > 0) out.urls = urls
  return out
}

export type BuildResult = {
  config: Config | undefined
  summary: {
    mcpsDisabled: string[]
    mcpsAdded: string[]
    agentsDisabled: string[]
    agentsAdded: string[]
    skillsAdded: string[]
  }
}

export const buildSpawnConfig = (
  global: Catalog,
  own: OpenhardenCatalogs,
  scope: ProjectScope | undefined,
): BuildResult => {
  if (!scope) return { config: undefined, summary: emptySummary() }
  const ownMcps = own.mcps ?? {}
  const ownAgents = own.agents ?? {}
  const ownSkills = own.skills ?? {}
  const allowedMcps = new Set(scope.mcps ?? [])
  const allowedAgents = new Set(scope.agents ?? [])
  const allowedSkills = new Set(scope.skills ?? [])

  const mcp = buildMcpSection(global.mcps, ownMcps, allowedMcps)
  const agent = buildAgentSection(global.agents, ownAgents, allowedAgents)
  const skills = buildSkillsSection(global, ownSkills, allowedSkills)

  const config: Record<string, unknown> = {}
  if (Object.keys(mcp).length > 0) config.mcp = mcp
  if (Object.keys(agent).length > 0) config.agent = agent
  if (skills) config.skills = skills
  if (Object.keys(config).length === 0) return { config: undefined, summary: emptySummary() }

  return {
    config: config as Config,
    summary: {
      mcpsDisabled: Object.keys(global.mcps).filter((n) => !allowedMcps.has(n)),
      mcpsAdded: Object.keys(ownMcps).filter((n) => allowedMcps.has(n)),
      agentsDisabled: Object.keys(global.agents).filter((n) => !allowedAgents.has(n)),
      agentsAdded: Object.keys(ownAgents).filter((n) => allowedAgents.has(n)),
      skillsAdded: Object.keys(ownSkills).filter((n) => allowedSkills.has(n)),
    },
  }
}

const emptySummary = (): BuildResult["summary"] => ({
  mcpsDisabled: [],
  mcpsAdded: [],
  agentsDisabled: [],
  agentsAdded: [],
  skillsAdded: [],
})
