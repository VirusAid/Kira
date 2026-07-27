/**
 * Что из расширений можно отменить.
 *
 * Про чужой инструмент в общем случае неизвестно, как обратить его действие:
 * протокол описывает, что вызвать, но не что при этом изменится. Поэтому здесь
 * перечислено ровно то, для чего обратный шаг ОЧЕВИДЕН и проверяем — сейчас это
 * файловые операции встроенного расширения.
 *
 * Всё остальное честно объявляется неотменяемым. Молча делать вид, что «отмени»
 * сработало, — хуже, чем сказать правду: человек уверен, что вернул как было, а
 * ничего не вернулось.
 *
 * Имена полей взяты не по памяти, а из схем настоящего сервера:
 * write_file(path, content) · move_file(source, destination) ·
 * create_directory(path).
 */

/** Вызов инструмента — то, что нужно сделать, чтобы обратить действие. */
export interface ToolCall {
  tool: string
  args: Record<string, unknown>
}

/** Как обратить конкретный инструмент. */
interface Reversal {
  /**
   * Что запомнить ДО вызова. Возвращает состояние, которое понадобится для
   * отката, либо null — если отменять будет нечего (например, файла ещё нет).
   */
  capture?: (args: Record<string, unknown>, read: (call: ToolCall) => Promise<string | null>) => Promise<unknown>
  /** Обратный вызов. null — отменить всё-таки нельзя. */
  reverse: (args: Record<string, unknown>, saved: unknown) => ToolCall | null
  /** Что сказать человеку после отката. */
  said: string
}

/**
 * Инструменты, у которых обратный шаг вообще существует.
 *
 * Отдельным списком, а не пробным вызовом reverse: пробовать «понарошку» с
 * пустыми аргументами — способ узнать ответ, который легко читается неверно и
 * ломается от любой правки внутри reverse.
 */
const REVERSIBLE_TOOLS = new Set(['move_file', 'write_file'])

const REVERSALS: Record<string, Reversal> = {
  move_file: {
    // перемещение обратимо само по себе: меняем местами откуда и куда
    reverse: (a) => ({ tool: 'move_file', args: { source: a.destination, destination: a.source } }),
    said: 'Вернула файл на место'
  },
  write_file: {
    // запись затирает прежнее содержимое — без него откат невозможен
    capture: async (a, read) => read({ tool: 'read_text_file', args: { path: a.path } }),
    reverse: (a, saved) =>
      typeof saved === 'string' ? { tool: 'write_file', args: { path: a.path, content: saved } } : null,
    said: 'Вернула прежнее содержимое файла'
  },
  create_directory: {
    // папку удалять не берёмся: она могла существовать до вызова, а внутри —
    // чужие файлы. Честно говорим, что откатить нечем
    reverse: () => null,
    said: ''
  }
}

/** Умеет ли Kira обращать этот инструмент. */
export function isReversible(tool: string): boolean {
  return REVERSIBLE_TOOLS.has(tool)
}

/** Состояние, которое нужно запомнить перед вызовом (или null). */
export async function captureBefore(
  tool: string, args: Record<string, unknown>, read: (call: ToolCall) => Promise<string | null>
): Promise<unknown> {
  const r = REVERSALS[tool]
  if (!r?.capture) return null
  try {
    return await r.capture(args, read)
  } catch {
    return null // прежнего состояния нет — значит и откатывать будет нечего
  }
}

/** Обратный вызов и фраза для человека. */
export function reverseOf(
  tool: string, args: Record<string, unknown>, saved: unknown
): { call: ToolCall; said: string } | null {
  const r = REVERSALS[tool]
  if (!r) return null
  const call = r.reverse(args, saved)
  return call ? { call, said: r.said } : null
}
