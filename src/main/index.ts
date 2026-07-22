/** Kira — точка входа main-процесса. */
import { app, shell, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { registerIpc } from './modules/ipc'
import { initAutomations, shutdownAutomations } from './modules/automation'
import { initReminders, shutdownReminders } from './modules/reminders'
import { initClipboardHistory, shutdownClipboardHistory } from './modules/clipboardHistory'
import { initScreenWatch, shutdownScreenWatch } from './modules/screenWatch'
import { registerHotkey } from './modules/window'
import { createTray, destroyTray, isQuitting, setQuitting } from './modules/tray'
import { createOverlay, destroyOverlay } from './modules/overlay'
import { initPulse, shutdownPulse } from './modules/pulse'
import { initDiscordMonitor, shutdownDiscordMonitor } from './modules/discord'
import { initTelegram, shutdownTelegram } from './modules/telegram'
import { initTelegramUser, shutdownTelegramUser } from './modules/telegramUser'
import { initKiraCore, coreFlushSync } from './core'
import { flushAllSync } from './modules/db'
import { logger } from './modules/logger'
import { getSettings } from './modules/settings'
import { extractAiFile, extractFileText } from './modules/shellIntegration'

// Голосовой ассистент обязан слышать и отвечать, ДАЖE когда поверх — полноэкранная
// игра или другое окно полностью перекрывает Kira. Chromium по умолчанию считает
// полностью перекрытое окно «скрытым» (native window occlusion) и тормозит его
// рендерер: замолкает микрофонный AudioContext (Vosk перестаёт слышать «Кира»),
// не обрабатывается стрим ответа, не играет TTS — причём это происходит ДАЖE при
// backgroundThrottling:false (тот флаг покрывает только сворачивание в трей, но не
// перекрытие). Отключаем детект перекрытия и фоновые троттлы таймеров/рендерера,
// чтобы весь голосовой конвейер продолжал работать поверх игры.
// ВАЖНО: переключатели командной строки должны быть выставлены ДО app.whenReady.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

let mainWindow: BrowserWindow | null = null
let pendingAiFile: string | null = extractAiFile(process.argv)

/** Путь к фирменной иконке (эмблема Kira) для окон и трея. */
function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../resources/icon.ico')
}

/** Открыть меню AI Actions для файла из контекстного меню Проводника. */
async function openAiFile(path: string): Promise<void> {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  const text = await extractFileText(path)
  mainWindow.webContents.send('ai-actions:open',
    text || `Файл: ${path}\n(не удалось прочитать содержимое)`)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#0a0a12',
    title: 'Kira',
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // разрешаем воспроизведение синтезированной речи без жеста пользователя
      autoplayPolicy: 'no-user-gesture-required',
      // НЕ замораживать таймеры/аудио, когда окно скрыто в трей — иначе голос
      // перестаёт работать в фоне
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // закрытие окна = свернуть в трей (Kira продолжает работать в фоне)
  mainWindow.on('close', (e) => {
    if (!isQuitting()) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // внешние ссылки — в системный браузер
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // если Kira запущена из контекстного меню файла — открыть AI Actions
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingAiFile) { void openAiFile(pendingAiFile); pendingAiFile = null }
  })
}

// Защитная сетка: единичный сбой модуля (сеть, сайдкар, интеграция) не должен
// ронять всё приложение — фиксируем в журнал и продолжаем работать.
process.on('uncaughtException', (err) => {
  try { logger.error('kira', `Неперехваченная ошибка: ${err.message}`) } catch { /* журнал недоступен */ }
})
process.on('unhandledRejection', (reason) => {
  try { logger.error('kira', `Необработанный промис: ${String((reason as Error)?.message ?? reason).slice(0, 200)}`) } catch { /* ignore */ }
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    const filePath = extractAiFile(argv)
    if (filePath) void openAiFile(filePath)
  })

  app.whenReady().then(() => {
    // единый AppUserModelID — Windows группирует все процессы Kira под одной
    // записью «Kira» с нашей эмблемой (а не набором «Electron»), и это же
    // управляет идентичностью уведомлений
    app.setAppUserModelId('app.kira.assistant')

    // разрешаем доступ к микрофону для голосового режима
    const { session } = require('electron') as typeof import('electron')
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media' || permission === 'clipboard-read')
    })

    initKiraCore()
    registerIpc(() => mainWindow)
    createWindow()
    createTray(() => mainWindow)
    createOverlay(
      () => mainWindow?.webContents.send('tray:toggle-voice'),
      () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } }
    )
    void import('./modules/ai/wakeword').then((m) => m.wakeWord.setWindowGetter(() => mainWindow))
    void import('./modules/ai/worker').then((m) => m.workers.setWindowGetter(() => mainWindow))
    // офлайн-мозг: если выбран как основной — заранее поднимаем сервер Ollama
    if (getSettings().preferLocal) {
      void import('./modules/ai/localLlm').then((m) => m.ensureRunning()).catch(() => {})
    }
    initAutomations()
    initReminders()
    initClipboardHistory()
    void import('./modules/routines').then((m) => m.initRoutines()).catch(() => {})
    registerHotkey()
    initPulse(() => mainWindow)
    initScreenWatch(() => mainWindow)
    initDiscordMonitor(() => mainWindow)
    initTelegram(() => mainWindow)
    void initTelegramUser(() => mainWindow)

    const s = getSettings()
    logger.info('kira', `Kira запущена. Провайдер: ${s.provider}, модель: ${s.providers[s.provider].model}`)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  // не выходим: Kira живёт в трее. Полный выход — через меню трея.
  if (process.platform !== 'win32') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  setQuitting(true)
  shutdownAutomations()
  shutdownReminders()
  shutdownClipboardHistory()
  shutdownScreenWatch()
  shutdownPulse()
  shutdownDiscordMonitor()
  shutdownTelegram()
  void shutdownTelegramUser()
  // гасим ВСЕ python-сайдкары, иначе процессы осиротеют и повиснут в памяти
  void import('./modules/ai/voskStt').then((m) => m.voskStt.shutdown())
  void import('./modules/ai/silero').then((m) => m.silero.kill())
  void import('./modules/ai/semantic').then((m) => m.semantic.kill())
  void import('./modules/ai/speaker').then((m) => m.speaker.kill())
  void import('./modules/ai/emotion').then((m) => m.emotion.kill())
  void import('./modules/ai/wakeword').then((m) => m.wakeWord.stop())
  coreFlushSync()
  destroyTray()
  destroyOverlay()
  flushAllSync()
})
