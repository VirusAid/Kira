/**
 * Перехват ошибок интерфейса.
 *
 * ErrorBoundary ловит только падения React при отрисовке. Всё остальное —
 * ошибка в обработчике события, в setTimeout, отклонённый промис — до него не
 * доходит и пропадает бесследно: у окна нет своего журнала, а `console.error`
 * видит лишь тот, кто открыл инструменты разработчика.
 *
 * Для Kira это особенно важно: ВЕСЬ голосовой конвейер — микрофон,
 * распознавание, синтез — живёт здесь, в рендерере, и работает асинхронно.
 * Без этих двух подписок отказ голоса выглядит как «она меня не слышит», без
 * единого следа в журнале.
 */
import { kira } from './api'

/** Одинаковые ошибки в цикле не должны затапливать канал в main. */
const seen = new Map<string, number>()
const REPEAT_COOLDOWN_MS = 10_000

function report(what: string, error: unknown): void {
  const message = error instanceof Error
    ? `${error.message}${error.stack ? ` | ${error.stack.split('\n')[1]?.trim() ?? ''}` : ''}`
    : String(error)
  const key = `${what}:${message}`.slice(0, 200)

  const now = Date.now()
  const last = seen.get(key) ?? 0
  if (now - last < REPEAT_COOLDOWN_MS) return
  seen.set(key, now)

  // сообщение уходит в main: там журнал и реестр отказов
  void kira.app.reportUiError(`${what}: ${message}`.slice(0, 500))
}

export function installErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    // ошибки загрузки картинок и прочих ресурсов приходят сюда же, но у них
    // нет error — отделяем, чтобы не слать пустые сообщения
    if (e.error) report('Ошибка интерфейса', e.error)
    else if (e.message) report('Ошибка интерфейса', e.message)
  })

  window.addEventListener('unhandledrejection', (e) => {
    report('Необработанный промис', e.reason)
  })
}

export { report as reportUiError }
