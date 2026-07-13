/**
 * Preload — безопасный мост между renderer и main.
 * Renderer получает единый объект window.kira.
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

type Listener = (...args: unknown[]) => void

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

function on(channel: string, listener: Listener): () => void {
  const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) => listener(...args)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  invoke,
  on,

  ai: {
    chat: (req: unknown) => invoke('ai:chat', req),
    abort: (requestId: string) => invoke('ai:abort', requestId),
    confirm: (confirmId: string, approved: boolean) => invoke('ai:confirm-response', confirmId, approved),
    testProvider: () => invoke('ai:test-provider'),
    listModels: (providerId: string) => invoke('ai:list-models', providerId),
    generateTitle: (msg: string) => invoke('ai:generate-title', msg),
    captureScreen: () => invoke('ai:capture-screen'),
    transcribe: (audioBase64: string, mimeType: string) => invoke('ai:transcribe', audioBase64, mimeType),
    quick: (instruction: string, text: string) => invoke('ai:quick', instruction, text),
    replaceSelection: (text: string) => invoke('ai-actions:replace', text),
    menuStatus: () => invoke('shell:menu-status'),
    menuInstall: () => invoke('shell:menu-install'),
    menuRemove: () => invoke('shell:menu-remove')
  },

  tts: {
    voices: () => invoke('tts:voices'),
    sileroAvailable: () => invoke('tts:silero-available'),
    pythonCheck: () => invoke('tts:python-check'),
    sileroInstall: () => invoke('tts:silero-install'),
    synthesize: (text: string, override?: { engine?: string; speaker?: string }) =>
      invoke('tts:synthesize', text, override)
  },

  wake: {
    available: () => invoke('wake:available'),
    start: () => invoke('wake:start'),
    stop: () => invoke('wake:stop'),
    install: () => invoke('wake:install'),
    feed: (pcm: ArrayBuffer) => ipcRenderer.send('wake:feed', pcm)
  },

  semantic: {
    available: () => invoke('semantic:available'),
    install: () => invoke('semantic:install')
  },

  speaker: {
    available: () => invoke('speaker:available'),
    enrolled: () => invoke('speaker:enrolled'),
    enroll: (samples: string[]) => invoke('speaker:enroll', samples),
    verify: (pcm: string) => invoke('speaker:verify', pcm),
    clear: () => invoke('speaker:clear'),
    install: () => invoke('speaker:install')
  },

  emotion: {
    available: () => invoke('emotion:available'),
    analyze: (pcm: string) => invoke('emotion:analyze', pcm)
  },

  overlay: {
    voiceUpdate: (p: { active: boolean; state: string; level: number }) => ipcRenderer.send('voice:update', p),
    openMain: () => invoke('overlay:open-main'),
    toggleVoice: () => invoke('overlay:toggle-voice')
  },

  undo: {
    list: () => invoke('undo:list'),
    last: () => invoke('undo:last')
  },

  integrations: {
    status: () => invoke('integrations:status'),
    connectGoogle: () => invoke('integrations:connect-google'),
    calendarToday: () => invoke('integrations:calendar-today'),
    gmailCheck: () => invoke('integrations:gmail-check'),
    discordTest: () => invoke('integrations:discord-test'),
    discordVerify: () => invoke('integrations:discord-verify'),
    telegramVerify: () => invoke('integrations:telegram-verify'),
    telegramTest: () => invoke('integrations:telegram-test'),
    tgSendCode: (phone: string) => invoke('tg-user:send-code', phone),
    tgSubmitCode: (code: string) => invoke('tg-user:submit-code', code),
    tgSubmitPassword: (pw: string) => invoke('tg-user:submit-password', pw),
    tgStatus: () => invoke('tg-user:status'),
    tgLogout: () => invoke('tg-user:logout')
  },

  chats: {
    list: () => invoke('chats:list'),
    create: (partial?: unknown) => invoke('chats:create', partial),
    update: (id: string, partial: unknown) => invoke('chats:update', id, partial),
    delete: (id: string) => invoke('chats:delete', id)
  },

  messages: {
    list: (chatId: string) => invoke('messages:list', chatId),
    append: (msg: unknown) => invoke('messages:append', msg),
    update: (chatId: string, msgId: string, partial: unknown) => invoke('messages:update', chatId, msgId, partial),
    delete: (chatId: string, msgId: string) => invoke('messages:delete', chatId, msgId)
  },

  memory: {
    list: () => invoke('memory:list'),
    save: (entry: unknown) => invoke('memory:save', entry),
    delete: (id: string) => invoke('memory:delete', id)
  },

  projects: {
    list: () => invoke('projects:list'),
    save: (project: unknown) => invoke('projects:save', project),
    delete: (id: string) => invoke('projects:delete', id)
  },

  protocols: {
    list: () => invoke('protocols:list'),
    save: (protocol: unknown) => invoke('protocols:save', protocol),
    delete: (id: string) => invoke('protocols:delete', id),
    run: (id: string) => invoke('protocols:run', id),
    stop: (id: string) => invoke('protocols:stop', id),
    duplicate: (id: string) => invoke('protocols:duplicate', id),
    export: (id: string) => invoke('protocols:export', id),
    import: () => invoke('protocols:import')
  },

  automations: {
    list: () => invoke('automations:list'),
    save: (automation: unknown) => invoke('automations:save', automation),
    delete: (id: string) => invoke('automations:delete', id)
  },

  abilities: {
    list: () => invoke('abilities:list'),
    save: (ability: unknown) => invoke('abilities:save', ability),
    delete: (id: string) => invoke('abilities:delete', id),
    run: (name: string) => invoke('abilities:run', name),
    draft: (text: string) => invoke('abilities:draft', text),
    export: (id: string) => invoke('abilities:export', id),
    import: () => invoke('abilities:import')
  },

  logs: {
    list: (limit?: number) => invoke('logs:list', limit),
    clear: () => invoke('logs:clear')
  },

  settings: {
    get: () => invoke('settings:get'),
    save: (settings: unknown) => invoke('settings:save', settings)
  },

  system: {
    stats: () => invoke('system:stats'),
    openApp: (name: string) => invoke('system:open-app', name),
    openUrl: (url: string) => invoke('system:open-url', url),
    volume: (percent: number) => invoke('system:volume', percent),
    screenshot: () => invoke('system:screenshot'),
    processes: () => invoke('system:processes'),
    kill: (pidOrName: string) => invoke('system:kill', pidOrName),
    power: (action: string) => invoke('system:power', action),
    brightness: (percent: number) => invoke('system:brightness', percent),
    mute: (mute: boolean) => invoke('system:mute', mute),
    media: (action: string) => invoke('system:media', action),
    windows: () => invoke('system:windows'),
    windowAction: (name: string, action: string) => invoke('system:window-action', name, action),
    minimizeAll: () => invoke('system:minimize-all'),
    captureSources: () => invoke('system:capture-sources'),
    saveRecording: (base64: string) => invoke('system:save-recording', base64),
    playMusic: (query: string) => invoke('system:play-music', query),
    playVideo: (query: string) => invoke('system:play-video', query),
    searchWeb: (query: string) => invoke('system:search-web', query),
    openSearch: (query: string, engine: string) => invoke('system:open-search', query, engine),
    readPage: (url: string) => invoke('system:read-page', url)
  },

  reminders: {
    list: () => invoke('reminders:list'),
    add: (text: string, when: string) => invoke('reminders:add', text, when),
    delete: (id: string) => invoke('reminders:delete', id)
  },

  files: {
    homeDirs: () => invoke('files:home-dirs'),
    list: (path: string) => invoke('files:list', path),
    search: (root: string, query: string) => invoke('files:search', root, query),
    searchUser: (query: string) => invoke('files:search-user', query),
    read: (path: string) => invoke('files:read', path),
    readDocument: (path: string) => invoke('files:read-document', path),
    searchContent: (query: string) => invoke('files:search-content', query),
    isText: (path: string) => invoke('files:is-text', path),
    isDocument: (path: string) => invoke('files:is-document', path),
    write: (path: string, content: string) => invoke('files:write', path, content),
    mkdir: (path: string) => invoke('files:mkdir', path),
    trash: (path: string) => invoke('files:trash', path),
    move: (from: string, to: string) => invoke('files:move', from, to),
    copy: (from: string, to: string) => invoke('files:copy', from, to),
    rename: (path: string, newName: string) => invoke('files:rename', path, newName),
    showInExplorer: (path: string) => invoke('files:show-in-explorer', path),
    pickFolder: () => invoke('files:pick-folder')
  },

  search: {
    global: (query: string) => invoke('search:global', query)
  },

  window: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close')
  }
}

contextBridge.exposeInMainWorld('kira', api)

export type KiraApi = typeof api
