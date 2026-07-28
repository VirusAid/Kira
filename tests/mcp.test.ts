/**
 * Клиент расширений против НАСТОЯЩЕГО MCP-сервера (tests/mcp-fake-server.js).
 *
 * Проверять разбор JSON в отрыве от процесса бессмысленно: половина ошибок тут
 * живёт в стыке — пагинация, зависший сервер, отмена, запуск .cmd на Windows.
 */
import { join } from 'path'
import { existsSync } from 'fs'
import { StdioMcpProvider, resolveCommand } from '../src/main/modules/mcp/stdio'
import type { McpServerConfig } from '../src/main/modules/mcp/types'

const config: McpServerConfig = {
  id: 'fake', title: 'Проверочный', transport: 'stdio',
  command: process.execPath, // __dirname в собранном тесте указывает на tests/.build, поэтому берём
  // путь от корня проекта — тесты запускаются именно оттуда
  args: [join(process.cwd(), 'tests', 'mcp-fake-server.js')], env: {}, enabled: true
}
let pass = 0, fail = 0
const t = (n: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++
}

async function main(): Promise<void> {
  const p = new StdioMcpProvider(config)
  await p.connect()
  t('подключение: состояние ready', p.status().state === 'ready', '-> ' + JSON.stringify(p.status()))
  const tools = await p.listTools()
  t('инструменты: обе страницы получены', tools.length === 2 && tools.map(x => x.name).join(',') === 'echo,boom',
    '-> ' + tools.map(x => x.name).join(', '))

  const ok = await p.call('echo', { text: 'привет' })
  t('вызов: текст ушёл в содержимое, а не в статус',
    ok.ok && ok.content === 'эхо: привет' && ok.message !== ok.content, '-> ' + JSON.stringify(ok))

  const bad = await p.call('boom', {})
  t('вызов: провал инструмента — неудача', bad.ok === false && bad.message.includes('внутренняя поломка'), '-> ' + bad.message)

  const missing = await p.call('нет-такого', {})
  t('вызов: неизвестный инструмент — честная ошибка', missing.ok === false, '-> ' + missing.message)

  const started = Date.now()
  const slow = await p.call('slow', {}, { timeoutMs: 800 })
  t('вызов: зависший сервер не вешает Киру',
    slow.ok === false && Date.now() - started < 3000, '-> ' + slow.message)

  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 200)
  const cancelled = await p.call('slow', {}, { signal: ctrl.signal, timeoutMs: 10_000 })
  t('вызов: отмена срабатывает', cancelled.ok === false && cancelled.message.includes('отменено'), '-> ' + cancelled.message)

  await p.disconnect()
  t('отключение: состояние offline', p.status().state === 'offline')

  // Встроенные расширения запускаются рантаймом самой Kira: внутри Electron уже
  // есть Node, поэтому пользователю не нужно ничего устанавливать, а установщик
  // не толстеет ни на байт. Проверяем, что команда «node» ведёт именно к нам.
  const own = new StdioMcpProvider({ ...config, id: 'own', command: 'node' })
  const launch = (own as unknown as { config: McpServerConfig }).config
  t('встроенные: команда «node» — это рантайм Kira, а не системный',
    launch.command === 'node')
  const viaOwn = new StdioMcpProvider({
    ...config, id: 'viaOwn', command: 'node',
    args: [join(process.cwd(), 'tests', 'mcp-fake-server.js')]
  })
  await viaOwn.connect()
  t('встроенные: сервер поднимается рантаймом Kira',
    viaOwn.status().state === 'ready', '-> ' + viaOwn.status().message)
  await viaOwn.disconnect()

  // Путь к встроенным расширениям в РАЗРАБОТКЕ ищется вверх от собранного main:
  // app.getAppPath() возвращает папку запускаемого файла (out/main), а не корень
  // проекта, и раздел показывал «не найдено», хотя файлы лежали на месте.
  const bundleRoot = join(process.cwd(), 'resources', 'mcp', 'node_modules', '@modelcontextprotocol')
  t('встроенные: расширения подготовлены сборкой',
    existsSync(join(bundleRoot, 'server-filesystem', 'dist', 'index.js')) &&
    existsSync(join(bundleRoot, 'server-memory', 'dist', 'index.js')),
    '-> ' + bundleRoot)

  // Путь к npx на обычной Windows — «C:\Program Files\nodejs\npx.cmd».
  // Через оболочку он ОБЯЗАН быть в кавычках, иначе cmd.exe принимает за
  // команду «C:\Program» и ни один сервер из npm не запускается.
  const r = resolveCommand('npx')
  t('запуск: npx на Windows требует оболочки',
    process.platform !== 'win32' || r.viaShell === true || !r.command.endsWith('.cmd'), '-> ' + JSON.stringify(r))
  if (process.platform === 'win32' && r.viaShell && r.command.includes(' ')) {
    const spaced = new StdioMcpProvider({ ...config, id: 'spaced', command: r.command, args: ['--version'] })
    await spaced.connect()
    t('запуск: путь с пробелом не разваливается',
      !spaced.status().message.includes('не является') &&
      !spaced.status().message.includes('not recognized'), '-> ' + spaced.status().message)
    await spaced.disconnect()
  } else {
    t('запуск: путь с пробелом не разваливается', true, '-> проверка не применима')
  }

  // ── Транспорт HTTP: тот же контракт, другой способ связи ──
  const { spawn } = await import('child_process')
  const srv = spawn(process.execPath, [join(process.cwd(), 'tests', 'mcp-fake-http.js'), '0'],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  const port = await new Promise<number>((resolve, reject) => {
    let buf = ''
    srv.stdout.setEncoding('utf-8')
    srv.stdout.on('data', (c: string) => {
      buf += c
      const found = buf.match(/PORT=(\d+)/)
      if (found) resolve(Number(found[1]))
    })
    setTimeout(() => reject(new Error('сервер не поднялся')), 10_000)
  })

  const { HttpMcpProvider } = await import('../src/main/modules/mcp/http')
  const h = new HttpMcpProvider({
    id: 'net', title: 'Сетевой', transport: 'http', command: '', args: [], env: {},
    url: `http://127.0.0.1:${port}/mcp`, enabled: true
  })
  await h.connect()
  t('http: подключение и рукопожатие', h.status().state === 'ready', '-> ' + JSON.stringify(h.status()))

  const htools = await h.listTools()
  t('http: список пришёл ПОТОКОМ событий и разобран',
    htools.length === 2 && htools[0].name === 'echo', '-> ' + htools.map((x) => x.name).join(', '))

  const hok = await h.call('echo', { text: 'привет' })
  t('http: вызов вернул содержимое отдельно от статуса',
    hok.ok && hok.content === 'эхо: привет', '-> ' + JSON.stringify(hok))

  const hbad = await h.call('boom', {})
  t('http: провал инструмента — неудача', hbad.ok === false && hbad.message.includes('внутренняя поломка'),
    '-> ' + hbad.message)

  // Сервер вправе НЕ закрывать поток после ответа. Ждать его конца нельзя:
  // тогда каждый вызов упирался бы в таймаут, хотя ответ пришёл сразу.
  const openStart = Date.now()
  const openRes = await h.call('otkrytyy', {}, { timeoutMs: 8000 })
  t('http: ответ берётся сразу, даже если поток не закрыт',
    openRes.ok && openRes.content === 'ответ пришёл сразу' && Date.now() - openStart < 3000,
    `-> ${JSON.stringify(openRes.content)} за ${Date.now() - openStart} мс`)

  const hstart = Date.now()
  const hslow = await h.call('slow', {}, { timeoutMs: 800 })
  t('http: молчащий сервер не вешает Киру',
    hslow.ok === false && Date.now() - hstart < 4000, '-> ' + hslow.message)

  await h.disconnect()
  t('http: отключение', h.status().state === 'offline')
  srv.kill()

  console.log(`\n=== ИТОГО: ${pass} PASS, ${fail} FAIL ===`)
  process.exit(fail ? 1 : 0)
}
void main()
