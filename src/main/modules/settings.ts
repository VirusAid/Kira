/** Настройки Kira: хранение, значения по умолчанию, миграция. */
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { KiraSettings } from '../../shared/types'
import { PERSONALITY_PRESETS } from '../../shared/personalityPresets'

// дефолтная личность = пресет «Кира» (единый источник, чтобы на свежей
// установке подсвечивался активный пресет и не было рассинхрона текста)
const DEFAULT_PERSONALITY = PERSONALITY_PRESETS[0].apply.personality

export const DEFAULT_SETTINGS: KiraSettings = {
  // пусто по умолчанию — имя узнаём у пользователя в онбординге. НЕ хардкодить
  // конкретное имя: иначе КАЖДЫЙ пользователь получает «Привет, <чужое имя>».
  // Пока имя не задано, интерфейс обращается нейтрально («друг»).
  userName: '',
  addressStyle: 'name',
  customAddress: '',
  provider: 'groq',
  providers: {
    // офлайн-мозг: Qwen3 через Ollama. Модель докачивается при первом запуске и
    // подбирается под железо (recommendModel); setupBrain перезапишет этот тег на
    // фактически скачанный. 8B — разумный дефолт-плейсхолдер до автоподбора.
    ollama: { model: 'qwen3:8b', baseUrl: 'http://localhost:11434' },
    // llama-3.3-70b-versatile снят с Groq (deprecated) → gpt-oss-120b (актуальная
    // рекомендованная Groq модель, бесплатный tier). Whisper для STT остаётся.
    groq: { model: 'openai/gpt-oss-120b', apiKey: '' },
    openrouter: { model: 'meta-llama/llama-3.3-70b-instruct:free', apiKey: '' },
    gemini: { model: 'gemini-3.5-flash', apiKey: '' },
    deepseek: { model: 'deepseek-chat', apiKey: '' },
    claude: { model: 'claude-opus-4-8', apiKey: '' },
    glm: { model: 'glm-5.2', apiKey: '' }
  },
  personality: DEFAULT_PERSONALITY,
  // офлайн-мозг (Qwen3) — основной по умолчанию; облако как запас (если задан ключ).
  // Онбординг переключит на облако, если пользователь дал ключ и не стал качать модель.
  preferLocal: true,
  voiceEnabled: true,
  ttsEngine: 'silero',
  sileroSpeaker: 'xenia',
  edgeVoice: 'ru-RU-SvetlanaNeural',
  voiceName: '',
  micDeviceId: '',
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
  aiActionsHotkey: 'Control+Shift+A',
  wakeWordEnabled: false,
  wakeWord: 'кира',
  proactiveEnabled: true,
  proactiveLevel: 'balanced',
  screenAssist: false,
  briefingEnabled: true,
  briefingHour: 9,
  allowControl: true,
  speakerVerify: false,
  onboarded: false,
  userProfile: '',
  floatingOrb: true,
  knowledgeFolder: '',
  obsidianVault: '',
  notionToken: '',
  googleClientId: '',
  googleClientSecret: '',
  googleRefreshToken: '',
  discordWebhook: '',
  discordUserToken: '',
  discordDmAlerts: false,
  telegramBotToken: '',
  telegramChatId: '',
  telegramBotEnabled: false,
  telegramApiId: '',
  telegramApiHash: '',
  telegramSession: '',
  telegramUserMonitor: false
}

let cached: KiraSettings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'data', 'settings.json')
}

// ─── Секреты на диске ────────────────────────────────────────────────────────
/*
 * Ключи и токены больше не лежат в файле открытым текстом.
 *
 * В settings.json собрано всё сразу: ключи платных провайдеров, токен Telegram
 * с доступом к личной переписке, refresh-токен Google к почте и календарю. Файл
 * при этом обычный, в профиле пользователя — его забирает любая программа,
 * запущенная от того же имени, и любой синхронизатор папок заодно.
 *
 * Шифруем средствами системы (DPAPI на Windows через safeStorage): расшифровать
 * можно только под той же учётной записью на том же компьютере. Копия файла на
 * чужой машине бесполезна.
 *
 * Совместимость в обе стороны обязательна: у людей уже есть настройки со
 * старыми открытыми значениями (читаем как есть и перешифровываем при первом
 * сохранении), а откат на прежнюю версию Kira не должен оставлять человека без
 * ключей — поэтому метка формата хранится рядом со значением.
 */
const ENC_PREFIX = 'enc:v1:'
/** Поля, которые нельзя держать открытыми. Провайдерские ключи — отдельно. */
const SECRET_FIELDS: Array<keyof KiraSettings> = [
  'notionToken', 'googleClientSecret', 'googleRefreshToken',
  'discordUserToken', 'discordWebhook',
  'telegramBotToken', 'telegramApiHash', 'telegramSession'
]

function canEncrypt(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { safeStorage } = require('electron') as typeof import('electron')
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function seal(value: string): string {
  if (!value || value.startsWith(ENC_PREFIX) || !canEncrypt()) return value
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { safeStorage } = require('electron') as typeof import('electron')
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
  } catch {
    return value // не смогли — лучше рабочая Kira, чем потерянный ключ
  }
}

function unseal(value: string): string {
  if (!value || !value.startsWith(ENC_PREFIX)) return value
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { safeStorage } = require('electron') as typeof import('electron')
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    // чужой профиль или переустановленная система — ключ уже не восстановить
    return ''
  }
}

/**
 * Закрыть секреты, оставшиеся от прежних версий, — вызывается ПОСЛЕ готовности
 * приложения.
 *
 * Раньше эта миграция стояла прямо в чтении настроек и молча не работала:
 * `safeStorage.isEncryptionAvailable()` до `app.whenReady()` отвечает `false`
 * даже на Windows, а настройки читаются гораздо раньше. Проверено запуском —
 * до готовности `false`, после `true`. Отсюда правило: шифровать только тогда,
 * когда система действительно готова, и не «когда-нибудь при следующем
 * сохранении» — человек может годами не заходить в настройки.
 */
export function secureSecretsAtRest(): void {
  try {
    if (!canEncrypt() || !existsSync(settingsFile())) return
    const saved = JSON.parse(readFileSync(settingsFile(), 'utf-8')) as Record<string, unknown>
    if (!hasPlainSecret(saved)) return
    saveSettings(getSettings())
  } catch { /* не вышло — не повод мешать запуску */ }
}

/** Есть ли в сохранённом файле хоть один секрет, лежащий открытым текстом. */
function hasPlainSecret(saved: Record<string, unknown>): boolean {
  const plain = (v: unknown): boolean => typeof v === 'string' && v.length > 0 && !v.startsWith(ENC_PREFIX)
  const providers = (saved.providers ?? {}) as Record<string, { apiKey?: string }>
  for (const cfg of Object.values(providers)) if (plain(cfg?.apiKey)) return true
  for (const field of SECRET_FIELDS) if (plain(saved[field as string])) return true
  return false
}

/** Пройтись по всем секретам настроек одной функцией. */
function mapSecrets(s: KiraSettings, fn: (v: string) => string): KiraSettings {
  const providers = {} as KiraSettings['providers']
  for (const key of Object.keys(s.providers) as (keyof KiraSettings['providers'])[]) {
    const cfg = s.providers[key]
    providers[key] = cfg.apiKey ? { ...cfg, apiKey: fn(cfg.apiKey) } : { ...cfg }
  }
  const out = { ...s, providers } as unknown as Record<string, unknown>
  for (const field of SECRET_FIELDS) {
    const v = out[field as string]
    if (typeof v === 'string' && v) out[field as string] = fn(v)
  }
  return out as unknown as KiraSettings
}

export function getSettings(): KiraSettings {
  if (cached) return cached
  const file = settingsFile()
  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf-8'))
      // ГЛУБОКОЕ слияние провайдеров: shallow-merge терял НОВЫЕ поля провайдера
      // (напр. добавили ollama.baseUrl) для старых сохранённых настроек, где у
      // провайдера сохранён только apiKey/model → поле становилось undefined.
      const savedProviders = (saved.providers ?? {}) as Record<string, object>
      const providers = {} as KiraSettings['providers']
      for (const key of Object.keys(DEFAULT_SETTINGS.providers) as (keyof KiraSettings['providers'])[]) {
        providers[key] = { ...DEFAULT_SETTINGS.providers[key], ...(savedProviders[key] ?? {}) }
      }
      // в памяти секреты живут расшифрованными — остальной код о шифровании
      // не знает и знать не должен
      cached = mapSecrets({ ...DEFAULT_SETTINGS, ...saved, providers }, unseal)
      return cached!
    } catch {
      /* повреждённые настройки — используем дефолтные */
    }
  }
  cached = { ...DEFAULT_SETTINGS }
  return cached
}

/**
 * Точечная правка настроек из main.
 *
 * Нужна там, где факт узнаёт именно main и знать его обязан весь остальной код:
 * например, какая модель офлайн-разума реально скачалась. Раньше это делал
 * интерфейс — и путь через онбординг тег не записывал вовсе, из-за чего запрос
 * уходил на несуществующую модель, а Kira молча уезжала в облако.
 */
export function patchSettings(patch: Partial<KiraSettings>): KiraSettings {
  return saveSettings({ ...getSettings(), ...patch })
}

export function saveSettings(next: KiraSettings): KiraSettings {
  cached = next
  const file = settingsFile()
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // на диск — зашифрованными; старый открытый файл так перешифруется сам при
  // первом же сохранении
  writeFileSync(file, JSON.stringify(mapSecrets(next, seal), null, 2), 'utf-8')

  app.setLoginItemSettings({ openAtLogin: next.launchOnStartup })
  return next
}
