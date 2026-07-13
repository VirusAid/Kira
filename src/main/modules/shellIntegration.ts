/**
 * Интеграция с Проводником Windows: пункт «Kira: действия» в контекстном меню
 * файлов. Пишет только в HKCU (без прав администратора), устанавливается и
 * снимается по кнопке в настройках — молча реестр не трогаем.
 *
 * При клике Проводник запускает Kira с аргументом `--ai-file "<путь>"`;
 * main читает содержимое файла и открывает то же меню AI Actions, что и по
 * горячей клавише для выделенного текста.
 */
import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { logger } from './logger'

const execFileP = promisify(execFile)

const KEY = 'HKCU\\Software\\Classes\\*\\shell\\KiraAiActions'
const CMD_KEY = KEY + '\\command'
const MENU_LABEL = 'Kira: действия'

/** Команда запуска: в упакованном виде — Kira.exe, в dev — electron + путь. */
function launchCommand(): string {
  const exe = process.execPath
  // форма --ai-file=<путь>: Chromium добавляет свои --switch в argv, и путь,
  // переданный отдельным аргументом, может «оторваться» — а =-форму не разбить
  if (app.isPackaged) return `"${exe}" --ai-file="%1"`
  return `"${exe}" "${app.getAppPath()}" --ai-file="%1"`
}

export async function isFileMenuInstalled(): Promise<boolean> {
  try {
    await execFileP('reg', ['query', KEY])
    return true
  } catch {
    return false
  }
}

export async function installFileMenu(): Promise<{ ok: boolean; message: string }> {
  try {
    await execFileP('reg', ['add', KEY, '/ve', '/d', MENU_LABEL, '/f'])
    await execFileP('reg', ['add', CMD_KEY, '/ve', '/d', launchCommand(), '/f'])
    logger.info('shell', 'Пункт контекстного меню установлен')
    return { ok: true, message: 'Пункт «Kira: действия» добавлен в контекстное меню файлов' }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export async function removeFileMenu(): Promise<{ ok: boolean; message: string }> {
  try {
    await execFileP('reg', ['delete', KEY, '/f'])
    logger.info('shell', 'Пункт контекстного меню удалён')
    return { ok: true, message: 'Пункт удалён из контекстного меню' }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

/** Извлечь путь файла из argv (поддержка --ai-file=<path> и --ai-file <path>). */
export function extractAiFile(argv: string[]): string | null {
  for (const a of argv) {
    if (a.startsWith('--ai-file=')) {
      return a.slice('--ai-file='.length).replace(/^"|"$/g, '') || null
    }
  }
  const i = argv.indexOf('--ai-file')
  // пробел-форма: следующий аргумент, но не чужой --switch (Chromium вставляет свои)
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return null
}

/** Прочитать текст файла для AI Actions (документы — через readDocument). */
export async function extractFileText(path: string): Promise<string> {
  const files = await import('./files')
  const ext = (path.toLowerCase().split('.').pop() || '')
  try {
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'pptx'].includes(ext)) {
      return (await files.readDocument(path)).slice(0, 8000)
    }
    return (await files.readTextFile(path)).slice(0, 8000)
  } catch {
    return ''
  }
}
