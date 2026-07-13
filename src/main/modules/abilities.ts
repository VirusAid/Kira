/**
 * Abilities — навыки Kira, описанные обычным языком.
 *
 * Навык хранит инструкцию (что и как делать) и фразы-триггеры. Инструкции
 * активных навыков попадают в системный промпт, поэтому Kira выполняет их
 * своим обычным агентным циклом — используя все доступные инструменты. Это и
 * есть «создание собственных возможностей обычным языком»: пользователь
 * описывает умение, Kira превращает описание в навык и дальше умеет его.
 *
 * «Skills» — тот же навык, но импортируемый/экспортируемый файлом.
 */
import { db } from './db'
import { newId } from './ids'
import { logger } from './logger'
import type { Ability, ActionResult } from '../../shared/types'

const MAX_ACTIVE = 40

/** Все навыки, свежие сверху. */
export function listAbilities(): Ability[] {
  return db().abilities.all().sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Активные навыки для инъекции в промпт (ограничиваем, чтобы не раздувать). */
export function activeAbilities(): Ability[] {
  return listAbilities().filter((a) => a.enabled).slice(0, MAX_ACTIVE)
}

export function saveAbility(partial: Partial<Ability> & { id?: string }): Ability {
  const existing = partial.id ? db().abilities.get(partial.id) : undefined
  if (existing) {
    return db().abilities.patch(existing.id, {
      ...partial,
      triggers: normalizeTriggers(partial.triggers ?? existing.triggers),
      updatedAt: Date.now()
    }) as Ability
  }
  const created: Ability = {
    id: newId(),
    name: (partial.name ?? 'Новый навык').trim(),
    description: (partial.description ?? '').trim(),
    instructions: (partial.instructions ?? '').trim(),
    triggers: normalizeTriggers(partial.triggers ?? []),
    icon: partial.icon ?? 'sparkles',
    enabled: partial.enabled ?? true,
    source: partial.source ?? 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    runCount: 0
  }
  db().abilities.put(created)
  logger.info('abilities', `Создан навык «${created.name}»`)
  return created
}

export function deleteAbility(id: string): boolean {
  return db().abilities.delete(id)
}

function normalizeTriggers(raw: unknown): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : String(raw ?? '').split(/[,\n;]+/)
  return [...new Set(arr.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12)
}

/**
 * Найти навык по имени или фразе-триггеру (для инструмента run_ability).
 * Возвращает инструкции, которые модель дальше выполняет в текущем цикле.
 */
export function runAbilityByName(query: string): ActionResult {
  const q = query.trim().toLowerCase()
  if (!q) return { ok: false, message: 'Не указан навык' }
  const abilities = listAbilities().filter((a) => a.enabled)
  const found =
    abilities.find((a) => a.name.toLowerCase() === q) ??
    abilities.find((a) => a.triggers.some((t) => t === q)) ??
    abilities.find((a) => a.name.toLowerCase().includes(q) || a.triggers.some((t) => q.includes(t) || t.includes(q)))
  if (!found) {
    const names = abilities.map((a) => a.name).join(', ') || '(навыков пока нет)'
    return { ok: false, message: `Навык «${query}» не найден. Доступные: ${names}` }
  }
  db().abilities.patch(found.id, { runCount: found.runCount + 1, lastRunAt: Date.now() })
  logger.action('abilities', `Навык «${found.name}» вызван`)
  return {
    ok: true,
    message: `Выполняю навык «${found.name}»`,
    data: `Инструкция навыка «${found.name}» — выполни её сейчас, используя свои инструменты:\n${found.instructions}`
  }
}

/**
 * Блок для системного промпта: перечень установленных навыков с триггерами,
 * чтобы Kira знала их и применяла контекстно.
 */
export function abilitiesPromptBlock(): string {
  const active = activeAbilities()
  if (!active.length) return ''
  const lines = active.map((a) => {
    const trig = a.triggers.length ? ` [фразы: ${a.triggers.join(', ')}]` : ''
    return `• ${a.name}${trig}: ${a.instructions.replace(/\s+/g, ' ').slice(0, 300)}`
  })
  return (
    'УСТАНОВЛЕННЫЕ НАВЫКИ (Abilities). Когда запрос пользователя подходит под навык ' +
    '(по смыслу или фразе-триггеру) — выполняй его инструкцию своими инструментами, ' +
    'не переспрашивая лишнего:\n' +
    lines.join('\n')
  )
}

/**
 * Превратить свободное описание пользователя в черновик навыка.
 * Локальная эвристика без обращения к ИИ — надёжна и без затрат лимитов;
 * пользователь потом правит в редакторе. (ИИ-уточнение делает renderer через
 * обычный чат при желании.)
 */
export function draftFromDescription(text: string): Partial<Ability> {
  const clean = text.replace(/\s+/g, ' ').trim()
  const firstSentence = clean.split(/[.!?\n]/)[0]?.trim() ?? clean
  const name = (firstSentence.length > 48 ? firstSentence.slice(0, 48) + '…' : firstSentence) || 'Новый навык'
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    description: clean.slice(0, 200),
    instructions: clean,
    triggers: []
  }
}
