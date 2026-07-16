const path = require('path')
const os = require('os')
module.exports = {
  app: { getPath: (n) => path.join(os.tmpdir(), 'kira-core-test', n), isPackaged: false },
  shell: {
    openPath: async () => '',
    openExternal: async () => {},
    // в тестах «корзина» = реальное удаление внутри tmpdir
    trashItem: async (p) => { require('fs').rmSync(p, { recursive: true, force: true }) }
  },
  clipboard: { readText: () => '', writeText: () => {} },
  Notification: class { show() {} },
  BrowserWindow: class { static getAllWindows() { return [] } },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  desktopCapturer: { getSources: async () => [] },
  nativeImage: { createFromBuffer: () => ({}) }
}
