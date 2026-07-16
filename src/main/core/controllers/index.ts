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
  mute: (on: boolean): Promise<ExecResult> => sys.setMute(on),
  playMusic: (query: string): Promise<ExecResult> => sys.playMusic(query),
  playVideo: (query: string): Promise<ExecResult> => sys.playVideo(query)
}

export const PowerController = {
  shutdown: (): Promise<ExecResult> => sys.powerAction('shutdown'),
  restart: (): Promise<ExecResult> => sys.powerAction('restart'),
  sleep: (): Promise<ExecResult> => sys.powerAction('sleep'),
  lock: (): Promise<ExecResult> => sys.powerAction('lock')
}

export const WindowController = {
  focus: (name: string): Promise<ExecResult> => sys.windowAction(name, 'focus'),
  minimizeAll: (): Promise<ExecResult> => sys.minimizeAll()
}

/** Известные пользовательские папки — чтобы «в загрузках» решалось локально. */
export function knownFolder(nameOrPath: string): string {
  const n = nameOrPath.toLowerCase().trim()
  const map: Record<string, string> = {
    'рабочий стол': app.getPath('desktop'),
    'загрузки': app.getPath('downloads'),
    'документы': app.getPath('documents'),
    'домашняя': app.getPath('home'),
    'картинки': app.getPath('pictures'),
    'музыка': app.getPath('music'),
    'видео': app.getPath('videos')
  }
  return map[n] ?? nameOrPath
}

export const FileController = {
  createFolder: (path: string): Promise<ExecResult> => fs.createFolder(path),
  deleteToTrash: (path: string): Promise<ExecResult> => fs.deleteToTrash(path),
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
  write: (text: string): ExecResult => sys.clipboardWrite(text)
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
  weather: (): Promise<{ ok: boolean; temp?: number; desc?: string; city?: string }> =>
    sys.getWeather() as never,
  openSettings: async (): Promise<ExecResult> => {
    await shell.openExternal('ms-settings:')
    return { ok: true, message: 'Открываю параметры Windows' }
  }
}
