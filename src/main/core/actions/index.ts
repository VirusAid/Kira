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
    patterns: [/^(?:громкость|звук)\s+(?:на\s+)?(?<level>\d{1,3})(?:\s*%|\s+процентов)?$/],
    examples: ['громкость 50'],
    args: [{ name: 'level', description: 'Процент 0–100', required: true }],
    validate: (a) => (Number(a.level) >= 0 && Number(a.level) <= 100 ? null : 'Громкость — число 0–100'),
    execute: (a) => MediaController.setVolume(Number(a.level)),
    confirmText: (a) => `Громкость ${a.level}%`
  },
  {
    id: 'mute',
    title: 'Выключить звук',
    description: 'Отключает звук',
    category: 'media',
    aliases: ['mute', 'без звука'],
    patterns: [/^(?:выключи|отключи|убери)\s+звук$/],
    examples: ['выключи звук'],
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
    args: [],
    execute: () => ApplicationController.taskManager(),
    confirmText: () => 'Открываю'
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
    execute: (a) => {
      const base = a.place?.includes('загрузк') ? knownFolder('загрузки')
        : a.place?.includes('документ') ? knownFolder('документы')
        : knownFolder('рабочий стол')
      const path = /^[a-z]:\\/i.test(a.name) ? a.name : `${base}\\${a.name}`
      return FileController.createFolder(path)
    },
    undo: (a) => FileController.deleteToTrash(FileController.desktopPath(a.name ?? '')),
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
    execute: (a) => ApplicationController.launch(a.app ?? ''),
    confirmText: () => 'Открываю'
  }
]
