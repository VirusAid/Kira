/**
 * Faults — реестр отказов подсистем.
 *
 * Зачем он нужен отдельно от журнала. Журнал — это лента событий: туда пишут
 * всё подряд, и запись о поломке тонет среди тысяч обычных строк. Реестр
 * отвечает на другой вопрос: ЧТО СЕЙЧАС СЛОМАНО. Одна запись на подсистему,
 * живёт, пока подсистема не заработает снова.
 *
 * Это лечит болезнь, из-за которой Kira молча работала наполовину. В версии
 * 1.2.0 два блока системного промпта были пустыми у всех пользователей: код
 * падал, соседний `catch` глотал ошибку, и никто — ни человек, ни журнал — об
 * этом не узнавал. Ловить ошибку и ничего не сообщать хуже, чем упасть:
 * падение хотя бы заметно.
 *
 * Повторы схлопываются. Отказ в голосовом цикле случается по многу раз в
 * секунду, и без этого журнал забился бы за минуту, а горячий путь просел бы
 * на записи в базу.
 */
import { BrowserWindow } from 'electron'
import { logger } from './logger'
import type { Fault } from '../../shared/types'

/** Подсистемы, отказ которых человек может заметить. */
export type Subsystem =
  | 'голос' | 'слух' | 'пробуждение' | 'смысл' | 'офлайн-разум' | 'провайдер ИИ'
  | 'расширения' | 'интеграции' | 'файлы' | 'автоматизации' | 'интерфейс' | 'ядро'

const faults = new Map<Subsystem, Fault>()

/** Не чаще одной записи в журнал на подсистему за этот срок. */
const LOG_COOLDOWN_MS = 30_000
const lastLoggedAt = new Map<Subsystem, number>()

function broadcast(): void {
  const list = [...faults.values()]
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('faults:changed', list)
  }
}

/**
 * Сообщить об отказе подсистемы.
 *
 * Вызывать там, где сбой ЗНАЧИМ для человека: голос не отвечает, модель не
 * грузится, расширение не поднялось. Для мелочей вроде «файла нет, и это
 * нормально» есть обычный catch — не всякая пойманная ошибка является отказом.
 */
export function reportFault(subsystem: Subsystem, message: string, fix?: string): void {
  const now = Date.now()
  const existing = faults.get(subsystem)

  const isRepeat = existing?.message === message
  if (isRepeat) {
    existing.count += 1
    existing.lastAt = now
  } else {
    faults.set(subsystem, { subsystem, message, fix, count: 1, firstAt: now, lastAt: now })
  }

  // в журнал — не чаще раза в полминуты на подсистему, иначе горячие пути
  // (голосовой цикл) забьют его целиком
  const since = now - (lastLoggedAt.get(subsystem) ?? 0)
  if (since >= LOG_COOLDOWN_MS) {
    lastLoggedAt.set(subsystem, now)
    const repeat = isRepeat && existing.count > 1 ? ` (повторов: ${existing.count})` : ''
    logger.error(subsystem, `${message}${repeat}`)
  }

  /*
   * В окно сообщаем ТОЛЬКО когда состав отказов изменился.
   *
   * Иначе сбой в горячем пути — скажем, обрыв трубы, в которую голосовой цикл
   * пишет звук по три десятка раз в секунду — гнал бы столько же сообщений
   * через IPC. Для человека же ничего не меняется: отметка уже висит, и второй
   * раз показывать её незачем.
   */
  if (!isRepeat) broadcast()
}

/** Подсистема снова работает — убрать отметку об отказе. */
export function clearFault(subsystem: Subsystem): void {
  if (!faults.delete(subsystem)) return
  lastLoggedAt.delete(subsystem)
  logger.info(subsystem, 'Работает снова')
  broadcast()
}

/** Что сломано прямо сейчас. */
export function listFaults(): Fault[] {
  return [...faults.values()].sort((a, b) => b.lastAt - a.lastAt)
}

/**
 * Обёртка для операций, отказ которых должен быть виден.
 * Возвращает null при сбое — вызывающий решает, что делать дальше.
 */
export async function guard<T>(
  subsystem: Subsystem,
  what: string,
  fn: () => Promise<T>,
  fix?: string
): Promise<T | null> {
  try {
    const result = await fn()
    clearFault(subsystem)
    return result
  } catch (e) {
    reportFault(subsystem, `${what}: ${(e as Error)?.message ?? String(e)}`.slice(0, 300), fix)
    return null
  }
}
