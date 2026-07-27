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
 * Места во фразе, куда подставляется сказанное: «перемести $1 в $2».
 *
 * Один аргумент — частый случай, но далеко не единственный: «перемести отчёт в
 * архив» это уже два, и по-русски они разделены предлогом, а не запятой.
 * Поэтому места размечает сам человек прямо во фразе — там, где он их и
 * слышит. Без разметки фраза работает по-старому: всё сказанное после неё
 * становится единственным аргументом.
 */
const SLOT = /\$([1-9])/g

/** Сколько разных мест размечено во фразе (0 — разметки нет). */
function slotsIn(phrase: string): number[] {
  const found = new Set<number>()
  for (const m of phrase.matchAll(SLOT)) found.add(Number(m[1]))
  return [...found].sort((x, y) => x - y)
}

/**
 * Шаблон из фразы привязки.
 *
 * Пользователь пишет фразы обычными словами, а не регулярками — регулярку он
 * писать не должен и не станет. Спецсимволы экранируем: без этого фраза со
 * скобкой или точкой развалила бы разбор ВСЕХ команд, потому что шаблоны
 * компилируются в общий список.
 */
function phrasePattern(phrase: string, fallbackArg: boolean): RegExp | null {
  // ТА ЖЕ свёртка, что и у разбора: там текст приводится к нижнему регистру и
  // ё→е. Без замены «ё» фраза «найдём отчёт» не совпала бы никогда — шаблон
  // остался бы с «ё», а на вход всегда приходит «е».
  const clean = phrase.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
  if (!clean) return null

  const escape = (t: string): string =>
    t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')

  const slots = slotsIn(clean)
  if (!slots.length) {
    const body = escape(clean)
    return fallbackArg ? new RegExp(`^${body}\\s+(?<v1>.+)$`) : new RegExp(`^${body}$`)
  }

  /*
   * Собираем шаблон по кускам: между метками — буквальный текст, на месте
   * метки — группа.
   *
   * Все группы, КРОМЕ ЗАМЫКАЮЩЕЙ, нежадные: иначе первая же съела бы весь
   * остаток фразы и следующий кусок текста («в») не нашёлся бы. А последняя,
   * если после неё ничего нет, наоборот должна забрать остаток целиком —
   * нежадная оставила бы от «в архив старых отчётов» только «в».
   */
  const parts: string[] = ['^']
  const pieces: Array<{ slot: number; at: number }> = []
  let last = 0
  for (const m of clean.matchAll(SLOT)) {
    parts.push(escape(clean.slice(last, m.index)))
    pieces.push({ slot: Number(m[1]), at: parts.length })
    parts.push('') // место под группу — заполним, когда узнаем, замыкающая ли она
    last = (m.index ?? 0) + m[0].length
  }
  const tail = clean.slice(last)
  parts.push(escape(tail))
  parts.push('$')

  pieces.forEach((p, i) => {
    const isLast = i === pieces.length - 1
    const greedy = isLast && tail.trim() === ''
    parts[p.at] = `(?<v${p.slot}>.+${greedy ? '' : '?'})`
  })
  return new RegExp(parts.join(''))
}

/**
 * Что и с какими аргументами вызывали в последний раз — материал для отмены.
 * `undo(args)` получает только аргументы команды, а для отката нужно и то, что
 * было ДО вызова: прежнее содержимое файла узнать задним числом уже нельзя.
 */
const lastCall = new Map<string, { args: Record<string, unknown>; before: unknown }>()

/**
 * Аргументы инструмента: метки `$1`, `$2`… заменяются на сказанное, остальное
 * уходит как постоянные значения.
 *
 * Одно поле может содержать и текст, и метку («отчёт за $1»), поэтому
 * подставляем в строку, а не подменяем её целиком.
 */
function buildArgs(template: Record<string, string>, spoken: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(template)) {
    out[key] = value.replace(SLOT, (whole, n: string) => spoken[`v${n}`] ?? whole)
  }
  return out
}

/**
 * Синхронная проверка обратимости — нужна в момент СБОРКИ действия, когда
 * решается, будет ли у него отмена вообще. Список короткий и не меняется в
 * рантайме, поэтому дублировать его тут дешевле, чем делать сборку асинхронной.
 */
function isReversibleSync(tool: string): boolean {
  return tool === 'move_file' || tool === 'write_file'
}

/** Откатить последний вызов привязки. */
async function undoBinding(b: McpBinding): Promise<{ ok: boolean; message: string }> {
  const { callTool } = await import('../modules/mcp/manager')
  const { reverseOf } = await import('../modules/mcp/reversible')
  const saved = lastCall.get(b.id)
  if (!saved) return { ok: false, message: 'Не помню, что нужно вернуть' }
  lastCall.delete(b.id)
  const back = reverseOf(b.tool, saved.args, saved.before)
  if (!back) {
    return { ok: false, message: `«${b.title || b.tool}» отменить нельзя — расширение не умеет обращать это действие` }
  }
  const r = await callTool(b.server, back.call.tool, back.call.args, { timeoutMs: 30_000 })
  return r.ok ? { ok: true, message: back.said } : { ok: false, message: `Не вышло вернуть: ${r.message}` }
}

/**
 * Какие места ждёт привязка. Берём из ФРАЗ, а если разметки там нет — из
 * значений аргументов: так продолжают работать привязки, созданные раньше, где
 * `$1` стоял только в аргументе, а фраза была без меток.
 */
function slotsOf(b: McpBinding): number[] {
  const inPhrases = new Set<number>()
  for (const p of b.phrases) for (const n of slotsIn(p)) inPhrases.add(n)
  if (inPhrases.size) return [...inPhrases].sort((x, y) => x - y)
  return Object.values(b.args).some((v) => v.includes('$1')) ? [1] : []
}

/** Понятное имя места — из поля инструмента, куда оно подставляется. */
function slotLabel(b: McpBinding, slot: number): string {
  const field = Object.entries(b.args).find(([, v]) => v.includes(`$${slot}`))?.[0]
  return field ?? `часть ${slot}`
}

/** Фраза для показа человеку: метки заменяются многоточием. */
function readablePhrase(phrase: string): string {
  return phrase.replace(SLOT, '…')
}

/**
 * Одна привязка → действие.
 *
 * Возвращает null, если привязка нерабочая (нет сервера, инструмента или
 * фраз): молча зарегистрировать пустышку хуже, чем не зарегистрировать.
 */
export function bindingToAction(b: McpBinding): KiraAction | null {
  if (!b.enabled || !b.server || !b.tool || !b.phrases.length) return null

  const slots = slotsOf(b)
  // Запасной аргумент нужен только когда мест ждём, а во фразе разметки нет:
  // тогда всё сказанное после фразы становится единственным значением.
  const fallbackArg = slots.length === 1 && !b.phrases.some((p) => slotsIn(p).length)
  const patterns = b.phrases.map((p) => phrasePattern(p, fallbackArg)).filter((p): p is RegExp => !!p)
  if (!patterns.length) return null

  const title = b.title || b.tool
  const args: ActionArg[] = slots.map((n) => ({
    name: `v${n}`, description: slotLabel(b, n), required: true
  }))

  return {
    id: bindingActionId(b),
    title,
    description: `Расширение «${b.server}»: ${b.tool}`,
    category: 'dev',
    aliases: [],
    patterns,
    examples: [readablePhrase(b.phrases[0])],
    // фразы привязки идут и в смысловой слой: человек скажет их не дословно
    phrases: b.phrases,
    args,
    dangerous: b.dangerous,
    execute: async (a, ctx) => {
      const { callTool } = await import('../modules/mcp/manager')
      const { captureBefore, isReversible } = await import('../modules/mcp/reversible')
      const payload = buildArgs(b.args, a)

      // Прежнее состояние запоминаем ДО вызова — после него его уже не узнать.
      // Только для тех инструментов, у которых обратный шаг вообще существует.
      if (isReversible(b.tool)) {
        const read = async (call: { tool: string; args: Record<string, unknown> }): Promise<string | null> => {
          const r = await callTool(b.server, call.tool, call.args, { timeoutMs: 15_000 })
          return r.ok ? (r.content ?? '') : null
        }
        lastCall.set(b.id, { args: payload, before: await captureBefore(b.tool, payload, read) })
      }

      // источник 'llm' означает фоновый вызов — там ждать человека бессмысленно
      const timeoutMs = ctx.source === 'chat' || ctx.source === 'voice' ? 30_000 : 60_000
      return callTool(b.server, b.tool, payload, { timeoutMs })
    },
    // Отмена появляется ТОЛЬКО у обратимых инструментов. Вешать её на всё
    // подряд нельзя: тогда неотменяемый вызов расширения занял бы место
    // последнего отменяемого и закрыл человеку откат того, что откатить можно.
    ...(isReversibleSync(b.tool) ? { undo: () => undoBinding(b) } : {}),
    describe: (a) => {
      const said = slots.map((n) => a[`v${n}`]).filter(Boolean).join(' → ')
      return `${title}${said ? `: «${said}»` : ''} (расширение «${b.server}»)`
    }
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
