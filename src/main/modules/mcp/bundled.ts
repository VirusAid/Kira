/**
 * Встроенные расширения — то, что готово сразу после установки.
 *
 * Обычный путь MCP («npx -y пакет») требует установленного Node.js и лезет в
 * интернет при первом запуске. Для человека, который просто поставил Kira, это
 * два условия, о которых он не договаривался. Поэтому эти серверы лежат внутри
 * установщика, а запускаются рантаймом самой Kira.
 *
 * Каталог живёт здесь, а не в интерфейсе: только main знает, куда
 * распаковалось приложение, и только он может проверить, что файлы на месте.
 */
import { app } from 'electron'
import { existsSync } from 'fs'
import { dirname, join } from 'path'

export interface BundledServer {
  /** Ключ пакета — для отладки и диагностики. */
  pkg: string
  title: string
  hint: string
  /** Полный путь к исполняемому файлу сервера. */
  entry: string
  /** Что спросить у человека перед подключением (пусто — ничего). */
  argHint: string
  /** Установлен ли он на самом деле. */
  available: boolean
}

/**
 * Папка со встроенными расширениями.
 *
 * В собранном приложении это ресурсы рядом с исполняемым файлом. В разработке
 * искать приходится ВВЕРХ от собранного main: `app.getAppPath()` возвращает
 * папку запускаемого файла (`out/main`), а не корень проекта — из-за этого
 * расширения показывались как «не найдены», хотя лежали на месте.
 */
function bundleDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'mcp')
  let dir = __dirname
  for (let up = 0; up < 5; up++) {
    const candidate = join(dir, 'resources', 'mcp')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return join(process.cwd(), 'resources', 'mcp')
}

function entryOf(pkg: string): string {
  return join(bundleDir(), 'node_modules', ...pkg.split('/'), 'dist', 'index.js')
}

const CATALOG: Array<Omit<BundledServer, 'entry' | 'available'>> = [
  {
    pkg: '@modelcontextprotocol/server-filesystem',
    title: 'Файлы и папки',
    hint: 'Кира сможет искать, читать и раскладывать файлы в выбранной папке',
    argHint: 'Папка, к которой открыть доступ'
  },
  {
    pkg: '@modelcontextprotocol/server-memory',
    title: 'Общая память',
    hint: 'Хранилище фактов, которым Кира может делиться с другими программами',
    argHint: ''
  }
]

/** Что доступно прямо сейчас — с проверкой, что файлы действительно на месте. */
export function bundledCatalog(): BundledServer[] {
  return CATALOG.map((c) => {
    const entry = entryOf(c.pkg)
    return { ...c, entry, available: existsSync(entry) }
  })
}
