/**
 * Освобождение простаивающих сайдкаров.
 *
 * Голос, синтез речи, смысловой поиск и узнавание говорящего живут в отдельных
 * процессах Python, и каждый держит в памяти свою модель. Запускались они
 * лениво — но не гасли уже никогда: сказал «Кира» один раз в десять утра, и до
 * вечера в памяти лежат четыре процесса с нейросетями. На слабой машине это и
 * есть та самая «Kira съела всю память и за собой не убирает».
 *
 * Правило простое: не звали N минут — отпускаем. Следующий вызов поднимет
 * процесс заново, это стоит секунду-другую и происходит редко; держать
 * гигабайты «на всякий случай» стоит дороже.
 *
 * Отдельная тонкость: пока идёт запрос, гасить нельзя. Поэтому обращение к
 * сайдкару отмечается ДО начала работы и ещё раз по её завершении — таймер
 * всегда отсчитывается от последнего реального использования.
 */
import { logger } from '../logger'

interface Watch {
  timer: NodeJS.Timeout | null
  idleMs: number
  release: () => void
  /** сколько операций выполняется прямо сейчас — занятый процесс не трогаем */
  busy: number
}

const watches = new Map<string, Watch>()

/**
 * Взять сайдкар под присмотр. Вызывается при каждом обращении к нему —
 * повторный вызов просто переводит стрелки.
 */
export function touchSidecar(name: string, release: () => void, idleMs: number): void {
  let w = watches.get(name)
  if (!w) {
    w = { timer: null, idleMs, release, busy: 0 }
    watches.set(name, w)
  }
  w.release = release
  w.idleMs = idleMs
  rearm(name, w)
}

/** Отметить начало работы: пока busy > 0, освобождение откладывается. */
export function beginSidecarWork(name: string): void {
  const w = watches.get(name)
  if (w) w.busy++
}

/** Отметить конец работы и заново отсчитать простой. */
export function endSidecarWork(name: string): void {
  const w = watches.get(name)
  if (!w) return
  w.busy = Math.max(0, w.busy - 1)
  rearm(name, w)
}

/** Снять с присмотра: процесс уже погашен своими силами. */
export function forgetSidecar(name: string): void {
  const w = watches.get(name)
  if (w?.timer) clearTimeout(w.timer)
  watches.delete(name)
}

function rearm(name: string, w: Watch): void {
  if (w.timer) clearTimeout(w.timer)
  w.timer = setTimeout(() => {
    const cur = watches.get(name)
    if (!cur) return
    if (cur.busy > 0) { rearm(name, cur); return } // ещё занят — подождём
    watches.delete(name)
    try {
      cur.release()
      logger.info('resources', `«${name}» простаивал — освободила память`)
    } catch { /* уже мёртв */ }
  }, w.idleMs)
  // таймер не должен удерживать процесс живым при выходе
  w.timer.unref?.()
}

/** Погасить всё разом — при выходе из приложения. */
export function releaseAllSidecars(): void {
  for (const [name, w] of [...watches]) {
    if (w.timer) clearTimeout(w.timer)
    watches.delete(name)
    try { w.release() } catch { /* уже мёртв */ }
  }
}

/**
 * Сколько ждать до освобождения. Разные сайдкары — разная цена перезапуска:
 * распознавание речи поднимается долго и нужно часто, синтез и смысл — реже.
 */
export const IDLE = {
  /** распознавание речи: держим дольше — его зовут каждой фразой */
  stt: 10 * 60_000,
  /** синтез речи */
  tts: 5 * 60_000,
  /** смысловой поиск: зовут редко, а модель тяжёлая */
  embed: 4 * 60_000,
  /** узнавание говорящего */
  speaker: 5 * 60_000
} as const
