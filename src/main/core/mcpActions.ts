/**
 * Привязки расширений → обычные действия ядра.
 *
 * Ключевая мысль всей затеи: инструмент чужого сервера не заслуживает
 * отдельного пути исполнения. Привязка превращается в такой же KiraAction, как
 * встроенные, — и дальше движок, история, отмена, характер, обучение и
 * подтверждение опасного работают с ней, ничего про MCP не зная. Поэтому
 * добавление расширений не потребовало ни одной правки в движке.
 *
 * Схема инструмента описывает поверхность API: `owner`, `repo`, `labels`.
 * Человек говорит «заведи задачу, что кнопка не работает». Привязка и есть
 * мост между этими двумя поверхностями: фразы вызова + куда подставить
 * сказанное.
 */
import { registry } from './registry'
import { extractArg } from './engine'
import { logger } from '../modules/logger'
import type { ActionArg, KiraAction } from './types'
import type { McpBinding } from '../modules/mcp/types'

/** Префикс идентификаторов. По нему же реестр снимает регистрацию пачкой. */
export const MCP_PREFIX = 'mcp:'

/** Идентификатор действия для привязки: он попадает и в выученные фразы. */
export function bindingActionId(b: McpBinding): string {
  return `${MCP_PREFIX}${b.server}/${b.tool}`
}

/**
 * Шаблон из фразы привязки.
 *
 * Пользователь пишет фразы обычными словами, а не регулярками — регулярку он
 * писать не должен и не станет. Спецсимволы экранируем: без этого фраза со
 * скобкой или точкой развалила бы разбор ВСЕХ команд, потому что шаблоны
 * компилируются в общий список.
 */
function phrasePattern(phrase: string, needsArg: boolean): RegExp | null {
  // ТА ЖЕ свёртка, что и у разбора: там текст приводится к нижнему регистру и
  // ё→е. Без замены «ё» фраза «найдём отчёт» не совпала бы никогда — шаблон
  // остался бы с «ё», а на вход всегда приходит «е».
  const clean = phrase.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
  if (!clean) return null
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  return needsArg
    ? new RegExp(`^${escaped}\\s+(?<value>.+)$`)
    : new RegExp(`^${escaped}$`)
}

/** Нужен ли привязке аргумент из речи — то есть встречается ли где-то `$1`. */
function usesSpokenValue(b: McpBinding): boolean {
  return Object.values(b.args).some((v) => v.includes('$1'))
}

/**
 * Одна привязка → действие.
 *
 * Возвращает null, если привязка нерабочая (нет сервера, инструмента или
 * фраз): молча зарегистрировать пустышку хуже, чем не зарегистрировать.
 */
export function bindingToAction(b: McpBinding): KiraAction | null {
  if (!b.enabled || !b.server || !b.tool || !b.phrases.length) return null

  const needsArg = usesSpokenValue(b)
  const patterns = b.phrases.map((p) => phrasePattern(p, needsArg)).filter((p): p is RegExp => !!p)
  if (!patterns.length) return null

  const title = b.title || b.tool
  const args: ActionArg[] = needsArg
    ? [{ name: 'value', description: 'что именно', required: true }]
    : []

  return {
    id: bindingActionId(b),
    title,
    description: `Расширение «${b.server}»: ${b.tool}`,
    category: 'dev',
    aliases: [],
    patterns,
    examples: [b.phrases[0]],
    // фразы привязки идут и в смысловой слой: человек скажет их не дословно
    phrases: b.phrases,
    args,
    dangerous: b.dangerous,
    execute: async (a, ctx) => {
      const { callTool } = await import('../modules/mcp/manager')
      // подставляем сказанное туда, где стоит $1; остальное — постоянные значения
      const payload: Record<string, unknown> = {}
      for (const [key, template] of Object.entries(b.args)) {
        payload[key] = template.includes('$1') ? template.replace('$1', a.value ?? '') : template
      }
      // источник 'llm' означает фоновый вызов — там ждать человека бессмысленно
      const timeoutMs = ctx.source === 'chat' || ctx.source === 'voice' ? 30_000 : 60_000
      return callTool(b.server, b.tool, payload, { timeoutMs })
    },
    describe: (a) => `${title}${a.value ? `: «${a.value}»` : ''} (расширение «${b.server}»)`
  }
}

/**
 * Пересобрать действия расширений в реестре.
 *
 * Зовётся при любом изменении: подключили сервер, поправили привязку, сервер
 * прислал новый список инструментов. Реестр меняется пакетом, а кэш смыслового
 * слоя сбрасывается — иначе новые фразы не попали бы в поиск по смыслу.
 */
export function syncMcpActions(bindings: McpBinding[]): number {
  const actions = bindings.map(bindingToAction).filter((a): a is KiraAction => !!a)
  registry.replacePrefixed(MCP_PREFIX, actions)
  logger.info('mcp', `Команд расширений в ядре: ${actions.length}`)
  return actions.length
}

/** Достать аргумент из фразы — тот же способ, что и у встроенных действий. */
export { extractArg }
