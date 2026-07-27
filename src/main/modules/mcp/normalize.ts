/**
 * Перевод ответа MCP в контракт ядра.
 *
 * Единственное место, где живут `content[]`, `isError` и `structuredContent`.
 * Выше этого слоя MCP не существует: движок, история, отмена, характер и
 * обучение видят обычный ExecResult и не знают, откуда он пришёл.
 *
 * Разделение статуса и содержимого здесь не формальность: ядро уже дважды
 * ловило один и тот же баг, когда содержимое лежало в `data`, а читали
 * `message` — и модель получала «Распознала текст» вместо самого текста.
 */
import type { ExecResult } from '../../core/types'

/** Ответ tools/call, как его описывает спецификация. */
export interface McpCallResult {
  content?: Array<Record<string, unknown>>
  structuredContent?: unknown
  isError?: boolean
}

/** Сколько текста берём из ответа: остальное всё равно не прочитать вслух. */
const MAX_TEXT = 8000

/**
 * Человеческое описание нетекстовых кусков ответа. Картинку или ссылку на
 * ресурс озвучить нельзя, но и молчать о них неправильно — иначе ответ выглядит
 * пустым, хотя сервер что-то вернул.
 */
function describePart(part: Record<string, unknown>): string {
  switch (part.type) {
    case 'text': return typeof part.text === 'string' ? part.text : ''
    case 'image': return '[изображение]'
    case 'audio': return '[аудио]'
    case 'resource_link': return typeof part.uri === 'string' ? `[файл: ${part.uri}]` : '[файл]'
    case 'resource': {
      const r = part.resource as Record<string, unknown> | undefined
      if (r && typeof r.text === 'string') return r.text
      return r && typeof r.uri === 'string' ? `[вложение: ${r.uri}]` : '[вложение]'
    }
    default: return ''
  }
}

/**
 * Ответ инструмента → ExecResult.
 *
 * `message` — короткий статус для человека, `content` — то, что показываем и
 * читаем вслух, `data` — структурная часть для кода. Провал инструмента
 * (`isError`) — это ok:false: ядро само покажет его как неудачу, честно и не
 * выдавая за успех.
 */
export function toExecResult(raw: McpCallResult, toolTitle: string): ExecResult {
  const parts = Array.isArray(raw.content) ? raw.content : []
  const text = parts.map(describePart).filter(Boolean).join('\n').trim()
  const failed = raw.isError === true

  if (failed) {
    // текст ошибки — это и есть причина; без него говорим хотя бы что именно упало
    return { ok: false, message: text ? text.slice(0, 500) : `«${toolTitle}» не смог выполнить запрос` }
  }
  return {
    ok: true,
    message: text ? toolTitle : `${toolTitle}: готово`,
    content: text ? text.slice(0, MAX_TEXT) : undefined,
    data: raw.structuredContent
  }
}
