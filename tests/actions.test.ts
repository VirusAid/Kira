/**
 * Разбор команд действия — то, чем Kira отличается от чат-бота.
 *
 * Правильная запись — через вертикальную черту: `[[kira:open_app|Telegram]]`.
 * Но модель регулярно пишет скобками, и раньше это кончалось худшим из
 * возможного: строгий разбор команду не узнавал, очистка текста исправно
 * убирала её с экрана — и на «открой телеграм» Kira молчала. Ни действия, ни
 * ответа, ни следа в журнале.
 *
 * Поэтому здесь проверяется снисходительность к чужой вольности — и то, что
 * она не ломает правильные команды.
 */
import { parseActions, stripActions } from '../src/main/modules/ai/kira'

let pass = 0, fail = 0
const t = (n: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++
}
const one = (text: string): string => {
  const a = parseActions(text)
  return a.length ? `${a[0].name}(${a[0].args.join('|')})` : 'НИЧЕГО'
}

function main(): void {
  // ── правильная запись работает как прежде ─────────────────────────────────
  t('черта — основной синтаксис', one('[[kira:open_app|Telegram]]') === 'open_app(Telegram)')
  t('без аргументов', one('[[kira:screenshot]]') === 'screenshot()')
  t('несколько аргументов',
    one('[[kira:move_file|a.txt|b.txt]]') === 'move_file(a.txt|b.txt)')
  t('несколько команд в одном ответе', parseActions('[[kira:open_app|Steam]] [[kira:screenshot]]').length === 2)

  // ── вольности модели ──────────────────────────────────────────────────────
  /*
   * Именно это пришло от тестировщика: три открывающие скобки, две
   * закрывающие. Требовать ровного счёта — значит снова промолчать.
   */
  t('квадратные скобки вместо черты',
    one('[[kira:open_app[Telegram]]') === 'open_app(Telegram)', '-> ' + one('[[kira:open_app[Telegram]]'))
  t('круглые скобки вместо черты',
    one('[[kira:open_app(Telegram)]]') === 'open_app(Telegram)')
  t('аргументы через запятую внутри скобок',
    one('[[kira:move_file[a.txt,b.txt]]') === 'move_file(a.txt|b.txt)')
  t('команда посреди текста',
    one('Открываю. [[kira:open_app[Telegram]]') === 'open_app(Telegram)')

  // ── снисходительность не мешает правильному ───────────────────────────────
  const mixed = parseActions('[[kira:open_app|Steam]] [[kira:screenshot]]')
  t('при верном синтаксисе снисходительный разбор не вмешивается',
    mixed.length === 2 && mixed.every((a) => a.args.every((x) => !x.includes('['))))

  // ── человек не должен видеть служебное ────────────────────────────────────
  t('команда не показывается человеку', stripActions('[[kira:open_app[Telegram]]') === '')
  t('текст вокруг команды сохраняется',
    stripActions('Открываю. [[kira:open_app[Telegram]]') === 'Открываю.')
  t('обрыв потока посреди команды не показывается',
    stripActions('Готово [[kira:open_app|Tele') === 'Готово')

  console.log(`\n=== ИТОГО: ${pass} PASS, ${fail} FAIL ===`)
  process.exit(fail ? 1 : 0)
}
main()
