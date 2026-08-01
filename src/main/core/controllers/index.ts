/**
 * Controllers — доменные фасады Kira Core.
 *
 * Каждый контроллер отвечает за свою область и является ЕДИНСТВЕННОЙ точкой,
 * через которую Actions трогают систему. Низкоуровневые драйверы (modules/
 * system.ts, files.ts) — деталь реализации: Actions зависят только от
 * контроллеров, поэтому замена драйвера не трогает ни Actions, ни движок.
 */
import { app, shell } from 'electron'
import { join } from 'path'
import * as sys from '../../modules/system'
import * as fs from '../../modules/files'
import * as util from '../../modules/utilities'
import * as clip from '../../modules/clipboardHistory'
import * as snip from '../../modules/snippets'
import * as knw from '../../modules/knowledge'
import { getSettings } from '../../modules/settings'
import type { ExecResult } from '../types'

export const BrowserController = {
  openDefault: (): Promise<ExecResult> => sys.openApp('браузер'),
  openUrl: (url: string): Promise<ExecResult> => sys.openUrl(url)
}

export const ApplicationController = {
  launch: (name: string, args?: string): Promise<ExecResult> => sys.openApp(name, args),
  close: (name: string): Promise<ExecResult> => sys.closeApp(name),
  taskManager: (): Promise<ExecResult> => sys.openApp('taskmgr'),
  vscode: (path?: string): Promise<ExecResult> => sys.openApp('code', path),
  dockerDesktop: (): Promise<ExecResult> => sys.openApp('docker desktop')
}

export const MediaController = {
  playPause: (): Promise<ExecResult> => sys.mediaControl('playpause'),
  next: (): Promise<ExecResult> => sys.mediaControl('next'),
  previous: (): Promise<ExecResult> => sys.mediaControl('prev'),
  volumeUp: (): Promise<ExecResult> => sys.mediaControl('volup'),
  volumeDown: (): Promise<ExecResult> => sys.mediaControl('voldown'),
  setVolume: (percent: number): Promise<ExecResult> => sys.setVolume(percent),
  /** Текущая громкость 0–100 — нужна, чтобы «отмени» вернула звук как было. */
  getVolume: (): Promise<number | null> => sys.getVolume(),
  mute: (on: boolean): Promise<ExecResult> => sys.setMute(on),
  playMusic: (query: string): Promise<ExecResult> => sys.playMusic(query),
  playVideo: (query: string): Promise<ExecResult> => sys.playVideo(query)
}

export const PowerController = {
  shutdown: (): Promise<ExecResult> => sys.powerAction('shutdown'),
  restart: (): Promise<ExecResult> => sys.powerAction('restart'),
  sleep: (): Promise<ExecResult> => sys.powerAction('sleep'),
  hibernate: (): Promise<ExecResult> => sys.powerAction('hibernate'),
  lock: (): Promise<ExecResult> => sys.powerAction('lock')
}

export const WindowController = {
  focus: (name: string): Promise<ExecResult> => sys.windowAction(name, 'focus'),
  minimizeAll: (): Promise<ExecResult> => sys.minimizeAll(),
  active: (action: 'minimize' | 'maximize' | 'restore' | 'close'): Promise<ExecResult> =>
    sys.activeWindowControl(action)
}

/** Ввод: клавиатурные комбинации в активное окно (копировать/вставить/…). */
export const InputController = {
  press: (keys: string): Promise<ExecResult> => sys.pressKeys(keys),
  copy: (): Promise<ExecResult> => sys.pressKeys('^c'),
  cut: (): Promise<ExecResult> => sys.pressKeys('^x'),
  paste: (): Promise<ExecResult> => sys.pressKeys('^v'),
  selectAll: (): Promise<ExecResult> => sys.pressKeys('^a'),
  save: (): Promise<ExecResult> => sys.pressKeys('^s')
}

/** Веб-поиск: открывает поисковую выдачу (без LLM). */
export const SearchController = {
  web: (query: string): Promise<ExecResult> => sys.openSearch(query, 'google'),
  youtube: (query: string): Promise<ExecResult> => sys.openSearch(query, 'youtube')
}

/** Текстовые сниппеты (заготовки). */
export const SnippetController = {
  save: (name: string, text: string): ExecResult => snip.saveSnippet(name, text),
  paste: (name: string): Promise<ExecResult> => snip.pasteSnippet(name),
  list: (): ExecResult => snip.listSnippets(),
  get: (name: string): ExecResult => snip.getSnippet(name),
  remove: (name: string): ExecResult => snip.deleteSnippet(name)
}

/** Самодиагностика подсистем Kira. */
export const DiagnosticsController = {
  run: (topic?: string): Promise<ExecResult> => import('../../modules/diagnostics').then((m) => m.diagnoseReport(topic))
}

/** Локальная база знаний по документам (RAG). */
export const KnowledgeController = {
  ask: (query: string): Promise<ExecResult> => knw.askDocs(query),
  status: (): ExecResult => knw.knowledgeStatus(),
  clear: (): ExecResult => knw.clearKnowledge(),
  /** Индексирует переданную папку или папку из настроек. */
  index: (folder?: string): Promise<ExecResult> => {
    const target = (folder ?? '').trim() || getSettings().knowledgeFolder
    if (!target) {
      return Promise.resolve({ ok: false, message: 'Не задана папка с документами. Укажи её: «проиндексируй документы в C:\\Docs» или в Настройках.' })
    }
    return knw.indexFolder(target)
  }
}

/** Бытовые утилиты: конвертер, курсы, QR, таймер, ИМТ, замер скорости. */
export const UtilityController = {
  isUnit: (word: string): boolean => util.isUnitWord(word),
  convert: (value: number, from: string, to: string): ExecResult => util.convertUnits(value, from, to),
  currency: (amount: number, from: string, to: string): Promise<ExecResult> => util.currencyConvert(amount, from, to),
  crypto: (coin: string, vs?: string): Promise<ExecResult> => util.cryptoRate(coin, vs),
  rate: (query: string): Promise<ExecResult> => util.rate(query),
  qr: (text: string): Promise<ExecResult> => util.generateQr(text),
  bmi: (heightCm: number, weightKg: number): ExecResult => util.bmi(heightCm, weightKg),
  timer: (ms: number, label?: string): ExecResult => util.startTimer(ms, label),
  timers: (): ExecResult => util.listTimers(),
  cancelTimers: (): ExecResult => util.cancelTimers(),
  speedTest: (): Promise<ExecResult> => util.speedTest(),
  looksLikeMath: (raw: string): boolean => util.looksLikeMath(raw),
  calculate: (raw: string): ExecResult => util.calculate(raw),
  translate: (text: string, to?: string): Promise<ExecResult> => util.translateText(text, to)
}

/**
 * Напоминания. Модуль умел их с самого начала, но наружу были выведены только
 * таймеры — «напомни завтра в 9» приходилось разбирать нейросети, хотя разбор
 * времени полностью локальный.
 */
export const ReminderController = {
  add: async (text: string, when: string): Promise<ExecResult> => {
    const m = await import('../../modules/reminders')
    return m.addReminder(text, when)
  },
  list: async (): Promise<ExecResult> => {
    const m = await import('../../modules/reminders')
    const items = m.listReminders()
    if (!items.length) return { ok: true, message: 'Напоминаний нет' }
    const lines = items.map((r) => {
      const when = new Date(r.fireAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
      return `${when} — ${r.text}`
    })
    return { ok: true, message: `Напоминаний: ${items.length}`, content: lines.join('\n') }
  }
}

/**
 * Заметки — поверх собственной памяти Kira, а не поверх Obsidian.
 *
 * Заметки уже были, но только у того, кто подключил внешнее хранилище. «Запиши
 * в заметки купить хлеб» без Obsidian уходило в облако и терялось. Своя память
 * есть у всех и работает офлайн — пишем туда, в категорию «note».
 */
export const NoteController = {
  add: async (text: string): Promise<ExecResult> => {
    const body = text.trim()
    if (!body) return { ok: false, message: 'Что записать?' }
    const { db } = await import('../../modules/db')
    const { newId } = await import('../../modules/ids')
    // заголовок — первые слова: по нему заметку потом видно в списке
    const title = body.split(/[\n.!?]/)[0].slice(0, 60).trim() || 'Заметка'
    db().memory.put({
      id: newId(), category: 'note', title, content: body,
      createdAt: Date.now(), updatedAt: Date.now(), source: 'kira'
    })
    return { ok: true, message: `Записала: ${title}` }
  },
  list: async (): Promise<ExecResult> => {
    const { db } = await import('../../modules/db')
    const notes = db().memory.all()
      .filter((m) => m.category === 'note')
      .sort((a, b) => b.updatedAt - a.updatedAt)
    if (!notes.length) return { ok: true, message: 'Заметок пока нет' }
    const lines = notes.slice(0, 40).map((n) =>
      `${new Date(n.createdAt).toLocaleDateString('ru-RU')} — ${n.content.slice(0, 120)}`)
    return { ok: true, message: `Заметок: ${notes.length}`, content: lines.join('\n') }
  }
}

/** Известные пользовательские папки — чтобы «в загрузках» решалось локально. */
export function knownFolder(nameOrPath: string): string {
  const n = nameOrPath.toLowerCase().trim()
  // Английские имена — не «на всякий случай», а потому что так эти папки
  // называются в самой Windows: человек говорит «открой downloads», видя
  // именно это слово в Проводнике. Без них Kira отвечала «не нашла папку» на
  // собственное системное название.
  const map: Record<string, string> = {
    'рабочий стол': app.getPath('desktop'),
    'рабочем столе': app.getPath('desktop'),
    'desktop': app.getPath('desktop'),
    'загрузки': app.getPath('downloads'),
    'downloads': app.getPath('downloads'),
    'download': app.getPath('downloads'),
    'документы': app.getPath('documents'),
    'documents': app.getPath('documents'),
    'docs': app.getPath('documents'),
    'домашняя': app.getPath('home'),
    'home': app.getPath('home'),
    'картинки': app.getPath('pictures'),
    'изображения': app.getPath('pictures'),
    'pictures': app.getPath('pictures'),
    'images': app.getPath('pictures'),
    'музыка': app.getPath('music'),
    'music': app.getPath('music'),
    'видео': app.getPath('videos'),
    'videos': app.getPath('videos'),
    'video': app.getPath('videos')
  }
  return map[n] ?? nameOrPath
}

export const FileController = {
  /** Показать содержимое папки. Kira умела открывать папку, но не «заглянуть» в неё. */
  listDir: async (nameOrPath: string): Promise<ExecResult> => {
    const dir = knownFolder(nameOrPath)
    try {
      const items = await fs.listDir(dir)
      if (!items.length) return { ok: true, message: `В папке «${dir}» пусто`, data: '' }
      const lines = items.slice(0, 100).map((i) =>
        i.isDirectory ? `[папка] ${i.name}` : `${i.name} · ${(i.size / 1024).toFixed(0)} КБ`)
      const more = items.length > 100 ? `\n…и ещё ${items.length - 100}` : ''
      return { ok: true, message: `В папке «${dir}»: ${items.length}`, content: lines.join('\n') + more }
    } catch (e) {
      return { ok: false, message: `Не удалось открыть папку: ${(e as Error).message}` }
    }
  },
  createFolder: (path: string): Promise<ExecResult> => fs.createFolder(path),
  deleteToTrash: (path: string): Promise<ExecResult> => fs.deleteToTrash(path),

  /*
   * Поиск, чтение и создание файлов были доступны ТОЛЬКО нейросети: модуль
   * files всё это умел, но ни одного действия ядра поверх него не было.
   * «Найди файл отчёт» уходило в облако вместе с именем файла — при том что
   * ищется он локально и мгновенно.
   */
  find: async (query: string): Promise<ExecResult> => {
    const q = query.trim()
    if (q.length < 2) return { ok: false, message: 'Скажи хотя бы часть названия' }
    const found = await fs.searchUserFiles(q, 40)
    if (!found.length) return { ok: true, message: `Ничего не нашла по «${q}»` }
    const lines = found.slice(0, 30).map((f) => (f.isDirectory ? `[папка] ${f.path}` : f.path))
    const more = found.length > 30 ? `\n…и ещё ${found.length - 30}` : ''
    return { ok: true, message: `Нашла: ${found.length}`, content: lines.join('\n') + more }
  },
  readFile: async (path: string): Promise<ExecResult> => {
    const file = knownFolder(path.trim())
    try {
      // документы (PDF/Word/Excel) читаются отдельным разборщиком
      const text = fs.isReadableDocument(file)
        ? await fs.readDocument(file)
        : await fs.readTextFile(file)
      const body = String(text ?? '').trim()
      if (!body) return { ok: true, message: `Файл «${file}» пуст` }
      return { ok: true, message: `Прочитала «${file}»`, content: body.slice(0, 8000) }
    } catch (e) {
      return { ok: false, message: `Не удалось прочитать: ${(e as Error).message}` }
    }
  },
  writeFile: (path: string, text: string): Promise<ExecResult> => fs.writeTextFile(path, text),
  move: (from: string, to: string): Promise<ExecResult> => fs.moveFile(from, to),
  copy: (from: string, to: string): Promise<ExecResult> => fs.copyFile(from, to),
  rename: (path: string, name: string): Promise<ExecResult> => fs.renameFile(path, name),
  openFolder: async (nameOrPath: string): Promise<ExecResult> => {
    const resolved = knownFolder(nameOrPath)
    const err = await shell.openPath(resolved)
    return err ? { ok: false, message: err } : { ok: true, message: `Открыла ${resolved}` }
  },
  openFile: async (path: string): Promise<ExecResult> => {
    const err = await shell.openPath(path)
    return err ? { ok: false, message: err } : { ok: true, message: `Открыла ${path}` }
  },
  desktopPath: (name: string): string => join(app.getPath('desktop'), name)
}

export const ClipboardController = {
  read: (): string => sys.clipboardRead(),
  write: (text: string): ExecResult => sys.clipboardWrite(text),
  history: (): ExecResult => clip.historyReport(),
  pasteRecent: (n: number): Promise<ExecResult> => clip.pasteRecent(n),
  copyRecent: (n: number): ExecResult => clip.copyRecent(n),
  clearHistory: (): ExecResult => clip.clearHistory()
}

export const NotificationController = {
  notify: (title: string, body: string): ExecResult => sys.notify(title, body)
}

export const TerminalController = {
  run: (command: string): Promise<ExecResult> => sys.runCommand(command)
}

export const GitController = {
  commit: (repoPath: string, message: string): Promise<ExecResult> =>
    sys.runCommand(`cd "${repoPath}"; git add -A; git commit -m "${message.replace(/"/g, '\\"')}"`)
}

export const SystemController = {
  screenshot: (): Promise<ExecResult> => sys.takeScreenshot(),
  setBrightness: (percent: number): Promise<ExecResult> => sys.setBrightness(percent),
  processes: (filter?: string): Promise<ExecResult> => sys.processReport(filter),
  killProcess: (pidOrName: string): Promise<ExecResult> => sys.killProcess(pidOrName),
  setWallpaper: (path: string): Promise<ExecResult> => sys.setWallpaper(path),
  restoreWallpaper: (): Promise<ExecResult> => sys.restoreWallpaper(),
  diskInfo: (): Promise<ExecResult> => sys.diskInfo(),
  batteryInfo: (): Promise<ExecResult> => sys.batteryInfo(),
  networkInfo: (): ExecResult => sys.networkInfo(),
  openRecycleBin: (): Promise<ExecResult> => sys.openRecycleBin(),
  emptyRecycleBin: (): Promise<ExecResult> => sys.emptyRecycleBin(),
  ocrScreen: (): Promise<ExecResult> => sys.ocrScreen(),
  ocrImage: (path: string): Promise<ExecResult> => sys.ocrImage(path),
  topMemory: (): Promise<ExecResult> => sys.topProcesses('memory'),
  topCpu: (): Promise<ExecResult> => sys.topProcesses('cpu'),
  startupApps: (): Promise<ExecResult> => sys.startupApps(),
  cleanTemp: (): Promise<ExecResult> => sys.cleanTempFiles(),
  /** Сводка загрузки: CPU, память, аптайм. */
  stats: (): ExecResult => {
    const s = sys.systemStats()
    return {
      ok: true,
      message: `Процессор ${s.cpuPercent}%, память ${s.memUsedGB} из ${s.memTotalGB} ГБ, аптайм ${s.uptimeHours} ч`,
      data: s
    }
  },
  weather: (): Promise<{ ok: boolean; temp?: number; desc?: string; city?: string }> =>
    sys.getWeather() as never,
  openSettings: async (): Promise<ExecResult> => {
    await shell.openExternal('ms-settings:')
    return { ok: true, message: 'Открываю параметры Windows' }
  }
}
