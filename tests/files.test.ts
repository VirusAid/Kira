/**
 * Файловые операции — проверка на РАЗРУШЕНИЕ, а не на успех.
 *
 * Kira двигает и переименовывает файлы по просьбе, а путь ей диктует модель.
 * Ошибка тут не «не сработало», а «чужой файл исчез навсегда».
 *
 * ПРАВИЛО ЭТОГО ФАЙЛА: настоящие системные пути сюда не попадают НИКОГДА.
 * Опасные случаи проверяются по возвращаемому результату на выдуманных путях —
 * функция обязана отказаться ДО того, как что-либо тронет. Однажды тут стоял
 * реальный `os.homedir()`, и заглушка `shell.trashItem` (это `rmSync` мимо
 * корзины) снесла живую домашнюю папку. Заглушка с тех пор физически
 * ограничена временной папкой, но полагаться на один барьер нельзя.
 */
import { moveFile, copyFile, renameFile, deleteToTrash } from '../src/main/modules/files'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

let pass = 0, fail = 0
const t = (n: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++
}
const root = path.join(os.tmpdir(), 'kira-core-test', 'files-' + Date.now())
const mk = (name: string, body: string): string => {
  const p = path.join(root, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body, 'utf-8')
  return p
}

async function main(): Promise<void> {
  fs.mkdirSync(root, { recursive: true })

  // ── Перемещение поверх существующего файла ────────────────────────────────
  const a = mk('a.txt', 'СОДЕРЖИМОЕ A')
  const b = mk('b.txt', 'ВАЖНОЕ B — ЕГО НЕЛЬЗЯ ТЕРЯТЬ')
  const moved = await moveFile(a, b)
  t('перемещение НЕ затирает существующий файл',
    fs.readFileSync(b, 'utf-8').includes('ВАЖНОЕ B'),
    '-> b.txt: ' + JSON.stringify(fs.readFileSync(b, 'utf-8').slice(0, 28)))
  t('перемещение сообщает, куда реально положило',
    moved.ok && moved.message.includes('(2)'), '-> ' + moved.message)

  // ── Копирование поверх существующего ──────────────────────────────────────
  const c = mk('c.txt', 'СОДЕРЖИМОЕ C')
  const d = mk('d.txt', 'ВАЖНОЕ D')
  await copyFile(c, d)
  t('копирование НЕ затирает существующий файл',
    fs.readFileSync(d, 'utf-8').includes('ВАЖНОЕ D'), '-> ' + fs.readFileSync(d, 'utf-8').slice(0, 28))

  // ── Переименование не должно выводить файл из папки ───────────────────────
  const e = mk('sub/e.txt', 'СОДЕРЖИМОЕ E')
  const up = '..' + path.sep + '..' + path.sep + 'сбежал.txt'
  const escaped = await renameFile(e, up)
  t('переименование не выпускает файл из папки', !escaped.ok, '-> ' + escaped.message)
  const slashed = await renameFile(e, 'другая/папка.txt')
  t('переименование не принимает путь вместо имени', !slashed.ok, '-> ' + slashed.message)
  t('исходный файл при этом цел', fs.existsSync(e))

  const okRename = await renameFile(e, 'нормальное-имя.txt')
  t('обычное переименование работает как прежде',
    okRename.ok && fs.existsSync(path.join(root, 'sub', 'нормальное-имя.txt')), '-> ' + okRename.message)

  // ── Катастрофические пути ─────────────────────────────────────────────────
  /*
   * Пути ВЫДУМАННЫЕ и заведомо отсутствующие на этой машине. Отказ обязан
   * прийти раньше проверки существования — иначе он держится на случайности
   * «такой папки тут нет», а на чужом компьютере она найдётся.
   */
  const sep = path.sep
  const catastrophic: Array<[string, string]> = [
    ['корень диска', 'Z:' + sep],
    ['корень диска без слэша', 'Z:'],
    ['сетевая шара целиком', sep + sep + 'сервер' + sep + 'общая'],
    ['Windows', 'Z:' + sep + 'Windows'],
    ['Program Files', 'Z:' + sep + 'Program Files'],
    ['ProgramData', 'Z:' + sep + 'ProgramData'],
    ['папка всех пользователей', 'Z:' + sep + 'Users'],
    ['пустой путь', '']
  ]
  for (const [what, target] of catastrophic) {
    const r = await deleteToTrash(target)
    t(`не удаляет: ${what}`, !r.ok && !/не найден/i.test(r.message), '-> ' + r.message)
  }

  // Домашняя папка берётся у СИСТЕМЫ, а не у Electron: заглушка подменяет
  // app.getPath, и защита, проверенная только тестом, оказалась бы проверенной
  // в единственной среде, где она заведомо не срабатывает.
  const home = await deleteToTrash(os.homedir())
  t('не удаляет: домашняя папка целиком',
    !home.ok && home.message.includes('домашняя'), '-> ' + home.message)
  t('домашняя папка на месте после отказа', fs.existsSync(os.homedir()))

  // ── Обычное удаление по-прежнему работает ─────────────────────────────────
  const doomed = mk('можно-удалить.txt', 'x')
  const okDel = await deleteToTrash(doomed)
  t('обычный файл удаляется как прежде', okDel.ok && !fs.existsSync(doomed), '-> ' + okDel.message)

  try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  console.log(`\n=== ИТОГО: ${pass} PASS, ${fail} FAIL ===`)
  process.exit(fail ? 1 : 0)
}
void main()
