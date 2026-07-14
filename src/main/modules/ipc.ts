/**
 * IPC — регистрация всех каналов связи main ↔ renderer.
 * Каждый домен (чат, память, проекты…) — своя группа обработчиков.
 */
import { BrowserWindow, ipcMain, dialog } from 'electron'
import { db } from './db'
import { newId } from './ids'
import { logger } from './logger'
import { getSettings, saveSettings } from './settings'
import { handleChatRequest, abortRequest, confirmAction, generateChatTitle } from './ai/chat'
import { testProvider, completeChat, listProviderModels } from './ai/client'
import { synthesize, EDGE_VOICES } from './ai/tts'
import { silero, SILERO_SPEAKERS } from './ai/silero'
import { wakeWord } from './ai/wakeword'
import { semantic } from './ai/semantic'
import { speaker } from './ai/speaker'
import { emotion } from './ai/emotion'
import * as system from './system'
import * as files from './files'
import { runProtocol, stopProtocol, duplicateProtocol } from './protocols'
import { listAbilities, saveAbility, deleteAbility, runAbilityByName, draftFromDescription } from './abilities'
import { isFileMenuInstalled, installFileMenu, removeFileMenu } from './shellIntegration'
import { rearmAutomation, removeAutomationTrigger } from './automation'
import { registerHotkey } from './window'
import { addReminder, listReminders, deleteReminder } from './reminders'
import { globalSearch } from './search'
import { updateVoice, requestOpenMain, requestToggleVoice, refreshVisibility } from './overlay'
import { undoLast, historyLabels } from './undo'
import { integrationStatus, connectGoogle, calendarToday, gmailList, discordSend } from './integrations'
import { restartDiscordMonitor, verifyDiscordToken } from './discord'
import { restartTelegram, verifyTelegramBot } from './telegram'
import { startUserLogin, submitCode, submitPassword, telegramUserStatus, logoutTelegramUser } from './telegramUser'
import type {
  AIRequest, Automation, Chat, ChatMessage, KiraSettings,
  MemoryEntry, Project, Protocol, Ability
} from '../../shared/types'

/**
 * Whisper на тишине/шуме выдаёт устойчивые «фразы-призраки» (артефакт обучения
 * на субтитрах YouTube). Отсекаем их, чтобы Kira не отвечала на пустоту.
 */
const WHISPER_HALLUCINATIONS = [
  'продолжение следует', 'спасибо за просмотр', 'спасибо за внимание',
  'субтитры делал', 'субтитры сделал', 'субтитры создавал', 'субтитры подготовил',
  'редактор субтитров', 'корректор', 'до новых встреч', 'подписывайтесь',
  'ставьте лайки', 'всем пока', 'продолжение в следующей', 'спасибо что смотрите',
  'дякую за перегляд', 'thanks for watching', 'subscribe', 'продолжение',
  'музыка', '.', '...', 'ннн'
]

function isWhisperHallucination(text: string): boolean {
  const t = text.toLowerCase().replace(/[!?.,…]+$/g, '').trim()
  if (!t) return true
  // слишком короткие обрывки (1-2 символа) — почти всегда шум
  if (t.replace(/[^a-zа-яё0-9]/gi, '').length < 3) return true
  return WHISPER_HALLUCINATIONS.some((h) => t === h || (h.length > 6 && t.includes(h)))
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // ─── AI ───────────────────────────────────────────────────────────────────
  ipcMain.handle('ai:chat', (_e, req: AIRequest) => {
    const win = getWindow()
    if (win) void handleChatRequest(win, req)
  })
  ipcMain.handle('ai:abort', (_e, requestId: string) => abortRequest(requestId))
  ipcMain.handle('ai:confirm-response', (_e, confirmId: string, approved: boolean) =>
    confirmAction(confirmId, approved)
  )
  ipcMain.handle('ai:test-provider', () => testProvider())
  ipcMain.handle('ai:list-models', (_e, providerId: string) => listProviderModels(providerId as never))
  ipcMain.handle('ai:generate-title', (_e, firstMessage: string) => generateChatTitle(firstMessage))
  ipcMain.handle('ai:capture-screen', () => system.captureScreenBase64())

  // Синтез речи: Silero (локальный) → Edge (облачный) → системный голос
  ipcMain.handle('tts:voices', () => ({ silero: SILERO_SPEAKERS, edge: EDGE_VOICES }))
  ipcMain.handle('tts:silero-available', () => silero.isAvailable())
  ipcMain.handle('tts:python-check', () => silero.checkPython())

  // Офлайн-активатор «Кира» (Vosk)
  ipcMain.handle('wake:available', () => wakeWord.isAvailable())
  ipcMain.handle('wake:start', () => wakeWord.start())
  ipcMain.handle('wake:stop', () => wakeWord.stop())
  ipcMain.on('wake:feed', (_e, pcm: ArrayBuffer) => wakeWord.feed(Buffer.from(pcm)))
  ipcMain.handle('wake:install', async () => {
    const win = getWindow()
    return wakeWord.install((line) => {
      if (win && !win.isDestroyed()) win.webContents.send('wake:install-progress', line)
    })
  })

  // Узнавание голоса (speaker verification)
  ipcMain.handle('speaker:available', () => speaker.isAvailable())
  ipcMain.handle('speaker:enrolled', () => speaker.isEnrolled())
  ipcMain.handle('speaker:enroll', (_e, samples: string[]) => speaker.enroll(samples))
  ipcMain.handle('speaker:verify', (_e, pcm: string) => speaker.verify(pcm))
  ipcMain.handle('speaker:clear', () => speaker.clearEnrollment())
  ipcMain.handle('speaker:install', async () => {
    const win = getWindow()
    return speaker.install((line) => {
      if (win && !win.isDestroyed()) win.webContents.send('speaker:install-progress', line)
    })
  })

  // Анализ тона голоса (эмоции)
  ipcMain.handle('emotion:available', () => emotion.isAvailable())
  ipcMain.handle('emotion:analyze', (_e, pcm: string) => emotion.analyze(pcm))

  // Семантическая память (эмбеддинги)
  ipcMain.handle('semantic:available', () => semantic.isAvailable())
  ipcMain.handle('semantic:install', async () => {
    const win = getWindow()
    return semantic.install((line) => {
      if (win && !win.isDestroyed()) win.webContents.send('semantic:install-progress', line)
    })
  })
  ipcMain.handle('tts:silero-install', async () => {
    const win = getWindow()
    return silero.install((line) => {
      if (win && !win.isDestroyed()) win.webContents.send('silero:install-progress', line)
    })
  })
  ipcMain.handle('tts:synthesize', async (_e, text: string, override?: { engine?: string; speaker?: string }) => {
    const s = getSettings()
    const engine = override?.engine ?? s.ttsEngine

    if (engine === 'system') return { ok: false, audio: '', format: '', engine: 'system' }

    // 1. Silero — локальный, приоритетный
    if (engine === 'silero') {
      try {
        const audio = await silero.synthesize(text, override?.speaker ?? s.sileroSpeaker)
        return { ok: true, audio, format: 'wav', engine: 'silero' }
      } catch (err) {
        logger.warn('tts', `Silero недоступен, пробую Edge: ${(err as Error).message}`)
      }
    }

    // 2. Edge TTS — облачный нейросетевой
    try {
      const audio = await synthesize(text, { voice: s.edgeVoice, rate: s.voiceRate, pitch: s.voicePitch })
      return { ok: true, audio, format: 'mp3', engine: 'edge' }
    } catch (err) {
      return { ok: false, audio: '', format: '', engine: 'system', error: (err as Error).message }
    }
  })

  // Groq Whisper — распознавание речи (бесплатный tier)
  ipcMain.handle('ai:transcribe', async (_e, audioBase64: string, mimeType: string) => {
    const s = getSettings()
    const groqKey = s.providers.groq.apiKey

    // офлайн-резерв: распознаём локально через Vosk (та же модель, что у wake-word)
    const offlineFallback = async (): Promise<{ ok: boolean; text: string; error?: string } | null> => {
      if (!mimeType.includes('wav')) return null
      const { voskStt } = await import('./ai/voskStt')
      if (!voskStt.hasModel()) return null
      const r = await voskStt.transcribe(audioBase64)
      if (!r.ok) return null
      logger.info('vosk-stt', 'Распознано офлайн (Vosk)')
      return { ok: true, text: r.text }
    }

    if (!groqKey) {
      const off = await offlineFallback()
      if (off) return off
      return { ok: false, text: '', error: 'Для голосового ввода нужен бесплатный API-ключ Groq (настройки → Модели). Он также включает распознавание речи Whisper.' }
    }
    try {
      const buffer = Buffer.from(audioBase64, 'base64')
      const form = new FormData()
      const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
      form.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`)
      // large-v3 точнее «turbo» для русского; язык фиксируем
      form.append('model', 'whisper-large-v3')
      form.append('language', 'ru')
      form.append('temperature', '0')
      // подсказка-контекст улучшает распознавание имён/команд
      form.append('prompt', 'Разговор с ассистентом Кира на русском: включи музыку, фильм, открой, найди, напомни.')
      // verbose_json даёт no_speech_prob и avg_logprob — по ним отсекаем тишину
      form.append('response_format', 'verbose_json')
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}` },
        body: form
      })
      if (!res.ok) {
        const off = await offlineFallback()
        if (off) return off
        return { ok: false, text: '', error: `Whisper: ошибка ${res.status}` }
      }
      const json = (await res.json()) as {
        text?: string
        segments?: { no_speech_prob?: number; avg_logprob?: number }[]
      }
      const text = (json.text ?? '').trim()

      // 1. Отсекаем «тишину»: высокая вероятность отсутствия речи + низкая уверенность
      const segs = json.segments ?? []
      if (segs.length) {
        const avgNoSpeech = segs.reduce((a, s) => a + (s.no_speech_prob ?? 0), 0) / segs.length
        const avgLogprob = segs.reduce((a, s) => a + (s.avg_logprob ?? 0), 0) / segs.length
        if (avgNoSpeech > 0.6 && avgLogprob < -0.45) {
          return { ok: true, text: '' }
        }
      }

      // 2. Отсекаем типичные «галлюцинации» Whisper на тишине/шуме
      if (isWhisperHallucination(text)) return { ok: true, text: '' }

      return { ok: true, text }
    } catch (err) {
      // сеть недоступна — пробуем офлайн (Vosk)
      const off = await offlineFallback()
      if (off) return off
      return { ok: false, text: '', error: (err as Error).message }
    }
  })

  // ─── Чаты ─────────────────────────────────────────────────────────────────
  ipcMain.handle('chats:list', () => db().chats.all().sort((a, b) => b.updatedAt - a.updatedAt))
  ipcMain.handle('chats:create', (_e, partial?: Partial<Chat>) => {
    const chat: Chat = {
      id: newId(),
      title: partial?.title ?? 'Новый диалог',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId: partial?.projectId,
      messageCount: 0
    }
    return db().chats.put(chat)
  })
  ipcMain.handle('chats:update', (_e, id: string, partial: Partial<Chat>) =>
    db().chats.patch(id, { ...partial, updatedAt: Date.now() })
  )
  ipcMain.handle('chats:delete', async (_e, id: string) => {
    db().chats.delete(id)
    await db().messages.deleteChat(id)
    return true
  })
  ipcMain.handle('messages:list', (_e, chatId: string) => db().messages.listChat(chatId))
  ipcMain.handle('messages:append', (_e, msg: ChatMessage) => {
    db().messages.append(msg)
    const chat = db().chats.get(msg.chatId)
    if (chat) db().chats.patch(chat.id, { updatedAt: Date.now(), messageCount: chat.messageCount + 1 })
    return msg
  })
  ipcMain.handle('messages:update', (_e, chatId: string, msgId: string, partial: Partial<ChatMessage>) =>
    db().messages.update(chatId, msgId, partial)
  )
  ipcMain.handle('messages:delete', (_e, chatId: string, msgId: string) => {
    const ok = db().messages.remove(chatId, msgId)
    const chat = db().chats.get(chatId)
    if (ok && chat) db().chats.patch(chatId, { messageCount: Math.max(0, chat.messageCount - 1) })
    return ok
  })

  // ─── Память ───────────────────────────────────────────────────────────────
  ipcMain.handle('memory:list', () => db().memory.all().sort((a, b) => b.updatedAt - a.updatedAt))
  ipcMain.handle('memory:save', (_e, entry: Partial<MemoryEntry> & { id?: string }) => {
    if (entry.id) {
      return db().memory.patch(entry.id, { ...entry, updatedAt: Date.now() })
    }
    const created: MemoryEntry = {
      id: newId(),
      category: entry.category ?? 'note',
      title: entry.title ?? '',
      content: entry.content ?? '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: 'user',
      pinned: entry.pinned
    }
    return db().memory.put(created)
  })
  ipcMain.handle('memory:delete', (_e, id: string) => db().memory.delete(id))

  // ─── Проекты ──────────────────────────────────────────────────────────────
  ipcMain.handle('projects:list', () => db().projects.all().sort((a, b) => b.updatedAt - a.updatedAt))
  ipcMain.handle('projects:save', (_e, project: Partial<Project> & { id?: string }) => {
    if (project.id && db().projects.get(project.id)) {
      return db().projects.patch(project.id, { ...project, updatedAt: Date.now() })
    }
    const created: Project = {
      id: newId(),
      name: project.name ?? 'Новый проект',
      description: project.description ?? '',
      status: project.status ?? 'active',
      tags: project.tags ?? [],
      goals: project.goals ?? [],
      notes: project.notes ?? [],
      path: project.path,
      progress: project.progress ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    logger.info('projects', `Создан проект «${created.name}»`)
    return db().projects.put(created)
  })
  ipcMain.handle('projects:delete', (_e, id: string) => {
    const p = db().projects.get(id)
    if (p) logger.info('projects', `Удалён проект «${p.name}»`)
    return db().projects.delete(id)
  })

  // ─── Протоколы ────────────────────────────────────────────────────────────
  ipcMain.handle('protocols:list', () => db().protocols.all().sort((a, b) => b.updatedAt - a.updatedAt))
  ipcMain.handle('protocols:save', (_e, protocol: Partial<Protocol> & { id?: string }) => {
    if (protocol.id && db().protocols.get(protocol.id)) {
      return db().protocols.patch(protocol.id, { ...protocol, updatedAt: Date.now() })
    }
    const created: Protocol = {
      id: newId(),
      name: protocol.name ?? 'Новый протокол',
      description: protocol.description ?? '',
      icon: protocol.icon ?? 'zap',
      steps: protocol.steps ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0
    }
    logger.info('protocols', `Создан протокол «${created.name}»`)
    return db().protocols.put(created)
  })
  ipcMain.handle('protocols:delete', (_e, id: string) => db().protocols.delete(id))
  ipcMain.handle('protocols:run', (_e, id: string) => runProtocol(id))
  ipcMain.handle('protocols:stop', (_e, id: string) => stopProtocol(id))
  ipcMain.handle('protocols:duplicate', (_e, id: string) => duplicateProtocol(id))
  ipcMain.handle('protocols:export', async (_e, id: string) => {
    const protocol = db().protocols.get(id)
    if (!protocol) return { ok: false, message: 'Протокол не найден' }
    const win = getWindow()
    if (!win) return { ok: false, message: 'Нет окна' }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${protocol.name}.kira-protocol.json`,
      filters: [{ name: 'Kira Protocol', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, message: 'Отменено' }
    await files.writeTextFile(result.filePath, JSON.stringify(protocol, null, 2))
    return { ok: true, message: `Экспортировано: ${result.filePath}` }
  })
  ipcMain.handle('protocols:import', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Kira Protocol', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    try {
      const raw = JSON.parse(await files.readTextFile(result.filePaths[0]))
      const imported: Protocol = {
        ...raw,
        id: newId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        runCount: 0,
        lastRunAt: undefined
      }
      db().protocols.put(imported)
      logger.info('protocols', `Импортирован протокол «${imported.name}»`)
      return imported
    } catch {
      return null
    }
  })

  // ── Навыки (Abilities / Skills) ──
  ipcMain.handle('abilities:list', () => listAbilities())
  ipcMain.handle('abilities:save', (_e, ability: Partial<Ability> & { id?: string }) => saveAbility(ability))
  ipcMain.handle('abilities:delete', (_e, id: string) => deleteAbility(id))
  ipcMain.handle('abilities:run', (_e, name: string) => runAbilityByName(name))
  ipcMain.handle('abilities:draft', (_e, text: string) => draftFromDescription(text))
  ipcMain.handle('abilities:export', async (_e, id: string) => {
    const ability = db().abilities.get(id)
    if (!ability) return { ok: false, message: 'Навык не найден' }
    const win = getWindow()
    if (!win) return { ok: false, message: 'Нет окна' }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${ability.name}.kira-skill.json`,
      filters: [{ name: 'Kira Skill', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, message: 'Отменено' }
    await files.writeTextFile(result.filePath, JSON.stringify(ability, null, 2))
    return { ok: true, message: `Экспортировано: ${result.filePath}` }
  })
  ipcMain.handle('abilities:import', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Kira Skill', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    try {
      const raw = JSON.parse(await files.readTextFile(result.filePaths[0]))
      return saveAbility({
        name: raw.name,
        description: raw.description,
        instructions: raw.instructions,
        triggers: raw.triggers,
        icon: raw.icon,
        enabled: true,
        source: 'imported'
      })
    } catch {
      return null
    }
  })

  // ── AI Actions (действия по выделенному тексту) ──
  ipcMain.handle('ai:quick', async (_e, instruction: string, text: string) => {
    try {
      const answer = await completeChat([
        {
          role: 'system',
          content:
            'Ты — быстрый ассистент. Выполни ОДНО действие над текстом пользователя и верни ТОЛЬКО результат — ' +
            'без пояснений, без вступлений, без кавычек вокруг ответа. Сохраняй смысл и, если не сказано иначе, ' +
            'отвечай на языке исходного текста.'
        },
        { role: 'user', content: `${instruction}\n\nТекст:\n${text}` }
      ])
      return { ok: true, result: answer.trim() }
    } catch (err) {
      return { ok: false, result: '', error: (err as Error).message }
    }
  })
  ipcMain.handle('ai-actions:replace', async (_e, text: string) => {
    system.clipboardWrite(text)
    await new Promise((r) => setTimeout(r, 80))
    return system.pressKeys('^v')
  })

  // ── Kira Core: реестр команд, прямой вызов, история действий ──
  ipcMain.handle('core:commands', async () => {
    const { registry, initKiraCore } = await import('../core')
    initKiraCore()
    return registry.list()
  })
  ipcMain.handle('core:execute', async (_e, id: string, args?: Record<string, string>) => {
    const { commandEngine, initKiraCore } = await import('../core')
    initKiraCore()
    const res = await commandEngine.executeById(id, args ?? {}, { source: 'ui' })
    return res ?? { ok: false, message: `Команда не найдена: ${id}` }
  })
  ipcMain.handle('core:history', async (_e, limit?: number) => {
    const { actionHistory } = await import('../core')
    return actionHistory.list(limit ?? 100)
  })

  // ── Интеграция с Проводником (контекстное меню файлов) ──
  ipcMain.handle('shell:menu-status', () => isFileMenuInstalled())
  ipcMain.handle('shell:menu-install', () => installFileMenu())
  ipcMain.handle('shell:menu-remove', () => removeFileMenu())

  // ─── Автоматизация ────────────────────────────────────────────────────────
  ipcMain.handle('automations:list', () => db().automations.all())
  ipcMain.handle('automations:save', (_e, automation: Partial<Automation> & { id?: string }) => {
    let saved: Automation
    if (automation.id && db().automations.get(automation.id)) {
      saved = db().automations.patch(automation.id, automation)!
    } else {
      saved = db().automations.put({
        id: newId(),
        name: automation.name ?? 'Автоматизация',
        enabled: automation.enabled ?? true,
        trigger: automation.trigger ?? 'schedule',
        triggerParam: automation.triggerParam ?? '0 9 * * *',
        protocolId: automation.protocolId ?? '',
        createdAt: Date.now(),
        fireCount: 0
      })
    }
    rearmAutomation(saved.id)
    return saved
  })
  ipcMain.handle('automations:delete', (_e, id: string) => {
    removeAutomationTrigger(id)
    return db().automations.delete(id)
  })

  // ─── Логи ─────────────────────────────────────────────────────────────────
  ipcMain.handle('logs:list', (_e, limit?: number) => {
    const all = db().logs.all().sort((a, b) => b.createdAt - a.createdAt)
    return limit ? all.slice(0, limit) : all
  })
  ipcMain.handle('logs:clear', () => {
    for (const l of db().logs.all()) db().logs.delete(l.id)
    return true
  })

  // ─── Настройки ────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, next: KiraSettings) => {
    const saved = saveSettings(next)
    registerHotkey()
    refreshVisibility()
    restartDiscordMonitor()
    restartTelegram()
    logger.info('settings', 'Настройки сохранены')
    return saved
  })

  // ─── Система ──────────────────────────────────────────────────────────────
  ipcMain.handle('system:stats', () => system.systemStats())
  ipcMain.handle('system:open-app', (_e, name: string) => system.openApp(name))
  ipcMain.handle('system:open-url', (_e, url: string) => system.openUrl(url))
  ipcMain.handle('system:volume', (_e, percent: number) => system.setVolume(percent))
  ipcMain.handle('system:screenshot', () => system.takeScreenshot())
  ipcMain.handle('system:processes', () => system.listProcesses())
  ipcMain.handle('system:kill', (_e, pidOrName: string) => system.killProcess(pidOrName))
  ipcMain.handle('system:power', (_e, action: 'shutdown' | 'restart' | 'sleep' | 'lock') =>
    system.powerAction(action)
  )
  ipcMain.handle('system:lock', () => system.powerAction('lock'))
  ipcMain.handle('system:brightness', (_e, percent: number) => system.setBrightness(percent))
  ipcMain.handle('system:mute', (_e, mute: boolean) => system.setMute(mute))
  ipcMain.handle('system:media', (_e, action: string) => system.mediaControl(action as never))
  ipcMain.handle('system:windows', () => system.listWindows())
  ipcMain.handle('system:window-action', (_e, name: string, action: 'focus' | 'minimize' | 'maximize' | 'close') =>
    system.windowAction(name, action)
  )
  ipcMain.handle('system:minimize-all', () => system.minimizeAll())
  ipcMain.handle('system:capture-sources', () => system.listCaptureSources())
  ipcMain.handle('system:save-recording', (_e, base64: string) => system.saveRecording(base64))
  ipcMain.handle('system:play-music', (_e, query: string) => system.playMusic(query))
  ipcMain.handle('system:play-video', (_e, query: string) => system.playVideo(query))
  ipcMain.handle('system:search-web', (_e, query: string) => system.searchWeb(query))
  ipcMain.handle('system:open-search', (_e, query: string, engine: 'google' | 'youtube') =>
    system.openSearch(query, engine)
  )
  ipcMain.handle('system:read-page', (_e, url: string) => system.readWebPage(url))
  ipcMain.handle('system:click', (_e, x: number, y: number, btn: 'left' | 'right' | 'double') => system.mouseClick(x, y, btn))
  ipcMain.handle('system:click-text', (_e, text: string) => system.clickElement(text))
  ipcMain.handle('system:press-keys', (_e, keys: string) => system.pressKeys(keys))

  // ─── Отмена действий ──────────────────────────────────────────────────────
  ipcMain.handle('undo:list', () => historyLabels())
  ipcMain.handle('undo:last', () => undoLast())

  // ─── Напоминания ──────────────────────────────────────────────────────────
  ipcMain.handle('reminders:list', () => listReminders())
  ipcMain.handle('reminders:add', (_e, text: string, when: string) => addReminder(text, when))
  ipcMain.handle('reminders:delete', (_e, id: string) => deleteReminder(id))

  // ─── Файлы ────────────────────────────────────────────────────────────────
  ipcMain.handle('files:home-dirs', () => files.homeDirs())
  ipcMain.handle('files:list', (_e, path: string) => files.listDir(path))
  ipcMain.handle('files:search', (_e, root: string, query: string) => files.searchFiles(root, query))
  ipcMain.handle('files:search-user', (_e, query: string) => files.searchUserFiles(query))
  ipcMain.handle('files:read', (_e, path: string) => files.readTextFile(path))
  ipcMain.handle('files:read-document', (_e, path: string) => files.readDocument(path))
  ipcMain.handle('files:search-content', (_e, query: string) => files.searchFileContents(query))
  ipcMain.handle('files:is-text', (_e, path: string) => files.isTextFile(path))
  ipcMain.handle('files:is-document', (_e, path: string) => files.isReadableDocument(path))
  ipcMain.handle('files:write', (_e, path: string, content: string) => files.writeTextFile(path, content))
  ipcMain.handle('files:mkdir', (_e, path: string) => files.createFolder(path))
  ipcMain.handle('files:trash', (_e, path: string) => files.deleteToTrash(path))
  ipcMain.handle('files:move', (_e, from: string, to: string) => files.moveFile(from, to))
  ipcMain.handle('files:copy', (_e, from: string, to: string) => files.copyFile(from, to))
  ipcMain.handle('files:rename', (_e, path: string, newName: string) => files.renameFile(path, newName))
  ipcMain.handle('files:show-in-explorer', (_e, path: string) => files.showInExplorer(path))
  ipcMain.handle('files:pick-folder', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  // ─── Поиск ────────────────────────────────────────────────────────────────
  ipcMain.handle('search:global', (_e, query: string) => globalSearch(query))

  // ─── Интеграции ───────────────────────────────────────────────────────────
  ipcMain.handle('integrations:status', () => integrationStatus())
  ipcMain.handle('integrations:connect-google', () => connectGoogle())
  ipcMain.handle('integrations:calendar-today', () => calendarToday())
  ipcMain.handle('integrations:gmail-check', () => gmailList())
  ipcMain.handle('integrations:discord-test', () => discordSend('Проверка связи от Kira 👋'))
  ipcMain.handle('integrations:discord-verify', () => verifyDiscordToken())
  ipcMain.handle('integrations:telegram-verify', () => verifyTelegramBot())
  ipcMain.handle('integrations:telegram-test', async () => {
    const { sendTelegram } = await import('./telegram')
    return sendTelegram('Проверка связи от Kira 👋')
  })
  // личный аккаунт (MTProto)
  ipcMain.handle('tg-user:send-code', (_e, phone: string) => startUserLogin(phone))
  ipcMain.handle('tg-user:submit-code', (_e, code: string) => submitCode(code))
  ipcMain.handle('tg-user:submit-password', (_e, pw: string) => submitPassword(pw))
  ipcMain.handle('tg-user:status', () => telegramUserStatus())
  ipcMain.handle('tg-user:logout', () => logoutTelegramUser())

  // ─── Оверлей голосового режима ────────────────────────────────────────────
  ipcMain.on('voice:update', (_e, p: { active: boolean; state: string; level: number }) => {
    updateVoice(p.active, p.state, p.level)
  })
  ipcMain.handle('overlay:open-main', () => requestOpenMain())
  ipcMain.handle('overlay:toggle-voice', () => requestToggleVoice())

  // ─── Окно ─────────────────────────────────────────────────────────────────
  ipcMain.handle('window:minimize', () => getWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const win = getWindow()
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('window:close', () => getWindow()?.close())
}
