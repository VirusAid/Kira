/** Сторы данных: память, проекты, протоколы, автоматизация, логи. */
import { create } from 'zustand'
import { kira } from '@/api'
import type {
  Automation, LogEntry, MemoryEntry, Project, Protocol, ProtocolRunState, Ability
} from '@shared/types'

// ─── Память ─────────────────────────────────────────────────────────────────

interface MemoryState {
  entries: MemoryEntry[]
  load: () => Promise<void>
  save: (entry: Partial<MemoryEntry>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useMemoryStore = create<MemoryState>((set) => ({
  entries: [],
  load: async () => set({ entries: await kira.memory.list() }),
  save: async (entry) => {
    await kira.memory.save(entry)
    set({ entries: await kira.memory.list() })
  },
  remove: async (id) => {
    await kira.memory.delete(id)
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
  }
}))

// ─── Проекты ────────────────────────────────────────────────────────────────

interface ProjectState {
  projects: Project[]
  load: () => Promise<void>
  save: (project: Partial<Project>) => Promise<Project>
  remove: (id: string) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  load: async () => set({ projects: await kira.projects.list() }),
  save: async (project) => {
    const saved = await kira.projects.save(project)
    set({ projects: await kira.projects.list() })
    return saved
  },
  remove: async (id) => {
    await kira.projects.delete(id)
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
  }
}))

// ─── Протоколы ──────────────────────────────────────────────────────────────

interface ProtocolState {
  protocols: Protocol[]
  runStates: Record<string, ProtocolRunState>
  load: () => Promise<void>
  save: (protocol: Partial<Protocol>) => Promise<Protocol>
  remove: (id: string) => Promise<void>
  run: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  duplicate: (id: string) => Promise<void>
}

let protocolListenerBound = false

export const useProtocolStore = create<ProtocolState>((set) => ({
  protocols: [],
  runStates: {},
  load: async () => {
    if (!protocolListenerBound) {
      protocolListenerBound = true
      kira.on('protocol:state', (payload) => {
        const state = payload as ProtocolRunState
        set((s) => ({ runStates: { ...s.runStates, [state.protocolId]: state } }))
      })
    }
    set({ protocols: await kira.protocols.list() })
  },
  save: async (protocol) => {
    const saved = await kira.protocols.save(protocol)
    set({ protocols: await kira.protocols.list() })
    return saved
  },
  remove: async (id) => {
    await kira.protocols.delete(id)
    set((s) => ({ protocols: s.protocols.filter((p) => p.id !== id) }))
  },
  run: async (id) => {
    await kira.protocols.run(id)
    set({ protocols: await kira.protocols.list() })
  },
  stop: async (id) => {
    await kira.protocols.stop(id)
  },
  duplicate: async (id) => {
    await kira.protocols.duplicate(id)
    set({ protocols: await kira.protocols.list() })
  }
}))

// ─── Автоматизация ──────────────────────────────────────────────────────────

interface AutomationState {
  automations: Automation[]
  load: () => Promise<void>
  save: (automation: Partial<Automation>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useAutomationStore = create<AutomationState>((set) => ({
  automations: [],
  load: async () => set({ automations: await kira.automations.list() }),
  save: async (automation) => {
    await kira.automations.save(automation)
    set({ automations: await kira.automations.list() })
  },
  remove: async (id) => {
    await kira.automations.delete(id)
    set((s) => ({ automations: s.automations.filter((a) => a.id !== id) }))
  }
}))

// ─── Навыки (Abilities) ─────────────────────────────────────────────────────

interface AbilityState {
  abilities: Ability[]
  load: () => Promise<void>
  save: (ability: Partial<Ability>) => Promise<Ability>
  remove: (id: string) => Promise<void>
}

export const useAbilityStore = create<AbilityState>((set) => ({
  abilities: [],
  load: async () => set({ abilities: await kira.abilities.list() }),
  save: async (ability) => {
    const saved = await kira.abilities.save(ability)
    set({ abilities: await kira.abilities.list() })
    return saved
  },
  remove: async (id) => {
    await kira.abilities.delete(id)
    set((s) => ({ abilities: s.abilities.filter((a) => a.id !== id) }))
  }
}))

// ─── Логи ───────────────────────────────────────────────────────────────────

interface LogState {
  logs: LogEntry[]
  load: () => Promise<void>
  clear: () => Promise<void>
}

let logListenerBound = false

export const useLogStore = create<LogState>((set) => ({
  logs: [],
  load: async () => {
    if (!logListenerBound) {
      logListenerBound = true
      kira.on('log:new', (payload) => {
        const entry = payload as LogEntry
        set((s) => ({ logs: [entry, ...s.logs].slice(0, 2000) }))
      })
    }
    set({ logs: await kira.logs.list(1000) })
  },
  clear: async () => {
    await kira.logs.clear()
    set({ logs: [] })
  }
}))
