/**
 * Хранилище — проверка на СБОЯХ, а не на счастливом пути.
 *
 * Ошибки тут не видно глазами: данные просто исчезают, и со стороны это
 * выглядит как «Kira забыла». Поэтому проверяем ровно те моменты, где раньше
 * терялось: битый файл, неудачная запись, выход посреди отложенной записи.
 */
import { Collection, MessageStore, sweepTempFiles, flushAllCollectionsSync } from '../src/main/modules/storage'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

let pass = 0, fail = 0
const t = (n: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++
}
const dataDir = path.join(app.getPath('userData'), 'data')

async function main(): Promise<void> {
  interface Row { id: string; v: string }
  const col = new Collection<Row>('probe-' + Date.now())
  const file = path.join(dataDir, col.name + '.json')

  col.put({ id: 'a', v: 'первое' })
  col.flushSync()
  t('коллекция: синхронный сброс пишет на диск', fs.existsSync(file))

  // Выход посреди отложенной записи. Раньше flush снимал признак «не сохранено»
  // ДО записи, поэтому сброс при выходе считал, что писать нечего.
  col.put({ id: 'b', v: 'второе' })
  const flying = col.flush()          // началась отложенная запись
  col.flushSync()                     // и тут же выход
  await flying
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8')) as Row[]
  t('коллекция: выход посреди записи не теряет данные',
    onDisk.length === 2 && onDisk.some((r) => r.id === 'b'), '-> ' + JSON.stringify(onDisk.map((r) => r.id)))

  // Неудачная запись не должна выдавать себя за успешную.
  const col2 = new Collection<Row>('probe2-' + Date.now())
  col2.put({ id: 'x', v: 'важное' })
  const realWrite = fs.promises.writeFile
  ;(fs.promises as { writeFile: unknown }).writeFile = () => Promise.reject(new Error('диск полон'))
  await col2.flush()
  ;(fs.promises as { writeFile: unknown }).writeFile = realWrite
  await col2.flush() // диск «починился» — данные обязаны дойти
  const file2 = path.join(dataDir, col2.name + '.json')
  t('коллекция: сбой записи не считается успехом — данные дописываются потом',
    fs.existsSync(file2) && (JSON.parse(fs.readFileSync(file2, 'utf-8')) as Row[]).length === 1)

  // Битая переписка не должна ронять открытие чата целиком.
  const store = new MessageStore<{ id: string; chatId: string }>()
  const badChat = 'broken-' + Date.now()
  fs.writeFileSync(path.join(dataDir, 'messages', badChat + '.json'), '{это не json', 'utf-8')
  let threw = false
  let got: unknown[] = []
  try { got = store.listChat(badChat) } catch { threw = true }
  t('переписка: битый файл не роняет открытие чата', !threw && got.length === 0)
  t('переписка: испорченное сохранено рядом, а не стёрто',
    fs.readdirSync(path.join(dataDir, 'messages')).some((f) => f.startsWith(badChat) && f.includes('.corrupt.')))

  // Кэш переписок не должен расти бесконечно.
  for (let i = 0; i < 40; i++) {
    const id = `hot-${Date.now()}-${i}`
    store.append({ id: 'm' + i, chatId: id })
  }
  await store.flush()
  const cacheSize = (store as unknown as { cache: Map<string, unknown> }).cache.size
  t('переписка: холодные разговоры отпускаются из памяти', cacheSize <= 12, '-> в памяти ' + cacheSize)

  // Временные файлы чужих (мёртвых) запусков убираются.
  const orphan = path.join(dataDir, 'orphan.json.999999.1.tmp')
  fs.writeFileSync(orphan, 'x', 'utf-8')
  await sweepTempFiles()
  t('уборка: недописанный файл прошлого запуска удалён', !fs.existsSync(orphan))

  flushAllCollectionsSync()
  for (const c of [col.name, col2.name]) {
    try { fs.unlinkSync(path.join(dataDir, c + '.json')) } catch { /* ignore */ }
  }
  console.log(`\n=== ИТОГО: ${pass} PASS, ${fail} FAIL ===`)
  process.exit(fail ? 1 : 0)
}
void main()
