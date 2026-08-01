/** Полный тестовый прогон Kira Core (временный файл, удаляется после). */
import { commandEngine, extractArg } from '../src/main/core/engine'
import { registry } from '../src/main/core/registry'
import { actions } from '../src/main/core/actions'
import { actionHistory } from '../src/main/core/history'
import { bus } from '../src/main/core/bus'
import { parseIntent } from '../src/main/core/intent'
import {
  noteMiss, listLearned, learnedDocs, forgetLearned, noteCorrection, looksLikeCorrection, exactLearned,
  noteUndo
} from '../src/main/core/learning'
import { contentOf } from '../src/main/core/types'
import { pickReply, pickFailure, resetPersonaState, hasVariants } from '../src/main/core/persona'
import { bindingToAction } from '../src/main/core/mcpActions'
import { toExecResult } from '../src/main/modules/mcp/normalize'
import { transcribeHint } from '../src/main/core/sttHint'
import { nameMatches } from '../src/main/modules/telegramUser'
import { stripActions, parseActions } from '../src/main/modules/ai/kira'
import { resolveLocalModel } from '../src/main/modules/ai/localLlm'
import { calculate, looksLikeMath } from '../src/main/modules/utilities'
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
  ['переведи 5 миль в км', 'convert'], ['сколько будет 100 долларов в рублях', 'convert'],
  ['курс биткоина', 'rate'], ['сколько стоит доллар', 'rate'],
  ['сделай qr код для example.com', 'qr_code'], ['имт 180 75', 'bmi'],
  ['таймер на 10 минут', 'timer'], ['поставь таймер на 30 секунд чай', 'timer'],
  ['проверь скорость интернета', 'speedtest'], ['таймеры', 'timers_list'],
  ['запусти игру', 'clarify_launch'], ['открой программу', 'clarify_launch'],
  ['включи что-нибудь', 'clarify_launch'], ['запусти какую-нибудь игру', 'clarify_launch'],
  ['запусти стим', 'launch_app'], ['открой discord', 'launch_app'],
  ['история буфера', 'clipboard_history'], ['что я копировал', 'clipboard_history'],
  ['вставь предыдущее', 'paste_recent'], ['вставь из истории 2', 'paste_recent'],
  ['прочитай текст с экрана', 'read_screen_text'], ['текст на экране', 'read_screen_text'],
  ['что жрёт память', 'top_memory'], ['что грузит процессор', 'top_cpu'],
  ['что в автозагрузке', 'startup_apps'], ['почисти временные файлы', 'clean_temp'],
  ['сохрани сниппет адрес: улица Ленина 1', 'snippet_save'], ['вставь сниппет адрес', 'snippet_paste'],
  ['мои сниппеты', 'snippets_list'], ['проиндексируй документы', 'index_docs'],
  ['найди в документах условия договора', 'ask_docs'], ['что в базе знаний', 'knowledge_status'],
  ['почему не работает голос', 'diagnose'], ['диагностика', 'diagnose'], ['проверь все системы', 'diagnose'],
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

// ─── Опечатки в командах ────────────────────────────────────────────────────
// Правка ошибочная хуже, чем нераспознавание: если «исправить» не то слово,
// Kira выполнит НЕ ТУ команду. Поэтому проверяем и срабатывание, и осторожность.
const vocab = registry.commandVocabulary()
t('опечатка: «открй браузер» понято', parseIntent('открй браузер', specs, vocab).kind === 'local')
t('опечатка: «сделай скриншт» понято', parseIntent('сделай скриншт', specs, vocab).kind === 'local',
  '-> ' + JSON.stringify(parseIntent('сделай скриншт', specs, vocab)))
t('без словаря опечатка НЕ правится', parseIntent('открй браузер', specs).kind === 'ai')
t('осторожность: чужое слово не притягивается', parseIntent('абракадабра тут', specs, vocab).kind === 'ai')
t('осторожность: короткое слово не правим', parseIntent('окр браузер', specs, vocab).kind === 'ai')
t('правильная команда работает как прежде', parseIntent('открой браузер', specs, vocab).kind === 'local')

// Главное свойство безопасности правки опечаток: словарь НЕ МЕНЯЕТ разбор
// обычной речи. Если фраза без словаря уходила в AI — она должна уходить туда
// и со словарём. Иначе Kira начнёт выполнять команды там, где её просто спросили.
{
  const ordinary = [
    'что такое браузер', 'расскажи про музыку', 'мне нравится этот трек',
    'какая погода будет завтра', 'напиши письмо коллеге', 'объясни как работает экран',
    'почему компьютер тормозит', 'спасибо большое', 'подумай над задачей',
    'переведи текст на английский', 'а что если удалить всё'
  ]
  const changed = ordinary.filter((phrase) =>
    parseIntent(phrase, specs).kind !== parseIntent(phrase, specs, vocab).kind)
  t('правка опечаток не меняет разбор обычной речи', changed.length === 0,
    changed.length ? '-> ' + changed.join(' | ') : `проверено фраз: ${ordinary.length}`)
}
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
  t('semanticDocs включает действия с ОДНИМ аргументом', ids.has('open_url') && ids.has('web_search'))
  t('semanticDocs содержит безопасные (weather/volume_up)', ids.has('weather') && ids.has('volume_up'))
  // Инвариант безопасности: смыслу доступны только безопасные действия и не
  // более ОДНОГО обязательного аргумента — угадать сразу два слота нельзя.
  const allEligible = docs.every((d) => {
    const a = registry.get(d.id)!
    return a && !a.dangerous && !a.noSemantic && a.args.filter((arg) => arg.required).length <= 1
  })
  t('semanticDocs: безопасны и максимум один обязательный аргумент', allEligible)
  const withArg = docs.filter((d) => registry.get(d.id)!.args.some((a) => a.required))
  t('semanticDocs: действия с аргументом реально появились', withArg.length > 0,
    'таких фраз: ' + withArg.length)

  // Приоритет: универсальные «ловушки» обязаны проверяться ПОСЛЕ конкретных
  // команд, иначе «открой браузер» уйдёт в общий запуск приложений.
  {
    const order = registry.intentSpecs().map((s) => s.id)
    const fallback = order.indexOf('launch_app')
    const specific = ['open_browser', 'play_music', 'play_video', 'open_folder', 'task_manager']
      .map((id) => order.indexOf(id))
      .filter((i) => i >= 0)
    t('приоритет: ловушка проверяется после конкретных команд',
      fallback >= 0 && specific.every((i) => i < fallback),
      `ловушка на ${fallback}, конкретные на ${specific.join(',')}`)
  }

  // Извлечение аргумента: смысл сказал ЧТО делать, а «с чем» вычитается из
  // фразы. Проверяем НАСТОЯЩУЮ функцию движка, а не её копию в тесте —
  // копия однажды уже разошлась с реальностью и дала ложный провал.
  {
    const ws = registry.get('web_search')!
    const searchWords = [...ws.examples, ...ws.aliases, ...(ws.phrases ?? [])]
    t('аргумент: синоним глагола не попадает в запрос',
      extractArg('поищи-ка в интернете рецепт борща', searchWords) === 'рецепт борща',
      '-> ' + extractArg('поищи-ка в интернете рецепт борща', searchWords))

    const pm = registry.get('play_music')!
    const musicWords = [...pm.examples, ...pm.aliases, ...(pm.phrases ?? [])]
    t('аргумент: регистр названия сохраняется',
      extractArg('включи мне музыку Hollywood Undead', musicWords) === 'Hollywood Undead',
      '-> ' + extractArg('включи мне музыку Hollywood Undead', musicWords))

    const of = registry.get('open_folder')!
    const folderWords = [...of.examples, ...of.aliases, ...(of.phrases ?? [])]
    t('аргумент: связки отбрасываются',
      extractArg('открой пожалуйста папку Загрузки', folderWords) === 'Загрузки',
      '-> ' + extractArg('открой пожалуйста папку Загрузки', folderWords))

    t('аргумент: пустой остаток = не выполняем',
      extractArg('поищи в интернете', searchWords) === '')
  }

// ─── Обучение на промахах ───────────────────────────────────────────────────
// Выученная ерунда будет срабатывать МОЛЧА, поэтому проверяем осторожность
// не менее тщательно, чем само обучение.
{
  forgetLearned()
  const before = registry.semanticDocs().length

  // одно подтверждение — рано: случайность не должна закрепляться
  noteMiss('врубай погромче звук', 'volume_up')
  t('обучение: с первого раза фраза НЕ активна',
    listLearned().every((p) => !p.active) && learnedDocs().length === 0)

  // второе подтверждение — фраза начинает работать
  noteMiss('врубай погромче звук', 'volume_up')
  const active = listLearned().filter((p) => p.active)
  t('обучение: со второго раза фраза активируется', active.length === 1,
    '-> ' + JSON.stringify(active.map((p) => p.phrase + ' → ' + p.actionId)))
  t('обучение: выученное попадает в смысловой индекс', learnedDocs().length === 1)

  // опасное не учим никогда, сколько ни повторяй
  noteMiss('снеси всё к чертям', 'shutdown_pc')
  noteMiss('снеси всё к чертям', 'shutdown_pc')
  t('обучение: опасное действие не выучивается',
    listLearned().every((p) => p.actionId !== 'shutdown_pc'))

  // длинные тексты — не команды
  noteMiss('вот это очень длинная фраза которую я говорю просто так и она точно не команда', 'volume_up')
  t('обучение: длинный текст не выучивается', listLearned().length === 1)

  // подсказка распознавателю собирается из живого словаря пользователя:
  // статичная фраза одинаково плохо слышала всех
  const hint = transcribeHint()
  t('подсказка распознавателю: знает имя ассистента и выученную фразу',
    hint.includes('Кира') && hint.includes('врубай погромче звук'), '-> ' + hint.slice(0, 90))
  t('подсказка распознавателю: не длиннее лимита Whisper', hint.length <= 380)

  // Индивидуальность: ядро запоминает не только форму команды, но и ЧТО именно
  // человек имел в виду. «Открой мою почту» у каждого своя, и повторять её
  // должно ядро, а не облако.
  forgetLearned()
  noteMiss('открой мою почту', 'open_url', ['mail.example.com'])
  t('личное: с первого раза ещё не работает', exactLearned('открой мою почту') === null)
  noteMiss('открой мою почту', 'open_url', ['mail.example.com'])
  const mine = exactLearned('открой мою почту')
  t('личное: выучена команда вместе с адресом',
    mine?.actionId === 'open_url' && mine?.args.url === 'mail.example.com',
    '-> ' + JSON.stringify(mine))
  t('личное: чужая формулировка не подхватывает мои данные',
    exactLearned('открой почту') === null)

  // Одна и та же фраза с разными данными — она не про конкретную вещь,
  // подставлять прошлое значение было бы враньём.
  noteMiss('найди это', 'web_search', ['рецепт борща'])
  noteMiss('найди это', 'web_search', ['погода в Киеве'])
  const vague = exactLearned('найди это')
  t('личное: разные данные у одной фразы не запоминаются',
    vague?.actionId === 'web_search' && Object.keys(vague?.args ?? {}).length === 0,
    '-> ' + JSON.stringify(vague))
  forgetLearned()

  // Исправление пользователя: молча повторять опровергнутую ошибку — худшее,
  // что может делать обучение, поэтому связка гасится и не оживает сама.
  noteMiss('врубай погромче звук', 'volume_up')
  noteMiss('врубай погромче звук', 'volume_up')
  t('исправление: перед проверкой связка активна', learnedDocs().length === 1)
  t('исправление: возражение распознаётся',
    looksLikeCorrection('нет, я не это просил') && looksLikeCorrection('не то'))
  t('исправление: обычная фраза не считается возражением',
    !looksLikeCorrection('нет ли у меня встреч завтра') && !looksLikeCorrection('включи музыку'))
  t('исправление: гасит ошибочную связку',
    noteCorrection('врубай погромче звук', 'volume_up') && learnedDocs().length === 0)
  noteMiss('врубай погромче звук', 'volume_up')
  noteMiss('врубай погромче звук', 'volume_up')
  t('исправление: опровергнутое не выучивается заново', learnedDocs().length === 0)

  // Кому уйдёт сообщение в Telegram: имя склоняется («напиши Васе»), но
  // ошибиться человеком нельзя — сообщение не отзовёшь.
  t('контакт: склонённое имя находит того же человека',
    nameMatches('Вася Пупкин', 'васе') && nameMatches('Вася Пупкин', 'вася'))
  t('контакт: фамилия и имя вместе тоже находят',
    nameMatches('Вася Пупкин', 'вася пупкин'))
  t('контакт: чужое имя не подходит',
    !nameMatches('Вася Пупкин', 'петя') && !nameMatches('Вася Пупкин', 'василиса кузнецова'))
  t('контакт: короткое имя требует точного совпадения',
    nameMatches('Ян Ковальский', 'ян') && !nameMatches('Яна Смирнова', 'ян'))

  // забывание работает и чистит индекс
  const forgotten = forgetLearned()
  t('обучение: забывание убирает всё', forgotten === 1 && learnedDocs().length === 0)
  t('обучение: индекс вернулся к исходному', registry.semanticDocs().length === before)

  // Отмена сразу после выученной команды — молчаливое исправление. Но сигнал
  // СЛАБЫЙ: «отмени» говорят и когда поняли верно, а человек передумал.
  forgetLearned()
  noteMiss('прибери на столе', 'volume_up')
  noteMiss('прибери на столе', 'volume_up')
  t('отмена: до неё связка работает', learnedDocs().length === 1)
  t('отмена: первая отмена только снижает уверенность',
    noteUndo('прибери на столе', 'volume_up') && learnedDocs().length === 0 &&
    listLearned().every((p) => !p.rejected))
  noteUndo('прибери на столе', 'volume_up')
  t('отмена: вторая подряд выключает связку насовсем',
    listLearned().some((p) => p.rejected))
  t('отмена: невыученную команду не трогаем',
    noteUndo('открой браузер', 'open_browser') === false)
  forgetLearned()

  // Обучение не должно расти без предела: у истории действий он есть, у
  // обучения не было — файл читается при каждом промахе ядра.
  for (let i = 0; i < 430; i++) noteMiss(`проверочная фраза номер ${i}`, 'volume_up')
  t('обучение: коллекция держится в рамках', listLearned().length <= 400,
    '-> ' + listLearned().length)
  forgetLearned()

}
}

// === УРОВЕНЬ 1f: семантика — быстрые отсечки (без модели) ===
async function levelSemanticGuards(): Promise<void> {
  // эти вызовы обязаны вернуть null ДО обращения к модели (короткие отсечки)
  t('семантика: пустая строка -> не выполняем', (await semanticIntent('')).match === null)
  t('семантика: составное «и» -> не выполняем', (await semanticIntent('выключи звук и свет')).match === null)
  t('семантика: перечисление через запятую -> не выполняем', (await semanticIntent('скриншот, потом отправь')).match === null)
  t('семантика: слишком длинно -> не выполняем', (await semanticIntent('а'.repeat(70))).match === null)

  // Трассировка: на каждый отказ должна быть внятная причина, иначе «почему не
  // сработало» снова превращается в гадание
  const probe = await semanticIntent('выключи звук и свет')
  t('трассировка: отказ объяснён причиной', typeof probe.skipped === 'string' && probe.skipped.length > 3, '-> ' + probe.skipped)
  t('трассировка: порог доступен для настройки', typeof probe.threshold === 'number' && probe.threshold > 0)
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

  // Отмена шире файлов: громкость, буфер и сниппеты тоже возвращаются.
  // Раньше отменялись только файловые операции — «сделай потише, нет, верни
  // как было» ядро не умело, хотя это самая частая просьба вернуть назад.
  const { clipboard } = await import('electron')
  clipboard.writeText('было в буфере')
  await commandEngine.executeById('clipboard_write', { text: 'стало в буфере' }, { source: 'agent' })
  const unClip = await commandEngine.undoLast({ source: 'chat' })
  t('отмена: буфер вернулся к прежнему тексту',
    unClip.ok === true && clipboard.readText() === 'было в буфере')

  const snipName = 'KiraTestSnip_' + Date.now()
  await commandEngine.executeById('snippet_save', { name: snipName, text: 'первый' }, { source: 'agent' })
  await commandEngine.executeById('snippet_save', { name: snipName, text: 'второй' }, { source: 'agent' })
  const unSnip = await commandEngine.undoLast({ source: 'chat' })
  const { getSnippet } = await import('../src/main/modules/snippets')
  const snipBack = getSnippet(snipName)
  t('отмена: перезаписанный сниппет вернул прежний текст',
    unSnip.ok === true && contentOf(snipBack) === 'первый', '-> ' + contentOf(snipBack))

  const newSnip = 'KiraTestSnipNew_' + Date.now()
  await commandEngine.executeById('snippet_save', { name: newSnip, text: 'разовый' }, { source: 'agent' })
  await commandEngine.undoLast({ source: 'chat' })
  t('отмена: новый сниппет удалён, а не оставлен пустым', getSnippet(newSnip).ok === false)

  // ХАРАКТЕР. Local First сделал команды мгновенными ценой безликости: ядро
  // отвечало одной и той же константой, каким бы ни был выбранный характер.
  {
    resetPersonaState()
    const ctx = { streak: 1, hour: 12, firstInAWhile: false }
    t('характер: «деловая» и «минимализм» остаются сухими',
      pickReply('Открываю', 'сухой', ctx) === 'Открываю' && pickReply('Готово', 'сухой', ctx) === 'Готово')

    // подряд идущие ответы не должны повторяться — именно повтор читается
    // как «заело», поэтому варианты перебираются по кругу, а не случайно
    const row = [0, 1, 2].map(() => pickReply('Готово', 'тёплый', ctx))
    t('характер: подряд не повторяется', new Set(row).size === row.length, '-> ' + row.join(' / '))

    // Продолжение фразы сохраняется, и вариант с ним СОГЛАСУЕТСЯ: короткий
    // отклик уместен сам по себе, но «Момент корзину» — брак.
    resetPersonaState()
    const withTail = [0, 1, 2, 3].map(() => pickReply('Открываю корзину', 'озорной', ctx))
    t('характер: продолжение фразы не теряется',
      withTail.every((r) => r.endsWith(' корзину')), '-> ' + withTail.join(' / '))
    t('характер: с дополнением остаются только глаголы',
      withTail.every((r) => /^(Открываю|Открыла|Уже открываю|Оп, открыла|Сейчас открою|Секунду — открываю) корзину$/.test(r)),
      '-> ' + withTail.join(' / '))

    // очередь команд: человек работает, а не общается — самое короткое
    resetPersonaState()
    const busy = { streak: 6, hour: 12, firstInAWhile: false }
    const quick = [0, 1, 2].map(() => pickReply('Готово', 'тёплый', busy))
    t('характер: в очереди команд отвечает коротко и одинаково',
      quick.every((r) => r === 'Готово'), '-> ' + quick.join(' / '))

    // Встреча после перерыва: здоровается один раз и только там, где это
    // свойственно характеру. «Деловой» приветствие — лишний шум.
    resetPersonaState()
    const backMorning = pickReply('Готово', 'тёплый', { streak: 1, hour: 9, firstInAWhile: true })
    const backEvening = pickReply('Готово', 'озорной', { streak: 1, hour: 20, firstInAWhile: true })
    t('контекст: после перерыва здоровается по времени суток',
      backMorning.startsWith('Доброе утро') && backEvening.startsWith('Вечер добрый'),
      '-> ' + backMorning + ' / ' + backEvening)
    t('контекст: следом уже не здоровается',
      !pickReply('Готово', 'тёплый', ctx).includes('утро'))
    t('контекст: деловой характер не здоровается',
      pickReply('Готово', 'обычный', { streak: 1, hour: 9, firstInAWhile: true }) === 'Готово' ||
      !pickReply('Готово', 'обычный', { streak: 1, hour: 9, firstInAWhile: true }).includes('утро'))
    t('контекст: длинную фразу приветствием не утяжеляет',
      !pickReply('Индексирую документы, это займёт немного времени', 'тёплый',
        { streak: 1, hour: 9, firstInAWhile: true }).startsWith('Доброе'))

    // незнакомая фраза остаётся собой — безопасное поведение по умолчанию
    t('характер: незнакомую фразу не выдумывает',
      pickReply('Перевожу в гибернацию', 'озорной', ctx) === 'Перевожу в гибернацию')

    // Фразы с подставленными данными («Громкость 40%») — самые частые ответы,
    // и до сих пор именно они оставались штампом.
    resetPersonaState()
    const vol = [0, 1, 2].map(() => pickReply('Громкость 40%', 'тёплый', ctx))
    t('характер: фразы с данными тоже оживают',
      new Set(vol).size > 1 && vol.every((r) => r.includes('40')), '-> ' + vol.join(' / '))
    resetPersonaState()
    const search = [0, 1].map(() => pickReply('Ищу: рецепт борща', 'озорной', ctx))
    t('характер: данные из фразы не теряются',
      search.every((r) => r.includes('рецепт борща')), '-> ' + search.join(' / '))

    // Неудача: сообщение об ошибке — суть, его менять нельзя, меняется подача.
    resetPersonaState()
    const because = 'Не удалось открыть папку: путь не найден'
    const fail = pickFailure(because, 'тёплый', ctx)
    t('характер: неудача звучит живее, но причина цела',
      fail.endsWith(because) && fail.length > because.length, '-> ' + fail)
    t('характер: у сухого регистра ошибка без вздохов',
      pickFailure('Не удалось', 'сухой', ctx) === 'Не удалось')
    t('характер: в очереди команд не до сочувствия',
      pickFailure('Не удалось', 'тёплый', { streak: 6, hour: 12, firstInAWhile: false }) === 'Не удалось')

    // Таблица привязана к фразам действий по тексту, и разойтись они могут
    // молча: характер просто перестанет звучать, и никто не заметит.
    const spoken = new Set<string>()
    for (const a of actions) {
      const phrase = a.confirmText?.({})
      if (phrase) spoken.add(phrase)
    }
    // параметрические фразы («Громкость N%») привязать по тексту нельзя —
    // считаем только постоянные
    const missing = [...spoken].filter((p) => !p.includes('undefined') && !hasVariants(p))
    t('характер: звучит в большинстве ответов действий',
      missing.length <= spoken.size / 4,
      `без вариантов ${missing.length} из ${spoken.size}: ${missing.join(', ')}`)
  }

  // РАСШИРЕНИЯ (MCP). Инструмент чужого сервера становится обычным действием —
  // именно поэтому движок, отмена и обучение не потребовали правок.
  {
    const binding = {
      id: 'b1', server: 'github', tool: 'create_issue', title: 'Заведи задачу',
      phrases: ['заведи задачу', 'создай issue'], args: { title: '$1', repo: 'kira' },
      dangerous: true, enabled: true, createdAt: Date.now()
    }
    const act = bindingToAction(binding)
    t('расширения: привязка становится действием',
      act?.id === 'mcp:github/create_issue' && act?.dangerous === true, '-> ' + act?.id)
    t('расширения: фраза с аргументом ловится шаблоном',
      !!act?.patterns?.[0].test('заведи задачу кнопка не работает'))
    t('расширения: аргумент вытаскивается из фразы',
      act?.patterns?.[0].exec('заведи задачу кнопка не работает')?.groups?.v1 === 'кнопка не работает')

    // Человек пишет фразы словами, а не регулярками. Незакрытая скобка не
    // должна разваливать разбор ВСЕХ команд — шаблоны компилируются вместе.
    const risky = bindingToAction({ ...binding, id: 'b2', phrases: ['сделай (что-нибудь) [важное]'], args: {} })
    t('расширения: спецсимволы во фразе экранируются',
      !!risky?.patterns?.[0].test('сделай (что-нибудь) [важное]') &&
      !risky?.patterns?.[0].test('сделай чтонибудь важное'))

    // Разбор сворачивает ввод: нижний регистр и ё→е. Шаблон привязки обязан
    // сворачиваться так же, иначе фраза с «ё» не совпадёт НИКОГДА.
    const yo = bindingToAction({ ...binding, id: 'b5', phrases: ['найдём отчёт'], args: {} })
    t('расширения: «ё» во фразе привязки не ломает совпадение',
      !!yo?.patterns?.[0].test('найдем отчет'), '-> ' + yo?.patterns?.[0])
    const caps = bindingToAction({ ...binding, id: 'b6', phrases: ['Заведи Задачу'], args: {} })
    t('расширения: регистр во фразе привязки не важен',
      !!caps?.patterns?.[0].test('заведи задачу'))

    // НЕСКОЛЬКО МЕСТ. По-русски аргументы разделены предлогом, а не запятой:
    // «перемести отчёт в архив» — это два значения, и человек размечает их
    // прямо во фразе, там же, где и слышит.
    const two = bindingToAction({
      ...binding, id: 'b7', tool: 'move_file', title: 'Перемести',
      phrases: ['перемести $1 в $2'], args: { source: '$1', destination: '$2' }
    })!
    const m2 = two.patterns?.[0].exec('перемести отчёт в архив')
    t('места: два значения разбираются по предлогу',
      m2?.groups?.v1 === 'отчёт' && m2?.groups?.v2 === 'архив', '-> ' + JSON.stringify(m2?.groups))

    // Замыкающая группа обязана забрать остаток ЦЕЛИКОМ: нежадная оставила бы
    // от «в архив старых отчётов» только «в».
    const m3 = two.patterns?.[0].exec('перемести годовой отчёт в архив старых отчётов')
    t('места: последнее значение берётся целиком',
      m3?.groups?.v1 === 'годовой отчёт' && m3?.groups?.v2 === 'архив старых отчётов',
      '-> ' + JSON.stringify(m3?.groups))

    t('места: у действия столько аргументов, сколько мест', two.args.length === 2,
      '-> ' + JSON.stringify(two.args.map((x) => x.name + ':' + x.description)))
    t('места: в примере вместо меток многоточие', two.examples[0] === 'перемести … в …',
      '-> ' + two.examples[0])

    // Старые привязки — без разметки во фразе — должны продолжать работать.
    const old = bindingToAction({ ...binding, id: 'b8', phrases: ['заведи задачу'], args: { title: '$1' } })!
    // Длина фразы: точные шаблоны анкерные, поэтому длинный текст им не
    // страшен. Раньше общий лимит в 120 символов отправлял в облако любую
    // команду с двумя windows-путями — а это обычное «перемести туда-сюда».
    registry.replacePrefixed('mcp:', [two])
    const longCmd = String.raw`перемести C:\Users\User\Documents\Рабочие отчёты\годовой-отчёт-итоговый.txt ` +
      String.raw`в C:\Users\User\Documents\Архив\Старые отчёты\годовой-отчёт-итоговый.txt`
    const longIntent = parseIntent(longCmd, registry.intentSpecs(), [])
    t('длина: команда с двумя путями не уходит в облако',
      longIntent.kind === 'local' && longCmd.length > 120,
      `-> ${longIntent.kind}, длина ${longCmd.length} (лимит догадок 120)`)
    // но вставленный текст командой не становится
    const prose = parseIntent('перемести ' + 'очень длинный текст '.repeat(40), registry.intentSpecs(), [])
    t('длина: вставленный текст командой не считается', prose.kind !== 'local')
    registry.replacePrefixed('mcp:', [])

    t('места: привязка без разметки работает по-старому',
      old.patterns?.[0].exec('заведи задачу кнопка не работает')?.groups?.v1 === 'кнопка не работает')

    t('расширения: без фраз действие не создаётся',
      bindingToAction({ ...binding, id: 'b3', phrases: [] }) === null)
    t('расширения: выключенная привязка не создаётся',
      bindingToAction({ ...binding, id: 'b4', enabled: false }) === null)

    // Реестр должен уметь снимать регистрацию: сервер отключили, привязку
    // удалили. Без этого повторное подключение падало бы на дубликате id.
    const before = registry.size
    registry.replacePrefixed('mcp:', [act!])
    t('расширения: команда попадает в реестр', registry.size === before + 1 && !!registry.get(act!.id))
    registry.replacePrefixed('mcp:', [])
    t('расширения: снятие регистрации не задевает встроенные',
      registry.size === before && !registry.get(act!.id) && !!registry.get('open_browser'))

    // Ответ сервера приводится к контракту ядра: статус отдельно, содержимое
    // отдельно — на смешении этих двух ядро уже дважды ловило баги.
    const okRes = toExecResult({ content: [{ type: 'text', text: 'задача #12 создана' }] }, 'Заведи задачу')
    t('расширения: текст ответа идёт в содержимое, а не в статус',
      okRes.ok && okRes.content === 'задача #12 создана' && okRes.message !== okRes.content)
    const errRes = toExecResult({ content: [{ type: 'text', text: 'нет доступа' }], isError: true }, 'Заведи задачу')
    t('расширения: провал инструмента — это неудача, а не успех',
      errRes.ok === false && errRes.message.includes('нет доступа'))
    const imgRes = toExecResult({ content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] }, 'Скриншот')
    t('расширения: картинка не теряется молча', imgRes.ok && imgRes.content === '[изображение]')
  }

  // Не хватает обязательного аргумента — ядро спрашивает и показывает пример,
  // а не подставляет что-нибудь на своё усмотрение: угаданный файл или
  // получатель это уже не помощь.
  const needArg = await commandEngine.executeById('clipboard_write', { text: '   ' }, { source: 'agent' })
  t('уточнение: пустой обязательный аргумент не выполняется', !!needArg && needArg.ok === false,
    '-> ' + (needArg ? needArg.message : 'нет'))
  const askFolder = await commandEngine.executeById('list_files', {}, { source: 'agent' })
  t('уточнение: ядро не придумывает недостающее', !!askFolder && askFolder.ok === false,
    '-> ' + (askFolder ? askFolder.message : 'нет'))

  // Сквозная проверка личного обучения: выученная фраза выполняется САМИМ
  // ядром — без облака и без движка эмбеддингов (его в тестах нет вовсе).
  noteMiss('вставь мою подпись', 'clipboard_write', ['Вадим, VirusAid'])
  noteMiss('вставь мою подпись', 'clipboard_write', ['Вадим, VirusAid'])
  clipboard.writeText('')
  const ranLearned = await commandEngine.tryHandle('вставь мою подпись', { source: 'chat' })
  t('личное: ядро само выполняет выученную фразу с моими данными',
    ranLearned.handled === true && clipboard.readText() === 'Вадим, VirusAid',
    '-> ' + JSON.stringify(clipboard.readText()))
  forgetLearned()

  const d1 = await commandEngine.tryHandle('выключи компьютер', { source: 'chat' })
  t('опасное без confirm -> отклонено', d1.handled === true && d1.result !== undefined && d1.result.ok === false)

  // Формулировка отказа зависит от характера, поэтому проверяем СМЫСЛ:
  // действие не выполнено, отказ зафиксирован, ответ не пустой.
  const d2 = await commandEngine.tryHandle('перезагрузи', { source: 'chat', confirm: async () => false })
  t('опасное confirm=false -> отменено',
    d2.denied === true && d2.result?.ok === false && !!d2.reply && !/выполн|перезагру/i.test(d2.reply),
    '-> ' + d2.reply)

  const sv = await commandEngine.tryHandle('включи свет', { source: 'chat' })
  t('стоп-слово «свет» -> уходит в AI', sv.handled === false)

  const sf = await commandEngine.tryHandle('открой абракадабрасофт', { source: 'chat' })
  t('несуществующее приложение -> softFail -> AI', sf.handled === false)

  // курс/конвертер: мусор уходит в AI (softFail), реальное — работает локально
  const iphone = await commandEngine.tryHandle('сколько стоит айфон', { source: 'chat' })
  t('«сколько стоит айфон» -> softFail -> AI', iphone.handled === false)
  const apples = await commandEngine.tryHandle('переведи 5 яблок в корзину', { source: 'chat' })
  t('«5 яблок в корзину» -> softFail -> AI', apples.handled === false)
  const lbs = await commandEngine.tryHandle('переведи 100 фунтов в кг', { source: 'chat' })
  t('«100 фунтов в кг» -> масса локально', !!(lbs.handled && lbs.result?.ok && (lbs.reply ?? '').includes('45.359')))
  const clarify = await commandEngine.tryHandle('запусти игру', { source: 'chat' })
  t('«запусти игру» -> уточняющий вопрос', !!(clarify.handled && (clarify.reply ?? '').includes('Какую игру')))

  const byAlias = await commandEngine.executeById('уведомление', { title: 'Тест' }, { source: 'agent' })
  t('executeById по алиасу', byAlias !== null && byAlias.ok === true)

  /*
   * «Громкость 400» — команда ядра с негодным значением, а не чужая фраза.
   * Раньше такое молча уезжало в облако: сообщение валидатора не видел никто,
   * ответ приходил через секунду, а без интернета не приходил вовсе. Теперь
   * ядро отвечает само и по делу.
   */
  const badVol = await commandEngine.tryHandle('громкость 400', { source: 'chat' })
  t('громкость 400 -> ядро объясняет само',
    badVol.handled === true && badVol.result?.ok === false && /0.{0,3}100/.test(badVol.result?.message ?? ''),
    '-> ' + (badVol.reply ?? ''))
  // а вот всеядная ловушка обязана по-прежнему пропускать чужое дальше
  const notApp = await commandEngine.tryHandle('открой файл', { source: 'chat' })
  t('«открой файл» -> не имя программы, уходит дальше', notApp.handled === false)

  const unknown = await commandEngine.executeById('no_such_action', {}, { source: 'agent' })
  t('неизвестный id -> null', unknown === null)

  const clip = await commandEngine.executeById('clipboard_write', { text: 'kira' }, { source: 'agent' })
  t('clipboard_write через Action API', clip !== null && clip.ok === true)

  // процессы: реальный PowerShell — общий список
  const procs = await commandEngine.tryHandle('какие процессы запущены', { source: 'chat' })
  t('процессы: реальный список системы', !!(procs.handled && procs.result && procs.result.ok && contentOf(procs.result).includes('МБ')), '-> ' + (procs.reply ?? '').slice(0, 40))

  // Контракт содержимого: message — статус, content — то, что показываем.
  // Регрессия за два реальных бага: содержимое лежало в data, а читали message,
  // из-за чего модель получала «Распознала текст» вместо самого текста, а
  // локальный ответ терял содержимое целиком.
  t('контракт: contentOf читает content',
    contentOf({ ok: true, message: 'статус', content: 'СОДЕРЖИМОЕ' } as never) === 'СОДЕРЖИМОЕ')
  t('контракт: contentOf понимает старое data-строкой',
    contentOf({ ok: true, message: 'статус', data: 'СТАРОЕ' } as never) === 'СТАРОЕ')
  t('контракт: структурные data не считаются содержимым',
    contentOf({ ok: true, message: 'статус', data: { a: 1 } } as never) === '')
  const withBody = await commandEngine.tryHandle('какие процессы запущены', { source: 'chat' })
  t('контракт: локальный ответ включает содержимое, а не только статус',
    !!(withBody.reply && withBody.result && withBody.reply.length > withBody.result.message.length))
  // процессы: проверка конкретного (svchost точно есть в Windows)
  const svc = await commandEngine.tryHandle('запущен ли svchost', { source: 'chat' })
  t('процессы: «запущен ли svchost» -> да', !!(svc.result && svc.result.ok && String(svc.reply ?? '').includes('запущен')))

  // ─── Английские имена: файлы, папки, программы ─────────────────────────────
  /*
   * Живой отчёт: «не открывает файлы и программы на английском языке».
   * Корень был не в языке как таковом, а в том, что «report.pdf» по форме
   * неотличим от домена — и «открыть сайт» перехватывал такие имена раньше
   * «открыть файл». Русское «отчёт.pdf» под шаблон домена не подходило вовсе,
   * поэтому ломалось ровно на английских именах.
   */
  const routes: Array<[string, string]> = [
    ['открой report.pdf', 'open_file'],
    ['открой Kira.exe', 'open_file'],
    ['открой setup.msi', 'open_file'],
    ['открой D:\\Games\\readme.md', 'open_file'],
    ['открой C:\\Users\\Public\\notes.txt', 'open_file'],
    // домены при этом остались доменами
    ['открой youtube.com', 'open_url'],
    ['зайди на github.com', 'open_url'],
    // папки — по системным английским именам тоже
    ['открой downloads', 'open_folder'],
    ['открой desktop', 'open_folder'],
    ['открой папку C:\\Projects', 'open_folder'],
    // названия программ длиннее двух слов
    ['открой Sublime Text 3', 'launch_app'],
    ['запусти Adobe Photoshop 2024', 'launch_app'],
    // и английские глаголы: имена программ и так пишутся латиницей
    ['open discord', 'launch_app'],
    ['launch steam', 'launch_app']
  ]
  for (const [phrase, want] of routes) {
    const got = parseIntent(phrase, specs, vocab)
    t(`английские имена: «${phrase}» → ${want}`,
      got.kind === 'local' && got.actionId === want,
      '-> ' + (got.kind === 'local' ? got.actionId : got.kind))
  }

  // Живые формулировки работают БЕЗ семантического сайдкара: поле phrases
  // теперь сопоставляется дословно, иначе у большинства (сайдкар ставится
  // отдельно) ядро понимало лишь узкие regex-формулировки.
  for (const phrase of ['сделай потише', 'сфоткай экран', 'покажи запущенные программы']) {
    const got = parseIntent(phrase, specs, vocab)
    t(`живая речь без сайдкара: «${phrase}»`, got.kind === 'local',
      '-> ' + (got.kind === 'local' ? got.actionId : got.kind))
  }

  // ─── Служебный протокол не должен попадать на глаза ───────────────────────
  // Пользователь присылал скриншоты, где [[kira:see_screen|]] и
  // [[kira:read_screen_text]] печатались прямо в ответе. Слабые модели
  // регулярно промахиваются мимо формата, поэтому чистка обязана прощать
  // кривизну — в отличие от ВЫПОЛНЕНИЯ, которое остаётся строгим.
  const dirty: string[] = [
    '[[kira:see_screen|]]',
    '[[kira:see_screen|]]]',
    '[[kira:read_screen_text]]',
    '[[Kira:open_app|C:\\Program Files\\App\\app.exe]]',
    '[[kira: focus_window|Visual Studio]]',
    '[[kira:click_text|Выберите папку]',
    'Готово. [[kira:open_app|steam]] Открываю.',
    'Смотрю [[kira:see_screen'
  ]
  for (const raw of dirty) {
    const left = stripActions(raw)
    t(`протокол не виден: ${raw.slice(0, 34)}`, !/kira:/i.test(left) && !left.includes('[['),
      '-> ' + JSON.stringify(left))
  }
  t('протокол: обычный текст не страдает',
    stripActions('Открыла. Массив [1] и скобки [[тут]] остались') === 'Открыла. Массив [1] и скобки [[тут]] остались')
  t('протокол: выполняются только строго оформленные блоки',
    parseActions('[[kira:open_app|steam]] [[Kira:open_app|x]] [[kira: open_app|y]]').length === 1)

  // ─── Офлайн-разум: настройка может расходиться с диском ───────────────────
  /*
   * Проверено на живой машине: preferLocal включён, в настройках «llama3.1»,
   * а скачан qwen3:4b. Запрос уходил на несуществующий тег, Ollama отвечала
   * 404 — и Kira «переключалась на glm», хотя разум на компьютере был готов.
   * Правда о модели живёт на диске, а не в настройке.
   */
  t('офлайн-разум: скачанное важнее записанного',
    resolveLocalModel('llama3.1', ['qwen3:4b']) === 'qwen3:4b')
  t('офлайн-разум: записанное уважается, если оно есть',
    resolveLocalModel('qwen3:8b', ['qwen3:4b', 'qwen3:8b']) === 'qwen3:8b')
  t('офлайн-разум: неявный :latest — то же самое',
    resolveLocalModel('qwen3:8b', ['qwen3:8b:latest', 'qwen3:8b']) === 'qwen3:8b')
  t('офлайн-разум: из нескольких берём самую сильную знакомую',
    resolveLocalModel('нет-такой', ['qwen3:1.7b', 'qwen3:8b']) === 'qwen3:8b')
  t('офлайн-разум: ничего не скачано — не выдумываем',
    resolveLocalModel('qwen3:8b', []) === 'qwen3:8b')

  // ─── Что ядро научилось делать само ───────────────────────────────────────
  /*
   * Всё перечисленное модули Kira умели давно, но наружу выведено не было:
   * каждая такая просьба уходила в облако вместе с содержимым — именем файла,
   * текстом заметки, тем, о чём просят напомнить. Проверяем, что теперь это
   * обычные локальные команды.
   */
  const nowLocal: Array<[string, string]> = [
    ['сколько будет 15 умножить на 7', 'calculate'],
    ['посчитай 20% от 350', 'calculate'],
    ['переведи hello на русский', 'translate'],
    ['запиши в заметки купить хлеб', 'note_add'],
    ['покажи мои заметки', 'notes_list'],
    ['напомни через час позвонить маме', 'remind'],
    ['напомни позвонить врачу через 30 минут', 'remind'],
    ['покажи напоминания', 'reminders_list'],
    ['найди файл отчет', 'find_file'],
    ['создай файл заметки.txt', 'create_file'],
    ['смени обои', 'set_wallpaper'],
    ['убей процесс chrome', 'kill_process']
  ]
  for (const [phrase, want] of nowLocal) {
    const got = parseIntent(phrase, specs, vocab)
    t(`ядро само: «${phrase}» → ${want}`,
      got.kind === 'local' && got.actionId === want,
      '-> ' + (got.kind === 'local' ? got.actionId : got.kind))
  }

  // Счёт: словами, знаками, процентами — и осторожность там, где это не счёт.
  const math: Array<[string, string]> = [
    ['сколько будет 15 умножить на 7', '105'],
    ['2+2*3', '8'],
    ['20% от 350', '70'],
    ['100 разделить на 4', '25'],
    ['2 в степени 10', '1024'],
    ['корень из 144', '12'],
    ['3,5 плюс 1,5', '5']
  ]
  for (const [expr, want] of math) {
    const r = calculate(expr)
    t(`счёт: «${expr}» = ${want}`, r.ok && r.message.endsWith('= ' + want), '-> ' + r.message)
  }
  t('счёт: на ноль делить нельзя', calculate('10 разделить на 0').ok === false)
  t('счёт: «сколько будет стоить ремонт» — не выражение',
    looksLikeMath('сколько будет стоить ремонт') === false)
  // выражение приходит из голоса и чата, то есть снаружи: ничего, кроме чисел
  // и четырёх действий, разбор принимать не должен
  t('счёт: посторонний код не исполняется',
    calculate('process.exit(1)').ok === false && calculate('2+2;alert(1)').ok === false)
  const bigVol = await commandEngine.tryHandle('сколько будет 15 умножить на 7', { source: 'chat' })
  t('счёт: ядро отвечает без облака',
    !!(bigVol.handled && bigVol.result?.ok && (bigVol.reply ?? '').includes('105')), '-> ' + bigVol.reply)

  /*
   * Напоминания: время может стоять и до просьбы, и после, а само указание
   * времени должно разбираться ЦЕЛИКОМ. Первый вариант шаблона откусывал
   * только «завтра», и «завтра в 9» вставало на девять утра по умолчанию —
   * совпало случайно, а «завтра в 18» встало бы на девять.
   */
  const whenCases: Array<[string, string, string]> = [
    ['напомни через час позвонить маме', 'через час', 'позвонить маме'],
    ['напомни завтра в 9 про встречу', 'завтра в 9', 'про встречу'],
    ['напомни позвонить врачу через 30 минут', 'через 30 минут', 'позвонить врачу'],
    ['напомни сегодня вечером полить цветы', 'сегодня вечером', 'полить цветы'],
    ['напомни в 18:30 забрать посылку', 'в 18:30', 'забрать посылку']
  ]
  for (const [phrase, wantWhen, wantText] of whenCases) {
    const got = parseIntent(phrase, specs, vocab)
    const when = got.kind === 'local' ? (got.args.when || got.args.when2 || '') : ''
    const text = got.kind === 'local' ? (got.args.text || got.args.text2 || '') : ''
    t(`напоминание: «${phrase}»`,
      when === wantWhen && text === wantText && parseWhen(when) !== null,
      `-> когда=${JSON.stringify(when)} что=${JSON.stringify(text)}`)
  }
  // «вечером» без часа раньше не разбиралось вовсе — самая обиходная форма
  const evening = parseWhen('сегодня вечером')
  t('напоминание: «вечером» — это 19 часов',
    evening !== null && new Date(evening).getHours() === 19)

  const hist = actionHistory.list(20)
  t('история фиксирует действия', hist.length >= 4, 'записей: ' + hist.length)
  t('шина событий работает', busCount >= 3, 'событий: ' + busCount)

  try { fs.rmSync(path.join(desktop, stamp), { recursive: true, force: true }) } catch { /* ignore */ }

  console.log('\n=== ИТОГО: ' + pass + ' PASS, ' + fail + ' FAIL ===')
  process.exit(fail ? 1 : 0)
}
void level2()
