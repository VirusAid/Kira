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
  ApplicationController, BrowserController, ClipboardController, FileController,
  GitController, MediaController, NotificationController, PowerController,
  SystemController, WindowController, knownFolder
} from '../controllers'
import type { KiraAction } from '../types'

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
