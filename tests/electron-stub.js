/**
 * Заглушка Electron для тестов.
 *
 * ОСТОРОЖНО, читай прежде чем менять. Тесты гоняются на живой машине
 * разработчика, а Kira умеет удалять и перемещать файлы. Поэтому всё
 * разрушительное здесь ОГРАНИЧЕНО временной папкой физически, а не по
 * договорённости «не передавать плохие пути».
 *
 * Это не перестраховка. 2026-08-01 `trashItem` был обычным
 * `fs.rmSync(recursive, force)`, тест на «Kira отказывается удалять
 * катастрофические пути» получил настоящий `os.homedir()` — и снёс у
 * пользователя `~/.claude` целиком и часть `AppData\Local`, мимо корзины и без
 * возможности восстановления. Ограничитель ниже сделал бы из той катастрофы
 * упавший тест.
 */
const path = require('path')
const os = require('os')
const fs = require('fs')

/** Единственное место, где тестам позволено что-либо разрушать. */
const SANDBOX = path.join(os.tmpdir(), 'kira-core-test')

/**
 * Разрешено ли трогать этот путь. Сравниваем по НОРМАЛИЗОВАННОМУ пути, чтобы
 * «..» не выводили за песочницу.
 */
function insideSandbox(target) {
  const p = path.resolve(String(target ?? ''))
  const box = path.resolve(SANDBOX)
  const tmp = path.resolve(os.tmpdir())
  // временная папка целиком: тесты кладут свои данные и рядом с песочницей
  const under = (root) => p === root || p.startsWith(root + path.sep)
  return under(box) || under(tmp)
}

function refuseOutside(action, target) {
  if (insideSandbox(target)) return
  throw new Error(
    `ЗАГЛУШКА ТЕСТОВ ОСТАНОВИЛА «${action}» вне временной папки: ${target}\n` +
    'Тесты не трогают настоящие файлы. Если проверяешь отказ опасной операции — ' +
    'проверяй ВОЗВРАЩАЕМЫЙ результат на выдуманном пути, а не реальное удаление.'
  )
}

module.exports = {
  app: {
    getPath: (n) => path.join(SANDBOX, n),
    getAppPath: () => SANDBOX,
    isPackaged: false,
    // настройки при сохранении трогают автозапуск — в тестах это пустышка
    setLoginItemSettings: () => {},
    // версия нужна MCP: Kira представляется ею серверам
    getVersion: () => '0.0.0-test',
    getName: () => 'Kira',
    /*
     * Переключатели Chromium выставляются на верхнем уровне модуля — тем самым
     * кодом, что не даёт душить рендерер под полноэкранной игрой. Без этой
     * заглушки собранный main падает при первой же загрузке, и смоук-тест
     * ловит несуществующую поломку.
     */
    commandLine: { appendSwitch: () => {}, appendArgument: () => {} },
    disableHardwareAcceleration: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}), // до готовности в тестах не доходим
    on: () => {},
    once: () => {},
    quit: () => {},
    exit: () => {},
    setAppUserModelId: () => {}
  },
  shell: {
    openPath: async () => '',
    openExternal: async () => {},
    showItemInFolder: () => {},
    // «корзина» в тестах = реальное удаление, поэтому строго внутри песочницы
    trashItem: async (p) => {
      refuseOutside('удаление', p)
      fs.rmSync(p, { recursive: true, force: true })
    }
  },
  safeStorage: {
    // без настоящего DPAPI: тесты не должны зависеть от учётной записи
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(String(s), 'utf-8'),
    decryptString: (b) => Buffer.from(b).toString('utf-8')
  },
  // настоящий буфер в памяти: иначе отмену записи в буфер нечем проверить
  clipboard: (() => {
    let text = ''
    return { readText: () => text, writeText: (v) => { text = String(v ?? '') } }
  })(),
  Notification: class { show() {} },
  BrowserWindow: class { static getAllWindows() { return [] } },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  desktopCapturer: { getSources: async () => [] },
  nativeImage: { createFromBuffer: () => ({}) }
}
