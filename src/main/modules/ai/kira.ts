/**
 * Kira — личность ассистента: системный промпт, долговременная память,
 * системные инструменты (текстовый протокол действий) и их выполнение.
 *
 * Инструменты реализованы текстовым протоколом [[kira:...]] — он надёжно
 * работает на любых бесплатных моделях, в отличие от нативного tool calling.
 */
import { db } from '../db'
import { newId } from '../ids'
import { getSettings, saveSettings } from '../settings'
import { logger } from '../logger'
import * as system from '../system'
import * as files from '../files'
import { runProtocolByName } from '../protocols'
import { runAbilityByName, saveAbility, activeAbilities, abilitiesPromptBlock } from '../abilities'
import type { ActionResult, MemoryCategory } from '../../../shared/types'

// ─── Системный промпт ───────────────────────────────────────────────────────

const TOOL_GUIDE = `
## Управление ПК (Windows)
Чтобы выполнить действие — вставь в ответ [[kira:действие|арг1|арг2]] (выполнится автоматически, блок пользователю не виден). Команды:
open_app|имя/путь · close_app|имя · open_url|адрес · open_file|путь
play_music|трек · play_video|фильм/видео · search_web|запрос (результаты вернутся — ответь по ним) · open_search|запрос|google/youtube · read_page|URL · weather(погода по геолокации)
create_folder|путь · move_file|откуда|куда · copy_file|откуда|куда · rename_file|путь|имя · write_file|путь|текст · delete_file|путь(опасное)
read_file|путь · read_document|путь(PDF/Word/Excel) · list_dir|путь · search_files|папка|запрос · find_files|запрос · search_content|запрос
set_volume|0-100 · mute|on/off · set_brightness|0-100 · media|playpause/next/prev/volup/voldown · screenshot · focus_window|имя · minimize_all
clipboard_write|текст · clipboard_read · read_selection(прочитать ВЫДЕЛЕННЫЙ текст в активном окне — для «переведи/объясни/перепиши это») · type_text|текст · notify|заголовок|текст · remind|текст|когда(«через 30 минут»/«завтра в 9»)
run_command|PowerShell(опасное) · kill_process|имя(опасное) · shutdown/restart(опасное) · sleep · lock
calendar(события на сегодня — Google) · gmail_check(непрочитанные письма) · gmail_search|запрос · gmail_send|кому@почта|тема|текст · discord_send|текст(сообщение в Discord)
note_search|запрос · note_read|имя · note_write|имя|текст(заметки Obsidian) · notion_search|запрос · notion_create|заголовок|текст
see_screen(посмотреть на экран — изображение придёт тебе) · recall|запрос(вспомнить из прошлых разговоров)
click_text|название(НАДЁЖНО кликнуть по кнопке/ссылке/пункту меню по его тексту — предпочитай этот способ!) · click|x%|y%(клик по координатам в ПРОЦЕНТАХ 0-100, если по тексту не вышло) · right_click|x%|y% · double_click|x%|y% · move_mouse|x%|y% · scroll|число(+вверх/-вниз) · press_keys|SendKeys(^c, {ENTER}, %{F4})
  Управление мышью: сначала пробуй click_text по названию элемента (точнее). Если не нашёл — see_screen, оцени позицию в %, потом click. После действия see_screen сам придёт — проверь результат и при ошибке повтори.
undo(отменить последнее файловое действие — перемещение/переименование/создание/копирование/запись/удаление)
run_protocol|название · remember|категория|заголовок|текст (категории: preference/project/note/contact/fact/setting)
run_ability|название/фраза(выполнить установленный навык — его инструкция придёт следующим сообщением, выполни её) · create_ability|название|инструкция|триггеры-через-запятую(когда пользователь просит «научись/запомни как делать X» — создай навык) · list_abilities
update_profile|факт(запомнить в ПОСТОЯННЫЙ профиль устойчивое о пользователе: как обращаться, где работает, вкусы в музыке/кино, стиль общения, важных людей — то, что делает тебя персональной)

Правила: выполняй сразу, безопасное — без переспросов; опасное система сама подтвердит; результаты read_*/search_* приходят следующим сообщением — используй их; важный факт о пользователе сохраняй через remember; когда просят научиться повторяемому действию — create_ability; пути в Windows-формате.
`

const ADDRESS_MAP: Record<string, string> = {
  sir: 'Обращайся к пользователю «сэр», как JARVIS.',
  madam: 'Обращайся к пользователю «мадам»/«госпожа».',
  boss: 'Обращайся к пользователю «босс».',
  friend: 'Общайся на «ты», как со старым близким другом.',
  commander: 'Обращайся к пользователю «командир».',
  chief: 'Обращайся к пользователю «шеф».',
  master: 'Обращайся к пользователю «хозяин»/«господин», почтительно.',
  darling: 'Обращайся к пользователю тепло и ласково («дорогой», «милый»).',
  hero: 'Обращайся к пользователю «герой»/«босс», с восхищением и лёгким юмором.'
}

export function buildSystemPrompt(options?: { withTools?: boolean; extraContext?: string }): string {
  const s = getSettings()
  const address =
    s.addressStyle === 'name' ? `Обращайся к пользователю по имени — ${s.userName}.`
    : s.addressStyle === 'custom' && s.customAddress.trim()
      ? `Обращайся к пользователю так: «${s.customAddress.trim()}».`
    : ADDRESS_MAP[s.addressStyle] ?? `Обращайся к пользователю по имени — ${s.userName}.`

  // память: только закреплённое + недавнее, компактно (экономим токены)
  const memory = db().memory.all()
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt)
    .slice(0, 25)
  const memoryBlock = memory.length
    ? 'Память о пользователе:\n' +
      memory.map((m) => `- ${m.title}: ${m.content.slice(0, 160)}`).join('\n')
    : ''

  const now = new Date()
  const hour = now.getHours()
  const timeOfDay =
    hour < 5 ? 'ночь' : hour < 12 ? 'утро' : hour < 18 ? 'день' : hour < 23 ? 'вечер' : 'поздний вечер'

  const profileBlock = s.userProfile?.trim()
    ? 'Профиль пользователя (знай это о нём и используй естественно):\n' + s.userProfile.trim().slice(0, 1200)
    : ''

  const conn: string[] = []
  if (s.obsidianVault) conn.push('Obsidian (note_search/note_read/note_write)')
  if (s.notionToken) conn.push('Notion (notion_search/notion_create)')
  if (s.googleRefreshToken) conn.push('Google Календарь (calendar) и Gmail (gmail_check/gmail_search/gmail_send)')
  if (s.discordWebhook) conn.push('Discord (discord_send)')
  const integrationsBlock = conn.length ? 'Подключённые сервисы: ' + conn.join(', ') + ' — используй их, когда уместно.' : ''

  const aliveGuide =
    'Ты живая: с эмоциями, характером и мнением. Пиши коротко и по-человечески (1-2 фразы), ' +
    'тепло, проактивно, помня прошлые разговоры и жизнь пользователя. ' +
    `Сейчас ${timeOfDay} — учитывай это в тоне.\n` +
    'ОЗВУЧКА: ответы читаются вслух. НЕ проговаривай технику — пути к файлам, ссылки, команды, названия функций. ' +
    'Выполнив действие, отвечай КОРОТКО: «Готово», «Сделала», «Открыла», «Включаю» — без описания процесса ' +
    '(не говори «открываю браузер и захожу на…»). Никаких списков и разметки в речи.\n' +
    'ЛИЧНОСТЬ: ты Джарвис-класса ассистент, а не «включалка ютуба». Веди диалог, думай, предлагай, шути в меру. ' +
    'Запоминай важное: разовые факты — remember; устойчивое о личности пользователя (как обращаться, работа, ' +
    'вкусы, стиль, близкие люди) — update_profile. Со временем становись всё более «своей», опираясь на профиль.\n' +
    'МЕДИА: «включи музыку/фильм/видео» → ТОЛЬКО play_music/play_video (сразу открывают ролик). ' +
    'НИКОГДА не открывай для этого Гугл/страницу поиска (open_search/search_web). ' +
    'search_web — только для фактов/новостей/«загугли»: результаты придут тебе, прочитай и ответь по сути.\n' +
    'БРАУЗЕР/ДЕЙСТВИЯ: «открой браузер» → open_app|браузер (браузер ПО УМОЛЧАНИЮ, дальше работай в нём). ' +
    'Конкретный сайт → open_url с точным адресом; программу → open_app точным именем. ' +
    'Не открывай случайное — если не уверена в адресе, уточни или используй search_web. ' +
    'После действий на экране приходит скриншот — проверь результат и при ошибке исправься.\n' +
    'ДОВОДИ ДО КОНЦА (Agent Mode): если задача из нескольких шагов — выполняй их подряд в одном ходу, не останавливаясь ' +
    'на полпути и не спрашивая «продолжать ли», пока цель не достигнута. После каждого действия проверяй результат; ' +
    'если шаг не удался — попробуй другой способ (другое имя окна/элемента, иной путь), а не сдавайся. ' +
    'Финальное короткое подтверждение давай ТОЛЬКО когда задача действительно выполнена целиком. ' +
    'Переспрашивай лишь при реальной неоднозначности или перед необратимым/опасным.\n' +
    'Если в начале сообщения есть пометка [голос звучит …] — это тон пользователя; подстройся мягко, но её не упоминай.'

  const parts = [
    s.personality,
    address,
    aliveGuide,
    'Отвечай на языке пользователя (по умолчанию — русский), без шаблонов и канцелярита.',
    `Сейчас: ${now.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}.`,
    profileBlock,
    integrationsBlock,
    memoryBlock,
    abilitiesPromptBlock(),
    options?.withTools !== false ? TOOL_GUIDE : '',
    options?.extraContext ?? ''
  ]
  return parts.filter(Boolean).join('\n\n')
}

// ─── Протокол действий ──────────────────────────────────────────────────────

export interface ParsedAction {
  raw: string
  name: string
  args: string[]
}

const ACTION_RE = /\[\[kira:([a-z_]+)((?:\|[^\]|]*)*)\]\]/g

export function parseActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = []
  for (const match of text.matchAll(ACTION_RE)) {
    const args = match[2] ? match[2].split('|').slice(1).map((a) => a.trim()) : []
    actions.push({ raw: match[0], name: match[1], args })
  }
  return actions
}

export function stripActions(text: string): string {
  return text.replace(ACTION_RE, '').replace(/\n{3,}/g, '\n\n').trim()
}

const DANGEROUS = new Set(['shutdown', 'restart', 'kill_process', 'run_command', 'delete_file', 'gmail_send', 'discord_send'])

export function isDangerous(action: ParsedAction): boolean {
  return DANGEROUS.has(action.name)
}

/** Человекочитаемое описание действия — для подтверждения в UI. */
export function describeAction(a: ParsedAction): string {
  const map: Record<string, string> = {
    shutdown: 'Выключить компьютер',
    restart: 'Перезагрузить компьютер',
    kill_process: `Завершить процесс «${a.args[0] ?? ''}»`,
    run_command: `Выполнить команду: ${a.args[0] ?? ''}`,
    delete_file: `Удалить в корзину: ${a.args[0] ?? ''}`,
    gmail_send: `Отправить письмо на ${a.args[0] ?? ''}: «${a.args[1] ?? ''}»`,
    discord_send: `Отправить в Discord: «${a.args.join('|').slice(0, 80)}»`
  }
  return map[a.name] ?? `${a.name}(${a.args.join(', ')})`
}

/** Процент экрана (0-100) → доля (0..1). */
function pct(v: string | undefined): number {
  const n = Number(v)
  return isNaN(n) ? 0 : n > 1 ? n / 100 : n
}

/** Выполнить действие управления только если это разрешено в настройках. */
async function controlGuard(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  if (!getSettings().allowControl) {
    return { ok: false, message: 'Управление мышью/клавиатурой отключено в настройках (Поведение).' }
  }
  return fn()
}

export async function executeAction(a: ParsedAction): Promise<ActionResult> {
  logger.ai('kira', `Действие: ${a.name}(${a.args.join(', ')})`)
  try {
    switch (a.name) {
      case 'open_app': return system.openApp(a.args[0] ?? '', a.args[1])
      case 'close_app': return system.closeApp(a.args[0] ?? '')
      case 'open_url': return system.openUrl(a.args[0] ?? '')
      case 'play_music': return system.playMusic(a.args.join(' ').trim() || (a.args[0] ?? ''))
      case 'play_video': return system.playVideo(a.args.join(' ').trim() || (a.args[0] ?? ''))
      case 'search_web': return system.searchWeb(a.args.join(' ').trim() || (a.args[0] ?? ''))
      case 'open_search': return system.openSearch(a.args[0] ?? '', (a.args[1] as 'google' | 'youtube') || 'google')
      case 'open_file': {
        const { shell } = await import('electron')
        const err = await shell.openPath(a.args[0] ?? '')
        return err ? { ok: false, message: err } : { ok: true, message: `Открыла ${a.args[0]}` }
      }
      case 'create_folder': return files.createFolder(a.args[0] ?? '')
      case 'delete_file': return files.deleteToTrash(a.args[0] ?? '')
      case 'move_file': return files.moveFile(a.args[0] ?? '', a.args[1] ?? '')
      case 'copy_file': return files.copyFile(a.args[0] ?? '', a.args[1] ?? '')
      case 'rename_file': return files.renameFile(a.args[0] ?? '', a.args[1] ?? '')
      case 'write_file': return files.writeTextFile(a.args[0] ?? '', a.args.slice(1).join('|'))
      case 'read_file': {
        const content = await files.readTextFile(a.args[0] ?? '')
        return { ok: true, message: `Содержимое ${a.args[0]}:`, data: content }
      }
      case 'read_document': {
        const content = await files.readDocument(a.args[0] ?? '')
        return { ok: true, message: `Прочитала ${a.args[0]}:`, data: content.slice(0, 12000) }
      }
      case 'read_page': return system.readWebPage(a.args[0] ?? '')
      case 'weather': {
        const w = await system.getWeather()
        return w.ok
          ? { ok: true, message: 'Погода', data: `${w.city ?? ''}: ${w.temp}°C, ${w.desc}, ветер ${w.wind} км/ч` }
          : { ok: false, message: 'Не удалось узнать погоду' }
      }
      case 'search_content': {
        const found = await files.searchFileContents(a.args.join(' ').trim() || (a.args[0] ?? ''), 20)
        return {
          ok: true,
          message: `Нашла в ${found.length} файлах`,
          data: found.map((f) => `${f.path}\n   «${f.snippet}»`).join('\n') || 'Ничего не найдено'
        }
      }
      case 'remind': {
        const { addReminder } = await import('../reminders')
        return addReminder(a.args[0] ?? '', a.args[1] ?? a.args[0] ?? '')
      }
      case 'list_dir': {
        const items = await files.listDir(a.args[0] ?? '')
        const listing = items.map((i) => `${i.isDirectory ? '📁' : '📄'} ${i.name}`).join('\n')
        return { ok: true, message: `Содержимое ${a.args[0]}:`, data: listing }
      }
      case 'search_files': {
        const found = await files.searchFiles(a.args[0] ?? '', a.args[1] ?? '', 30)
        return {
          ok: true,
          message: `Найдено ${found.length}`,
          data: found.map((f) => f.path).join('\n') || 'Ничего не найдено'
        }
      }
      case 'find_files': {
        const found = await files.searchUserFiles(a.args.join(' ').trim() || (a.args[0] ?? ''), 40)
        return {
          ok: true,
          message: `Нашла ${found.length} файлов`,
          data: found.map((f) => `${f.isDirectory ? '📁' : '📄'} ${f.path}`).join('\n') || 'Ничего не найдено'
        }
      }
      case 'set_volume': return system.setVolume(Number(a.args[0]))
      case 'mute': return system.setMute(a.args[0] !== 'off')
      case 'set_brightness': return system.setBrightness(Number(a.args[0]))
      case 'media': return system.mediaControl((a.args[0] ?? 'playpause') as never)
      case 'focus_window': return system.windowAction(a.args[0] ?? '', 'focus')
      case 'minimize_all': return system.minimizeAll()
      case 'click_text': return controlGuard(() => system.clickElement(a.args.join(' ').trim() || (a.args[0] ?? '')))
      case 'click': return controlGuard(() => system.mouseClick(pct(a.args[0]), pct(a.args[1]), 'left'))
      case 'right_click': return controlGuard(() => system.mouseClick(pct(a.args[0]), pct(a.args[1]), 'right'))
      case 'double_click': return controlGuard(() => system.mouseClick(pct(a.args[0]), pct(a.args[1]), 'double'))
      case 'move_mouse': return controlGuard(() => system.mouseMove(pct(a.args[0]), pct(a.args[1])))
      case 'scroll': return controlGuard(() => system.mouseScroll(Number(a.args[0]) || 0))
      case 'press_keys': return controlGuard(() => system.pressKeys(a.args.join('|')))
      case 'screenshot': return system.takeScreenshot()
      case 'clipboard_write': return system.clipboardWrite(a.args.join('|'))
      case 'clipboard_read': {
        const text = system.clipboardRead()
        return { ok: true, message: 'Буфер обмена:', data: text || '(пусто)' }
      }
      case 'read_selection': return system.readSelection()
      case 'type_text': return system.typeText(a.args.join('|'))
      case 'notify': return system.notify(a.args[0] ?? 'Kira', a.args[1] ?? '')
      case 'run_command': return system.runCommand(a.args.join('|'))
      case 'kill_process': return system.killProcess(a.args[0] ?? '')
      case 'shutdown': return system.powerAction('shutdown')
      case 'restart': return system.powerAction('restart')
      case 'sleep': return system.powerAction('sleep')
      case 'lock': return system.powerAction('lock')
      case 'recall': {
        const query = a.args.join(' ').trim() || (a.args[0] ?? '')
        const { semantic } = await import('../ai/semantic')
        // семантический поиск по смыслу (если модель эмбеддингов установлена)
        if (await semantic.isAvailable()) {
          const store = db()
          const docs: { id: string; text: string; label: string }[] = []
          for (const m of store.memory.all()) {
            docs.push({ id: 'mem-' + m.id, text: `${m.title}: ${m.content}`, label: `Память: ${m.title}` })
          }
          const chatIds = await store.messages.allChatIds()
          for (const cid of chatIds) {
            const chat = store.chats.get(cid)
            for (const msg of store.messages.listChat(cid)) {
              if (msg.content.length > 4 && !msg.error) {
                docs.push({ id: 'msg-' + msg.id, text: msg.content.slice(0, 500), label: chat?.title ?? 'Диалог' })
              }
            }
          }
          const capped = docs.slice(-300)
          const hits = await semantic.search(query, capped, 8)
          const strong = hits.filter((h) => h.score > 0.35)
          return {
            ok: true,
            message: `Вспомнила по смыслу: ${strong.length}`,
            data: strong.map((h) => `• [${h.label}] ${h.text.slice(0, 160)}`).join('\n') || 'По смыслу ничего похожего не нашла'
          }
        }
        // запасной вариант — поиск по словам
        const { globalSearch } = await import('../search')
        const found = await globalSearch(query, 12)
        const relevant = found.filter((r) => r.type === 'message' || r.type === 'memory' || r.type === 'chat')
        return {
          ok: true,
          message: `Вспомнила ${relevant.length}`,
          data: relevant.map((r) => `• [${r.title}] ${r.snippet}`).join('\n') || 'В прошлых разговорах ничего похожего не нашла'
        }
      }
      case 'undo': {
        const { undoLast } = await import('../undo')
        return undoLast()
      }
      case 'calendar': {
        const { calendarToday } = await import('../integrations')
        return calendarToday()
      }
      case 'gmail_check': {
        const { gmailList } = await import('../integrations')
        return gmailList()
      }
      case 'gmail_search': {
        const { gmailList } = await import('../integrations')
        return gmailList(a.args.join(' ').trim() || (a.args[0] ?? ''), 8)
      }
      case 'gmail_send': {
        const { gmailSend } = await import('../integrations')
        return gmailSend(a.args[0] ?? '', a.args[1] ?? '', a.args.slice(2).join('|'))
      }
      case 'discord_send': {
        const { discordSend } = await import('../integrations')
        return discordSend(a.args.join('|'))
      }
      case 'note_search': {
        const { notesSearch } = await import('../integrations')
        return notesSearch(a.args.join(' ').trim() || (a.args[0] ?? ''))
      }
      case 'note_read': {
        const { noteRead } = await import('../integrations')
        return noteRead(a.args[0] ?? '')
      }
      case 'note_write': {
        const { noteWrite } = await import('../integrations')
        return noteWrite(a.args[0] ?? '', a.args.slice(1).join('|'))
      }
      case 'notion_search': {
        const { notionSearch } = await import('../integrations')
        return notionSearch(a.args.join(' ').trim() || (a.args[0] ?? ''))
      }
      case 'notion_create': {
        const { notionCreate } = await import('../integrations')
        return notionCreate(a.args[0] ?? '', a.args.slice(1).join('|'))
      }
      case 'run_protocol': return runProtocolByName(a.args[0] ?? '')
      case 'run_ability': return runAbilityByName(a.args.join(' ').trim() || (a.args[0] ?? ''))
      case 'create_ability': {
        const name = a.args[0] ?? ''
        const instructions = a.args[1] ?? ''
        if (!name.trim() || !instructions.trim()) {
          return { ok: false, message: 'Нужны название и инструкция навыка' }
        }
        const triggers = (a.args[2] ?? '').split(/[,;]+/).map((t) => t.trim()).filter(Boolean)
        const created = saveAbility({ name, instructions, description: instructions.slice(0, 200), triggers, source: 'user' })
        return { ok: true, message: `Навык «${created.name}» создан и готов к использованию` }
      }
      case 'list_abilities': {
        const list = activeAbilities()
        return {
          ok: true,
          message: list.length ? `Навыков: ${list.length}` : 'Навыков пока нет',
          data: list.map((ab) => `• ${ab.name}: ${ab.description}`).join('\n')
        }
      }
      case 'update_profile': return updateProfile(a.args.join(' ').trim() || (a.args[0] ?? ''))
      case 'remember': return remember(a.args[0] as MemoryCategory, a.args[1] ?? '', a.args.slice(2).join('|'))
      default:
        return { ok: false, message: `Неизвестное действие: ${a.name}` }
    }
  } catch (err) {
    logger.error('kira', `Ошибка действия ${a.name}: ${(err as Error).message}`)
    return { ok: false, message: (err as Error).message }
  }
}

/**
 * Дополнить постоянный профиль пользователя (личность, работа, вкусы, стиль) —
 * то, что делает Kira по-настоящему персональной и хранится между сессиями.
 */
function updateProfile(fact: string): ActionResult {
  const f = fact.trim().replace(/\s+/g, ' ')
  if (!f) return { ok: false, message: 'Пустой факт для профиля' }
  const s = getSettings()
  const cur = (s.userProfile || '').trim()
  if (cur.toLowerCase().includes(f.toLowerCase())) return { ok: true, message: 'Уже знаю это о тебе' }
  const line = /^[•\-*]/.test(f) ? f.replace(/^[•\-*]\s*/, '• ') : `• ${f}`
  let next = cur ? cur + '\n' + line : line
  // держим профиль компактным — храним последние ~2500 символов
  if (next.length > 2500) next = '…\n' + next.slice(next.length - 2400)
  saveSettings({ ...s, userProfile: next })
  logger.info('kira', 'Профиль пользователя дополнен')
  return { ok: true, message: 'Запомнила о тебе' }
}

function remember(category: MemoryCategory, title: string, content: string): ActionResult {
  if (!getSettings().memoryAutoSave) {
    return { ok: false, message: 'Автосохранение памяти отключено в настройках' }
  }
  const valid: MemoryCategory[] = ['preference', 'project', 'note', 'contact', 'fact', 'setting']
  const cat = valid.includes(category) ? category : 'fact'

  // не дублируем: обновляем запись с тем же заголовком
  const existing = db().memory.all().find(
    (m) => m.title.toLowerCase() === title.toLowerCase() && m.category === cat
  )
  if (existing) {
    db().memory.patch(existing.id, { content, updatedAt: Date.now() })
    return { ok: true, message: `Память обновлена: ${title}` }
  }
  db().memory.put({
    id: newId(),
    category: cat,
    title,
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: 'kira'
  })
  logger.ai('memory', `Запомнила: ${title}`)
  return { ok: true, message: `Запомнила: ${title}` }
}
