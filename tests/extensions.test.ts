/**
 * Сквозная проверка расширений: команда человека → ядро → настоящий сервер →
 * настоящий файл → отмена.
 *
 * Именно здесь ловится то, чего не видно в отрыве: имена полей у инструмента,
 * запоминание прежнего состояния ДО вызова, честный ответ на «отмени» там, где
 * откатить нечем.
 *
 * Требует подготовленных встроенных расширений (npm run prepare:mcp) — без них
 * проверка пропускается, а не падает: это часть сборки, а не репозитория.
 */
import { registry } from '../src/main/core/registry'
import { actions } from '../src/main/core/actions'
import { commandEngine } from '../src/main/core/engine'
import { bindingToAction } from '../src/main/core/mcpActions'
import { saveServer, saveBinding } from '../src/main/modules/mcp/manager'
import { syncMcpActions } from '../src/main/core/mcpActions'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'

registry.registerAll(actions)
let pass = 0, fail = 0
const t = (n: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`)
  if (ok) pass++; else fail++
}

const dir = join(tmpdir(), 'kira-undo-test')
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
const file = join(dir, 'zametka.txt')
const entry = join(process.cwd(), 'resources', 'mcp', 'node_modules',
  '@modelcontextprotocol', 'server-filesystem', 'dist', 'index.js')

if (!existsSync(entry)) {
  console.log('ПРОПУСК: встроенные расширения не подготовлены (npm run prepare:mcp)')
  process.exit(0)
}

void (async () => {
  writeFileSync(file, 'первоначальный текст', 'utf-8')

  const srv = await saveServer({
    title: 'Файлы для теста', transport: 'stdio',
    command: 'node', args: [entry, dir], env: {}, enabled: true
  })
  const b = saveBinding({
    server: srv.id, tool: 'write_file', title: 'Запиши в заметку',
    phrases: ['запиши в заметку'], args: { path: file, content: '$1' },
    dangerous: false, enabled: true
  })
  syncMcpActions([b])
  t('привязка зарегистрирована', !!registry.get('mcp:' + srv.id + '/write_file'))

  const done = await commandEngine.tryHandle('запиши в заметку новый текст', { source: 'chat' })
  t('расширение выполнило команду', done.handled === true && done.result?.ok === true,
    '-> ' + JSON.stringify(done.result?.message))
  t('файл действительно изменился', readFileSync(file, 'utf-8').includes('новый текст'),
    '-> ' + JSON.stringify(readFileSync(file, 'utf-8')))

  const back = await commandEngine.undoLast({ source: 'chat' })
  t('отмена расширения сработала', back.ok === true, '-> ' + back.message)
  t('файл вернулся к прежнему содержимому',
    readFileSync(file, 'utf-8') === 'первоначальный текст',
    '-> ' + JSON.stringify(readFileSync(file, 'utf-8')))

  // неотменяемый инструмент: Kira обязана сказать это прямо
  const b2 = saveBinding({
    server: srv.id, tool: 'create_directory', title: 'Заведи папку',
    phrases: ['заведи папку'], args: { path: join(dir, 'novaya') },
    dangerous: false, enabled: true
  })
  syncMcpActions([b, b2])
  await commandEngine.tryHandle('заведи папку', { source: 'chat' })
  const cant = await commandEngine.undoLast({ source: 'chat' })
  t('неотменяемое названо прямо, а не «нечего отменять»',
    cant.ok === false && cant.message.includes('Заведи папку'), '-> ' + cant.message)

  // ДВА МЕСТА в одной фразе на настоящем перемещении файла.
  const src = join(dir, 'ishodnik.txt')
  const dst = join(dir, 'perenesenniy.txt')
  writeFileSync(src, 'содержимое для переноса', 'utf-8')
  const b3 = saveBinding({
    server: srv.id, tool: 'move_file', title: 'Перемести',
    phrases: ['перемести $1 в $2'], args: { source: '$1', destination: '$2' },
    dangerous: false, enabled: true
  })
  syncMcpActions([b, b2, b3])
  const moved = await commandEngine.tryHandle(`перемести ${src} в ${dst}`, { source: 'chat' })
  t('два места: команда выполнилась', moved.handled === true && moved.result?.ok === true,
    '-> ' + JSON.stringify(moved.result?.message))
  t('два места: файл действительно переехал',
    existsSync(dst) && !existsSync(src), `-> есть новый: ${existsSync(dst)}, старого нет: ${!existsSync(src)}`)

  const backMove = await commandEngine.undoLast({ source: 'chat' })
  t('два места: отмена вернула файл обратно',
    backMove.ok === true && existsSync(src) && !existsSync(dst), '-> ' + backMove.message)

  // МОДЕЛЬ КАК КОМПИЛЯТОР: удачный вызов расширения превращается в постоянную
  // локальную команду — но только со второго повторения.
  const { noteExtensionUse, generalize, forgetProposals } = await import('../src/main/modules/mcp/proposals')
  forgetProposals()

  const shaped = generalize('заведи задачу кнопка не работает',
    { title: 'кнопка не работает', repo: 'kira' })
  t('заготовка: сказанное становится местом, остальное — постоянным',
    shaped.phrase === 'заведи задачу $1' && shaped.args.title === '$1' && shaped.args.repo === 'kira',
    '-> ' + JSON.stringify(shaped))

  const first = noteExtensionUse('запиши в дневник хороший день', srv.id, 'write_file',
    { path: join(dir, 'dnevnik.txt'), content: 'хороший день' })
  t('заготовка: с первого раза команда НЕ создаётся', first.created === false)

  const second = noteExtensionUse('запиши в дневник хороший день', srv.id, 'write_file',
    { path: join(dir, 'dnevnik.txt'), content: 'хороший день' })
  t('заготовка: со второго раза появляется команда', second.created === true, '-> ' + second.title)

  const { listBindings } = await import('../src/main/modules/mcp/manager')
  const born = listBindings().find((x) => x.phrases[0].startsWith('запиши в дневник'))
  t('заготовка: путь остался постоянным, а текст стал местом',
    born?.args.content === '$1' && born?.args.path === join(dir, 'dnevnik.txt'),
    '-> ' + JSON.stringify(born?.args))
  t('заготовка: созданная команда требует подтверждения', born?.dangerous === true)

  // и она сразу работает как обычная команда ядра — но сперва спрашивает
  syncMcpActions(listBindings())
  // метка-сторож: если команда сработает без спроса, содержимое изменится.
  // Проверять «файла нет» нельзя — он мог остаться от прошлого прогона
  writeFileSync(join(dir, 'dnevnik.txt'), 'сторож', 'utf-8')
  const denied = await commandEngine.tryHandle('запиши в дневник отличный день', { source: 'chat' })
  t('заготовка: без подтверждения ничего не делает',
    denied.denied === true && readFileSync(join(dir, 'dnevnik.txt'), 'utf-8') === 'сторож',
    '-> ' + denied.reply)

  const spoken = await commandEngine.tryHandle('запиши в дневник отличный день',
    { source: 'chat', confirm: async () => true })
  t('заготовка: с подтверждением выполняется ядром',
    spoken.handled === true && spoken.result?.ok === true, '-> ' + JSON.stringify(spoken.result?.message))
  t('заготовка: подставилось именно сказанное',
    readFileSync(join(dir, 'dnevnik.txt'), 'utf-8') === 'отличный день',
    '-> ' + JSON.stringify(readFileSync(join(dir, 'dnevnik.txt'), 'utf-8')))
  // Морфология: человек говорит «задачу», модель передаёт «задача» — совпадения
  // нет. Создать привязку, где ничего не переменное, значит навсегда повторять
  // данные того единственного раза.
  const stale = { path: join(dir, 'x.txt'), content: 'совсем другое' }
  noteExtensionUse('запиши заметку', srv.id, 'write_file', stale)
  const notCreated = noteExtensionUse('запиши заметку', srv.id, 'write_file', stale)
  t('заготовка: не берётся, если непонятно, что переменное',
    notCreated.created === false &&
    !listBindings().some((x) => x.phrases[0] === 'запиши заметку'),
    '-> created=' + notCreated.created)

  forgetProposals()

  const { shutdownMcp } = await import('../src/main/modules/mcp/manager')
  await shutdownMcp()
  console.log(`\n=== ИТОГО: ${pass} PASS, ${fail} FAIL ===`)
  process.exit(fail ? 1 : 0)
})()
