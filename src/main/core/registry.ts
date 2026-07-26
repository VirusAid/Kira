/**
 * Command Registry — единый реестр всех Actions.
 * Приоритет сопоставления задаёт поле priority действия (по умолчанию 0);
 * при равенстве сохраняется порядок регистрации.
 */
import type { IntentSpec, KiraAction } from './types'

/**
 * Приоритет действия при сопоставлении: больше — раньше. По умолчанию 0.
 *
 * Универсальные «ловушки» (шаблон подходит почти под любую фразу) помечаются
 * отрицательным priority прямо в описании действия — это видно при чтении и не
 * зависит от места в файле.
 *
 * Пробовал вычислять приоритет автоматически — по количеству буквального текста
 * и «любого текста» в шаблоне. Отказался: оценка получалась непредсказуемой
 * (длинное перечисление в диагностике перевешивало короткую конкретную
 * команду), а всеядность выражается по-разному — и через «.+», и через классы
 * символов. Явная пометка честнее магии: её видно и легко проверить.
 */
function actionPriority(a: KiraAction): number {
  return a.priority ?? 0
}

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

  /**
   * Спеки для Intent Parser, отсортированные по ПРИОРИТЕТУ, а не по порядку в
   * файле. Раньше приоритет задавался местом в массиве: перенёс действие — и
   * универсальная «ловушка» могла молча перехватить конкретную команду. Теперь
   * место в файле отвечает только за читаемость, а «ловушки» помечены явно.
   */
  intentSpecs(): IntentSpec[] {
    return this.ordered
      .filter((a) => a.patterns?.length)
      .map((a, i) => ({ action: a, i, weight: actionPriority(a) }))
      // по убыванию приоритета; при равенстве — исходный порядок (стабильно)
      .sort((x, y) => y.weight - x.weight || x.i - y.i)
      .map(({ action }) => ({ id: action.id, patterns: action.patterns! }))
  }

  /**
   * Словарь слов команд — из примеров, фраз и псевдонимов самих действий.
   * Нужен для мягкой правки опечаток («сделай скриншт» → «скриншот»).
   * Берём из самих действий, чтобы словарь не расходился с реальностью.
   */
  commandVocabulary(): string[] {
    const words = new Set<string>()
    for (const a of this.ordered) {
      for (const src of [...a.examples, ...a.aliases, ...(a.phrases ?? [])]) {
        for (const w of src.trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/)) {
          // короткие и служебные слова не годятся в якоря для правки
          if (w.length >= 4 && /^[а-яa-z]+$/.test(w)) words.add(w)
        }
      }
    }
    return [...words]
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
      // Действия с ОДНИМ обязательным аргументом теперь тоже доступны смыслу:
      // раньше их было 17 из 86, и «поищи-ка в сети рецепт борща» уходило в
      // облако, хотя ядро умеет это мгновенно. Аргумент извлекается отдельно
      // (см. engine), и для таких действий порог уверенности выше.
      // С несколькими обязательными аргументами пока не работаем: угадать сразу
      // два слота по смыслу слишком рискованно.
      if (a.args.filter((arg) => arg.required).length > 1) continue
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
