/** Глобальное состояние приложения: навигация, настройки, панели. */
import { create } from 'zustand'
import { kira } from '@/api'
import type { KiraSettings, SystemStats } from '@shared/types'

export type ViewId =
  | 'home' | 'chat' | 'projects' | 'protocols' | 'memory'
  | 'files' | 'automation' | 'integrations' | 'systems' | 'settings' | 'logs'

interface PendingConfirm {
  confirmId: string
  description: string
}

interface AppState {
  view: ViewId
  rightPanelOpen: boolean
  searchOpen: boolean
  settings: KiraSettings | null
  stats: SystemStats | null
  pendingConfirms: PendingConfirm[]
  /** id проекта, открытого в детальном виде */
  openProjectId: string | null
  /** полноэкранный режим голосового разговора */
  voiceImmersive: boolean

  setView: (view: ViewId) => void
  toggleRightPanel: () => void
  setSearchOpen: (open: boolean) => void
  loadSettings: () => Promise<void>
  saveSettings: (settings: KiraSettings) => Promise<void>
  refreshStats: () => Promise<void>
  pushConfirm: (confirm: PendingConfirm) => void
  resolveConfirm: (confirmId: string, approved: boolean) => void
  setOpenProject: (id: string | null) => void
  setVoiceImmersive: (v: boolean) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'home',
  rightPanelOpen: true,
  searchOpen: false,
  settings: null,
  stats: null,
  pendingConfirms: [],
  openProjectId: null,
  voiceImmersive: false,

  setView: (view) => set({ view }),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setSearchOpen: (open) => set({ searchOpen: open }),

  loadSettings: async () => {
    const settings = await kira.settings.get()
    set({ settings })
    applyTheme(settings)
  },

  saveSettings: async (settings) => {
    const saved = await kira.settings.save(settings)
    set({ settings: saved })
    applyTheme(saved)
  },

  refreshStats: async () => {
    set({ stats: await kira.system.stats() })
  },

  pushConfirm: (confirm) =>
    set((s) => ({ pendingConfirms: [...s.pendingConfirms, confirm] })),

  resolveConfirm: (confirmId, approved) => {
    void kira.ai.confirm(confirmId, approved)
    set((s) => ({ pendingConfirms: s.pendingConfirms.filter((c) => c.confirmId !== confirmId) }))
  },

  setOpenProject: (id) => set({ openProjectId: id, view: 'projects' }),
  setVoiceImmersive: (v) => set({ voiceImmersive: v })
}))

function applyTheme(s: KiraSettings): void {
  const root = document.documentElement
  root.style.setProperty('--accent', s.accent)
  root.style.setProperty('--font-size', `${s.fontSize}px`)
  root.setAttribute('data-anim', s.animationLevel ?? 'full')
  const rgb = hexToRgb(s.accent)
  if (rgb) {
    root.style.setProperty('--accent-soft', `rgba(${rgb}, 0.14)`)
    root.style.setProperty('--accent-glow', `rgba(${rgb}, 0.35)`)
    root.style.setProperty('--border', `rgba(${rgb}, 0.12)`)
    root.style.setProperty('--border-strong', `rgba(${rgb}, 0.3)`)
  }
}

function hexToRgb(hex: string): string | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null
}
