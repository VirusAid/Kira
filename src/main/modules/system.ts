/**
 * System — управление компьютером: программы, окна, громкость, яркость,
 * скриншоты, процессы, питание, буфер обмена.
 *
 * Все действия логируются. Опасные действия (выключение, завершение
 * процессов, удаление) подтверждаются на стороне UI до вызова.
 */
import { app, clipboard, desktopCapturer, screen, shell, Notification } from 'electron'
import { spawn, execFile } from 'child_process'
import { promises as fsp, existsSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { logger } from './logger'
import type { ActionResult, ProcessInfo, SystemStats } from '../../shared/types'

/** Запуск PowerShell-команды с таймаутом. */
export function runPowerShell(command: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code: code ?? -1 })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ stdout, stderr: 'Не удалось запустить PowerShell', code: -1 })
    })
  })
}

const ps = (s: string) => `'${s.replace(/'/g, "''")}'`

// ─── Программы и файлы ──────────────────────────────────────────────────────

/** Известные приложения: имя → команда запуска. */
const KNOWN_APPS: Record<string, string> = {
  'браузер': 'start microsoft-edge:',
  'edge': 'start microsoft-edge:',
  'chrome': 'start chrome',
  'хром': 'start chrome',
  'firefox': 'start firefox',
  'блокнот': 'notepad',
  'notepad': 'notepad',
  'калькулятор': 'calc',
  'calc': 'calc',
  'проводник': 'explorer',
  'explorer': 'explorer',
  'терминал': 'wt',
  'terminal': 'wt',
  'cmd': 'start cmd',
  'powershell': 'start powershell',
  'диспетчер задач': 'taskmgr',
  'taskmgr': 'taskmgr',
  'настройки': 'start ms-settings:',
  'discord': 'start discord:',
  'дискорд': 'start discord:',
  'steam': 'start steam:',
  'стим': 'start steam:',
  'spotify': 'start spotify:',
  'telegram': `start "" "$env:APPDATA\\Telegram Desktop\\Telegram.exe"`,
  'телеграм': `start "" "$env:APPDATA\\Telegram Desktop\\Telegram.exe"`,
  'vscode': 'start code',
  'visual studio code': 'start code',
  'paint': 'mspaint',
  'word': 'start winword',
  'excel': 'start excel'
}

export async function openApp(nameOrPath: string, args?: string): Promise<ActionResult> {
  const key = nameOrPath.trim().toLowerCase()
  logger.action('system', `Запуск: ${nameOrPath}${args ? ' ' + args : ''}`)

  // «браузер»/«интернет» без уточнения — открываем браузер ПО УМОЛЧАНИЮ
  if (['браузер', 'browser', 'интернет', 'веб-браузер', 'обозреватель'].includes(key)) {
    await shell.openExternal(args && /^https?:\/\//.test(args) ? args : 'https://www.google.com/')
    return { ok: true, message: 'Открываю браузер' }
  }

  // 1. известное приложение
  const known = KNOWN_APPS[key]
  if (known) {
    const r = await runPowerShell(known.startsWith('start') || known.includes('$env') ? `cmd /c ${known}` : `Start-Process ${ps(known)}`)
    return r.code === 0
      ? { ok: true, message: `Запускаю ${nameOrPath}` }
      : { ok: false, message: `Не удалось запустить ${nameOrPath}: ${r.stderr.slice(0, 200)}` }
  }

  // 2. явный путь
  if (existsSync(nameOrPath)) {
    const err = await shell.openPath(nameOrPath)
    return err ? { ok: false, message: err } : { ok: true, message: `Открываю ${nameOrPath}` }
  }

  // 3. пробуем как команду (в PATH или app-протокол)
  const r = await runPowerShell(
    args
      ? `Start-Process ${ps(nameOrPath)} -ArgumentList ${ps(args)}`
      : `Start-Process ${ps(nameOrPath)}`
  )
  if (r.code === 0) return { ok: true, message: `Запускаю ${nameOrPath}` }

  // 4. поиск в меню «Пуск»
  const found = await findInStartMenu(nameOrPath)
  if (found) {
    const err = await shell.openPath(found)
    return err ? { ok: false, message: err } : { ok: true, message: `Нашла и запускаю: ${found}` }
  }

  return { ok: false, message: `Не нашла программу «${nameOrPath}». Попробуй указать полный путь.` }
}

async function findInStartMenu(query: string): Promise<string | null> {
  const dirs = [
    join(process.env.APPDATA ?? '', 'Microsoft/Windows/Start Menu/Programs'),
    'C:/ProgramData/Microsoft/Windows/Start Menu/Programs'
  ]
  const q = query.toLowerCase()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const found = await searchLnk(dir, q, 0)
    if (found) return found
  }
  return null
}

async function searchLnk(dir: string, q: string, depth: number): Promise<string | null> {
  if (depth > 3) return null
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isFile() && e.name.toLowerCase().endsWith('.lnk') && e.name.toLowerCase().includes(q)) {
        return full
      }
      if (e.isDirectory()) {
        const found = await searchLnk(full, q, depth + 1)
        if (found) return found
      }
    }
  } catch {
    /* нет доступа — пропускаем */
  }
  return null
}

// известные сайты по названию (чтобы открывать именно нужное, а не случайное)
const KNOWN_SITES: Record<string, string> = {
  'youtube': 'youtube.com', 'ютуб': 'youtube.com', 'ютюб': 'youtube.com',
  'google': 'google.com', 'гугл': 'google.com', 'гугол': 'google.com',
  'вконтакте': 'vk.com', 'вк': 'vk.com', 'vk': 'vk.com',
  'телеграм': 'web.telegram.org', 'telegram': 'web.telegram.org',
  'инстаграм': 'instagram.com', 'instagram': 'instagram.com', 'инста': 'instagram.com',
  'фейсбук': 'facebook.com', 'facebook': 'facebook.com',
  'твиттер': 'twitter.com', 'twitter': 'twitter.com', 'x': 'x.com',
  'тикток': 'tiktok.com', 'tiktok': 'tiktok.com',
  'reddit': 'reddit.com', 'реддит': 'reddit.com',
  'github': 'github.com', 'гитхаб': 'github.com',
  'wikipedia': 'wikipedia.org', 'википедия': 'ru.wikipedia.org', 'вики': 'ru.wikipedia.org',
  'gmail': 'mail.google.com', 'почта': 'mail.google.com', 'gmail почта': 'mail.google.com',
  'chatgpt': 'chatgpt.com', 'чатгпт': 'chatgpt.com', 'chat gpt': 'chatgpt.com',
  'twitch': 'twitch.tv', 'твич': 'twitch.tv',
  'spotify': 'open.spotify.com', 'спотифай': 'open.spotify.com',
  'netflix': 'netflix.com', 'нетфликс': 'netflix.com',
  'amazon': 'amazon.com', 'aliexpress': 'aliexpress.com', 'алиэкспресс': 'aliexpress.com',
  'озон': 'ozon.ru', 'ozon': 'ozon.ru', 'wildberries': 'wildberries.ru', 'вайлдберриз': 'wildberries.ru',
  'discord': 'discord.com', 'дискорд': 'discord.com',
  'linkedin': 'linkedin.com', 'notion': 'notion.so'
}

export async function openUrl(url: string): Promise<ActionResult> {
  const raw = url.trim()
  const key = raw.toLowerCase().replace(/\.(com|ru|org|net|tv)$/i, '')
  let target: string
  if (/^https?:\/\//i.test(raw)) {
    target = raw
  } else if (KNOWN_SITES[key]) {
    target = 'https://' + KNOWN_SITES[key]
  } else if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw)) {
    // похоже на домен (site.com/...) — открываем как есть
    target = 'https://' + raw
  } else {
    // не адрес и не известный сайт — НЕ открываем случайное. Подсказываем правильный инструмент.
    return {
      ok: false,
      message: `«${raw}» — это не адрес сайта. Для фильма/видео используй play_video, для музыки play_music, для поиска информации search_web, а для сайта — точный адрес (например youtube.com).`
    }
  }
  logger.action('system', `Открытие: ${target}`)
  await shell.openExternal(target)
  return { ok: true, message: `Открываю ${target.replace(/^https?:\/\//, '').slice(0, 60)}` }
}

export async function closeApp(processName: string): Promise<ActionResult> {
  const name = processName.replace(/\.exe$/i, '')
  logger.action('system', `Закрытие: ${name}`)
  const r = await runPowerShell(`Stop-Process -Name ${ps(name)} -ErrorAction SilentlyContinue; if ($?) { 'ok' }`)
  return r.stdout.includes('ok')
    ? { ok: true, message: `Закрыла ${name}` }
    : { ok: false, message: `Процесс «${name}» не найден` }
}

// ─── Громкость и яркость ────────────────────────────────────────────────────

const VOLUME_CS = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class Audio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null; enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
    IAudioEndpointVolume epv = null; var epvid = typeof(IAudioEndpointVolume).GUID;
    dev.Activate(ref epvid, 23, 0, out epv); return epv;
  }
  public static float GetVolume() { float v; Vol().GetMasterVolumeLevelScalar(out v); return v; }
  public static void SetVolume(float v) { Vol().SetMasterVolumeLevelScalar(v, System.Guid.Empty); }
  public static void SetMute(bool m) { Vol().SetMute(m, System.Guid.Empty); }
}
'@
`

export async function setVolume(percent: number): Promise<ActionResult> {
  const level = Math.max(0, Math.min(100, Math.round(percent))) / 100
  logger.action('system', `Громкость: ${Math.round(level * 100)}%`)
  const r = await runPowerShell(`${VOLUME_CS}\n[Audio]::SetVolume(${level})`)
  return r.code === 0
    ? { ok: true, message: `Громкость ${Math.round(level * 100)}%` }
    : { ok: false, message: 'Не удалось изменить громкость' }
}

export async function setMute(mute: boolean): Promise<ActionResult> {
  logger.action('system', mute ? 'Звук выключен' : 'Звук включён')
  const r = await runPowerShell(`${VOLUME_CS}\n[Audio]::SetMute($${mute})`)
  return r.code === 0
    ? { ok: true, message: mute ? 'Звук выключен' : 'Звук включён' }
    : { ok: false, message: 'Не удалось изменить звук' }
}

export async function setBrightness(percent: number): Promise<ActionResult> {
  const level = Math.max(0, Math.min(100, Math.round(percent)))
  logger.action('system', `Яркость: ${level}%`)
  const r = await runPowerShell(
    `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${level})`
  )
  return r.code === 0 && !r.stderr
    ? { ok: true, message: `Яркость ${level}%` }
    : { ok: false, message: 'Не удалось изменить яркость (внешние мониторы могут не поддерживаться)' }
}

// ─── Скриншоты ──────────────────────────────────────────────────────────────

export async function takeScreenshot(): Promise<ActionResult> {
  const display = screen.getPrimaryDisplay()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.size.width, height: display.size.height }
  })
  if (!sources.length) return { ok: false, message: 'Не удалось получить изображение экрана' }

  const dir = join(app.getPath('pictures'), 'Kira Screenshots')
  await fsp.mkdir(dir, { recursive: true })
  const file = join(dir, `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
  await fsp.writeFile(file, sources[0].thumbnail.toPNG())
  logger.action('system', `Скриншот сохранён: ${file}`)
  return { ok: true, message: `Скриншот сохранён: ${file}`, data: file }
}

/** Снимок экрана в base64 (для «зрения» Kira). */
export async function captureScreenBase64(): Promise<string> {
  const display = screen.getPrimaryDisplay()
  const scale = Math.min(1, 1440 / display.size.width)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale)
    }
  })
  if (!sources.length) throw new Error('Экран недоступен')
  return sources[0].thumbnail.toJPEG(80).toString('base64')
}

// ─── Процессы ───────────────────────────────────────────────────────────────

export async function listProcesses(): Promise<ProcessInfo[]> {
  const r = await runPowerShell(
    `Get-Process | Sort-Object WS -Descending | Select-Object -First 60 Id, ProcessName, WS | ConvertTo-Json -Compress`
  )
  try {
    const raw = JSON.parse(r.stdout)
    const arr = Array.isArray(raw) ? raw : [raw]
    return arr.map((p: { Id: number; ProcessName: string; WS: number }) => ({
      pid: p.Id,
      name: p.ProcessName,
      memoryMB: Math.round(p.WS / 1024 / 1024)
    }))
  } catch {
    return []
  }
}

export async function killProcess(pidOrName: string): Promise<ActionResult> {
  logger.action('system', `Завершение процесса: ${pidOrName}`)
  const isPid = /^\d+$/.test(pidOrName)
  const cmd = isPid
    ? `Stop-Process -Id ${pidOrName} -Force -ErrorAction SilentlyContinue; if ($?) { 'ok' }`
    : `Stop-Process -Name ${ps(pidOrName.replace(/\.exe$/i, ''))} -Force -ErrorAction SilentlyContinue; if ($?) { 'ok' }`
  const r = await runPowerShell(cmd)
  return r.stdout.includes('ok')
    ? { ok: true, message: `Процесс ${pidOrName} завершён` }
    : { ok: false, message: `Не удалось завершить ${pidOrName}` }
}

// ─── Питание ────────────────────────────────────────────────────────────────

export async function powerAction(action: 'shutdown' | 'restart' | 'sleep' | 'lock'): Promise<ActionResult> {
  logger.action('system', `Питание: ${action}`)
  switch (action) {
    case 'shutdown':
      execFile('shutdown', ['/s', '/t', '3'])
      return { ok: true, message: 'Выключаю компьютер через 3 секунды…' }
    case 'restart':
      execFile('shutdown', ['/r', '/t', '3'])
      return { ok: true, message: 'Перезагружаю компьютер через 3 секунды…' }
    case 'sleep':
      await runPowerShell('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)')
      return { ok: true, message: 'Перевожу в спящий режим' }
    case 'lock':
      execFile('rundll32.exe', ['user32.dll,LockWorkStation'])
      return { ok: true, message: 'Блокирую экран' }
  }
}

// ─── Буфер обмена и уведомления ─────────────────────────────────────────────

export function clipboardRead(): string {
  return clipboard.readText()
}

export function clipboardWrite(text: string): ActionResult {
  clipboard.writeText(text)
  logger.action('system', 'Текст скопирован в буфер обмена')
  return { ok: true, message: 'Скопировано в буфер обмена' }
}

/** Восстановить файл/папку из корзины по исходному пути (Shell.Application). */
export async function restoreFromRecycleBin(originalPath: string): Promise<boolean> {
  const p = originalPath.replace(/'/g, "''")
  const script =
    `$sh = New-Object -ComObject Shell.Application; $rb = $sh.Namespace(10); ` +
    `$item = $rb.Items() | Where-Object { $_.Path -ne $null } | Where-Object { ` +
    `  $orig = $rb.GetDetailsOf($_, 1); ` +
    `  (Join-Path $orig $_.Name) -eq '${p}' -or $_.Name -eq (Split-Path '${p}' -Leaf) } | Select-Object -First 1; ` +
    `if ($item) { $verb = $item.Verbs() | Where-Object { $_.Name -match 'Восстанов|Restore|восстанов' } | Select-Object -First 1; ` +
    `  if ($verb) { $verb.DoIt(); 'ok' } else { $item.InvokeVerb('undelete'); 'ok' } }`
  const r = await runPowerShell(script, 20_000)
  return r.stdout.includes('ok')
}

/** Прочитать ВЫДЕЛЕННЫЙ текст в активном окне: Ctrl+C, затем буфер обмена. */
export async function readSelection(): Promise<ActionResult> {
  const before = clipboard.readText()
  await runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')`
  )
  await new Promise((r) => setTimeout(r, 250))
  const text = clipboard.readText()
  if (!text || text === before) {
    return { ok: false, message: 'Не удалось прочитать выделение (ничего не выделено?)' }
  }
  logger.action('system', 'Прочитано выделение')
  return { ok: true, message: 'Прочитала выделенный текст', data: text.slice(0, 8000) }
}

export function notify(title: string, body: string): ActionResult {
  new Notification({ title, body }).show()
  return { ok: true, message: 'Уведомление показано' }
}

export async function typeText(text: string): Promise<ActionResult> {
  logger.action('system', 'Ввод текста в активное окно')
  const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}').replace(/'/g, "''")
  const r = await runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`
  )
  return r.code === 0
    ? { ok: true, message: 'Текст введён' }
    : { ok: false, message: 'Не удалось ввести текст' }
}

// ─── «Руки»: управление мышью и клавиатурой (computer use) ──────────────────

const MOUSE_CS = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class KMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  public static int W() { return GetSystemMetrics(0); }
  public static int H() { return GetSystemMetrics(1); }
  public static void Click(){ mouse_event(0x02,0,0,0,IntPtr.Zero); mouse_event(0x04,0,0,0,IntPtr.Zero); }
  public static void Right(){ mouse_event(0x08,0,0,0,IntPtr.Zero); mouse_event(0x10,0,0,0,IntPtr.Zero); }
  public static void Scroll(int amt){ mouse_event(0x0800,0,0,(uint)amt,IntPtr.Zero); }
}
'@
`

/** Переместить курсор. x,y — доля экрана 0..1 (надёжнее абсолютных пикселей). */
export async function mouseMove(xFrac: number, yFrac: number): Promise<ActionResult> {
  const script = `${MOUSE_CS}\n$w=[KMouse]::W(); $h=[KMouse]::H(); [KMouse]::SetCursorPos([int]($w*${clamp01(xFrac)}), [int]($h*${clamp01(yFrac)}))`
  const r = await runPowerShell(script)
  return r.code === 0 ? { ok: true, message: `Курсор → ${Math.round(xFrac * 100)}%, ${Math.round(yFrac * 100)}%` } : { ok: false, message: 'Не удалось двинуть мышь' }
}

export async function mouseClick(xFrac?: number, yFrac?: number, button: 'left' | 'right' | 'double' = 'left'): Promise<ActionResult> {
  logger.action('control', `Клик ${button}${xFrac != null ? ` @ ${Math.round(xFrac * 100)}%,${Math.round((yFrac ?? 0) * 100)}%` : ''}`)
  const move = xFrac != null && yFrac != null
    ? `$w=[KMouse]::W(); $h=[KMouse]::H(); [KMouse]::SetCursorPos([int]($w*${clamp01(xFrac)}), [int]($h*${clamp01(yFrac)})); Start-Sleep -Milliseconds 120;`
    : ''
  const act = button === 'right' ? '[KMouse]::Right()' : button === 'double' ? '[KMouse]::Click(); Start-Sleep -Milliseconds 60; [KMouse]::Click()' : '[KMouse]::Click()'
  const r = await runPowerShell(`${MOUSE_CS}\n${move} ${act}`)
  return r.code === 0 ? { ok: true, message: `Клик выполнен` } : { ok: false, message: 'Не удалось кликнуть' }
}

export async function mouseScroll(amount: number): Promise<ActionResult> {
  const r = await runPowerShell(`${MOUSE_CS}\n[KMouse]::Scroll(${Math.round(amount)})`)
  return r.code === 0 ? { ok: true, message: 'Прокрутка' } : { ok: false, message: 'Не удалось прокрутить' }
}

/** Нажать клавишу/сочетание в формате SendKeys: «^c», «{ENTER}», «%{F4}». */
export async function pressKeys(keys: string): Promise<ActionResult> {
  logger.action('control', `Клавиши: ${keys}`)
  const escaped = keys.replace(/'/g, "''")
  const r = await runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 120; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`
  )
  return r.code === 0 ? { ok: true, message: `Нажато: ${keys}` } : { ok: false, message: 'Не удалось нажать' }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number(v) || 0))
}

/**
 * Надёжный клик по элементу интерфейса ПО ТЕКСТУ (Windows UI Automation).
 * Находит кнопку/ссылку/пункт меню с нужным названием в активном окне и кликает
 * точно по нему — без «прицеливания по скриншоту».
 */
export async function clickElement(text: string, doClick = true): Promise<ActionResult> {
  logger.action('control', `Клик по элементу «${text}»`)
  const target = text.replace(/'/g, "''").toLowerCase()
  const script = `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class FGW{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,IntPtr e);}'
$AE=[System.Windows.Automation.AutomationElement]; $CT=[System.Windows.Automation.ControlType]
$hwnd=[FGW]::GetForegroundWindow(); $win=$AE::FromHandle($hwnd)
if($win -eq $null){ Write-Output 'NONE'; exit }
$types=@($CT::Button,$CT::Hyperlink,$CT::MenuItem,$CT::ListItem,$CT::TabItem,$CT::CheckBox,$CT::RadioButton,$CT::SplitButton,$CT::Text,$CT::TreeItem)
$conds=$types|ForEach-Object{ New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty,$_) }
$or=New-Object System.Windows.Automation.OrCondition($conds)
$els=$win.FindAll([System.Windows.Automation.TreeScope]::Descendants,$or)
$best=$null
foreach($e in $els){
  $n=$e.Current.Name
  if($n -and $n.ToLower().Contains('${target}')){ $best=$e; if($n.ToLower() -eq '${target}'){ break } }
}
if($best -eq $null){ Write-Output 'NOTFOUND'; exit }
$r=$best.Current.BoundingRectangle
if($r.Width -le 0){ Write-Output 'NOTFOUND'; exit }
$x=[int]($r.X + $r.Width/2); $y=[int]($r.Y + $r.Height/2)
if(${doClick ? '$true' : '$false'}){ [FGW]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 120; [FGW]::mouse_event(2,0,0,0,[IntPtr]::Zero); [FGW]::mouse_event(4,0,0,0,[IntPtr]::Zero) }
Write-Output ("OK|"+$best.Current.Name+"|"+$x+"|"+$y)
`
  const r = await runPowerShell(script, 20_000)
  const out = r.stdout.trim()
  if (out.startsWith('OK|')) {
    const name = out.split('|')[1] ?? text
    return { ok: true, message: doClick ? `Нажала «${name}»` : `Нашла «${name}»`, data: out }
  }
  if (out.includes('NOTFOUND')) return { ok: false, message: `Не нашла элемент «${text}» в активном окне` }
  return { ok: false, message: `Не удалось найти окно/элемент «${text}»` }
}

// ─── Статистика ─────────────────────────────────────────────────────────────

let lastCpu = os.cpus().map((c) => c.times)

export function systemStats(): SystemStats {
  const cpus = os.cpus()
  let idleDiff = 0
  let totalDiff = 0
  cpus.forEach((cpu, i) => {
    const prev = lastCpu[i] ?? cpu.times
    const prevTotal = Object.values(prev).reduce((a, b) => a + b, 0)
    const curTotal = Object.values(cpu.times).reduce((a, b) => a + b, 0)
    totalDiff += curTotal - prevTotal
    idleDiff += cpu.times.idle - prev.idle
  })
  lastCpu = cpus.map((c) => c.times)
  const cpuPercent = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0

  return {
    cpuPercent,
    memUsedGB: +((os.totalmem() - os.freemem()) / 1024 ** 3).toFixed(1),
    memTotalGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    uptimeHours: +(os.uptime() / 3600).toFixed(1),
    platform: `${os.type()} ${os.release()}`,
    hostname: os.hostname()
  }
}

/** Произвольная системная команда (запрашивается подтверждение в UI). */
export async function runCommand(command: string): Promise<ActionResult> {
  logger.action('system', `Команда: ${command}`)
  const r = await runPowerShell(command, 60_000)
  const output = (r.stdout + r.stderr).trim().slice(0, 2000)
  return {
    ok: r.code === 0,
    message: output || (r.code === 0 ? 'Команда выполнена' : `Код ошибки: ${r.code}`),
    data: output
  }
}

// ─── Управление медиа (мультимедийные клавиши) ──────────────────────────────

const MEDIA_KEYS: Record<string, { vk: number; label: string }> = {
  playpause: { vk: 0xb3, label: 'Пауза/Плей' },
  next: { vk: 0xb0, label: 'Следующий трек' },
  prev: { vk: 0xb1, label: 'Предыдущий трек' },
  stop: { vk: 0xb2, label: 'Стоп' },
  volup: { vk: 0xaf, label: 'Громче' },
  voldown: { vk: 0xae, label: 'Тише' },
  volmute: { vk: 0xad, label: 'Без звука' }
}

export async function mediaControl(action: keyof typeof MEDIA_KEYS): Promise<ActionResult> {
  const key = MEDIA_KEYS[action]
  if (!key) return { ok: false, message: 'Неизвестная медиа-команда' }
  logger.action('system', `Медиа: ${key.label}`)
  const script =
    `Add-Type -Name K -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);'; ` +
    `[W.K]::keybd_event(${key.vk},0,0,[System.UIntPtr]::Zero); [W.K]::keybd_event(${key.vk},0,2,[System.UIntPtr]::Zero)`
  const r = await runPowerShell(script)
  return r.code === 0
    ? { ok: true, message: key.label }
    : { ok: false, message: 'Не удалось отправить медиа-команду' }
}

// ─── Управление окнами ──────────────────────────────────────────────────────

export interface WindowInfo {
  handle: number
  title: string
  processName: string
}

export async function listWindows(): Promise<WindowInfo[]> {
  const r = await runPowerShell(
    `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ` +
    `Select-Object @{n='handle';e={[int64]$_.MainWindowHandle}}, @{n='title';e={$_.MainWindowTitle}}, @{n='processName';e={$_.ProcessName}} | ` +
    `ConvertTo-Json -Compress`
  )
  try {
    const raw = JSON.parse(r.stdout)
    const arr = Array.isArray(raw) ? raw : [raw]
    return arr.filter((w: WindowInfo) => w && w.title)
  } catch {
    return []
  }
}

/** Действие над окном по имени процесса: focus | minimize | maximize | close. */
export async function windowAction(
  processName: string,
  action: 'focus' | 'minimize' | 'maximize' | 'close'
): Promise<ActionResult> {
  const name = processName.replace(/\.exe$/i, '')
  logger.action('system', `Окно «${name}»: ${action}`)
  const SW = { minimize: 6, maximize: 3, focus: 9 } as const
  if (action === 'close') {
    const r = await runPowerShell(
      `(Get-Process -Name ${ps(name)} -ErrorAction SilentlyContinue | Select-Object -First 1).CloseMainWindow(); if ($?) { 'ok' }`
    )
    return r.stdout.includes('ok')
      ? { ok: true, message: `Окно ${name} закрыто` }
      : { ok: false, message: `Окно «${name}» не найдено` }
  }
  const script =
    `Add-Type -Name Win -Namespace Api -MemberDefinition '` +
    `[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow); ` +
    `[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);'; ` +
    `$p = Get-Process -Name ${ps(name)} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; ` +
    `if ($p) { [Api.Win]::ShowWindow($p.MainWindowHandle, ${SW[action]}); [Api.Win]::SetForegroundWindow($p.MainWindowHandle); 'ok' }`
  const r = await runPowerShell(script)
  return r.stdout.includes('ok')
    ? { ok: true, message: `Окно ${name}: ${action}` }
    : { ok: false, message: `Окно «${name}» не найдено` }
}

/** Свернуть все окна (показать рабочий стол). */
export async function minimizeAll(): Promise<ActionResult> {
  logger.action('system', 'Свернуть все окна')
  const r = await runPowerShell(`(New-Object -ComObject Shell.Application).MinimizeAll()`)
  return r.code === 0
    ? { ok: true, message: 'Все окна свёрнуты' }
    : { ok: false, message: 'Не удалось свернуть окна' }
}

// ─── Захват источников для записи экрана ────────────────────────────────────

/** Список источников экрана/окон для записи (renderer записывает через MediaRecorder). */
export async function listCaptureSources(): Promise<{ id: string; name: string; thumbnail: string }[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 240, height: 135 }
  })
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL()
  }))
}

/** Сохранить записанное видео (base64 webm) в папку «Видео/Kira Recordings». */
export async function saveRecording(base64: string): Promise<ActionResult> {
  const dir = join(app.getPath('videos'), 'Kira Recordings')
  await fsp.mkdir(dir, { recursive: true })
  const file = join(dir, `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`)
  await fsp.writeFile(file, Buffer.from(base64, 'base64'))
  logger.action('system', `Запись экрана сохранена: ${file}`)
  return { ok: true, message: `Запись сохранена: ${file}`, data: file }
}

// ─── Музыка и веб ───────────────────────────────────────────────────────────

export interface YouTubeResult {
  videoId: string
  title: string
  channel?: string
}

/** Поиск на YouTube без API-ключа: парсим первый результат из HTML выдачи. */
export async function searchYouTube(query: string): Promise<YouTubeResult | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=ru`,
      {
        signal: AbortSignal.timeout(15_000),
        headers: {
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
        }
      }
    )
    const html = await res.text()
    // первый videoRenderer содержит videoId, title и имя канала
    const idMatch = html.match(/"videoId":"([\w-]{11})"/)
    if (!idMatch) return null
    const videoId = idMatch[1]
    // ищем заголовок рядом с этим videoId
    const block = html.slice(html.indexOf(`"${videoId}"`), html.indexOf(`"${videoId}"`) + 1200)
    const titleMatch = block.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/)
    const channelMatch = block.match(/"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/)
    const decode = (s?: string): string =>
      s ? JSON.parse(`"${s}"`) : ''
    return {
      videoId,
      title: decode(titleMatch?.[1]) || query,
      channel: decode(channelMatch?.[1])
    }
  } catch {
    return null
  }
}

/** Найти на YouTube и включить в браузере (с автозапуском). */
export async function playMusic(query: string): Promise<ActionResult> {
  logger.action('media', `Поиск на YouTube: ${query}`)
  const result = await searchYouTube(query)
  if (!result) {
    await shell.openExternal(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`)
    return { ok: true, message: `Открыла поиск на YouTube: ${query}` }
  }
  await shell.openExternal(`https://www.youtube.com/watch?v=${result.videoId}`)
  const by = result.channel ? ` (${result.channel})` : ''
  logger.action('media', `Включаю: ${result.title}${by}`)
  return { ok: true, message: `Включаю: ${result.title}${by}`, data: result }
}

/** Включить видео/фильм: ищем на YouTube (клип, трейлер, полный фильм) и открываем. */
export async function playVideo(query: string): Promise<ActionResult> {
  return playMusic(query)
}

// ─── Веб-поиск ──────────────────────────────────────────────────────────────

export interface WebResult {
  title: string
  url: string
  snippet: string
}

function decodeHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .trim()
}

function unwrapDdgUrl(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m) { try { return decodeURIComponent(m[1]) } catch { /* ignore */ } }
  return href.startsWith('//') ? 'https:' + href : href
}

/** Настоящий веб-поиск (DuckDuckGo, без ключа). Возвращает результаты для Kira. */
export async function searchWeb(query: string, limit = 6): Promise<ActionResult> {
  logger.action('web', `Поиск в интернете: ${query}`)
  try {
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
      },
      body: `q=${encodeURIComponent(query)}&kl=ru-ru`
    })
    const html = await res.text()
    const results: WebResult[] = []

    const linkRe = /result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    const snipRe = /result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    const snippets: string[] = []
    let sm: RegExpExecArray | null
    while ((sm = snipRe.exec(html)) !== null) snippets.push(decodeHtml(sm[1]))

    let lm: RegExpExecArray | null
    let i = 0
    while ((lm = linkRe.exec(html)) !== null && results.length < limit) {
      results.push({
        url: unwrapDdgUrl(lm[1]),
        title: decodeHtml(lm[2]),
        snippet: snippets[i] ?? ''
      })
      i++
    }

    if (!results.length) {
      return { ok: false, message: `По запросу «${query}» ничего не нашлось`, data: '' }
    }
    const formatted = results
      .map((r, idx) => `${idx + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`)
      .join('\n\n')
    return { ok: true, message: `Нашла ${results.length} результатов по «${query}»`, data: formatted }
  } catch (err) {
    return { ok: false, message: `Ошибка поиска: ${(err as Error).message}`, data: '' }
  }
}

/** Прочитать веб-страницу: извлечь читаемый текст из HTML для анализа Kira. */
export async function readWebPage(url: string): Promise<ActionResult> {
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
  logger.action('web', `Читаю страницу: ${normalized}`)
  try {
    const res = await fetch(normalized, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
      }
    })
    if (!res.ok) return { ok: false, message: `Страница недоступна (${res.status})` }
    const html = await res.text()

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleMatch ? decodeHtml(titleMatch[1]) : ''

    // вырезаем скрипты/стили/навигацию, оставляем текст
    let body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
    body = decodeHtml(body).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim()

    const text = body.slice(0, 12_000)
    if (text.length < 40) return { ok: false, message: 'Не удалось извлечь текст со страницы' }
    return {
      ok: true,
      message: `Прочитала: ${title || normalized}`,
      data: `Заголовок: ${title}\nURL: ${normalized}\n\n${text}`
    }
  } catch (err) {
    return { ok: false, message: `Ошибка чтения: ${(err as Error).message}` }
  }
}

const WMO: Record<number, string> = {
  0: 'ясно', 1: 'малооблачно', 2: 'облачно', 3: 'пасмурно',
  45: 'туман', 48: 'изморозь', 51: 'морось', 53: 'морось', 55: 'морось',
  61: 'небольшой дождь', 63: 'дождь', 65: 'сильный дождь',
  71: 'небольшой снег', 73: 'снег', 75: 'сильный снег', 77: 'снежная крупа',
  80: 'ливень', 81: 'ливень', 82: 'сильный ливень', 85: 'снегопад', 86: 'снегопад',
  95: 'гроза', 96: 'гроза с градом', 99: 'сильная гроза'
}

/** Погода по геолокации (по IP). Бесплатно, без ключей. */
export async function getWeather(): Promise<{ ok: boolean; city?: string; temp?: number; desc?: string; wind?: number }> {
  try {
    const geo = await (await fetch('http://ip-api.com/json/?fields=city,lat,lon', { signal: AbortSignal.timeout(10_000) })).json() as { city?: string; lat?: number; lon?: number }
    if (geo.lat == null) return { ok: false }
    const w = await (await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code,wind_speed_10m`,
      { signal: AbortSignal.timeout(10_000) }
    )).json() as { current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number } }
    const c = w.current
    if (!c) return { ok: false }
    return {
      ok: true,
      city: geo.city,
      temp: Math.round(c.temperature_2m ?? 0),
      desc: WMO[c.weather_code ?? 0] ?? '',
      wind: Math.round(c.wind_speed_10m ?? 0)
    }
  } catch {
    return { ok: false }
  }
}

/** Открыть поисковую выдачу в браузере (Google / YouTube). */
export async function openSearch(query: string, engine: 'google' | 'youtube' = 'google'): Promise<ActionResult> {
  const url =
    engine === 'youtube'
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      : `https://www.google.com/search?q=${encodeURIComponent(query)}`
  await shell.openExternal(url)
  return { ok: true, message: `Открываю ${engine === 'youtube' ? 'YouTube' : 'Google'}: ${query}` }
}
