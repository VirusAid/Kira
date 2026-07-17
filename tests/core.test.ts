/** Полный тестовый прогон Kira Core (временный файл, удаляется после). */
import { commandEngine } from '../src/main/core/engine'
import { registry } from '../src/main/core/registry'
import { actions } from '../src/main/core/actions'
import { actionHistory } from '../src/main/core/history'
import { bus } from '../src/main/core/bus'
import { parseIntent } from '../src/main/core/intent'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

registry.registerAll(actions)
const specs = registry.intentSpecs()
let pass = 0
let fail = 0
const t = (name: string, ok: boolean, extra = ''): void => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

// === УРОВЕНЬ 1: Intent Parser — базовые ===
const cases: Array<[string, string]> = [
  ['Кира, открой браузер', 'open_browser'], ['открой хром', 'open_browser'],
  ['открой youtube.com', 'open_url'], ['зайди на github.com', 'open_url'],
  ['включи музыку', 'play_music'], ['поставь трек Believer', 'play_music'],
  ['включи фильм Интерстеллар', 'play_video'], ['пауза', 'media_pause'],
  ['выключи музыку', 'media_pause'], ['поставь музыку на паузу', 'media_pause'],
  ['следующий трек', 'media_next'], ['переключи трек', 'media_next'],
  ['предыдущий трек', 'media_prev'], ['громче', 'volume_up'],
  ['сделай потише', 'volume_down'], ['громкость 50', 'set_volume'],
  ['выключи звук', 'mute'], ['включи звук', 'unmute'],
  ['сделай скриншот', 'screenshot'], ['сверни всё', 'minimize_all'],
  ['какая погода', 'weather'], ['открой параметры', 'open_settings'],
  ['открой диспетчер задач', 'task_manager'], ['заблокируй компьютер', 'lock_screen'],
  ['спящий режим', 'sleep_pc'], ['выключи компьютер', 'shutdown_pc'],
  ['перезагрузи', 'restart_pc'], ['открой загрузки', 'open_folder'],
  ['создай папку Отчёты', 'create_folder'], ['создай папку Фото в загрузках', 'create_folder'],
  ['открой vscode', 'open_vscode'], ['запусти docker', 'run_docker'],
  ['открой discord', 'launch_app'], ['запусти steam', 'launch_app'],
  ['закрой telegram', 'close_app'],
  ['какие процессы запущены', 'list_processes'], ['запущен ли discord', 'list_processes'],
  ['покажи список процессов', 'list_processes'],
  ['яркость 70', 'set_brightness'], ['звук на максимум', 'set_volume'],
  ['что в буфере обмена', 'clipboard_read'], ['открой файл C:\\doc.pdf', 'open_file'],
  ['отмени', 'undo_last'], ['отмени последнее действие', 'undo_last'], ['верни как было', 'undo_last'],
  ['открой калькулятор', 'open_calculator'], ['открой блокнот', 'open_notepad'],
  ['открой проводник', 'open_explorer'], ['открой терминал', 'open_terminal'],
  ['открой paint', 'open_paint'], ['сколько времени', 'current_time'],
  ['какое сегодня число', 'current_date'], ['загрузка системы', 'system_info'],
  ['сколько места на диске', 'disk_space'], ['сколько заряда', 'battery'],
  ['мой ip адрес', 'ip_address'], ['закрой окно', 'close_window'],
  ['сверни окно', 'minimize_window'], ['разверни окно', 'maximize_window'],
  ['скопируй', 'copy_selection'], ['вставь', 'paste_clipboard'],
  ['выдели всё', 'select_all'], ['вырежи', 'cut_selection'], ['сохрани файл', 'save_file'],
  ['загугли рецепт борща', 'web_search'], ['найди на ютубе обзор', 'youtube_search'],
  ['открой корзину', 'open_recycle_bin'], ['очисти корзину', 'empty_recycle_bin'],
  ['гибернация', 'hibernate'],
  ['напиши письмо маме', 'ai'], ['объясни эту ошибку', 'ai'],
  ['открой браузер и найди рецепт борща', 'ai'], ['что ты умеешь', 'ai'],
  ['почему небо голубое', 'ai'], ['исправь ошибки в проекте', 'agent'],
  ['наведи порядок в загрузках', 'agent']
]
let l1 = 0
for (const [phrase, expected] of cases) {
  const i = parseIntent(phrase, specs)
  const got = i.kind === 'local' ? i.actionId : i.kind
  if (got === expected) l1++
  else console.log(`FAIL  intent "${phrase}" -> ${got} (ожидалось ${expected})`)
}
t(`Intent базовые: ${l1}/${cases.length}`, l1 === cases.length)

// === УРОВЕНЬ 1b: граничные случаи ===
t('пустая строка -> ai', parseIntent('', specs).kind === 'ai')
t('очень длинный текст -> ai', parseIntent('открой браузер '.repeat(20), specs).kind === 'ai')
{
  const i = parseIntent('КИРА!!! Открой браузер!!!', specs)
  t('КИРА + регистр + пунктуация', i.kind === 'local' && i.actionId === 'open_browser')
}
{
  const i = parseIntent('открой браузер пожалуйста', specs)
  t('вежливость вырезается', i.kind === 'local' && i.actionId === 'open_browser')
}
{
  const i = parseIntent('создай папку Отчёты', specs)
  t('регистр аргумента: Отчёты', i.kind === 'local' && i.args.name === 'Отчёты')
}
{
  const i = parseIntent('поставь трек Imagine Dragons', specs)
  t('латиница в аргументе', i.kind === 'local' && i.args.query === 'Imagine Dragons')
}
t('громкость 150 матчится (валидация — движок)', parseIntent('громкость 150', specs).kind === 'local')
t('многошаговость: звук и свет -> ai', parseIntent('выключи звук и свет', specs).kind === 'ai')
t('многошаговость: скриншот, потом -> ai', parseIntent('скриншот, потом отправь его', specs).kind === 'ai')
t('вопрос про браузер -> ai', parseIntent('как открыть браузер в линуксе', specs).kind === 'ai')

// === УРОВЕНЬ 1c: разбор времени напоминаний ===
import { parseWhen } from '../src/main/modules/reminders'
{
  const now = Date.now()
  const hour = parseWhen('через час')
  t('«через час» парсится', hour !== null && Math.abs((hour - now) - 3_600_000) < 5000)
  const half = parseWhen('через полчаса')
  t('«через полчаса» парсится', half !== null && Math.abs((half - now) - 1_800_000) < 5000)
  const five = parseWhen('через 5 минут')
  t('«через 5 минут» парсится', five !== null && Math.abs((five - now) - 300_000) < 5000)
  const bare = parseWhen('завтра в 9')
  const d9 = new Date(); d9.setDate(d9.getDate() + 1); d9.setHours(9, 0, 0, 0)
  t('«завтра в 9» -> завтра 9:00', bare === d9.getTime())
  const evening = parseWhen('завтра в 7 вечера')
  const d19 = new Date(); d19.setDate(d19.getDate() + 1); d19.setHours(19, 0, 0, 0)
  t('«завтра в 7 вечера» -> 19:00', evening === d19.getTime())
  t('мусор -> null', parseWhen('когда-нибудь') === null)
}

// === УРОВЕНЬ 1d: пресеты личности ===
import { PERSONALITY_PRESETS, detectPreset } from '../src/shared/personalityPresets'
{
  t('пресетов >= 5', PERSONALITY_PRESETS.length >= 5)
  const uniqueIds = new Set(PERSONALITY_PRESETS.map((p) => p.id)).size
  t('id пресетов уникальны', uniqueIds === PERSONALITY_PRESETS.length)
  const allValid = PERSONALITY_PRESETS.every((p) => p.name && p.emoji && p.tagline && p.apply.personality.length > 40 && p.apply.addressStyle)
  t('все пресеты заполнены (имя/эмодзи/промпт/обращение)', allValid)
  t('detectPreset узнаёт «Кира» по промпту', detectPreset(PERSONALITY_PRESETS[0].apply.personality) === PERSONALITY_PRESETS[0].id)
  t('detectPreset на ручном тексте -> null', detectPreset('произвольный характер') === null)
}

// === УРОВЕНЬ 1e: семантический индекс интентов ===
import { semanticIntent } from '../src/main/core/semanticIntent'
{
  const docs = registry.semanticDocs()
  t('semanticDocs непустой', docs.length > 20, 'фраз: ' + docs.length)
  const ids = new Set(docs.map((d) => d.id))
  // опасные и требующие обяз. аргументов действия НЕ должны попадать в индекс
  t('semanticDocs без опасных (shutdown)', !ids.has('shutdown_pc') && !ids.has('restart_pc'))
  t('semanticDocs без обяз.-арг (open_url/create_folder)', !ids.has('open_url') && !ids.has('create_folder'))
  t('semanticDocs содержит безопасные (weather/volume_up)', ids.has('weather') && ids.has('volume_up'))
  const allEligible = docs.every((d) => {
    const a = registry.get(d.id)!
    return a && !a.dangerous && !a.args.some((arg) => arg.required)
  })
  t('semanticDocs: все действия безопасны и без обяз. аргументов', allEligible)
}

// === УРОВЕНЬ 1f: семантика — быстрые отсечки (без модели) ===
async function levelSemanticGuards(): Promise<void> {
  // эти вызовы обязаны вернуть null ДО обращения к модели (короткие отсечки)
  t('семантика: пустая строка -> null', (await semanticIntent('')) === null)
  t('семантика: составное «и» -> null', (await semanticIntent('выключи звук и свет')) === null)
  t('семантика: перечисление через запятую -> null', (await semanticIntent('скриншот, потом отправь')) === null)
  t('семантика: слишком длинно -> null', (await semanticIntent('а'.repeat(70))) === null)
}

// === УРОВЕНЬ 2: Command Engine — реальные действия ===
async function level2(): Promise<void> {
  await levelSemanticGuards()
  let busCount = 0
  bus.on('action:executed', () => { busCount++ })

  const w = await commandEngine.tryHandle('какая погода', { source: 'chat' })
  t('погода: полная цепочка до реального HTTP', !!(w.handled && w.result && w.result.ok), '-> ' + (w.reply ?? ''))

  const stamp = 'KiraCoreTest_' + Date.now()
  const cf = await commandEngine.tryHandle('создай папку ' + stamp, { source: 'chat' })
  const desktop = path.join(os.tmpdir(), 'kira-core-test', 'desktop')
  const created = fs.existsSync(path.join(desktop, stamp))
  t('создай папку: реально создана на диске', !!(cf.handled && cf.result && cf.result.ok && created))

  // отмена: «отмени» удаляет ИМЕННО созданную папку (undo-механика ядра)
  const un = await commandEngine.tryHandle('отмени', { source: 'chat' })
  const goneAfterUndo = !fs.existsSync(path.join(desktop, stamp))
  t('отмени: папка реально убрана', !!(un.handled && un.result && un.result.ok && goneAfterUndo), '-> ' + (un.reply ?? ''))

  // повторная отмена — честное «нечего отменять»
  const un2 = await commandEngine.tryHandle('отмени', { source: 'chat' })
  t('повторная отмена -> «нечего отменять»', !!(un2.handled && un2.result && un2.result.ok === false))

  const d1 = await commandEngine.tryHandle('выключи компьютер', { source: 'chat' })
  t('опасное без confirm -> отклонено', d1.handled === true && d1.result !== undefined && d1.result.ok === false)

  const d2 = await commandEngine.tryHandle('перезагрузи', { source: 'chat', confirm: async () => false })
  t('опасное confirm=false -> отменено', d2.reply === 'Хорошо, отменила.')

  const sv = await commandEngine.tryHandle('включи свет', { source: 'chat' })
  t('стоп-слово «свет» -> уходит в AI', sv.handled === false)

  const sf = await commandEngine.tryHandle('открой абракадабрасофт', { source: 'chat' })
  t('несуществующее приложение -> softFail -> AI', sf.handled === false)

  const byAlias = await commandEngine.executeById('уведомление', { title: 'Тест' }, { source: 'agent' })
  t('executeById по алиасу', byAlias !== null && byAlias.ok === true)

  const badVol = await commandEngine.tryHandle('громкость 400', { source: 'chat' })
  t('громкость 400 -> в AI (валидатор)', badVol.handled === false)

  const unknown = await commandEngine.executeById('no_such_action', {}, { source: 'agent' })
  t('неизвестный id -> null', unknown === null)

  const clip = await commandEngine.executeById('clipboard_write', { text: 'kira' }, { source: 'agent' })
  t('clipboard_write через Action API', clip !== null && clip.ok === true)

  // процессы: реальный PowerShell — общий список
  const procs = await commandEngine.tryHandle('какие процессы запущены', { source: 'chat' })
  t('процессы: реальный список системы', !!(procs.handled && procs.result && procs.result.ok && String(procs.result.data ?? '').includes('МБ')), '-> ' + (procs.reply ?? '').slice(0, 40))
  // процессы: проверка конкретного (svchost точно есть в Windows)
  const svc = await commandEngine.tryHandle('запущен ли svchost', { source: 'chat' })
  t('процессы: «запущен ли svchost» -> да', !!(svc.result && svc.result.ok && String(svc.reply ?? '').includes('запущен')))

  const hist = actionHistory.list(20)
  t('история фиксирует действия', hist.length >= 4, 'записей: ' + hist.length)
  t('шина событий работает', busCount >= 3, 'событий: ' + busCount)

  try { fs.rmSync(path.join(desktop, stamp), { recursive: true, force: true }) } catch { /* ignore */ }

  console.log('\n=== ИТОГО: ' + pass + ' PASS, ' + fail + ' FAIL ===')
  process.exit(fail ? 1 : 0)
}
void level2()
