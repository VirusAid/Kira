/**
 * Подготовка встроенных расширений — кладёт их рядом с Kira ещё при сборке.
 *
 * Обычно MCP-серверы запускают через `npx`, а он при первом обращении лезет в
 * интернет и требует установленного Node.js. Для нашего пользователя это два
 * лишних условия там, где он ждёт «установил и работает»: на проверке первое
 * подключение занимало 10 секунд скачивания, а без Node.js не работало вовсе.
 *
 * Поэтому серверы кладутся в resources/mcp на этапе сборки, а запускаются
 * рантаймом самой Kira: внутри Electron уже есть Node, и отдельный бинарник не
 * нужен (см. modules/mcp/stdio.ts).
 *
 * Запускается автоматически перед сборкой установщика.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'resources', 'mcp')

/**
 * Что кладём в установщик.
 *
 * Только живые и полезные без настройки. GitHub-сервер сюда не попал
 * намеренно: в npm он помечен как более не поддерживаемый, а официальная
 * замена — отдельная программа, которую всё равно пришлось бы скачивать.
 */
const PACKAGES = [
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-memory'
]

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

console.log('Готовлю встроенные расширения…')
if (existsSync(target)) rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })

// отдельный package.json: иначе npm поднимется до корня проекта и потянет
// зависимости самой Kira
writeFileSync(join(target, 'package.json'), JSON.stringify({
  name: 'kira-bundled-extensions',
  private: true,
  version: '1.0.0',
  description: 'Расширения, поставляемые вместе с Kira'
}, null, 2) + '\n')

run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--silent', ...PACKAGES], target)

// package-lock не нужен внутри установщика — только лишний вес и путаница
rmSync(join(target, 'package-lock.json'), { force: true })

for (const pkg of PACKAGES) {
  const entry = join(target, 'node_modules', ...pkg.split('/'), 'dist', 'index.js')
  if (!existsSync(entry)) {
    console.error(`Не нашёл точку входа: ${entry}`)
    process.exit(1)
  }
}
console.log(`Готово: ${PACKAGES.length} расширения в resources/mcp`)
