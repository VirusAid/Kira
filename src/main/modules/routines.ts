/**
 * Routines — Kira подмечает твои привычки и предлагает автоматизировать.
 *
 * Слушает запуски приложений (через шину ядра) и, если ты регулярно открываешь
 * одно и то же в одно и то же время дня, мягко предлагает сохранить это рутиной
 * (протоколом). Всё локально, только факт запуска — что и когда.
 */
import { Collection } from './storage'
import { newId } from './ids'
import { logger } from './logger'
import { bus } from '../core/bus'

interface LaunchLog {
  id: string
  app: string
  bucket: 'утро' | 'день' | 'вечер' | 'ночь'
  day: string // YYYY-MM-DD
  at: number
}

const MAX_LOG = 400
let _col: Collection<LaunchLog> | null = null
function col(): Collection<LaunchLog> {
  if (!_col) _col = new Collection<LaunchLog>('routines-log')
  return _col
}

function bucketOf(h: number): LaunchLog['bucket'] {
  return h < 6 ? 'ночь' : h < 12 ? 'утро' : h < 18 ? 'день' : 'вечер'
}

function record(app: string): void {
  const a = app.trim().toLowerCase()
  if (!a || a.length < 2) return
  const now = new Date()
  col().put({ id: newId(), app: a, bucket: bucketOf(now.getHours()), day: now.toISOString().slice(0, 10), at: Date.now() })
  // держим лог компактным
  const all = col().all().sort((x, y) => y.at - x.at)
  for (const old of all.slice(MAX_LOG)) col().delete(old.id)
}

let lastSuggestKey = ''

/**
 * Найти устойчивую привычку: приложение, открытое в один и тот же промежуток
 * дня в ≥3 РАЗНЫХ дня. Возвращает подсказку (один раз на привычку) или null.
 */
export function suggestRoutine(): { app: string; bucket: string; days: number; text: string } | null {
  const byKey = new Map<string, Set<string>>()
  for (const l of col().all()) {
    const key = `${l.app}@${l.bucket}`
    if (!byKey.has(key)) byKey.set(key, new Set())
    byKey.get(key)!.add(l.day)
  }
  let best: { key: string; app: string; bucket: string; days: number } | null = null
  for (const [key, days] of byKey) {
    if (days.size >= 3 && (!best || days.size > best.days)) {
      const [app, bucket] = key.split('@')
      best = { key, app, bucket, days: days.size }
    }
  }
  if (!best || best.key === lastSuggestKey) return null
  lastSuggestKey = best.key
  return {
    app: best.app, bucket: best.bucket, days: best.days,
    text: `Заметила: ты часто открываешь ${best.app} в это время (${best.bucket}). Хочешь, буду делать это сама по расписанию или одной командой?`
  }
}

/** Подписаться на запуски приложений через шину ядра. */
export function initRoutines(): void {
  bus.on('action:executed', ({ action, args, result }) => {
    if (!result.ok) return
    if (action.id === 'launch_app') { record(args.app ?? ''); return }
    // конкретные лаунчеры (калькулятор/браузер/…) — по заголовку действия
    if (action.category === 'apps' && action.id.startsWith('open_')) record(action.title)
    if (action.id === 'open_browser') record('браузер')
  })
  logger.info('routines', 'Обучение привычкам активно')
}
