/**
 * Перехват ошибок интерфейса: срабатывает ли он на самом деле.
 *
 * Без этого теста утверждение «теперь падения голоса видны» держалось бы на
 * том, что код лежит в нужном файле и проходит проверку типов. Здесь мы
 * поднимаем поддельное окно, кидаем в него настоящие события и смотрим, что
 * ушло в main.
 */
const sent: string[] = []

// поддельное окно и мост в main — ставим ДО загрузки модуля, он берёт их при
// подписке
const listeners = new Map<string, ((e: unknown) => void)[]>()
;(globalThis as Record<string, unknown>).window = {
  addEventListener: (type: string, cb: (e: unknown) => void) => {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type)!.push(cb)
  },
  // api.ts забирает мост из window.kira В МОМЕНТ загрузки модуля, поэтому он
  // должен лежать здесь до первого import
  kira: { app: { reportUiError: (m: string) => { sent.push(m); return Promise.resolve() } } }
}

let pass = 0, fail = 0
const t = (n: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++
}
const fire = (type: string, e: unknown): void => {
  for (const cb of listeners.get(type) ?? []) cb(e)
}

async function main(): Promise<void> {
  const { installErrorHandlers } = await import('../src/renderer/src/errors')
  installErrorHandlers()

  t('подписка на ошибки окна поставлена', listeners.has('error'))
  t('подписка на отклонённые промисы поставлена', listeners.has('unhandledrejection'))

  // ── обычная ошибка ────────────────────────────────────────────────────────
  fire('error', { error: new Error('голос отвалился') })
  t('ошибка окна уходит в main', sent.length === 1, '-> ' + (sent[0] ?? '').slice(0, 60))
  t('в сообщении видно причину', (sent[0] ?? '').includes('голос отвалился'))

  // ── отклонённый промис: раньше пропадал бесследно ─────────────────────────
  fire('unhandledrejection', { reason: new Error('синтез не ответил') })
  t('отклонённый промис уходит в main', sent.length === 2, '-> ' + (sent[1] ?? '').slice(0, 60))

  // ── повторы душатся: горячий путь не должен затопить канал ────────────────
  const before = sent.length
  for (let i = 0; i < 200; i++) fire('error', { error: new Error('одно и то же') })
  t('200 одинаковых ошибок дают одно сообщение', sent.length - before === 1,
    `-> ушло: ${sent.length - before}`)

  // ── разные ошибки не глушат друг друга ────────────────────────────────────
  fire('error', { error: new Error('другая беда') })
  t('другая ошибка проходит сразу', sent.length - before === 2)

  // ── сбой загрузки картинки не должен слать пустое сообщение ───────────────
  const quiet = sent.length
  fire('error', { error: null, message: '' })
  t('событие без ошибки игнорируется', sent.length === quiet)

  console.log(`\n=== ИТОГО: ${pass} PASS, ${fail} FAIL ===`)
  process.exit(fail ? 1 : 0)
}
void main()
