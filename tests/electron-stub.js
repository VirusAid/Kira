const path = require('path')
const os = require('os')
module.exports = {
  app: {
    getPath: (n) => path.join(os.tmpdir(), 'kira-core-test', n),
    isPackaged: false,
    // настройки при сохранении трогают автозапуск — в тестах это пустышка
    setLoginItemSettings: () => {},
    // версия нужна MCP: Kira представляется ею серверам
    getVersion: () => '0.0.0-test'
  },
  shell: {
    openPath: async () => '',
    openExternal: async () => {},
    // в тестах «корзина» = реальное удаление внутри tmpdir
    trashItem: async (p) => { require('fs').rmSync(p, { recursive: true, force: true }) }
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
