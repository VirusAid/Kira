/** Типизированный доступ к мосту window.kira (preload). */
import type {
  ActionResult, AIRequest, Automation, Chat, ChatMessage, FileItem, KiraSettings,
  LogEntry, MemoryEntry, ProcessInfo, Project, Protocol, Ability, SearchResult, SystemStats
} from '@shared/types'

interface KiraBridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void
  ai: {
    chat: (req: AIRequest) => Promise<void>
    abort: (requestId: string) => Promise<void>
    confirm: (confirmId: string, approved: boolean) => Promise<void>
    testProvider: () => Promise<{ ok: boolean; message: string }>
    generateTitle: (msg: string) => Promise<string>
    captureScreen: () => Promise<string>
    transcribe: (audioBase64: string, mimeType: string) => Promise<{ ok: boolean; text: string; error?: string }>
    quick: (instruction: string, text: string) => Promise<{ ok: boolean; result: string; error?: string }>
    replaceSelection: (text: string) => Promise<ActionResult>
    menuStatus: () => Promise<boolean>
    menuInstall: () => Promise<ActionResult>
    menuRemove: () => Promise<ActionResult>
  }
  tts: {
    voices: () => Promise<{
      silero: { id: string; label: string; gender: string }[]
      edge: { id: string; label: string; gender: 'female' | 'male'; lang: string }[]
    }>
    sileroAvailable: () => Promise<boolean>
    pythonCheck: () => Promise<{ ok: boolean; version: string }>
    sileroInstall: () => Promise<{ ok: boolean; message: string }>
    synthesize: (text: string, override?: { engine?: string; speaker?: string }) =>
      Promise<{ ok: boolean; audio: string; format: string; engine: string; error?: string }>
  }
  wake: {
    available: () => Promise<boolean>
    start: () => Promise<void>
    stop: () => Promise<void>
    install: () => Promise<{ ok: boolean; message: string }>
    feed: (pcm: ArrayBuffer) => void
  }
  semantic: {
    available: () => Promise<boolean>
    install: () => Promise<{ ok: boolean; message: string }>
  }
  speaker: {
    available: () => Promise<boolean>
    enrolled: () => Promise<boolean>
    enroll: (samples: string[]) => Promise<{ ok: boolean; message: string }>
    verify: (pcm: string) => Promise<{ isOwner: boolean; score: number }>
    clear: () => Promise<void>
    install: () => Promise<{ ok: boolean; message: string }>
  }
  emotion: {
    available: () => Promise<boolean>
    analyze: (pcm: string) => Promise<{ label: string; arousal: number; pitch: number } | null>
  }
  overlay: {
    voiceUpdate: (p: { active: boolean; state: string; level: number }) => void
    openMain: () => Promise<void>
    toggleVoice: () => Promise<void>
  }
  undo: {
    list: () => Promise<{ id: string; label: string; at: number }[]>
    last: () => Promise<ActionResult>
  }
  integrations: {
    status: () => Promise<{ obsidian: boolean; notion: boolean; google: boolean; discord: boolean }>
    connectGoogle: () => Promise<{ ok: boolean; message: string }>
    calendarToday: () => Promise<ActionResult>
    gmailCheck: () => Promise<ActionResult>
    discordTest: () => Promise<ActionResult>
    discordVerify: () => Promise<{ ok: boolean; name?: string }>
    telegramVerify: () => Promise<{ ok: boolean; username?: string }>
    telegramTest: () => Promise<ActionResult>
  }
  chats: {
    list: () => Promise<Chat[]>
    create: (partial?: Partial<Chat>) => Promise<Chat>
    update: (id: string, partial: Partial<Chat>) => Promise<Chat>
    delete: (id: string) => Promise<boolean>
  }
  messages: {
    list: (chatId: string) => Promise<ChatMessage[]>
    append: (msg: ChatMessage) => Promise<ChatMessage>
    update: (chatId: string, msgId: string, partial: Partial<ChatMessage>) => Promise<ChatMessage>
    delete: (chatId: string, msgId: string) => Promise<boolean>
  }
  memory: {
    list: () => Promise<MemoryEntry[]>
    save: (entry: Partial<MemoryEntry>) => Promise<MemoryEntry>
    delete: (id: string) => Promise<boolean>
  }
  projects: {
    list: () => Promise<Project[]>
    save: (project: Partial<Project>) => Promise<Project>
    delete: (id: string) => Promise<boolean>
  }
  protocols: {
    list: () => Promise<Protocol[]>
    save: (protocol: Partial<Protocol>) => Promise<Protocol>
    delete: (id: string) => Promise<boolean>
    run: (id: string) => Promise<ActionResult>
    stop: (id: string) => Promise<ActionResult>
    duplicate: (id: string) => Promise<Protocol | null>
    export: (id: string) => Promise<ActionResult>
    import: () => Promise<Protocol | null>
  }
  automations: {
    list: () => Promise<Automation[]>
    save: (automation: Partial<Automation>) => Promise<Automation>
    delete: (id: string) => Promise<boolean>
  }
  abilities: {
    list: () => Promise<Ability[]>
    save: (ability: Partial<Ability>) => Promise<Ability>
    delete: (id: string) => Promise<boolean>
    run: (name: string) => Promise<ActionResult>
    draft: (text: string) => Promise<Partial<Ability>>
    export: (id: string) => Promise<ActionResult>
    import: () => Promise<Ability | null>
  }
  logs: {
    list: (limit?: number) => Promise<LogEntry[]>
    clear: () => Promise<boolean>
  }
  settings: {
    get: () => Promise<KiraSettings>
    save: (settings: KiraSettings) => Promise<KiraSettings>
  }
  system: {
    stats: () => Promise<SystemStats>
    openApp: (name: string) => Promise<ActionResult>
    openUrl: (url: string) => Promise<ActionResult>
    volume: (percent: number) => Promise<ActionResult>
    screenshot: () => Promise<ActionResult>
    processes: () => Promise<ProcessInfo[]>
    kill: (pidOrName: string) => Promise<ActionResult>
    power: (action: string) => Promise<ActionResult>
    brightness: (percent: number) => Promise<ActionResult>
    mute: (mute: boolean) => Promise<ActionResult>
    media: (action: string) => Promise<ActionResult>
    windows: () => Promise<{ handle: number; title: string; processName: string }[]>
    windowAction: (name: string, action: string) => Promise<ActionResult>
    minimizeAll: () => Promise<ActionResult>
    captureSources: () => Promise<{ id: string; name: string; thumbnail: string }[]>
    saveRecording: (base64: string) => Promise<ActionResult>
    playMusic: (query: string) => Promise<ActionResult>
    playVideo: (query: string) => Promise<ActionResult>
    searchWeb: (query: string) => Promise<ActionResult>
    openSearch: (query: string, engine: string) => Promise<ActionResult>
    readPage: (url: string) => Promise<ActionResult>
  }
  reminders: {
    list: () => Promise<{ id: string; text: string; fireAt: number; createdAt: number; fired: boolean }[]>
    add: (text: string, when: string) => Promise<ActionResult>
    delete: (id: string) => Promise<boolean>
  }
  files: {
    homeDirs: () => Promise<{ name: string; path: string }[]>
    list: (path: string) => Promise<FileItem[]>
    search: (root: string, query: string) => Promise<FileItem[]>
    searchUser: (query: string) => Promise<FileItem[]>
    read: (path: string) => Promise<string>
    readDocument: (path: string) => Promise<string>
    searchContent: (query: string) => Promise<{ path: string; name: string; snippet: string }[]>
    isText: (path: string) => Promise<boolean>
    isDocument: (path: string) => Promise<boolean>
    write: (path: string, content: string) => Promise<ActionResult>
    mkdir: (path: string) => Promise<ActionResult>
    trash: (path: string) => Promise<ActionResult>
    move: (from: string, to: string) => Promise<ActionResult>
    copy: (from: string, to: string) => Promise<ActionResult>
    rename: (path: string, newName: string) => Promise<ActionResult>
    showInExplorer: (path: string) => Promise<void>
    pickFolder: () => Promise<string | null>
  }
  search: { global: (query: string) => Promise<SearchResult[]> }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
  }
}

export const kira = (window as unknown as { kira: KiraBridge }).kira
