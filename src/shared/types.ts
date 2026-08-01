/**
 * Общие типы Kira — единый контракт между main-процессом и renderer.
 */

// ─── Чат ────────────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  chatId: string
  role: ChatRole
  content: string
  createdAt: number
  editedAt?: number
  /** Прикреплённые файлы (пути) */
  attachments?: string[]
  /** Сообщение — результат системного действия */
  isAction?: boolean
  /** Модель, сгенерировавшая ответ */
  model?: string
  /** Ошибка генерации */
  error?: boolean
}

export interface Chat {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  projectId?: string
  pinned?: boolean
  messageCount: number
}

// ─── Память ─────────────────────────────────────────────────────────────────

export type MemoryCategory =
  | 'preference'
  | 'project'
  | 'note'
  | 'contact'
  | 'fact'
  | 'setting'

export interface MemoryEntry {
  id: string
  category: MemoryCategory
  title: string
  content: string
  createdAt: number
  updatedAt: number
  /** Источник: 'user' — добавлено вручную, 'kira' — сохранено ассистентом */
  source: 'user' | 'kira'
  pinned?: boolean
}

// ─── Проекты ────────────────────────────────────────────────────────────────

export type ProjectStatus = 'active' | 'paused' | 'done' | 'archived'

export interface ProjectGoal {
  id: string
  text: string
  done: boolean
}

export interface ProjectNote {
  id: string
  text: string
  createdAt: number
}

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  tags: string[]
  goals: ProjectGoal[]
  notes: ProjectNote[]
  /** Путь к папке проекта на диске */
  path?: string
  progress: number
  createdAt: number
  updatedAt: number
}

// ─── Протоколы ──────────────────────────────────────────────────────────────

export type ProtocolStepType =
  | 'open_app'
  | 'open_url'
  | 'open_file'
  | 'run_command'
  | 'create_folder'
  | 'move_file'
  | 'copy_file'
  | 'delete_file'
  | 'wait'
  | 'notify'
  | 'ai_prompt'
  | 'set_volume'
  | 'screenshot'
  | 'type_text'

export interface ProtocolStep {
  id: string
  type: ProtocolStepType
  /** Основной параметр: путь, URL, команда, текст… */
  target: string
  /** Доп. параметр: аргументы, путь назначения, секунды ожидания */
  param?: string
  enabled: boolean
}

export interface Protocol {
  id: string
  name: string
  description: string
  icon: string
  steps: ProtocolStep[]
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  runCount: number
}

export interface ProtocolRunState {
  protocolId: string
  running: boolean
  currentStep: number
  totalSteps: number
  stepLabel?: string
  error?: string
}

// ─── Навыки (Abilities / Skills) ────────────────────────────────────────────
//
// Навык — переиспользуемая способность Kira, описанная обычным языком.
// Инструкции навыка инжектятся в системный промпт, поэтому Kira выполняет их
// своим обычным агентным циклом (всеми инструментами) — отдельный движок не
// нужен. «Skills» = экспорт/импорт навыков файлом (.kira-skill.json).

export interface Ability {
  id: string
  name: string
  /** Что делает навык — понятным языком (видит пользователь). */
  description: string
  /** Как именно Kira должна это выполнять — инструкция для модели. */
  instructions: string
  /** Фразы, по которым Kira распознаёт запрос навыка. */
  triggers: string[]
  icon: string
  enabled: boolean
  /** user — создан пользователем/Kira; imported — установлен из файла. */
  source: 'user' | 'imported'
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  runCount: number
}

// ─── Автоматизация ──────────────────────────────────────────────────────────

export type AutomationTriggerType = 'schedule' | 'app_start' | 'file_watch'

export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: AutomationTriggerType
  /** cron-выражение для schedule, путь папки для file_watch */
  triggerParam: string
  protocolId: string
  createdAt: number
  lastFiredAt?: number
  fireCount: number
}

// ─── Логи ───────────────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error' | 'action' | 'ai'

export interface LogEntry {
  id: string
  level: LogLevel
  source: string
  message: string
  createdAt: number
}

// ─── Настройки ──────────────────────────────────────────────────────────────

export type AIProviderId = 'ollama' | 'groq' | 'openrouter' | 'gemini' | 'deepseek' | 'claude' | 'glm'

export interface AIProviderConfig {
  apiKey?: string
  model: string
  baseUrl?: string
}

export interface KiraSettings {
  userName: string
  /** Как Kira обращается к пользователю */
  addressStyle:
    | 'name' | 'sir' | 'madam' | 'boss' | 'friend' | 'commander'
    | 'chief' | 'master' | 'darling' | 'hero' | 'custom'
  /** Своё обращение, если addressStyle = 'custom' */
  customAddress: string
  provider: AIProviderId
  providers: Record<AIProviderId, AIProviderConfig>
  /** Предпочитать локальный офлайн-мозг (Ollama), облако — как запас */
  preferLocal: boolean
  personality: string
  voiceEnabled: boolean
  /**
   * Движок синтеза речи:
   *  'silero' — локальный нейросетевой (CPU, лучшее качество RU, офлайн)
   *  'edge'   — облачный нейросетевой Microsoft
   *  'system' — системные голоса Windows
   */
  ttsEngine: 'silero' | 'edge' | 'system'
  /** Голос Silero: xenia | kseniya | baya | aidar | eugene */
  sileroSpeaker: string
  /** Голос Edge TTS (напр. ru-RU-SvetlanaNeural) */
  edgeVoice: string
  /** Имя системного голоса (Web Speech), если ttsEngine = 'system' */
  voiceName: string
  /**
   * Микрофон, которым Kira слушает (deviceId). Пусто — устройство Windows по
   * умолчанию. Нужен выбор: у людей одновременно веб-камера, гарнитура и
   * микрофон монитора, и Windows часто выбирает не тот.
   */
  micDeviceId: string
  voiceRate: number
  /** Высота тона для Edge TTS, Гц (-30…+30) */
  voicePitch: number
  voiceAutoListen: boolean
  theme: 'dark' | 'darker'
  accent: string
  fontSize: number
  /** Насыщенность и количество анимаций интерфейса */
  animationLevel: 'full' | 'reduced' | 'off'
  confirmDangerous: boolean
  launchOnStartup: boolean
  memoryAutoSave: boolean
  /** Глобальная горячая клавиша вызова Kira (Electron accelerator), '' — выкл */
  summonHotkey: string
  /** Горячая клавиша AI Actions по выделенному тексту, '' — выкл */
  aiActionsHotkey: string
  /** Режим слова-активатора: реагировать только на фразы со словом «Кира» */
  wakeWordEnabled: boolean
  /** Само слово активации */
  wakeWord: string
  /** Проактивность: мониторинг системы и брифинги */
  proactiveEnabled: boolean
  /** Насколько активно Kira сама подсказывает: calm / balanced / active */
  proactiveLevel: 'calm' | 'balanced' | 'active'
  /** Помощь по контексту экрана: Kira ненавязчиво видит, чем ты занят, и предлагает помощь */
  screenAssist: boolean
  /** Утренний брифинг раз в день */
  briefingEnabled: boolean
  /** Час, после которого делать брифинг */
  briefingHour: number
  /** Разрешить Kira управлять мышью/клавиатурой (computer use) */
  allowControl: boolean
  /** Узнавать голос хозяина — реагировать только на него */
  speakerVerify: boolean
  /** Чувствовать эмоции по голосу и подстраивать тон */
  /** Пройден ли мастер знакомства при первом запуске */
  onboarded: boolean
  /** Персональный профиль пользователя (свободный текст) для контекста Kira */
  userProfile: string
  /** Постоянная плавающая эмблема поверх всех окон */
  floatingOrb: boolean
  /** Папка с документами для локальной базы знаний (RAG) */
  knowledgeFolder: string
  /** Интеграции */
  obsidianVault: string // путь к хранилищу Obsidian (папка с .md)
  notionToken: string // internal integration token Notion
  googleClientId: string // OAuth client id (Google Calendar/Gmail)
  googleClientSecret: string
  googleRefreshToken: string // получен после подключения
  discordWebhook: string // URL вебхука Discord для отправки сообщений
  discordUserToken: string // пользовательский токен для слежения за ЛС (риск: против правил Discord)
  discordDmAlerts: boolean // предупреждать о новых личных сообщениях
  telegramBotToken: string // токен бота от @BotFather
  telegramChatId: string // chat id владельца (подхватывается при первом сообщении боту)
  telegramBotEnabled: boolean // бот: чат с Kira из Telegram + отправка сообщений
  telegramApiId: string // api_id с my.telegram.org (личный аккаунт, MTProto)
  telegramApiHash: string // api_hash с my.telegram.org
  telegramSession: string // сохранённая сессия после входа (StringSession)
  telegramUserMonitor: boolean // следить за личными сообщениями (личный аккаунт)
}

// ─── Система ────────────────────────────────────────────────────────────────

export interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedAt: number
  ext: string
}

export interface ProcessInfo {
  pid: number
  name: string
  memoryMB: number
}

export interface SystemStats {
  cpuPercent: number
  memUsedGB: number
  memTotalGB: number
  uptimeHours: number
  platform: string
  hostname: string
}

// ─── Поиск ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  type: 'chat' | 'message' | 'project' | 'memory' | 'protocol' | 'ability' | 'log' | 'file'
  id: string
  title: string
  snippet: string
  /** id родителя (для сообщений — chatId) */
  parentId?: string
}

// ─── AI ─────────────────────────────────────────────────────────────────────

export interface AIStreamChunk {
  requestId: string
  delta?: string
  done?: boolean
  error?: string
  /** Вызов инструмента, распознанный в ответе */
  toolCall?: { name: string; args: Record<string, string> }
}

export interface AIRequest {
  requestId: string
  chatId: string
  messages: { role: ChatRole; content: string }[]
  /** Включить системные инструменты (управление ПК) */
  withTools?: boolean
  /** Скриншот в base64 для vision-запроса */
  imageBase64?: string
}

// ─── Результат опасного действия ────────────────────────────────────────────

export interface ActionResult {
  ok: boolean
  /** Короткий статус для пользователя. НЕ содержимое. */
  message: string
  /** Содержимое для показа/озвучки (текст экрана, найденные фрагменты, списки). */
  content?: string
  /** Структурные данные для кода. Не для показа. */
  data?: unknown
}

// ─── Расширения (MCP) ───────────────────────────────────────────────────────
//
// MCP — стандартный способ для программ отдавать наружу свои возможности. Для
// Kira это ещё один источник действий: решение о вызове принимает ядро, а не
// нейросеть. Описания ниже — чистые данные: их показывает интерфейс и хранит
// файл настроек.

/**
 * Описание сервера — чистая настройка, живёт в файле и переживает перезапуск.
 *
 * `id` задаётся ОДИН раз при подключении и дальше неизменен. Команда запуска,
 * адрес, переменные окружения — всё это можно править сколько угодно, но не
 * ключ: он попадает в идентификаторы действий (`mcp:github/create_issue`), а
 * значит и в выученные фразы. Сменить ключ — обесценить всё, чему Kira
 * научилась про этот сервер.
 */
export interface McpServerConfig {
  /** Неизменяемый ключ, задан пользователем при подключении: «github». */
  id: string
  /** Человеческое имя для интерфейса. */
  title: string
  /**
   * Как соединяться. `stdio` — программа на этом компьютере, `http` — сервер по
   * адресу (в том числе чужой, в сети).
   */
  transport: 'stdio' | 'http'
  /** Программа и аргументы запуска (stdio). */
  command: string
  args: string[]
  /** Адрес сервера (http). */
  url?: string
  /**
   * Переменные окружения. ВНИМАНИЕ: сюда попадают токены доступа, и хранятся
   * они открытым текстом — ровно как ключи облачных провайдеров рядом. При
   * подключении сервера пользователю об этом говорится прямо.
   */
  env: Record<string, string>
  cwd?: string
  enabled: boolean
}

/** Инструмент сервера — снимок, пригодный для кэша, индекса и интерфейса. */
export interface McpTool {
  name: string
  title?: string
  description: string
  /** JSON Schema входных параметров — как её отдал сервер. */
  inputSchema: Record<string, unknown>
}

/**
 * Состояние сервера. Не булево: «не работает» бывает пяти разных видов, и
 * человеку важно знать, какого именно — самодиагностика Kira должна отвечать
 * «нет токена GITHUB_TOKEN», а не «не удалось подключиться».
 */
export interface McpStatus {
  state: 'unconfigured' | 'connecting' | 'ready' | 'degraded' | 'offline'
  /** Человеческое объяснение — попадает в интерфейс и в диагностику. */
  message: string
  /** Сколько инструментов сейчас известно. */
  tools: number
}

/**
 * Привязка «фраза человека → инструмент сервера».
 *
 * Это и есть мост между поверхностью API и поверхностью человека. Схема
 * инструмента знает про `owner`, `repo`, `labels`; человек говорит «заведи
 * задачу, что кнопка не работает». Привязка описывает, как одно превращается в
 * другое: какими словами команда зовётся и куда подставляются аргументы.
 */
export interface McpBinding {
  id: string
  /** Ключ сервера (McpServerConfig.id) и имя инструмента на нём. */
  server: string
  tool: string
  /** Как команда называется для человека: «заведи задачу». */
  title: string
  /** Фразы вызова. Первая используется как пример в подсказках. */
  phrases: string[]
  /**
   * Что подставить в аргументы инструмента. Значение либо постоянное, либо
   * `$1` — то, что человек сказал после командной части.
   */
  args: Record<string, string>
  /** Требует подтверждения. По умолчанию ДА — про чужой инструмент мы не знаем. */
  dangerous: boolean
  enabled: boolean
  createdAt: number
}

/** Состояние обновления Kira — общее для main и интерфейса. */
export interface UpdateState {
  /** установленная версия */
  current: string
  stage: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error'
  /** версия найденного обновления */
  version?: string
  /** 0..100 при загрузке */
  percent?: number
  /** человеческое пояснение, в том числе причина сбоя */
  message?: string
}
