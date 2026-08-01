/**
 * Обновления Kira.
 *
 * Kira живёт в трее неделями, и без этого модуля человек навсегда остаётся на
 * той версии, которую однажды скачал: исправленные ошибки до него не доходят.
 *
 * ТРИ РЕШЕНИЯ, которые стоит понимать, прежде чем что-то тут менять.
 *
 * 1. НИЧЕГО НЕ КАЧАЕМ БЕЗ СПРОСА. Установщик — сотни мегабайт, и на мобильном
 *    интернете самовольная загрузка это чужие деньги. Поэтому проверка сама,
 *    а загрузка — только по нажатию. `autoDownload` выключен намеренно.
 *
 * 2. ТИШИНА ПРИ СБОЯХ. Нет сети, GitHub недоступен, лимит запросов — всё это
 *    обычные будни, а не событие для пользователя. Такое уходит в журнал и
 *    больше никуда: ассистент, ноющий про обновления, раздражает сильнее, чем
 *    старая версия.
 *
 * 3. ПОДПИСИ НЕТ — И ПРОВЕРКА ПОДПИСИ ВЫКЛЮЧЕНА ОСОЗНАННО. Сборка не
 *    подписывается сертификатом, поэтому в настройках сборки НЕ должно быть
 *    `win.publisherName`: при нём electron-updater требует действительную
 *    подпись у скачанного файла и отвергает обновление целиком. Проверено по
 *    исходникам NsisUpdater — без `publisherName` проверка пропускается.
 *    Целостность при этом обеспечивают HTTPS до GitHub и контрольная сумма
 *    SHA-512 из latest.yml, которую electron-updater сверяет сам.
 */
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { logger } from './logger'
import type { UpdateState } from '../../shared/types'


let state: UpdateState = { current: app.getVersion(), stage: 'idle' }
let getWin: (() => BrowserWindow | null) | null = null
let timer: NodeJS.Timeout | null = null

/** Через сколько после запуска заглянуть за обновлением. */
const FIRST_CHECK_MS = 40_000
/** Как часто проверять потом. */
const EVERY_MS = 6 * 60 * 60_000

function publish(next: Partial<UpdateState>): void {
  state = { ...state, ...next }
  const win = getWin?.()
  if (win && !win.isDestroyed()) win.webContents.send('update:state', state)
}

export function updateState(): UpdateState {
  return state
}

/**
 * Технические сбои — человеческим языком.
 *
 * «ENOENT: no such file or directory, open …app-update.yml» человеку не
 * объясняет ничего; в коммерческом продукте такое читается как поломка. Тексты
 * подобраны так, чтобы из них было понятно, что делать дальше — или что делать
 * ничего не нужно.
 */
function humanError(raw: string): string {
  const e = raw.toLowerCase()
  if (e.includes('app-update.yml') || e.includes('enoent')) {
    return 'Эта копия Kira собрана без обновлений — скачай установщик с сайта.'
  }
  if (e.includes('enotfound') || e.includes('econn') || e.includes('etimedout') || e.includes('network') || e.includes('getaddrinfo')) {
    return 'Нет связи с сервером обновлений. Проверь интернет.'
  }
  if (e.includes('403') || e.includes('rate limit')) {
    return 'Сервер обновлений временно ограничил запросы. Загляни попозже.'
  }
  if (e.includes('404')) {
    return 'Обновление не найдено на сервере. Возможно, выпуск ещё готовится.'
  }
  if (e.includes('enospc') || e.includes('no space')) {
    return 'Не хватает места на диске для загрузки обновления.'
  }
  if (e.includes('sha512') || e.includes('checksum')) {
    return 'Файл обновления повреждён при загрузке. Попробуй ещё раз.'
  }
  return `Не удалось проверить обновления: ${raw.slice(0, 120)}`
}

/**
 * Проверить наличие обновления.
 * `silent` — фоновая проверка: о неудаче человеку не сообщаем.
 */
export async function checkForUpdate(silent = true): Promise<UpdateState> {
  if (!app.isPackaged) {
    // в разработке проверять нечего: версия берётся из package.json, и
    // обновление немедленно «нашлось бы» на каждом запуске
    publish({ stage: 'idle', message: 'Обновления работают только в установленной Kira' })
    return state
  }
  if (state.stage === 'downloading') return state
  publish({ stage: 'checking', message: '' })
  try {
    const found = await autoUpdater.checkForUpdates()
    const version = found?.updateInfo?.version
    /*
     * Спрашиваем именно `isUpdateAvailable`, а не «версия отличается».
     *
     * Отличается — не значит новее. На живом запуске 1.3.1 это сразу и
     * вылезло: в журнал ушло «Доступна версия 1.3.0», то есть Kira предложила
     * бы откатиться назад. Сравнение версий по правилам semver уже сделано
     * внутри electron-updater — своё писать незачем и не нужно.
     */
    if (found?.isUpdateAvailable && version) {
      logger.info('update', `Доступна версия ${version}`)
      publish({ stage: 'available', version, message: `Вышла версия ${version}` })
    } else {
      publish({ stage: 'latest', version: undefined, message: 'Установлена последняя версия' })
    }
  } catch (e) {
    const raw = (e as Error).message
    logger.warn('update', `Проверка не удалась: ${raw.slice(0, 200)}`)
    // фоновая неудача не должна выглядеть как поломка: возвращаемся в покой
    publish(silent ? { stage: 'idle', message: '' } : { stage: 'error', message: humanError(raw) })
  }
  return state
}

/** Скачать найденное обновление. Только по явной команде человека. */
export async function downloadUpdate(): Promise<UpdateState> {
  if (!app.isPackaged || state.stage === 'downloading') return state
  publish({ stage: 'downloading', percent: 0, message: 'Загружаю обновление…' })
  try {
    await autoUpdater.downloadUpdate()
  } catch (e) {
    const raw = (e as Error).message
    logger.warn('update', `Загрузка не удалась: ${raw.slice(0, 200)}`)
    publish({ stage: 'error', message: humanError(raw) })
  }
  return state
}

/**
 * Перезапуститься и поставить обновление.
 *
 * `isSilent = false`: установщик показывает окно с ходом установки. Без этого
 * Kira просто исчезает на полминуты, и человек не понимает, что произошло.
 */
export function installUpdate(): void {
  if (state.stage !== 'ready') return
  logger.info('update', `Устанавливаю ${state.version}`)
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}

export function initUpdater(getWindow: () => BrowserWindow | null): void {
  getWin = getWindow
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false          // решение о загрузке за человеком
  autoUpdater.autoInstallOnAppQuit = true   // скачал — поставится при выходе
  autoUpdater.logger = null                 // свой журнал, чужой не нужен

  autoUpdater.on('download-progress', (p: { percent: number }) => {
    publish({ stage: 'downloading', percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    logger.info('update', `Версия ${info.version} загружена`)
    publish({
      stage: 'ready', version: info.version, percent: 100,
      message: `Версия ${info.version} готова — установится при перезапуске`
    })
  })
  autoUpdater.on('error', (e: Error) => {
    logger.warn('update', `Сбой обновления: ${e.message.slice(0, 160)}`)
    if (state.stage === 'downloading') publish({ stage: 'error', message: 'Загрузка прервалась' })
  })

  // первая проверка не сразу: на старте и без неё есть чем заняться
  timer = setTimeout(function tick(): void {
    void checkForUpdate(true)
    timer = setTimeout(tick, EVERY_MS)
    timer.unref?.()
  }, FIRST_CHECK_MS)
  timer.unref?.()
}

export function shutdownUpdater(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
