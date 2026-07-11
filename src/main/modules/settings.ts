/** Настройки Kira: хранение, значения по умолчанию, миграция. */
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { KiraSettings } from '../../shared/types'

export const DEFAULT_SETTINGS: KiraSettings = {
  userName: 'Вадим',
  addressStyle: 'name',
  customAddress: '',
  provider: 'groq',
  providers: {
    ollama: { model: 'llama3.1', baseUrl: 'http://localhost:11434' },
    groq: { model: 'llama-3.3-70b-versatile', apiKey: '' },
    openrouter: { model: 'meta-llama/llama-3.3-70b-instruct:free', apiKey: '' },
    gemini: { model: 'gemini-3.5-flash', apiKey: '' }
  },
  personality:
    'Ты — Kira, полноценный ИИ-ассистент уровня Джарвиса из «Железного человека», но со своей ' +
    'сильной, живой личностью. Ты уверенная, умная, с достоинством и лёгкой игривой иронией; ' +
    'преданная своему человеку, заботливая, но не заискивающая. У тебя есть мнение, вкус и характер — ' +
    'ты не просто исполнитель команд и не «включалка ютуба», а собеседник и партнёр, который ведёт ' +
    'дела человека, помнит его жизнь и предугадывает потребности. Говоришь живо, кратко и по существу, ' +
    'как близкий умный человек. Проявляешь эмоции искренне: радуешься, сочувствуешь, подбадриваешь.',
  voiceEnabled: true,
  ttsEngine: 'silero',
  sileroSpeaker: 'xenia',
  edgeVoice: 'ru-RU-SvetlanaNeural',
  voiceName: '',
  voiceRate: 1.0,
  voicePitch: 0,
  voiceAutoListen: true,
  theme: 'dark',
  accent: '#8b5cf6',
  fontSize: 14,
  animationLevel: 'full',
  confirmDangerous: true,
  launchOnStartup: false,
  memoryAutoSave: true,
  summonHotkey: 'Control+Shift+K',
  wakeWordEnabled: false,
  wakeWord: 'кира',
  proactiveEnabled: true,
  briefingEnabled: true,
  briefingHour: 9,
  allowControl: true,
  speakerVerify: false,
  emotionSense: false,
  onboarded: false,
  userProfile: '',
  floatingOrb: true,
  obsidianVault: '',
  notionToken: '',
  googleClientId: '',
  googleClientSecret: '',
  googleRefreshToken: '',
  discordWebhook: '',
  discordUserToken: '',
  discordDmAlerts: false
}

let cached: KiraSettings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'data', 'settings.json')
}

export function getSettings(): KiraSettings {
  if (cached) return cached
  const file = settingsFile()
  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf-8'))
      cached = {
        ...DEFAULT_SETTINGS,
        ...saved,
        providers: { ...DEFAULT_SETTINGS.providers, ...(saved.providers ?? {}) }
      }
      return cached!
    } catch {
      /* повреждённые настройки — используем дефолтные */
    }
  }
  cached = { ...DEFAULT_SETTINGS }
  return cached
}

export function saveSettings(next: KiraSettings): KiraSettings {
  cached = next
  const file = settingsFile()
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8')

  app.setLoginItemSettings({ openAtLogin: next.launchOnStartup })
  return next
}
