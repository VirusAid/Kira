/**
 * Реестр отказов: проверяем поведение, ради которого он и написан.
 *
 * Главное здесь — схлопывание повторов. Отказ в горячем пути (запись звука в
 * распознаватель идёт десятки раз в секунду) не должен ни забивать журнал, ни
 * гнать поток сообщений в окно. Проверяем это на числах, а не на глаз.
 */
import { reportFault, clearFault, listFaults } from '../src/main/modules/faults'
import { db } from '../src/main/modules/db'

let pass = 0, fail = 0
const t = (n: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++
}
const errorsInLog = (): number =>
  db().logs.all().filter((l) => l.level === 'error').length

function main(): void {
  // ── одна запись на подсистему ─────────────────────────────────────────────
  reportFault('голос', 'сайдкар не поднялся', 'проверь Python')
  t('отказ попадает в реестр', listFaults().length === 1)
  t('подсистема и подсказка сохранены',
    listFaults()[0].subsystem === 'голос' && listFaults()[0].fix === 'проверь Python')

  // ── повторы схлопываются в счётчик, а не плодят записи ────────────────────
  const before = errorsInLog()
  for (let i = 0; i < 500; i++) reportFault('голос', 'сайдкар не поднялся')
  t('500 повторов дают одну запись в реестре', listFaults().length === 1,
    `-> записей: ${listFaults().length}`)
  t('счётчик повторов растёт', listFaults()[0].count === 501, `-> ${listFaults()[0].count}`)
  t('журнал НЕ забит повторами', errorsInLog() - before === 0,
    `-> добавилось строк: ${errorsInLog() - before}`)

  // ── другая беда в той же подсистеме — это новая запись, а не повтор ───────
  reportFault('голос', 'другая беда')
  t('смена причины заменяет запись, не плодит', listFaults().length === 1)
  t('счётчик сброшен для новой причины', listFaults()[0].count === 1)

  // ── разные подсистемы живут отдельно ──────────────────────────────────────
  reportFault('слух', 'микрофон занят')
  t('разные подсистемы не смешиваются', listFaults().length === 2)

  // ── починка убирает отметку ───────────────────────────────────────────────
  clearFault('голос')
  t('починка убирает отметку', listFaults().length === 1 && listFaults()[0].subsystem === 'слух')
  clearFault('голос')
  t('повторная починка не ломается', listFaults().length === 1)

  clearFault('слух')
  t('реестр пуст, когда всё работает', listFaults().length === 0)

  console.log(`\n=== ИТОГО: ${pass} PASS, ${fail} FAIL ===`)
  process.exit(fail ? 1 : 0)
}
main()
