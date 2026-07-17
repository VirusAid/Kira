/**
 * Command Registry — единый реестр всех Actions.
 * Порядок регистрации определяет приоритет сопоставления интентов.
 */
import type { IntentSpec, KiraAction } from './types'

class CommandRegistry {
  private byId = new Map<string, KiraAction>()
  private ordered: KiraAction[] = []

  register(action: KiraAction): void {
    if (this.byId.has(action.id)) throw new Error(`Action уже зарегистрирован: ${action.id}`)
    this.byId.set(action.id, action)
    this.ordered.push(action)
  }

  registerAll(actions: KiraAction[]): void {
    for (const a of actions) this.register(a)
  }

  get(id: string): KiraAction | undefined {
    return this.byId.get(id)
  }

  /** Поиск по id или синониму (для LLM-протокола и палитры). */
  resolve(idOrAlias: string): KiraAction | undefined {
    const q = idOrAlias.trim().toLowerCase()
    return this.byId.get(q) ?? this.ordered.find((a) => a.aliases.includes(q))
  }

  /** Спеки для чистого Intent Parser. */
  intentSpecs(): IntentSpec[] {
    return this.ordered
      .filter((a) => a.patterns?.length)
      .map((a) => ({ id: a.id, patterns: a.patterns! }))
  }

  /**
   * Документы для семантического сопоставления: по одной фразе на строку.
   * Только БЕЗОПАСНЫЕ действия БЕЗ обязательных аргументов (их можно выполнить
   * без точного разбора аргументов), иначе семантика могла бы, например,
   * «выключи музыку» перепутать с «выключи компьютер».
   */
  semanticDocs(): { id: string; text: string; label: string }[] {
    const docs: { id: string; text: string; label: string }[] = []
    for (const a of this.ordered) {
      if (a.dangerous || a.noSemantic) continue
      if (a.args.some((arg) => arg.required)) continue
      const phrases = [...new Set([
        a.title.toLowerCase(), ...a.aliases, ...a.examples, ...(a.phrases ?? [])
      ])]
      for (const p of phrases) {
        if (p.trim().length > 2) docs.push({ id: a.id, text: p, label: a.id })
      }
    }
    return docs
  }

  /** Сериализуемый каталог (для UI: палитра команд, справка, hotkeys). */
  list(): Array<{
    id: string; title: string; description: string; category: string
    aliases: string[]; examples: string[]; dangerous: boolean
    args: Array<{ name: string; description: string; required?: boolean }>
  }> {
    return this.ordered.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      category: a.category,
      aliases: a.aliases,
      examples: a.examples,
      dangerous: !!a.dangerous,
      args: a.args
    }))
  }

  get size(): number {
    return this.ordered.length
  }
}

export const registry = new CommandRegistry()
