/**
 * Состояние чата: диалоги, сообщения, стриминг ответа Kira,
 * выполнение действий, голосовые колбэки.
 */
import { create } from 'zustand'
import { kira } from '@/api'
import type { Chat, ChatMessage } from '@shared/types'

function newLocalId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

export interface ActionEvent {
  name: string
  ok: boolean
  message: string
}

interface ChatState {
  chats: Chat[]
  activeChatId: string | null
  messages: ChatMessage[]
  streaming: boolean
  streamText: string
  actionEvents: ActionEvent[]
  editingMessageId: string | null
  /** колбэк для озвучивания готового ответа (голосовой режим) */
  onAssistantDone: ((text: string) => void) | null
  /** колбэк на завершённое предложение во время стриминга (потоковая озвучка) */
  onAssistantSentence: ((sentence: string) => void) | null
  /** колбэк при ошибке генерации — чтобы голос вышел из «думаю» */
  onAssistantError: ((error: string) => void) | null

  loadChats: () => Promise<void>
  openChat: (chatId: string) => Promise<void>
  newChat: (projectId?: string) => Promise<string>
  deleteChat: (chatId: string) => Promise<void>
  renameChat: (chatId: string, title: string) => Promise<void>
  togglePin: (chatId: string) => Promise<void>
  sendMessage: (text: string, options?: { withScreen?: boolean }) => Promise<void>
  stopGeneration: () => void
  editMessage: (msgId: string, content: string) => Promise<void>
  deleteMessage: (msgId: string) => Promise<void>
  regenerate: () => Promise<void>
  setEditing: (msgId: string | null) => void
  setOnAssistantDone: (cb: ((text: string) => void) | null) => void
  setOnAssistantSentence: (cb: ((sentence: string) => void) | null) => void
  setOnAssistantError: (cb: ((error: string) => void) | null) => void
}

let currentRequestId: string | null = null
let listenersBound = false
let ttsCursor = 0 // сколько символов streamText уже отдано на озвучку

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChatId: null,
  messages: [],
  streaming: false,
  streamText: '',
  actionEvents: [],
  editingMessageId: null,
  onAssistantDone: null,
  onAssistantSentence: null,
  onAssistantError: null,

  loadChats: async () => {
    bindListeners()
    const chats = await kira.chats.list()
    set({ chats })
  },

  openChat: async (chatId) => {
    const messages = await kira.messages.list(chatId)
    set({ activeChatId: chatId, messages, actionEvents: [], editingMessageId: null })
  },

  newChat: async (projectId) => {
    const chat = await kira.chats.create(projectId ? { projectId } : undefined)
    set((s) => ({ chats: [chat, ...s.chats], activeChatId: chat.id, messages: [], actionEvents: [] }))
    return chat.id
  },

  deleteChat: async (chatId) => {
    await kira.chats.delete(chatId)
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== chatId),
      activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
      messages: s.activeChatId === chatId ? [] : s.messages
    }))
  },

  renameChat: async (chatId, title) => {
    await kira.chats.update(chatId, { title })
    set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, title } : c)) }))
  },

  togglePin: async (chatId) => {
    const chat = get().chats.find((c) => c.id === chatId)
    if (!chat) return
    await kira.chats.update(chatId, { pinned: !chat.pinned })
    set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, pinned: !c.pinned } : c)) }))
  },

  sendMessage: async (text, options) => {
    const state = get()
    if (state.streaming || !text.trim()) return

    let chatId = state.activeChatId
    const isFirst = !chatId || state.messages.length === 0
    if (!chatId) chatId = await get().newChat()

    const userMsg: ChatMessage = {
      id: newLocalId(),
      chatId,
      role: 'user',
      content: text.trim(),
      createdAt: Date.now()
    }
    await kira.messages.append(userMsg)
    ttsCursor = 0 // страховка: прошлый запрос мог умереть без done/error
    set((s) => ({ messages: [...s.messages, userMsg], streaming: true, streamText: '', actionEvents: [] }))

    // скриншот для «зрения»
    let imageBase64: string | undefined
    if (options?.withScreen) {
      try {
        imageBase64 = await kira.ai.captureScreen()
      } catch {
        /* экран недоступен — продолжаем без него */
      }
    }

    const history = get().messages
      .filter((m) => !m.error)
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content }))

    currentRequestId = newLocalId()
    void kira.ai.chat({
      requestId: currentRequestId,
      chatId,
      messages: history,
      withTools: true,
      imageBase64
    })

    // автогенерация названия для нового диалога
    if (isFirst) {
      void kira.ai.generateTitle(text).then((title) => {
        void kira.chats.update(chatId!, { title })
        set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, title } : c)) }))
      })
    }
  },

  stopGeneration: () => {
    if (currentRequestId) void kira.ai.abort(currentRequestId)
  },

  editMessage: async (msgId, content) => {
    const { activeChatId } = get()
    if (!activeChatId) return
    await kira.messages.update(activeChatId, msgId, { content, editedAt: Date.now() })
    set((s) => ({
      messages: s.messages.map((m) => (m.id === msgId ? { ...m, content, editedAt: Date.now() } : m)),
      editingMessageId: null
    }))
  },

  deleteMessage: async (msgId) => {
    const { activeChatId } = get()
    if (!activeChatId) return
    await kira.messages.delete(activeChatId, msgId)
    set((s) => ({ messages: s.messages.filter((m) => m.id !== msgId) }))
  },

  regenerate: async () => {
    const { messages, activeChatId } = get()
    if (!activeChatId || get().streaming) return
    // убираем последний ответ ассистента и повторяем запрос
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    if (lastAssistant) {
      await kira.messages.delete(activeChatId, lastAssistant.id)
      set((s) => ({ messages: s.messages.filter((m) => m.id !== lastAssistant.id) }))
    }
    const history = get().messages
      .filter((m) => !m.error)
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content }))
    if (!history.length) return
    ttsCursor = 0
    set({ streaming: true, streamText: '', actionEvents: [] })
    currentRequestId = newLocalId()
    void kira.ai.chat({ requestId: currentRequestId, chatId: activeChatId, messages: history, withTools: true })
  },

  setEditing: (msgId) => set({ editingMessageId: msgId }),
  setOnAssistantDone: (cb) => set({ onAssistantDone: cb }),
  setOnAssistantSentence: (cb) => set({ onAssistantSentence: cb }),
  setOnAssistantError: (cb) => set({ onAssistantError: cb })
}))

/** Подписка на события стриминга из main-процесса (однократно). */
function bindListeners(): void {
  if (listenersBound) return
  listenersBound = true
  const store = useChatStore

  kira.on('ai:chunk', (payload) => {
    const { requestId, delta } = payload as { requestId: string; delta: string }
    // событие от УЖЕ ПРЕРВАННОГО запроса — игнорируем, иначе его текст
    // примешивается к новому ответу (гонка при быстрых перебиваниях)
    if (requestId !== currentRequestId) return
    const s = store.getState()
    const streamText = s.streamText + delta
    store.setState({ streamText })
    // потоковая озвучка: выделяем завершённые предложения и отдаём их голосу сразу
    const cb = s.onAssistantSentence
    if (cb) {
      const pending = streamText.slice(ttsCursor)
      const re = /[^.!?…\n]*[.!?…\n]+/g
      let m: RegExpExecArray | null
      let consumed = 0
      while ((m = re.exec(pending)) !== null) {
        const sentence = m[0].trim()
        if (sentence.replace(/[^a-zа-яё0-9]/gi, '').length > 1) cb(sentence)
        consumed = m.index + m[0].length
      }
      ttsCursor += consumed
    }
  })

  kira.on('ai:action', (payload) => {
    const event = payload as { requestId?: string; name: string; ok: boolean; message: string }
    if (event.requestId && event.requestId !== currentRequestId) return
    store.setState((s) => ({ actionEvents: [...s.actionEvents, event] }))
  })

  kira.on('ai:done', (payload) => {
    const { requestId, content, model } = payload as { requestId: string; content: string; model: string }
    if (requestId !== currentRequestId) return // финал прерванного запроса — не пишем
    const s = store.getState()
    const chatId = s.activeChatId
    if (!chatId) {
      store.setState({ streaming: false, streamText: '' })
      return
    }
    const assistantMsg: ChatMessage = {
      id: newLocalId(),
      chatId,
      role: 'assistant',
      content,
      createdAt: Date.now(),
      model
    }
    void kira.messages.append(assistantMsg)
    // потоковая озвучка: договариваем «хвост» после последнего знака препинания
    if (s.onAssistantSentence && s.streamText) {
      const tail = s.streamText.slice(ttsCursor).trim()
      if (tail.replace(/[^a-zа-яё0-9]/gi, '').length > 1) s.onAssistantSentence(tail)
    } else if (s.onAssistantSentence && content && content !== '…') {
      // ответ пришёл целиком без стрима (локальные команды Kira Core) — озвучиваем его
      const brief = content.slice(0, 400).trim()
      if (brief.replace(/[^a-zа-яё0-9]/gi, '').length > 1) s.onAssistantSentence(brief)
    }
    ttsCursor = 0
    store.setState((st) => ({
      messages: [...st.messages, assistantMsg],
      streaming: false,
      streamText: ''
    }))
    s.onAssistantDone?.(content)
  })

  kira.on('ai:error', (payload) => {
    const { requestId, error } = payload as { requestId: string; error: string }
    if (requestId !== currentRequestId) return // ошибка прерванного запроса — молчим
    const s = store.getState()
    const chatId = s.activeChatId
    if (chatId) {
      const errMsg: ChatMessage = {
        id: newLocalId(),
        chatId,
        role: 'assistant',
        content: `⚠️ ${error}`,
        createdAt: Date.now(),
        error: true
      }
      void kira.messages.append(errMsg)
      store.setState((st) => ({ messages: [...st.messages, errMsg], streaming: false, streamText: '' }))
    } else {
      store.setState({ streaming: false, streamText: '' })
    }
    ttsCursor = 0
    // выводим голос из состояния «думаю», чтобы он снова слушал
    store.getState().onAssistantError?.(error)
  })
}
