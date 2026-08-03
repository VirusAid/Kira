/**
 * Сбор лицензий стороннего кода в THIRD-PARTY-NOTICES.md.
 *
 * Kira распространяется платно, а внутри неё чужой открытый код: библиотеки
 * npm, пакеты Python, движок Electron с Chromium и обученные модели. Почти все
 * их лицензии (MIT, Apache 2.0, BSD, ISC) разрешают что угодно, включая
 * продажу, но ТРЕБУЮТ приложить текст лицензии и указание авторства. Файл с
 * уведомлениями — не формальность, а условие, на котором этим кодом вообще
 * можно пользоваться.
 *
 * Список собирается из того, что РЕАЛЬНО лежит в поставке, а не из
 * package.json: зависимости зависимостей туда не попадают, а требования их
 * лицензий действуют ровно так же.
 *
 * Запуск: node scripts/licenses.mjs
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => { try { return readFileSync(p, 'utf-8') } catch { return '' } }
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null } }

/** Лицензия из package.json — поле бывает и строкой, и объектом, и массивом. */
function licenseOf(pkg, dir) {
  const l = pkg?.license ?? pkg?.licenses
  let name = ''
  if (typeof l === 'string') name = l
  else if (Array.isArray(l)) name = l.map((x) => x.type ?? x).join(' OR ')
  else if (l) name = l.type ?? ''

  /*
   * «SEE LICENSE IN LICENSE» — это отсылка, а не название. У части пакетов
   * (так ведут себя официальные MCP-серверы) сам файл в поставку при этом не
   * попал, и в уведомлениях осталась бы ссылка в никуда. Ищем название там,
   * где его действительно написали: в файле лицензии, иначе в README.
   */
  if (name && !/^see licen[cs]e/i.test(name)) return name
  if (dir) {
    const named = (name.match(/in\s+(\S+)/i) ?? [])[1] ?? 'LICENSE'
    const fromFile = firstLicenseLine(read(join(dir, named)))
    if (fromFile) return fromFile
    const stated = read(join(dir, 'README.md'))
      .match(/licensed under the ([A-Za-z0-9.\- ]{2,40}?) [Ll]icense/)
    if (stated) return stated[1].trim()
  }
  return name
}

/** Название лицензии по первой содержательной строке её текста. */
function firstLicenseLine(text) {
  const first = text.split('\n').map((x) => x.trim()).filter(Boolean)[0] ?? ''
  return /licen[cs]e/i.test(first) && first.length < 60
    ? first.replace(/\s*licen[cs]e\s*$/i, '')
    : ''
}

/** Все пакеты npm внутри папки node_modules, включая scoped (@scope/name). */
function scanNodeModules(dir) {
  const found = new Map()
  if (!existsSync(dir)) return found
  const walk = (base) => {
    let entries = []
    try { entries = readdirSync(base, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = join(base, e.name)
      if (e.name.startsWith('@')) { walk(full); continue }
      const pkg = readJson(join(full, 'package.json'))
      if (pkg?.name) {
        const key = `${pkg.name}@${pkg.version ?? '?'}`
        if (!found.has(key)) {
          found.set(key, {
            name: pkg.name, version: pkg.version ?? '', license: licenseOf(pkg, full),
            homepage: pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ?? ''
          })
        }
      }
      // вложенные зависимости зависимостей
      const nested = join(full, 'node_modules')
      if (existsSync(nested)) walk(nested)
    }
  }
  walk(dir)
  return found
}

/** Пакеты Python: метаданные лежат в *.dist-info/METADATA. */
function scanPython(dir) {
  const found = new Map()
  if (!existsSync(dir)) return found
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return found }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.endsWith('.dist-info')) continue
    const meta = read(join(dir, e.name, 'METADATA'))
    if (!meta) continue
    const field = (n) => (meta.match(new RegExp('^' + n + ': (.+)$', 'm')) ?? [])[1] ?? ''
    // у части пакетов лицензия только в классификаторах
    const classifier = (meta.match(/^Classifier: License :: (?:OSI Approved :: )?(.+)$/m) ?? [])[1] ?? ''
    const name = field('Name')
    if (!name) continue
    found.set(name, {
      name, version: field('Version'),
      // «UNKNOWN» в поле License означает, что автор его не заполнил, — тогда
      // смотрим классификаторы, где лицензия указана по-настоящему
      // …а если и там пусто — в описании пакета: часть авторов пишет лицензию
      // только текстом в README, который целиком лежит в этом же файле
      license: pickLicense(field('License-Expression'), field('License'), classifier,
        (meta.match(/licen[cs]ed under the ([A-Za-z0-9.\- ]{2,40}?) [Ll]icen[cs]e/) ?? [])[1]),
      homepage: field('Home-page') || field('Project-URL').replace(/^[^,]*,\s*/, '')
    })
  }
  return found
}

/** Первое осмысленное название лицензии из нескольких источников. */
function pickLicense(...candidates) {
  for (const c of candidates) {
    const v = String(c ?? '').split('\n')[0].trim()
    if (!v || /^unknown$/i.test(v)) continue
    /*
     * Часть пакетов кладёт в это поле ВЕСЬ текст лицензии, и в таблицу он не
     * годится. Но составное выражение вроде «Apache-2.0 AND BSD-3-Clause AND
     * MIT» (так делает torch) — законный ответ, просто длинный. Отличаем по
     * признакам прозы, а не по длине: у сплошного текста есть предложения и
     * копирайт.
     */
    if (/\. |Copyright|©|\bTHE SOFTWARE\b/i.test(v) || v.length > 200) continue
    // классификаторы пишут «Apache Software License» — приводим к привычному виду
    return v.replace(/^Apache Software License$/, 'Apache-2.0')
      .replace(/^MIT License$/, 'MIT')
      .replace(/^BSD License$/, 'BSD')
  }
  return ''
}

const table = (rows) => {
  if (!rows.length) return '_(ничего не найдено)_\n'
  const line = (r) => `| ${r.name} | ${r.version} | ${r.license || '—'} |`
  return '| Компонент | Версия | Лицензия |\n|---|---|---|\n' +
    rows.sort((a, b) => a.name.localeCompare(b.name)).map(line).join('\n') + '\n'
}

// ─── Сбор ────────────────────────────────────────────────────────────────────
const appDeps = scanNodeModules(join(root, 'node_modules'))
const prod = new Set(Object.keys(readJson(join(root, 'package.json'))?.dependencies ?? {}))
// в сборку попадает только то, что тянут рабочие зависимости; девелоперские
// (сборщики, тесты) не распространяются и в уведомлениях не нужны
const shipped = [...appDeps.values()].filter((p) => prod.has(p.name) || isTransitive(p.name))
function isTransitive(name) {
  for (const dep of prod) {
    const pkg = readJson(join(root, 'node_modules', dep, 'package.json'))
    if (pkg?.dependencies && name in pkg.dependencies) return true
  }
  return false
}
const mcpDeps = [...scanNodeModules(join(root, 'resources', 'mcp', 'node_modules')).values()]
const pyDeps = [...scanPython(join(root, 'resources', 'pyenv')).values()]

const electronVersion = readJson(join(root, 'node_modules', 'electron', 'package.json'))?.version ?? ''

const out = `# Стороннее программное обеспечение в составе Kira

Kira включает открытый код и обученные модели других авторов. Ниже перечислено
то, что входит в поставку, с указанием версий и лицензий. Полные тексты
лицензий доступны по ссылкам на страницы проектов.

Сам код Kira распространяется на условиях [собственной лицензии](LICENSE) и
открытым не является. Перечисленное ниже к нему не относится.

Файл собирается автоматически: \`node scripts/licenses.mjs\`.
Дата сборки: ${new Date().toISOString().slice(0, 10)}.

---

## Платформа

| Компонент | Версия | Лицензия |
|---|---|---|
| Electron | ${electronVersion} | MIT |
| Chromium (в составе Electron) | — | BSD-3-Clause |
| Node.js (в составе Electron) | — | MIT |

Electron: https://github.com/electron/electron
Chromium: https://chromium.googlesource.com/chromium/src/+/main/LICENSE

---

## Библиотеки JavaScript (в приложении)

${table(shipped)}
---

## Библиотеки JavaScript (встроенные расширения)

Поставляются в \`resources/mcp\` и запускаются как отдельные программы.

${table(mcpDeps)}
---

## Пакеты Python (голос, распознавание речи, смысловой поиск)

Поставляются в \`resources/pyenv\`.

${table(pyDeps)}
---

## Модели

| Модель | Назначение | Лицензия |
|---|---|---|
| vosk-model-small-ru-0.22 | распознавание речи офлайн | Apache-2.0 |
| Silero TTS v4_ru | синтез речи офлайн | CC BY-NC-SA (см. примечание) |

Vosk: https://alphacephei.com/vosk/models
Silero: https://github.com/snakers4/silero-models

**Примечание о Silero.** Модели Silero, кроме \`v5_cis_base\`, опубликованы под
лицензией с запретом коммерческого использования. Для платного распространения
требуется либо переход на \`v5_cis_base\` (MIT), либо отдельное соглашение с
авторами.
`

writeFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), out, 'utf-8')
console.log(`Готово: THIRD-PARTY-NOTICES.md`)
console.log(`  приложение: ${shipped.length}`)
console.log(`  расширения: ${mcpDeps.length}`)
console.log(`  Python:     ${pyDeps.length}`)
const unknown = [...shipped, ...mcpDeps, ...pyDeps].filter((p) => !p.license)
if (unknown.length) console.log(`  БЕЗ ЛИЦЕНЗИИ (проверить вручную): ${unknown.map((p) => p.name).join(', ')}`)
