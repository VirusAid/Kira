/**
 * Модель как компилятор привязок, а не как исполнитель.
 *
 * Когда ядро не поняло фразу, а нейросеть в итоге сделала дело чужим
 * инструментом — это готовая заготовка команды. Дальше та же фраза не должна
 * снова идти в облако: из пары «что сказал человек» + «что вызвала модель»
 * собирается обычная привязка, и команда становится локальной — мгновенной,
 * бесплатной и работающей офлайн.
 *
 * Модель нужна ОДИН раз, чтобы породить привязку. Дальше она из горячего пути
 * уходит совсем.
 *
 * Осторожность та же, что и в обучении фразам: собранная наугад команда будет
 * срабатывать молча, поэтому
 *  • учимся только после промаха ядра и только на успешном вызове;
 *  • только если за запрос был РОВНО ОДИН вызов расширения;
 *  • привязка создаётся со ВТОРОГО повторения, а не с первого;
 *  • она всегда требует подтверждения — про чужой инструмент мы не знаем, что
 *    он делает;
 *  • всё созданное видно в разделе «Расширения» и удаляется одной кнопкой.
 */
import { Collection } from '../storage'
import { logger } from '../logger'
import { newId } from '../ids'
import { normalize } from '../../core/intent'
import { saveBinding } from './manager'

interface Proposal {
  id: string
  /** Свёрнутая фраза человека. */
  phrase: string
  server: string
  tool: string
  /** Аргументы вызова, как их сделала модель. */
  args: Record<string, string>
  count: number
  at: number
}

/** Со скольких повторений заготовка превращается в настоящую команду. */
const CREATE_AT = 2
/** Сколько заготовок держим: это черновики, а не ценность. */
const MAX_PROPOSALS = 100

let _col: Collection<Proposal> | null = null
function col(): Collection<Proposal> {
  if (!_col) _col = new Collection<Proposal>('mcp-proposals')
  return _col
}

/**
 * Превратить конкретный вызов в шаблон.
 *
 * Если значение аргумента дословно встретилось во фразе — на его месте
 * появляется место для подстановки: «заведи задачу кнопка не работает» с
 * аргументом title=«кнопка не работает» даёт фразу «заведи задачу $1» и
 * шаблон {title: '$1'}. Значения, которых во фразе нет (например, папка или
 * репозиторий), остаются постоянными — человек их не произносит.
 */
export function generalize(
  phrase: string, args: Record<string, string>
): { phrase: string; args: Record<string, string> } {
  let out = phrase
  const template: Record<string, string> = {}
  let slot = 0
  // длинные значения подставляем первыми: короткое может оказаться частью
  // длинного, и тогда разметка встала бы в середину чужого куска
  const entries = Object.entries(args).sort((a, b) => String(b[1]).length - String(a[1]).length)
  for (const [key, value] of entries) {
    const v = String(value).trim()
    const at = v.length >= 2 ? out.toLowerCase().indexOf(v.toLowerCase()) : -1
    if (at === -1) {
      template[key] = v // человек этого не говорил — значение постоянное
      continue
    }
    slot++
    out = out.slice(0, at) + `$${slot}` + out.slice(at + v.length)
    template[key] = `$${slot}`
  }
  return { phrase: out, args: template }
}

/**
 * Зафиксировать удачный вызов расширения после промаха ядра.
 * Возвращает созданную команду, когда заготовка подтвердилась во второй раз.
 */
export function noteExtensionUse(
  rawPhrase: string, server: string, tool: string, args: Record<string, string>
): { created: boolean; title: string } {
  const phrase = normalize(rawPhrase)
  // те же рамки, что у обучения фразам: длинный текст командой не станет
  if (phrase.length < 4 || phrase.length > 64) return { created: false, title: '' }
  if (phrase.split(/\s+/).length > 8) return { created: false, title: '' }

  const existing = col().all().find((p) => p.phrase === phrase && p.server === server && p.tool === tool)
  if (!existing) {
    col().put({ id: newId(), phrase, server, tool, args, count: 1, at: Date.now() })
    prune()
    return { created: false, title: '' }
  }

  const count = existing.count + 1
  col().patch(existing.id, { count, at: Date.now() })
  if (count < CREATE_AT) return { created: false, title: '' }

  const shaped = generalize(phrase, existing.args)
  const binding = saveBinding({
    server, tool,
    title: shaped.phrase.replace(/\$\d/g, '…'),
    phrases: [shaped.phrase],
    args: shaped.args,
    // про чужой инструмент мы не знаем, что он делает: подтверждение остаётся
    dangerous: true,
    enabled: true
  })
  col().delete(existing.id)
  logger.info('mcp', `собрала команду из повторения: «${shaped.phrase}» → ${server}/${tool}`)
  return { created: true, title: binding.title }
}

/** Заготовки — черновики, поэтому просто держим их число в рамках. */
function prune(): void {
  const all = col().all()
  if (all.length <= MAX_PROPOSALS) return
  const old = all.sort((a, b) => a.at - b.at).slice(0, all.length - MAX_PROPOSALS)
  for (const p of old) col().delete(p.id)
}

/** Забыть все заготовки (для тестов и сброса). */
export function forgetProposals(): void {
  for (const p of col().all()) col().delete(p.id)
}
