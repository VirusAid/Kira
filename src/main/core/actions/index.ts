/**
 * Action API — все возможности Kira, оформленные единообразно.
 *
 * ВАЖЕН ПОРЯДОК: реестр сопоставляет паттерны в порядке регистрации,
 * поэтому специфичные действия (браузер, музыка, диспетчер задач) идут
 * раньше универсального запуска приложений.
 *
 * Новое действие = ещё один объект в этом массиве. Движок, реестр, интенты,
 * LLM-протокол и история подхватывают его автоматически.
 */
import {
  ApplicationController, BrowserController, ClipboardController, DiagnosticsController, FileController,
  GitController, InputController, KnowledgeController, MediaController, NotificationController,
  PowerController, SearchController, SnippetController, SystemController, UtilityController,
  WindowController, knownFolder
} from '../controllers'
import type { KiraAction } from '../types'

/** Число из строки, устойчивое к запятой/мусору: «5,5» → 5.5. */
function toNum(v: string | undefined): number {
  return Number(String(v ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN)
}

/** Длительность таймера из числа + единицы в миллисекунды. */
function durationMs(dur: string, unit: string): number {
  const n = toNum(dur)
  const u = unit.toLowerCase()
  const mult = /^ч/.test(u) ? 3600_000 : /^с/.test(u) ? 1000 : 60_000
  return n * mult
}

const APP_STOPWORDS = /(^| )(сайт|страницу|файл|папку|музыку|песню|трек|фильм|видео|звук|громкость|свет|окно|его|ее|это|мой|моя|мое)( |$)/

/** Путь папки для create_folder — ЕДИНАЯ логика для execute и undo. */
function folderPath(a: Record<string, string>): string {
  const base = a.place?.includes('загрузк') ? knownFolder('загрузки')
    : a.place?.includes('документ') ? knownFolder('документы')
    : knownFolder('рабочий стол')
  return /^[a-z]:\\/i.test(a.name ?? '') ? (a.name ?? '') : `${base}\\${a.name ?? ''}`
}

export const actions: KiraAction[] = [
  // ─── Браузер и веб ────────────────────────────────────────────────────────
  {
    id: 'open_browser',
    title: 'Открыть браузер',
    description: 'Открывает браузер по умолчанию',
    category: 'browser',
    aliases: ['browser', 'браузер', 'хром', 'chrome', 'интернет'],
    patterns: [/^(?:открой|запусти|включи)\s+(?:браузер|хром|chrome|интернет)$/],
    examples: ['открой браузер'],
    phrases: ['запусти браузер', 'открой интернет', 'зайди в интернет', 'открой веб', 'дай интернет'],
    args: [],
    execute: () => BrowserController.openDefault(),
    confirmText: () => 'Открываю браузер'
  },
  {
    id: 'open_url',
    title: 'Открыть сайт',
    description: 'Открывает сайт по адресу или известному имени',
    category: 'browser',
    aliases: ['url', 'сайт', 'site'],
    patterns: [
      /^(?:открой|зайди на|перейди на)\s+(?:сайт\s+)?(?<url>[a-z0-9а-я][a-z0-9а-я.-]*\.[a-zа-я]{2,}(?:\/\S*)?)$/,
      /^(?:открой|зайди на|перейди на)\s+сайт\s+(?<url>\S+)$/
    ],
    examples: ['открой youtube.com', 'зайди на github.com'],
    args: [{ name: 'url', description: 'Адрес сайта', required: true }],
    softFail: true,
    execute: (a) => BrowserController.openUrl(a.url ?? ''),
    confirmText: () => 'Открываю'
  },

  // ─── Медиа ────────────────────────────────────────────────────────────────
  {
    id: 'play_music',
    title: 'Включить музыку',
    description: 'Находит и включает трек/исполнителя (YouTube)',
    category: 'media',
    aliases: ['музыка', 'music'],
    patterns: [/^(?:включи|поставь|сыграй|запусти)\s+(?:музыку|песню|трек)(?:\s+(?<query>(?!на\s+паузу$).+))?$/],
    examples: ['включи музыку', 'поставь трек Believer'],
    args: [{ name: 'query', description: 'Что включить' }],
    execute: (a) => MediaController.playMusic(a.query ?? 'популярная музыка'),
    confirmText: () => 'Включаю'
  },
  {
    id: 'play_video',
    title: 'Включить видео/фильм',
    description: 'Находит и включает видео или фильм (YouTube)',
    category: 'media',
    aliases: ['видео', 'фильм', 'video'],
    patterns: [/^(?:включи|поставь|запусти|найди и включи)\s+(?:фильм|видео|клип|сериал)\s+(?<query>.+)$/],
    examples: ['включи фильм Интерстеллар'],
    args: [{ name: 'query', description: 'Что включить', required: true }],
    execute: (a) => MediaController.playVideo(a.query ?? ''),
    confirmText: () => 'Включаю'
  },
  {
    id: 'media_pause',
    title: 'Пауза/продолжить',
    description: 'Пауза или возобновление воспроизведения',
    category: 'media',
    aliases: ['пауза', 'pause', 'плей', 'play'],
    patterns: [/^(?:пауза|поставь(?:\s+музыку)?\s+на\s+паузу|продолжи|возобнови|стоп\s+музыка|останови\s+музыку|выключи\s+музыку|плей)$/],
    examples: ['пауза', 'продолжи'],
    phrases: ['выключи музыку', 'останови музыку', 'поставь на паузу', 'заглуши музыку', 'хватит музыки', 'продолжи воспроизведение'],
    args: [],
    execute: () => MediaController.playPause(),
    confirmText: () => 'Готово'
  },
  {
    id: 'media_next',
    title: 'Следующий трек',
    description: 'Переключает на следующий трек',
    category: 'media',
    aliases: ['next', 'следующий'],
    patterns: [/^(?:следующий(?:\s+трек)?|переключи(?:\s+трек)?|дальше|некст)$/],
    examples: ['следующий трек'],
    phrases: ['переключи песню', 'давай следующую', 'смени трек', 'листай дальше', 'другую песню'],
    args: [],
    execute: () => MediaController.next(),
    confirmText: () => 'Переключаю'
  },
  {
    id: 'media_prev',
    title: 'Предыдущий трек',
    description: 'Возвращает предыдущий трек',
    category: 'media',
    aliases: ['prev', 'предыдущий'],
    patterns: [/^(?:предыдущий(?:\s+трек)?|трек назад|верни трек)$/],
    examples: ['предыдущий трек'],
    phrases: ['верни прошлую песню', 'предыдущая композиция', 'трек назад', 'вернись к прошлому треку'],
    args: [],
    execute: () => MediaController.previous(),
    confirmText: () => 'Возвращаю'
  },
  {
    id: 'volume_up',
    title: 'Громче',
    description: 'Увеличивает громкость',
    category: 'media',
    aliases: ['громче', 'volume up'],
    patterns: [/^(?:громче|сделай (?:по)?громче|прибавь(?:\s+звук|\s+громкость)?)$/],
    examples: ['громче'],
    phrases: ['сделай погромче', 'добавь звука', 'прибавь громкость', 'плохо слышно', 'увеличь звук'],
    args: [],
    execute: () => MediaController.volumeUp(),
    confirmText: () => 'Громче'
  },
  {
    id: 'volume_down',
    title: 'Тише',
    description: 'Уменьшает громкость',
    category: 'media',
    aliases: ['тише', 'volume down'],
    patterns: [/^(?:тише|сделай (?:по)?тише|убавь(?:\s+звук|\s+громкость)?)$/],
    examples: ['тише'],
    phrases: ['сделай потише', 'убавь звук', 'слишком громко', 'уменьши громкость', 'приглуши немного'],
    args: [],
    execute: () => MediaController.volumeDown(),
    confirmText: () => 'Тише'
  },
  {
    id: 'set_volume',
    title: 'Установить громкость',
    description: 'Ставит громкость в процентах (0–100)',
    category: 'media',
    aliases: ['громкость', 'volume'],
    patterns: [
      /^(?:громкость|звук)\s+(?:на\s+)?(?<level>\d{1,3})(?:\s*%|\s+процентов)?$/,
      /^(?:громкость|звук)\s+на\s+(?<preset>максимум|полную|всю|минимум)$/
    ],
    examples: ['громкость 50', 'звук на максимум'],
    args: [
      { name: 'level', description: 'Процент 0–100' },
      { name: 'preset', description: 'максимум/минимум' }
    ],
    validate: (a) => {
      if (a.preset) return null
      return Number(a.level) >= 0 && Number(a.level) <= 100 ? null : 'Громкость — число 0–100'
    },
    execute: (a) => {
      const level = a.preset ? (a.preset === 'минимум' ? 0 : 100) : Number(a.level)
      return MediaController.setVolume(level)
    },
    confirmText: (a) => (a.preset ? `Громкость на ${a.preset}` : `Громкость ${a.level}%`)
  },
  {
    id: 'mute',
    title: 'Выключить звук',
    description: 'Отключает звук',
    category: 'media',
    aliases: ['mute', 'без звука'],
    patterns: [/^(?:выключи|отключи|убери)\s+звук$/],
    examples: ['выключи звук'],
    phrases: ['убери звук', 'отключи звук', 'заглуши всё', 'без звука', 'сделай тихо совсем'],
    args: [],
    execute: () => MediaController.mute(true),
    undo: () => MediaController.mute(false),
    confirmText: () => 'Звук выключен'
  },
  {
    id: 'unmute',
    title: 'Включить звук',
    description: 'Включает звук обратно',
    category: 'media',
    aliases: ['unmute'],
    patterns: [/^(?:включи|верни)\s+звук$/],
    examples: ['включи звук'],
    phrases: ['верни звук', 'включи звук обратно', 'снова со звуком'],
    args: [],
    execute: () => MediaController.mute(false),
    confirmText: () => 'Звук включён'
  },

  // ─── Система ──────────────────────────────────────────────────────────────
  {
    id: 'screenshot',
    title: 'Скриншот',
    description: 'Делает снимок экрана',
    category: 'system',
    aliases: ['screenshot', 'снимок'],
    patterns: [/^(?:сделай\s+)?(?:скриншот|снимок экрана)$/],
    examples: ['сделай скриншот'],
    phrases: ['сфоткай экран', 'заскринь', 'снимок экрана', 'сохрани что на экране', 'сделай скрин'],
    args: [],
    execute: () => SystemController.screenshot(),
    confirmText: () => 'Скриншот готов'
  },
  {
    id: 'minimize_all',
    title: 'Свернуть все окна',
    description: 'Сворачивает все окна (показать рабочий стол)',
    category: 'system',
    aliases: ['сверни всё'],
    patterns: [/^сверни (?:все|все окна|всё)$/],
    examples: ['сверни всё'],
    phrases: ['покажи рабочий стол', 'сверни все окна', 'убери все окна', 'сверни всё на панель'],
    args: [],
    execute: () => WindowController.minimizeAll(),
    confirmText: () => 'Свернула'
  },
  {
    id: 'weather',
    title: 'Погода',
    description: 'Текущая погода по геолокации (без LLM)',
    category: 'info',
    aliases: ['погода', 'weather'],
    patterns: [/^(?:какая\s+(?:сейчас\s+)?погода(?:\s+сегодня|\s+на улице)?|погода(?:\s+сегодня|\s+на улице)?)$/],
    examples: ['какая погода'],
    phrases: ['что там с погодой', 'какая температура на улице', 'холодно ли сегодня', 'погода сейчас', 'сколько градусов'],
    args: [],
    execute: async () => {
      const w = await SystemController.weather()
      return w.ok
        ? { ok: true, message: `Сейчас${w.city ? ' в ' + w.city : ''} ${w.temp}°, ${w.desc}` }
        : { ok: false, message: 'Не удалось узнать погоду' }
    }
  },
  {
    id: 'open_settings',
    title: 'Параметры Windows',
    description: 'Открывает параметры Windows',
    category: 'system',
    aliases: ['настройки windows', 'параметры'],
    patterns: [/^открой\s+(?:настройки|параметры)(?:\s+(?:windows|виндовс|системы|пк|компьютера))?$/],
    examples: ['открой параметры'],
    phrases: ['открой настройки виндовс', 'зайди в параметры системы', 'настройки компьютера'],
    args: [],
    execute: () => SystemController.openSettings()
  },
  {
    id: 'task_manager',
    title: 'Диспетчер задач',
    description: 'Открывает диспетчер задач',
    category: 'system',
    aliases: ['taskmgr', 'диспетчер'],
    patterns: [/^(?:открой|запусти)\s+диспетчер(?:\s+задач)?$/],
    examples: ['открой диспетчер задач'],
    phrases: ['открой таск менеджер', 'запусти диспетчер задач', 'покажи диспетчер'],
    args: [],
    execute: () => ApplicationController.taskManager(),
    confirmText: () => 'Открываю'
  },

  {
    id: 'list_processes',
    title: 'Запущенные процессы',
    description: 'Показывает все запущенные программы (или проверяет конкретную)',
    category: 'system',
    aliases: ['процессы', 'задачи', 'processes'],
    patterns: [
      /^(?:какие\s+)?(?:процессы|программы|приложения)\s+(?:сейчас\s+)?(?:запущены|работают|открыты)$/,
      /^(?:покажи\s+(?:список\s+)?|список\s+)(?:процессы|процессов|запущенных программ|программ)$/,
      /^запущен(?:а|о)?\s+ли\s+(?<filter>[\wа-я.+-]+)$/
    ],
    examples: ['какие процессы запущены', 'запущен ли discord'],
    phrases: ['что у меня сейчас работает', 'покажи запущенные программы', 'какие приложения открыты', 'список активных процессов'],
    args: [{ name: 'filter', description: 'Имя программы для проверки' }],
    execute: (a) => SystemController.processes(a.filter)
  },

  // ─── Питание (опасные) ────────────────────────────────────────────────────
  {
    id: 'lock_screen',
    title: 'Заблокировать экран',
    description: 'Блокирует компьютер',
    category: 'power',
    aliases: ['lock', 'блокировка'],
    patterns: [/^заблокируй(?:\s+(?:компьютер|экран|пк))?$/],
    examples: ['заблокируй компьютер'],
    phrases: ['заблокируй экран', 'закрой доступ к компу', 'блокировка экрана', 'запри компьютер'],
    args: [],
    execute: () => PowerController.lock(),
    confirmText: () => 'Блокирую'
  },
  {
    id: 'sleep_pc',
    title: 'Спящий режим',
    description: 'Переводит компьютер в сон',
    category: 'power',
    aliases: ['sleep', 'сон'],
    patterns: [/^(?:спящий режим|усыпи(?:\s+(?:компьютер|пк))?|переведи в сон)$/],
    examples: ['спящий режим'],
    phrases: ['усыпи компьютер', 'переведи в сон', 'уложи комп спать'],
    args: [],
    execute: () => PowerController.sleep(),
    confirmText: () => 'Засыпаю'
  },
  {
    id: 'shutdown_pc',
    title: 'Выключить компьютер',
    description: 'Полное выключение компьютера',
    category: 'power',
    aliases: ['shutdown'],
    patterns: [/^(?:выключи|отключи|заверши работу)\s+(?:компьютер|пк|комп)$/],
    examples: ['выключи компьютер'],
    args: [],
    dangerous: true,
    describe: () => 'Выключить компьютер',
    execute: () => PowerController.shutdown()
  },
  {
    id: 'restart_pc',
    title: 'Перезагрузить компьютер',
    description: 'Перезагрузка компьютера',
    category: 'power',
    aliases: ['restart', 'reboot'],
    patterns: [/^(?:перезагрузи|ребутни)(?:\s+(?:компьютер|пк|комп))?$/],
    examples: ['перезагрузи компьютер'],
    args: [],
    dangerous: true,
    describe: () => 'Перезагрузить компьютер',
    execute: () => PowerController.restart()
  },

  // ─── Файлы ────────────────────────────────────────────────────────────────
  {
    id: 'open_folder',
    title: 'Открыть папку',
    description: 'Открывает папку в Проводнике (знает «загрузки», «рабочий стол»…)',
    category: 'files',
    aliases: ['папка', 'folder', 'проводник'],
    patterns: [/^открой\s+(?:папку\s+)?(?<path>загрузки|документы|рабочий стол|картинки|музыка|видео|[a-z]:\\.+)$/],
    examples: ['открой загрузки', 'открой папку C:\\Projects'],
    args: [{ name: 'path', description: 'Имя известной папки или путь', required: true }],
    softFail: true,
    execute: (a) => FileController.openFolder(a.path ?? ''),
    confirmText: () => 'Открываю'
  },
  {
    id: 'create_folder',
    title: 'Создать папку',
    description: 'Создаёт папку (по умолчанию — на рабочем столе)',
    category: 'files',
    aliases: ['новая папка'],
    patterns: [/^(?:создай|сделай)\s+(?:новую\s+)?папку\s+(?<name>.+?)(?:\s+(?<place>на рабочем столе|в загрузках|в документах))?$/],
    examples: ['создай папку Отчёты', 'создай папку Фото в загрузках'],
    args: [
      { name: 'name', description: 'Имя папки', required: true },
      { name: 'place', description: 'Где создать' }
    ],
    execute: (a) => FileController.createFolder(folderPath(a)),
    // отменяем ИМЕННО созданный путь (раньше undo всегда целил в рабочий стол)
    undo: (a) => FileController.deleteToTrash(folderPath(a)),
    confirmText: () => 'Папка создана'
  },
  {
    id: 'delete_file',
    title: 'Удалить в корзину',
    description: 'Удаляет файл или папку в корзину',
    category: 'files',
    aliases: ['удалить'],
    examples: ['удалить файл'],
    args: [{ name: 'path', description: 'Путь', required: true }],
    dangerous: true,
    describe: (a) => `Удалить в корзину: ${a.path}`,
    execute: (a) => FileController.deleteToTrash(a.path ?? '')
  },
  {
    id: 'rename_file',
    title: 'Переименовать',
    description: 'Переименовывает файл/папку',
    category: 'files',
    aliases: ['переименовать'],
    examples: [],
    args: [
      { name: 'path', description: 'Что переименовать', required: true },
      { name: 'name', description: 'Новое имя', required: true }
    ],
    execute: (a) => FileController.rename(a.path ?? '', a.name ?? '')
  },
  {
    id: 'copy_file',
    title: 'Скопировать',
    description: 'Копирует файл/папку',
    category: 'files',
    aliases: ['копировать'],
    examples: [],
    args: [
      { name: 'from', description: 'Откуда', required: true },
      { name: 'to', description: 'Куда', required: true }
    ],
    execute: (a) => FileController.copy(a.from ?? '', a.to ?? '')
  },
  {
    id: 'move_file',
    title: 'Переместить',
    description: 'Перемещает файл/папку',
    category: 'files',
    aliases: ['переместить'],
    examples: [],
    args: [
      { name: 'from', description: 'Откуда', required: true },
      { name: 'to', description: 'Куда', required: true }
    ],
    execute: (a) => FileController.move(a.from ?? '', a.to ?? '')
  },

  // ─── Буфер, уведомления ──────────────────────────────────────────────────
  {
    id: 'clipboard_write',
    title: 'В буфер обмена',
    description: 'Кладёт текст в буфер обмена',
    category: 'clipboard',
    aliases: ['скопируй в буфер'],
    examples: [],
    args: [{ name: 'text', description: 'Текст', required: true }],
    execute: async (a) => ClipboardController.write(a.text ?? '')
  },
  {
    id: 'notify',
    title: 'Уведомление',
    description: 'Показывает системное уведомление',
    category: 'notify',
    aliases: ['уведомление'],
    examples: [],
    args: [
      { name: 'title', description: 'Заголовок', required: true },
      { name: 'body', description: 'Текст' }
    ],
    execute: async (a) => NotificationController.notify(a.title ?? 'Kira', a.body ?? '')
  },

  // ─── Dev ──────────────────────────────────────────────────────────────────
  {
    id: 'open_vscode',
    title: 'Открыть VS Code',
    description: 'Запускает Visual Studio Code (опционально с папкой)',
    category: 'dev',
    aliases: ['vscode', 'вс код', 'код'],
    patterns: [/^(?:открой|запусти)\s+(?:vs ?code|вс ?код|visual studio code)$/],
    examples: ['открой vscode'],
    args: [{ name: 'path', description: 'Папка проекта' }],
    execute: (a) => ApplicationController.vscode(a.path),
    confirmText: () => 'Открываю'
  },
  {
    id: 'run_docker',
    title: 'Запустить Docker',
    description: 'Запускает Docker Desktop',
    category: 'dev',
    aliases: ['docker', 'докер'],
    patterns: [/^(?:запусти|открой|включи)\s+(?:docker|докер)(?:\s+desktop)?$/],
    examples: ['запусти docker'],
    args: [],
    softFail: true,
    execute: () => ApplicationController.dockerDesktop(),
    confirmText: () => 'Запускаю Docker'
  },
  {
    id: 'git_commit',
    title: 'Git commit',
    description: 'Коммитит все изменения в репозитории',
    category: 'dev',
    aliases: ['коммит'],
    examples: [],
    args: [
      { name: 'path', description: 'Путь к репозиторию', required: true },
      { name: 'message', description: 'Сообщение коммита', required: true }
    ],
    dangerous: true,
    describe: (a) => `Git commit в ${a.path}: «${a.message}»`,
    execute: (a) => GitController.commit(a.path ?? '', a.message ?? 'update')
  },

  // ─── Быстрый запуск приложений (специфичные — до универсального) ─────────
  {
    id: 'open_calculator',
    title: 'Калькулятор',
    description: 'Открывает калькулятор Windows',
    category: 'apps',
    aliases: ['калькулятор', 'calc'],
    patterns: [/^(?:открой|запусти|включи)\s+(?:калькулятор|calc)$/],
    examples: ['открой калькулятор'],
    phrases: ['посчитать на калькуляторе', 'запусти калькулятор', 'нужен калькулятор'],
    args: [],
    execute: () => ApplicationController.launch('калькулятор'),
    confirmText: () => 'Открываю калькулятор'
  },
  {
    id: 'open_notepad',
    title: 'Блокнот',
    description: 'Открывает блокнот',
    category: 'apps',
    aliases: ['блокнот', 'notepad'],
    patterns: [/^(?:открой|запусти|включи)\s+(?:блокнот|notepad)$/],
    examples: ['открой блокнот'],
    phrases: ['запусти блокнот', 'открой notepad', 'нужен блокнот записать'],
    args: [],
    execute: () => ApplicationController.launch('блокнот'),
    confirmText: () => 'Открываю блокнот'
  },
  {
    id: 'open_explorer',
    title: 'Проводник',
    description: 'Открывает проводник Windows',
    category: 'apps',
    aliases: ['проводник', 'explorer', 'этот компьютер'],
    patterns: [/^(?:открой|запусти)\s+(?:проводник|explorer|мой компьютер|этот компьютер)$/],
    examples: ['открой проводник'],
    phrases: ['открой этот компьютер', 'открой файлы', 'покажи мой компьютер'],
    args: [],
    execute: () => ApplicationController.launch('проводник'),
    confirmText: () => 'Открываю проводник'
  },
  {
    id: 'open_terminal',
    title: 'Терминал',
    description: 'Открывает терминал / командную строку',
    category: 'dev',
    aliases: ['терминал', 'консоль', 'cmd', 'командная строка'],
    patterns: [/^(?:открой|запусти)\s+(?:терминал|консоль|командную строку|cmd|powershell|терминал windows)$/],
    examples: ['открой терминал'],
    phrases: ['открой командную строку', 'запусти консоль', 'нужен терминал'],
    args: [],
    execute: () => ApplicationController.launch('терминал'),
    confirmText: () => 'Открываю терминал'
  },
  {
    id: 'open_paint',
    title: 'Paint',
    description: 'Открывает графический редактор Paint',
    category: 'apps',
    aliases: ['paint', 'пейнт'],
    patterns: [/^(?:открой|запусти)\s+(?:paint|пейнт|паинт)$/],
    examples: ['открой paint'],
    phrases: ['запусти пейнт', 'открой рисовалку', 'хочу порисовать'],
    args: [],
    execute: () => ApplicationController.launch('paint'),
    confirmText: () => 'Открываю Paint'
  },

  // ─── Информация о системе ────────────────────────────────────────────────
  {
    id: 'current_time',
    title: 'Текущее время',
    description: 'Говорит, который сейчас час',
    category: 'info',
    aliases: ['время', 'который час'],
    patterns: [/^(?:сколько (?:сейчас )?времени|который (?:сейчас )?час|время сейчас|текущее время)$/],
    examples: ['сколько времени'],
    phrases: ['который час', 'сколько сейчас времени', 'подскажи время', 'time'],
    args: [],
    execute: async () => {
      const t = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      return { ok: true, message: `Сейчас ${t}`, data: t }
    }
  },
  {
    id: 'current_date',
    title: 'Сегодняшняя дата',
    description: 'Говорит сегодняшнюю дату и день недели',
    category: 'info',
    aliases: ['дата', 'какое число', 'какой день'],
    patterns: [/^(?:какое (?:сегодня )?число|какой (?:сегодня )?день(?: недели)?|какая (?:сегодня )?дата|дата сегодня|сегодняшняя дата)$/],
    examples: ['какое сегодня число'],
    phrases: ['какой сегодня день', 'какое число', 'дата сегодня', 'какой день недели'],
    args: [],
    execute: async () => {
      const d = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      return { ok: true, message: `Сегодня ${d}`, data: d }
    }
  },
  {
    id: 'system_info',
    title: 'Загрузка системы',
    description: 'Показывает загрузку процессора, память и аптайм',
    category: 'system',
    aliases: ['загрузка', 'состояние системы', 'нагрузка'],
    patterns: [/^(?:загрузка (?:системы|компьютера|пк)|(?:нагрузка|состояние) системы|сколько (?:оперативки|памяти|озу)(?:\s+(?:занято|свободно))?|нагрузка на процессор)$/],
    examples: ['загрузка системы'],
    phrases: ['сколько оперативки занято', 'нагрузка на процессор', 'как загружен компьютер', 'состояние системы', 'сколько памяти свободно'],
    args: [],
    execute: async () => SystemController.stats()
  },
  {
    id: 'disk_space',
    title: 'Место на диске',
    description: 'Показывает свободное место на дисках',
    category: 'system',
    aliases: ['диск', 'место на диске'],
    patterns: [/^(?:сколько (?:свободного )?места на диске|(?:свободное )?место на диске|проверь диск|сколько места осталось)$/],
    examples: ['сколько места на диске'],
    phrases: ['сколько свободного места', 'место на диске', 'проверь диск', 'сколько осталось на диске'],
    args: [],
    execute: async () => SystemController.diskInfo()
  },
  {
    id: 'battery',
    title: 'Заряд батареи',
    description: 'Показывает уровень заряда батареи',
    category: 'system',
    aliases: ['батарея', 'заряд'],
    patterns: [/^(?:сколько заряда(?:\s+(?:батареи|осталось))?|уровень (?:заряда|батареи)|заряд батареи|сколько батареи)$/],
    examples: ['сколько заряда'],
    phrases: ['уровень батареи', 'сколько заряда осталось', 'заряд батареи', 'на сколько заряжен ноут'],
    args: [],
    execute: async () => SystemController.batteryInfo()
  },
  {
    id: 'ip_address',
    title: 'IP-адрес',
    description: 'Показывает локальный IP-адрес',
    category: 'info',
    aliases: ['ip', 'ip адрес', 'айпи'],
    patterns: [/^(?:мой ip(?:\s+адрес)?|какой у меня ip(?:\s+адрес)?|ip адрес|мой айпи|какой айпи)$/],
    examples: ['мой ip адрес'],
    phrases: ['какой у меня айпи', 'мой ip адрес', 'узнай мой ip', 'локальный адрес'],
    args: [],
    execute: async () => SystemController.networkInfo()
  },

  // ─── Управление активным окном ───────────────────────────────────────────
  {
    id: 'close_window',
    title: 'Закрыть окно',
    description: 'Закрывает активное окно',
    category: 'system',
    aliases: ['закрой окно'],
    patterns: [/^закрой (?:активное |текущее )?окно$/],
    examples: ['закрой окно'],
    phrases: ['закрой активное окно', 'закрой текущее окно', 'убери это окно'],
    args: [],
    execute: () => WindowController.active('close'),
    confirmText: () => 'Закрыла окно'
  },
  {
    id: 'minimize_window',
    title: 'Свернуть окно',
    description: 'Сворачивает активное окно',
    category: 'system',
    aliases: ['сверни окно'],
    patterns: [/^сверни (?:активное |текущее |это )?окно$/],
    examples: ['сверни окно'],
    noSemantic: true, // свернуть↔развернуть путаются в эмбеддингах — только regex
    args: [],
    execute: () => WindowController.active('minimize'),
    confirmText: () => 'Свернула'
  },
  {
    id: 'maximize_window',
    title: 'Развернуть окно',
    description: 'Разворачивает активное окно на весь экран',
    category: 'system',
    aliases: ['разверни окно'],
    patterns: [/^(?:разверни (?:активное |текущее |это )?окно(?:\s+на весь экран)?|разверни на весь экран|на весь экран)$/],
    examples: ['разверни окно'],
    noSemantic: true, // свернуть↔развернуть путаются в эмбеддингах — только regex
    args: [],
    execute: () => WindowController.active('maximize'),
    confirmText: () => 'Развернула'
  },

  // ─── Правка (клавиатурные команды в активное окно) ───────────────────────
  {
    id: 'copy_selection',
    title: 'Скопировать',
    description: 'Копирует выделенное (Ctrl+C)',
    category: 'clipboard',
    aliases: ['скопируй', 'копировать'],
    patterns: [/^(?:скопируй(?:\s+(?:выделенное|это|текст))?|копировать)$/],
    examples: ['скопируй'],
    phrases: ['скопируй выделенное', 'копировать текст', 'скопируй это'],
    args: [],
    execute: () => InputController.copy(),
    confirmText: () => 'Скопировала'
  },
  {
    id: 'paste_clipboard',
    title: 'Вставить',
    description: 'Вставляет из буфера обмена (Ctrl+V)',
    category: 'clipboard',
    aliases: ['вставь', 'вставить'],
    patterns: [/^(?:вставь(?:\s+(?:из буфера|текст|сюда))?|вставить)$/],
    examples: ['вставь'],
    phrases: ['вставь из буфера', 'вставить текст', 'вставь сюда'],
    args: [],
    execute: () => InputController.paste(),
    confirmText: () => 'Вставила'
  },
  {
    id: 'select_all',
    title: 'Выделить всё',
    description: 'Выделяет всё (Ctrl+A)',
    category: 'clipboard',
    aliases: ['выдели всё', 'выделить всё'],
    patterns: [/^(?:выдели(?:ть)? (?:всё|все|весь текст))$/],
    examples: ['выдели всё'],
    phrases: ['выделить весь текст', 'выдели всё', 'выделить всё целиком'],
    args: [],
    execute: () => InputController.selectAll(),
    confirmText: () => 'Выделила всё'
  },
  {
    id: 'cut_selection',
    title: 'Вырезать',
    description: 'Вырезает выделенное (Ctrl+X)',
    category: 'clipboard',
    aliases: ['вырежи', 'вырезать'],
    patterns: [/^(?:вырежи(?:\s+(?:выделенное|это|текст))?|вырезать)$/],
    examples: ['вырежи'],
    phrases: ['вырежи выделенное', 'вырезать текст'],
    args: [],
    execute: () => InputController.cut(),
    confirmText: () => 'Вырезала'
  },
  {
    id: 'save_file',
    title: 'Сохранить',
    description: 'Сохраняет в активном окне (Ctrl+S)',
    category: 'system',
    aliases: ['сохрани', 'сохранить'],
    patterns: [/^(?:сохрани(?:ть)?(?:\s+(?:файл|документ|это))?)$/],
    examples: ['сохрани файл'],
    phrases: ['сохрани документ', 'сохранить файл', 'сохрани изменения'],
    args: [],
    execute: () => InputController.save(),
    confirmText: () => 'Сохранила'
  },

  // ─── Веб-поиск ────────────────────────────────────────────────────────────
  {
    id: 'web_search',
    title: 'Поиск в интернете',
    description: 'Открывает поисковую выдачу Google по запросу',
    category: 'browser',
    aliases: ['загугли', 'погугли', 'поиск в интернете'],
    patterns: [/^(?:загугли|погугли|найди в (?:интернете|гугле)|поищи в (?:интернете|гугле)|поиск)\s+(?<query>.+)$/],
    examples: ['загугли рецепт борща'],
    args: [{ name: 'query', description: 'Что искать', required: true }],
    execute: (a) => SearchController.web(a.query ?? ''),
    confirmText: (a) => `Ищу: ${a.query}`
  },
  {
    id: 'youtube_search',
    title: 'Поиск на YouTube',
    description: 'Открывает поиск YouTube по запросу',
    category: 'browser',
    aliases: ['найди на ютубе'],
    patterns: [/^(?:найди|поищи|покажи)\s+на\s+(?:ютубе|youtube|ютюбе)\s+(?<query>.+)$/],
    examples: ['найди на ютубе обзор ноутбука'],
    args: [{ name: 'query', description: 'Что искать', required: true }],
    execute: (a) => SearchController.youtube(a.query ?? ''),
    confirmText: (a) => `Ищу на YouTube: ${a.query}`
  },

  // ─── Корзина и гибернация ─────────────────────────────────────────────────
  {
    id: 'open_recycle_bin',
    title: 'Открыть корзину',
    description: 'Открывает корзину Windows',
    category: 'system',
    aliases: ['корзина', 'открой корзину'],
    patterns: [/^открой корзину$/],
    examples: ['открой корзину'],
    phrases: ['покажи корзину', 'открой корзину', 'зайди в корзину'],
    args: [],
    execute: () => SystemController.openRecycleBin(),
    confirmText: () => 'Открываю корзину'
  },
  {
    id: 'empty_recycle_bin',
    title: 'Очистить корзину',
    description: 'Очищает корзину (необратимо)',
    category: 'system',
    aliases: ['очисти корзину'],
    patterns: [/^(?:очисти(?:ть)?|опустоши)\s+корзину$/],
    examples: ['очисти корзину'],
    args: [],
    dangerous: true,
    describe: () => 'Очистить корзину — файлы удалятся безвозвратно',
    execute: () => SystemController.emptyRecycleBin()
  },
  {
    id: 'hibernate',
    title: 'Гибернация',
    description: 'Переводит компьютер в гибернацию',
    category: 'power',
    aliases: ['гибернация', 'гибернуй'],
    patterns: [/^(?:гибернация|гибернуй|переведи в гибернацию|уйти в гибернацию)$/],
    examples: ['гибернация'],
    args: [],
    dangerous: true,
    describe: () => 'Перевести компьютер в гибернацию',
    execute: () => PowerController.hibernate(),
    confirmText: () => 'Перевожу в гибернацию'
  },

  // ─── Утилиты (конвертер, курсы, QR, таймер, ИМТ, скорость) ───────────────
  {
    id: 'convert',
    title: 'Конвертер',
    description: 'Переводит единицы измерения или суммы валют',
    category: 'info',
    aliases: ['конвертер', 'переведи'],
    patterns: [/^(?:переведи|конвертируй|сколько будет|переведи-ка)\s+(?<value>-?[\d.,]+)\s+(?<from>[a-zа-я/$€£]+)\s+в\s+(?<to>[a-zа-я/]+)$/],
    examples: ['переведи 5 миль в км', 'сколько будет 100 долларов в рублях'],
    args: [
      { name: 'value', description: 'Число', required: true },
      { name: 'from', description: 'Из чего', required: true },
      { name: 'to', description: 'Во что', required: true }
    ],
    softFail: true, // «переведи 5 яблок в корзину» — не единицы и не валюта → пусть решает AI
    execute: async (a) => {
      // «фунт» — и масса, и валюта: единицы выбираем, только если ОБЕ стороны — единицы
      // («100 фунтов в кг» → масса; «100 фунтов в рубли» → валюта GBP→RUB).
      // Проверка — по единому словарю единиц (utilities.isUnitWord), не по своему списку
      const bothUnits = UtilityController.isUnit(a.from ?? '') && UtilityController.isUnit(a.to ?? '')
      return bothUnits
        ? UtilityController.convert(toNum(a.value), a.from ?? '', a.to ?? '')
        : UtilityController.currency(toNum(a.value), a.from ?? '', a.to ?? '')
    }
  },
  {
    id: 'rate',
    title: 'Курс валюты/крипты',
    description: 'Показывает курс валюты или криптовалюты',
    category: 'info',
    aliases: ['курс', 'сколько стоит'],
    patterns: [/^(?:курс|сколько стоит|цена|почём)\s+(?<coin>[a-zа-я]+)$/],
    examples: ['курс биткоина', 'сколько стоит доллар'],
    args: [{ name: 'coin', description: 'Валюта/монета', required: true }],
    softFail: true, // «сколько стоит айфон» — не валюта → пусть отвечает AI
    execute: (a) => UtilityController.rate(a.coin ?? '')
  },
  {
    id: 'qr_code',
    title: 'QR-код',
    description: 'Генерирует QR-код и открывает его',
    category: 'info',
    aliases: ['qr', 'кьюар'],
    patterns: [/^(?:сделай\s+|создай\s+|сгенерируй\s+)?(?:qr|кью ?ар)(?:[ -]?код)?(?:\s+(?:для|из|с текстом))?\s+(?<text>.+)$/],
    examples: ['сделай qr код для example.com'],
    args: [{ name: 'text', description: 'Текст или ссылка', required: true }],
    execute: (a) => UtilityController.qr(a.text ?? ''),
    confirmText: () => 'Готовлю QR-код'
  },
  {
    id: 'bmi',
    title: 'Индекс массы тела',
    description: 'Считает ИМТ по росту (см) и весу (кг)',
    category: 'info',
    aliases: ['имт', 'bmi'],
    patterns: [/^(?:посчитай\s+)?(?:имт|bmi)\s+(?:рост\s+)?(?<height>\d{2,3})\s*(?:см)?\s+(?:вес\s+)?(?<weight>\d{2,3})\s*(?:кг)?$/],
    examples: ['имт 180 75'],
    args: [
      { name: 'height', description: 'Рост в см', required: true },
      { name: 'weight', description: 'Вес в кг', required: true }
    ],
    execute: async (a) => UtilityController.bmi(toNum(a.height), toNum(a.weight))
  },
  {
    id: 'timer',
    title: 'Таймер',
    description: 'Ставит таймер на заданное время',
    category: 'system',
    aliases: ['таймер'],
    patterns: [/^(?:поставь|заведи|включи|запусти|засеки)?\s*таймер(?:\s+на)?\s+(?<dur>\d+)\s*(?<unit>секунд(?:у|ы)?|сек|минут(?:у|ы)?|мин|час(?:а|ов)?|ч)(?:\s+(?<label>.+))?$/],
    examples: ['таймер на 10 минут', 'поставь таймер на 30 секунд чай'],
    args: [
      { name: 'dur', description: 'Число', required: true },
      { name: 'unit', description: 'секунд/минут/часов', required: true },
      { name: 'label', description: 'Метка' }
    ],
    execute: async (a) => UtilityController.timer(durationMs(a.dur ?? '', a.unit ?? 'мин'), a.label),
    confirmText: (a) => `Таймер на ${a.dur} ${a.unit}`
  },
  {
    id: 'timers_list',
    title: 'Активные таймеры',
    description: 'Показывает запущенные таймеры',
    category: 'system',
    aliases: ['таймеры'],
    patterns: [/^(?:какие\s+)?таймеры(?:\s+(?:активны|идут|запущены))?$|^(?:покажи|сколько осталось на)\s+таймер(?:ах|ы|е)?$/],
    examples: ['таймеры'],
    phrases: ['сколько осталось на таймере', 'какие таймеры идут', 'покажи таймеры'],
    args: [],
    execute: async () => UtilityController.timers()
  },
  {
    id: 'speedtest',
    title: 'Скорость интернета',
    description: 'Замеряет скорость загрузки и пинг',
    category: 'info',
    aliases: ['скорость интернета', 'спидтест'],
    patterns: [/^(?:проверь|замерь|тест|измерь)\s+скорость(?:\s+интернета|\s+сети)?$|^спидтест$|^скорость интернета$/],
    examples: ['проверь скорость интернета'],
    phrases: ['замерь скорость интернета', 'какая у меня скорость сети', 'быстрый ли интернет', 'спидтест'],
    args: [],
    execute: async () => UtilityController.speedTest()
  },

  // ─── Уточнение неконкретного запуска (ДО универсального) ─────────────────
  {
    id: 'clarify_launch',
    title: 'Уточнить, что запустить',
    description: 'Переспрашивает, если просят открыть что-то неконкретное («запусти игру»)',
    category: 'apps',
    aliases: [],
    // ловим ТОЛЬКО обобщённые слова-категории, а не конкретные приложения:
    // «запусти игру» → уточнить, «запусти стим» → это уже launch_app ниже
    patterns: [/^(?:открой|запусти|включи|поставь|давай)\s+(?:мне\s+)?(?:какую-нибудь\s+|какую-то\s+|любую\s+|какое-нибудь\s+|какой-нибудь\s+)?(?<what>игру|игры|игрушку|игрушки|программу|прогу|приложение|приложуху|сайт|страницу|что-нибудь|что-то|чо-нибудь|чё-нибудь|чото)$/],
    examples: ['запусти игру', 'открой программу'],
    noSemantic: true, // это уточняющий помощник — семантике тут делать нечего
    args: [{ name: 'what', description: 'Категория' }],
    execute: async (a) => {
      const w = (a.what ?? '').toLowerCase()
      const msg =
        /игр/.test(w) ? 'Какую игру запустить? Назови — и я открою.'
        : /программ|приложен|приложух|прог/.test(w) ? 'Какую программу открыть?'
        : /сайт|страниц/.test(w) ? 'Какой сайт открыть?'
        : 'А что именно открыть — программу, сайт или музыку?'
      return { ok: true, message: msg }
    }
  },

  // ─── Буфер: история и вставка прошлых копий ──────────────────────────────
  {
    id: 'clipboard_history',
    title: 'История буфера обмена',
    description: 'Показывает, что копировал недавно',
    category: 'clipboard',
    aliases: ['история буфера'],
    patterns: [/^(?:история буфера(?:\s+обмена)?|что я (?:недавно )?копировал(?:а)?|покажи историю буфера)$/],
    examples: ['история буфера'],
    phrases: ['что я копировал недавно', 'история копирования', 'покажи что копировал'],
    args: [],
    execute: async () => ClipboardController.history()
  },
  {
    id: 'paste_recent',
    title: 'Вставить прошлую копию',
    description: 'Вставляет ранее скопированный текст из истории',
    category: 'clipboard',
    aliases: ['вставь предыдущее'],
    patterns: [
      /^вставь\s+(?:предыдущ(?:ее|ую)(?:\s+копию)?|прошл(?:ое|ый)|то что копировал(?:а)? (?:до этого|раньше))$/,
      /^вставь\s+(?:из\s+истории\s+|запись\s+)?(?<n>\d+)(?:\s+запись)?$/
    ],
    examples: ['вставь предыдущее', 'вставь из истории 2'],
    args: [{ name: 'n', description: 'Номер записи (1 — предыдущая)' }],
    execute: (a) => ClipboardController.pasteRecent(toNum(a.n) || 1),
    confirmText: () => 'Вставила'
  },

  // ─── OCR: текст с экрана ──────────────────────────────────────────────────
  {
    id: 'read_screen_text',
    title: 'Прочитать текст с экрана',
    description: 'Распознаёт текст на экране (офлайн, OCR)',
    category: 'system',
    aliases: ['распознай текст', 'текст с экрана'],
    patterns: [/^(?:прочитай|распознай|считай|извлеки)\s+текст(?:\s+(?:с экрана|на экране|со скриншота|с картинки))?$|^текст на экране$/],
    examples: ['прочитай текст с экрана'],
    phrases: ['распознай текст на экране', 'считай текст с картинки', 'какой текст на экране', 'вытащи текст с экрана'],
    args: [],
    execute: async () => SystemController.ocrScreen()
  },

  // ─── Обслуживание ПК ──────────────────────────────────────────────────────
  {
    id: 'top_memory',
    title: 'Что занимает память',
    description: 'Показывает программы, жрущие больше всего памяти',
    category: 'system',
    aliases: ['что жрёт память'],
    patterns: [/^(?:что|кто)\s+(?:жр[её]т|ест|занимает|съедает)\s+(?:память|оперативк[уи]|озу|памяти|оперативную память)$/],
    examples: ['что жрёт память'],
    phrases: ['что занимает оперативку', 'кто ест память', 'что грузит память', 'на что уходит оперативка'],
    args: [],
    execute: async () => SystemController.topMemory()
  },
  {
    id: 'top_cpu',
    title: 'Что грузит процессор',
    description: 'Показывает программы, нагружающие процессор',
    category: 'system',
    aliases: ['что грузит процессор'],
    patterns: [/^(?:что|кто)\s+(?:грузит|нагружает|жр[её]т|тормозит)\s+(?:процессор|цпу|систему|компьютер|проц)$/],
    examples: ['что грузит процессор'],
    phrases: ['что нагружает процессор', 'от чего тормозит компьютер', 'кто грузит цпу', 'почему комп тормозит'],
    args: [],
    execute: async () => SystemController.topCpu()
  },
  {
    id: 'startup_apps',
    title: 'Автозагрузка',
    description: 'Показывает программы в автозапуске',
    category: 'system',
    aliases: ['автозагрузка'],
    patterns: [/^(?:что в автозагрузке|автозагрузка|какие программы (?:в автозапуске|автозагружаются)|что запускается при старте)$/],
    examples: ['что в автозагрузке'],
    phrases: ['что в автозапуске', 'какие программы автозагружаются', 'что стартует с виндой'],
    args: [],
    execute: async () => SystemController.startupApps()
  },
  {
    id: 'clean_temp',
    title: 'Очистить временные файлы',
    description: 'Удаляет временные файлы (%TEMP%), освобождает место',
    category: 'system',
    aliases: ['почисти мусор'],
    patterns: [/^(?:почисти(?:ть)?|очисти(?:ть)?|удали)\s+(?:временные файлы|темп|мусор|кэш временных|временное)$/],
    examples: ['почисти временные файлы'],
    args: [],
    dangerous: true,
    describe: () => 'Удалить временные файлы (%TEMP%)',
    execute: () => SystemController.cleanTemp()
  },

  // ─── Сниппеты ──────────────────────────────────────────────────────────────
  {
    id: 'snippet_save',
    title: 'Сохранить сниппет',
    description: 'Сохраняет текстовую заготовку под именем',
    category: 'clipboard',
    aliases: ['сохрани сниппет'],
    patterns: [/^(?:сохрани|создай|запомни)\s+сниппет\s+(?<name>[^:：]+)[:：]\s*(?<text>.+)$/],
    examples: ['сохрани сниппет адрес: ул. Ленина 1'],
    args: [
      { name: 'name', description: 'Имя сниппета', required: true },
      { name: 'text', description: 'Текст', required: true }
    ],
    execute: async (a) => SnippetController.save(a.name ?? '', a.text ?? '')
  },
  {
    id: 'snippet_paste',
    title: 'Вставить сниппет',
    description: 'Вставляет сохранённый сниппет по имени',
    category: 'clipboard',
    aliases: ['вставь сниппет'],
    patterns: [/^вставь\s+сниппет\s+(?<name>.+)$/],
    examples: ['вставь сниппет адрес'],
    args: [{ name: 'name', description: 'Имя сниппета', required: true }],
    execute: (a) => SnippetController.paste(a.name ?? ''),
    confirmText: () => 'Вставила'
  },
  {
    id: 'snippets_list',
    title: 'Мои сниппеты',
    description: 'Список сохранённых сниппетов',
    category: 'clipboard',
    aliases: ['сниппеты'],
    patterns: [/^(?:мои сниппеты|список сниппетов|покажи сниппеты|какие есть сниппеты)$/],
    examples: ['мои сниппеты'],
    phrases: ['какие у меня сниппеты', 'покажи заготовки'],
    args: [],
    execute: async () => SnippetController.list()
  },

  // ─── База знаний по документам (RAG) ─────────────────────────────────────
  {
    id: 'index_docs',
    title: 'Проиндексировать документы',
    description: 'Строит локальную базу знаний из папки с документами',
    category: 'files',
    aliases: ['проиндексируй документы'],
    patterns: [/^(?:проиндексируй|индексируй|обнови базу знаний|добавь в базу знаний)\s+документы(?:\s+(?:в|из)\s+(?<folder>.+))?$/],
    examples: ['проиндексируй документы', 'проиндексируй документы в C:\\Docs'],
    noSemantic: true,
    args: [{ name: 'folder', description: 'Папка (иначе — из настроек)' }],
    execute: (a) => KnowledgeController.index(a.folder),
    confirmText: () => 'Индексирую документы, это займёт немного времени'
  },
  {
    id: 'ask_docs',
    title: 'Поиск по документам',
    description: 'Отвечает на вопрос по проиндексированным документам',
    category: 'info',
    aliases: ['найди в документах'],
    patterns: [/^(?:найди в документах|что в документах (?:про|о|об)|поиск(?:\s+в)? (?:документах|моих файлах)|спроси у документов)\s+(?<query>.+)$/],
    examples: ['найди в документах условия договора'],
    args: [{ name: 'query', description: 'Вопрос', required: true }],
    execute: (a) => KnowledgeController.ask(a.query ?? '')
  },
  {
    id: 'knowledge_status',
    title: 'База знаний',
    description: 'Что проиндексировано в базе знаний',
    category: 'info',
    aliases: ['база знаний'],
    patterns: [/^(?:что в базе знаний|статус базы знаний|что проиндексировано|размер базы знаний)$/],
    examples: ['что в базе знаний'],
    phrases: ['что проиндексировано', 'сколько документов в базе'],
    args: [],
    execute: async () => KnowledgeController.status()
  },

  // ─── Самодиагностика ──────────────────────────────────────────────────────
  {
    id: 'diagnose',
    title: 'Самодиагностика',
    description: 'Проверяет подсистемы Kira и подсказывает, что починить',
    category: 'system',
    aliases: ['диагностика', 'проверь себя'],
    patterns: [/^(?:почему не работает|что не так с|что случилось с|проверь|диагностика|самодиагностика|проверь себя|всё ли работает|что сломалось|проверь системы)(?:\s+(?<topic>.+))?$/],
    examples: ['почему не работает голос', 'диагностика'],
    phrases: ['проверь все системы', 'что у тебя не работает', 'самопроверка', 'всё ли в порядке'],
    args: [{ name: 'topic', description: 'Что проверить (голос/мозг/память…)' }],
    execute: (a) => DiagnosticsController.run(a.topic)
  },

  // ─── Приложения (универсальный — ПОСЛЕДНИМ) ──────────────────────────────
  {
    id: 'close_app',
    title: 'Закрыть программу',
    description: 'Закрывает окно приложения по имени',
    category: 'apps',
    aliases: ['закрой'],
    patterns: [/^(?:закрой|выключи)\s+(?<app>[\w.а-я+-]+(?:\s+[\w.а-я+-]+)?)$/],
    examples: ['закрой discord'],
    args: [{ name: 'app', description: 'Имя приложения', required: true }],
    softFail: true,
    validate: (a) => (APP_STOPWORDS.test(` ${a.app ?? ''} `) ? 'не похоже на имя приложения' : null),
    execute: (a) => ApplicationController.close(a.app ?? ''),
    confirmText: () => 'Закрыла'
  },
  {
    id: 'launch_app',
    title: 'Открыть программу',
    description: 'Запускает приложение по имени (discord, telegram, steam…)',
    category: 'apps',
    aliases: ['запусти', 'открой'],
    patterns: [/^(?:открой|запусти|включи)\s+(?<app>[\w.а-я+-]+(?:\s+[\w.а-я+-]+)?)$/],
    examples: ['открой discord', 'запусти steam'],
    args: [{ name: 'app', description: 'Имя приложения', required: true }],
    softFail: true,
    validate: (a) => (APP_STOPWORDS.test(` ${a.app ?? ''} `) ? 'не похоже на имя приложения' : null),
    execute: async (a) => {
      const r = await ApplicationController.launch(a.app ?? '')
      if (r.ok) return r
      // «открой ютуб»: не приложение, но известный сайт — открываем его
      const site = await BrowserController.openUrl(a.app ?? '')
      return site.ok ? site : r
    },
    confirmText: () => 'Открываю'
  },

  // ─── Дополнительно: яркость, буфер, файл, отмена ──────────────────────────
  {
    id: 'set_brightness',
    title: 'Яркость экрана',
    description: 'Ставит яркость экрана в процентах (0–100)',
    category: 'system',
    aliases: ['яркость', 'brightness'],
    patterns: [/^(?:яркость|поставь яркость|сделай яркость)\s+(?:на\s+)?(?<level>\d{1,3})(?:\s*%|\s+процентов)?$/],
    examples: ['яркость 70'],
    args: [{ name: 'level', description: 'Процент 0–100', required: true }],
    validate: (a) => (Number(a.level) >= 0 && Number(a.level) <= 100 ? null : 'Яркость — число 0–100'),
    execute: (a) => SystemController.setBrightness(Number(a.level)),
    confirmText: (a) => `Яркость ${a.level}%`
  },
  {
    id: 'clipboard_read',
    title: 'Прочитать буфер обмена',
    description: 'Показывает текущее содержимое буфера обмена',
    category: 'clipboard',
    aliases: ['буфер', 'clipboard'],
    patterns: [/^(?:что(?:\s+сейчас)?\s+в\s+буфере(?:\s+обмена)?|прочитай\s+буфер(?:\s+обмена)?|покажи\s+буфер(?:\s+обмена)?)$/],
    examples: ['что в буфере обмена'],
    phrases: ['что я скопировал', 'прочитай буфер обмена', 'покажи что в буфере', 'что сейчас в буфере'],
    args: [],
    execute: async () => {
      const text = ClipboardController.read().trim()
      return text
        ? { ok: true, message: `В буфере: ${text.slice(0, 300)}`, data: text }
        : { ok: true, message: 'Буфер обмена пуст' }
    }
  },
  {
    id: 'open_file',
    title: 'Открыть файл',
    description: 'Открывает файл программой по умолчанию',
    category: 'files',
    aliases: ['файл'],
    patterns: [/^открой\s+файл\s+(?<path>.+)$/],
    examples: ['открой файл C:\\doc.pdf'],
    args: [{ name: 'path', description: 'Путь к файлу', required: true }],
    softFail: true,
    execute: (a) => FileController.openFile(a.path ?? ''),
    confirmText: () => 'Открываю'
  },
  {
    id: 'undo_last',
    title: 'Отменить последнее действие',
    description: 'Отменяет последнее отменяемое действие (папка, звук, файловые операции)',
    category: 'system',
    aliases: ['отмена', 'undo'],
    patterns: [/^(?:отмени(?:\s+(?:последнее|это))?(?:\s+действие)?|отмена|верни\s+(?:как\s+было|обратно|назад))$/],
    examples: ['отмени', 'верни как было'],
    phrases: ['отмени последнее', 'верни как было', 'отмени что сделала', 'откати назад'],
    args: [],
    execute: async (_a, ctx) => {
      const { commandEngine } = await import('../engine')
      return commandEngine.undoLast(ctx)
    }
  }
]
