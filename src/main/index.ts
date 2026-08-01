/** Kira — точка входа main-процесса. */
import { app, shell, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { registerIpc } from './modules/ipc'
import { initAutomations, shutdownAutomations } from './modules/automation'
import { initReminders, shutdownReminders } from './modules/reminders'
import { initClipboardHistory, shutdownClipboardHistory } from './modules/clipboardHistory'
import { initVision, shutdownVision } from './modules/vision'
import { registerHotkey } from './modules/window'
import { createTray, destroyTray, isQuitting, setQuitting } from './modules/tray'
import { createOverlay, destroyOverlay } from './modules/overlay'
import { initPulse, shutdownPulse } from './modules/pulse'
import { initUpdater, shutdownUpdater } from './modules/updater'
import { initDiscordMonitor, shutdownDiscordMonitor } from './modules/discord'
import { initTelegram, shutdownTelegram } from './modules/telegram'
import { initTelegramUser, shutdownTelegramUser } from './modules/telegramUser'
import { initKiraCore, coreFlushSync } from './core'
import { flushAllSync } from './modules/db'
import { flushAllCollectionsSync } from './modules/storage'
import { logger } from './modules/logger'
import { getSettings, secureSecretsAtRest } from './modules/settings'
import { extractAiFile, extractFileText } from './modules/shellIntegration'
import { isMcpServerMode, startMcpServer } from './modules/mcp/server'

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

  // внешние ссылки — в системный браузер, и только по безопасной схеме:
  // адрес приходит из ответа модели, а её кормят веб-страницы и чужие
  // расширения. `file:` или чей-то протокол система запустила бы послушно.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) void shell.openExternal(url)
    else logger.warn('kira', `Отклонено открытие окна: ${url.slice(0, 80)}`)
    return { action: 'deny' }
  })

  /*
   * Окно Kira не должно уходить на сторонний адрес.
   *
   * В окне живёт мост к управлению компьютером. Обычная ссылка в ответе — а
   * ответ Kira это разметка — увела бы туда весь интерфейс вместе с мостом, и
   * приложение бы просто исчезло, подменённое чужой страницей. Разрешаем
   * только собственные адреса; остальное уходит в системный браузер.
   */
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const own = process.env['ELECTRON_RENDERER_URL']
    if (url.startsWith('file://') || (own && url.startsWith(own))) return
    e.preventDefault()
    logger.warn('kira', `Заблокирован переход окна на ${url.slice(0, 80)}`)
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  // запрет на прикрепление отладчика и на webview с чужим содержимым
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault())

  /*
   * Рендерер умер — поднимаем заново.
   *
   * Kira живёт в трее сутками, и весь голос работает именно в окне. Без этого
   * после падения (например, когда полноэкранная игра душит скрытое окно)
   * оставался живой значок в трее, который ни на что не отвечает: ни голоса,
   * ни ответов, и человеку не за что зацепиться. Перезагрузка возвращает всё.
   */
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.error('kira', `Окно упало (${details.reason}) — поднимаю заново`)
    if (details.reason === 'clean-exit') return
    try { mainWindow?.webContents.reload() } catch { /* окно уже уничтожено */ }
  })
  mainWindow.webContents.on('unresponsive', () => {
    logger.warn('kira', 'Окно перестало отвечать')
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

/*
 * Режим MCP-сервера: Kira отдаёт свои возможности наружу по stdio, чтобы ею
 * могли пользоваться другие клиенты. Окна, трей, эмблема, зрение и
 * проактивность не нужны — только ядро и обмен сообщениями.
 *
 * Проверка идёт ДО единственного экземпляра: клиент может запустить сервер,
 * когда обычная Kira уже открыта, и тогда блокировка убила бы его на старте.
 */
if (isMcpServerMode(process.argv)) {
  app.whenReady().then(() => {
    startMcpServer()
  })
} else {

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

    // ключи и токены на диске закрываем ПОСЛЕ готовности: до неё системное
    // шифрование недоступно и миграция молча ничего бы не сделала
    secureSecretsAtRest()
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
    // офлайн-мозг: если выбран как основной — заранее поднимаем сервер Ollama и
    // сразу же узнаём, какая модель реально лежит на диске. Без этого первый
    // запрос уходил на тег из настроек, которого могло не быть, получал 404 —
    // и Kira «переключалась в облако», хотя разум на компьютере был готов.
    if (getSettings().preferLocal) {
      void import('./modules/ai/localLlm').then(async (m) => {
        m.sweepLeftovers()
        await m.ensureRunning()
        await m.cachedModels()
      }).catch(() => {})
    }
    // офлайн-распознавание речи: если голос включён и нет ключа Groq (Whisper),
    // распознавание пойдёт через Vosk — прогреваем сайдкар заранее, чтобы первая
    // команда сработала мгновенно (иначе первый раз ждём старт Python + модели)
    {
      const s0 = getSettings()
      if (s0.voiceEnabled && !s0.providers.groq.apiKey?.trim()) {
        void import('./modules/ai/voskStt').then((m) => m.voskStt.warmup()).catch(() => {})
      }
    }
    // прибираем чужой мусор прошлых запусков: недокачанный движок и снимки
    // экрана, оставшиеся от оборванного распознавания
    void import('./modules/system').then((m) => m.sweepTempSnapshots()).catch(() => {})
    void import('./modules/storage').then((m) => m.sweepTempFiles()).catch(() => {})
    initAutomations()
    initReminders()
    initClipboardHistory()
    void import('./modules/routines').then((m) => m.initRoutines()).catch(() => {})
    registerHotkey()
    initUpdater(() => mainWindow)
    initPulse(() => mainWindow)
    initVision(() => mainWindow)
    initDiscordMonitor(() => mainWindow)
    // расширения (MCP) — после ядра: их команды регистрируются в том же реестре
    void import('./modules/mcp/manager').then((m) => m.initMcp()).catch(() => {})
    initTelegram(() => mainWindow)
    void initTelegramUser(() => mainWindow)

    const s = getSettings()
    logger.info('kira', `Kira готова к работе. Думает ${s.preferLocal ? 'на этом компьютере' : 'через облако'}`)

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
  shutdownVision()
  shutdownPulse()
  shutdownUpdater()
  shutdownDiscordMonitor()
  shutdownTelegram()
  void shutdownTelegramUser()
  void import('./modules/mcp/manager').then((m) => m.shutdownMcp())
  // гасим ВСЕ python-сайдкары, иначе процессы осиротеют и повиснут в памяти
  void import('./modules/ai/voskStt').then((m) => m.voskStt.shutdown())
  void import('./modules/ai/silero').then((m) => m.silero.kill())
  void import('./modules/ai/semantic').then((m) => m.semantic.kill())
  void import('./modules/ai/speaker').then((m) => m.speaker.kill())
  void import('./modules/ai/wakeword').then((m) => m.wakeWord.stop())
  coreFlushSync()
  destroyTray()
  destroyOverlay()
  flushAllSync()
  // страховка: сбрасываем ВСЕ коллекции (reminders, snippets, routines и др.),
  // а не только перечисленные вручную — запись отложена на 400 мс, и созданное
  // прямо перед закрытием иначе терялось
  flushAllCollectionsSync()
})

} // конец обычного режима (не MCP-сервер)
