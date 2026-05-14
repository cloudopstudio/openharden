import { spawn } from "node:child_process"

export type Options = {
  binary?: string
  profile?: string
}

export type StateSnapshot = {
  folder: string | null
  organization: string | null
  engramProject: string | null
}

export type Context = {
  enabled: boolean
  saveState(identity: string, state: StateSnapshot, source: string): Promise<void>
  saveSession(identity: string, folder: string, detail: string): Promise<void>
  listProjects(): Promise<string[]>
}

const projectFor = (identity: string): string => `${identity}_root`

const exec = (binary: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const proc = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (b) => (stdout += b.toString()))
    proc.stderr.on("data", (b) => (stderr += b.toString()))
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }))
    proc.on("error", (err) => resolve({ code: -1, stdout, stderr: stderr + String(err) }))
  })

export const create = (opts: Options): Context => {
  const binary = opts.binary ?? "engram"
  const profileArgs = opts.profile ? ["--profile", opts.profile] : []

  const save = async (
    project: string,
    title: string,
    body: string,
    type: string,
  ): Promise<void> => {
    const args = [...profileArgs, "save", title, body, "--project", project, "--type", type]
    const r = await exec(binary, args)
    if (r.code !== 0) {
      throw new Error(`engram save failed (code=${r.code}): ${r.stderr.trim() || r.stdout.trim()}`)
    }
  }

  return {
    enabled: true,
    async saveState(identity, state, source) {
      const body = JSON.stringify({ ...state, source, ts: new Date().toISOString() })
      await save(projectFor(identity), "state/current", body, "state")
    },
    async saveSession(identity, folder, detail) {
      const body = JSON.stringify({ folder, detail, ts: new Date().toISOString() })
      await save(projectFor(identity), `session/${folder}`, body, "session")
    },
    async listProjects() {
      const r = await exec(binary, [...profileArgs, "projects", "list"])
      if (r.code !== 0) {
        throw new Error(`engram projects list failed (code=${r.code}): ${r.stderr.trim() || r.stdout.trim()}`)
      }
      return parseProjectNames(r.stdout)
    },
  }
}

const parseProjectNames = (output: string): string[] => {
  const names: string[] = []
  const rowPattern = /^(.+?)\s{2,}\d+\s+(?:obs|observation)/
  for (const line of output.split("\n")) {
    if (!line.trim()) continue
    const m = line.match(rowPattern)
    if (!m) continue
    const name = m[1]?.trim()
    if (!name) continue
    if (name.toLowerCase().startsWith("projects ")) continue
    names.push(name)
  }
  return Array.from(new Set(names)).sort()
}

export const disabled = (): Context => ({
  enabled: false,
  async saveState() {},
  async saveSession() {},
  async listProjects() {
    return []
  },
})
