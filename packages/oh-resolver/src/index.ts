import type { Channel, Context, Identity, Scope, Signal } from "@openharden/shared"

export type Binding = {
  channel: Channel
  from: string
  identity: Identity
}

type UserState = {
  identity: Identity
  currentProject?: string
  scope?: Scope
}

export type Resolver = {
  resolve(signal: Signal): Promise<Context>
  bind(channel: Channel, from: string, identity: Identity, project?: string): Promise<void>
  unbind(channel: Channel, from: string): Promise<void>
  whoami(channel: Channel, from: string): Promise<Identity | null>
  switchProject(identityId: string, project: string): Promise<void>
  currentProject(identityId: string): Promise<string | null>
  list(): Promise<Binding[]>
}

export type Options = {
  defaultProject: string
  defaultScope?: Scope
}

const key = (channel: Channel, from: string) => `${channel}:${from}`

const split = (k: string): { channel: Channel; from: string } => {
  const idx = k.indexOf(":")
  return { channel: k.slice(0, idx) as Channel, from: k.slice(idx + 1) }
}

export const create = (opts: Options): Resolver => {
  const bindings = new Map<string, Identity>()
  const users = new Map<string, UserState>()

  return {
    async resolve(signal) {
      const identity = bindings.get(key(signal.channel, signal.from))
      if (!identity) {
        throw new Error(`no identity bound for ${signal.channel}:${signal.from}`)
      }
      const user = users.get(identity.id)
      return {
        project: user?.currentProject ?? opts.defaultProject,
        scope: user?.scope ?? opts.defaultScope ?? "project",
        identity,
      }
    },

    async bind(channel, from, identity, project) {
      bindings.set(key(channel, from), identity)
      const existing = users.get(identity.id)
      users.set(identity.id, {
        identity,
        currentProject: project ?? existing?.currentProject,
        scope: existing?.scope,
      })
    },

    async unbind(channel, from) {
      bindings.delete(key(channel, from))
    },

    async whoami(channel, from) {
      return bindings.get(key(channel, from)) ?? null
    },

    async switchProject(identityId, project) {
      const user = users.get(identityId)
      if (!user) throw new Error(`unknown identity: ${identityId}`)
      user.currentProject = project
    },

    async currentProject(identityId) {
      return users.get(identityId)?.currentProject ?? null
    },

    async list() {
      return Array.from(bindings.entries()).map(([k, identity]) => {
        const parts = split(k)
        return { channel: parts.channel, from: parts.from, identity }
      })
    },
  }
}
