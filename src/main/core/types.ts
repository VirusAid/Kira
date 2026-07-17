/**
 * Kira Core — контракты ядра.
 *
 * Ядро не знает ни про интерфейс, ни про LLM: только Actions, их реестр,
 * разбор намерений и исполнение. Любой новый Action подключается добавлением
 * объекта в реестр — без изменения движка (Open/Closed).
 */

export type ActionCategory =
  | 'browser' | 'apps' | 'files' | 'media' | 'system' | 'power'
  | 'clipboard' | 'dev' | 'notify' | 'info'

export type ActionSource = 'chat' | 'voice' | 'automation' | 'agent' | 'hotkey' | 'ui' | 'llm'

export interface ActionArg {
  name: string
  description: string
  required?: boolean
}

export interface ExecResult {
  ok: boolean
  message: string
  data?: unknown
}

export interface ActionContext {
  source: ActionSource
  /** Подтверждение опасного действия (UI-слой передаёт диалог). Нет — опасное отклоняется. */
  confirm?: (description: string) => Promise<boolean>
}

export interface KiraAction {
  id: string
  title: string
  description: string
  category: ActionCategory
  /** Синонимы для поиска/сопоставления по имени (LLM, палитра, hotkeys). */
  aliases: string[]
  /**
   * Интент-паттерны (анкерные RegExp по нормализованному тексту) с именованными
   * группами-аргументами. Нет паттернов — команда не ловится из речи напрямую,
   * но доступна агентам/автоматизации/LLM по id.
   */
  patterns?: RegExp[]
  examples: string[]
  /**
   * Доп. естественные формулировки для СЕМАНТИЧЕСКОГО сопоставления (эмбеддинги).
   * Ловят команду в любой форме, когда точный regex не сработал. Указывать
   * только для безаргументных/необязательно-аргументных безопасных действий.
   */
  phrases?: string[]
  /**
   * Исключить из СЕМАНТИЧЕСКОГО индекса, даже если действие безопасно и без
   * обязательных аргументов. Для команд, чей смысл легко спутать с
   * противоположным по эмбеддингам (свернуть↔развернуть окно): точный regex их
   * ловит, а нечёткое совпадение рискует выполнить не то.
   */
  noSemantic?: boolean
  args: ActionArg[]
  /** Требует подтверждения пользователя (необратимое/чувствительное). */
  dangerous?: boolean
  /**
   * «Мягкий отказ»: если execute вернул ok:false — считать команду
   * необработанной и передать запрос AI Router (для эвристик вроде запуска
   * приложения по произвольному имени).
   */
  softFail?: boolean
  canExecute?: () => boolean | Promise<boolean>
  /** null — аргументы валидны; строка — причина, по которой ядро откажется. */
  validate?: (args: Record<string, string>) => string | null
  execute: (args: Record<string, string>, ctx: ActionContext) => Promise<ExecResult>
  undo?: (args: Record<string, string>) => Promise<ExecResult>
  /** Короткая фраза-подтверждение для озвучки (по умолчанию — result.message). */
  confirmText?: (args: Record<string, string>) => string
  /** Человекочитаемое описание для диалога подтверждения. */
  describe?: (args: Record<string, string>) => string
}

// ─── Intent ──────────────────────────────────────────────────────────────────

export type Intent =
  | { kind: 'local'; actionId: string; args: Record<string, string> }
  | { kind: 'ai' }
  | { kind: 'agent' }

/** Лёгкая проекция Action для чистого Intent Parser (без функций/electron). */
export interface IntentSpec {
  id: string
  patterns: RegExp[]
}

// ─── История ────────────────────────────────────────────────────────────────

export interface ActionRecord {
  id: string
  actionId: string
  title: string
  args: Record<string, string>
  ok: boolean
  message: string
  source: ActionSource
  at: number
}

// ─── Шина событий ────────────────────────────────────────────────────────────

export interface CoreEvents {
  'action:executed': { action: KiraAction; args: Record<string, string>; result: ExecResult; source: ActionSource }
  'action:denied': { action: KiraAction; args: Record<string, string>; source: ActionSource }
}
