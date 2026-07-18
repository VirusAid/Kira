/**
 * Agent Runner — переиспользуемый АВТОНОМНЫЙ агентный цикл Kira (headless).
 *
 * В отличие от chat.ts (интерактивный агент со стримингом), этот цикл работает
 * без пользователя рядом: получает цель, сам строит план и выполняет его до
 * конца теми же инструментами ([[kira:…]]), возвращая итог. На нём построены:
 *   • фоновый worker (worker.ts) — долгая задача параллельно диалогу;
 *   • суб-агент как инструмент (subagent) — узкая подзадача со своим контекстом.
 *
 * Безопасность: без человека нельзя подтвердить необратимое — опасные действия
 * НЕ выполняются, а честно отмечаются в итоге. Есть лимит раундов, таймаут,
 * отмена и защита от зацикливания (как в интерактивном агенте).
 */
import { completeChatResilient, type AIMessage } from './client'
import { logger } from '../logger'

export interface AgentActionOutcome { name: string; ok: boolean; message: string }
export interface AgentStep { round: number; text: string; actions: AgentActionOutcome[] }
export interface AgentRunResult {
  ok: boolean
  summary: string
  steps: AgentStep[]
  rounds: number
  cancelled?: boolean
  skippedDangerous: string[]
}

export interface AgentRunOptions {
  goal: string
  /** Максимум раундов «мысль → действия → результаты». */
  maxRounds?: number
  /** Общий бюджет времени, мс. */
  timeoutMs?: number
  /** Доп. директива в системный промпт (роль суб-агента и т.п.). */
  systemExtra?: string
  /** Прогресс: вызывается после каждого раунда. */
  onStep?: (step: AgentStep) => void
  /** Кооперативная отмена: если вернёт true — цикл корректно завершится. */
  isCancelled?: () => boolean
}

const SEARCH_ACTIONS = new Set(['search_web', 'read_page', 'open_search', 'search_files', 'find_files', 'search_content', 'recall'])
const SEARCH_BUDGET = 4

/**
 * Внутри автономного цикла НЕЛЬЗЯ делегировать дальше: delegate из worker'а
 * плодил бы новых worker'ов рекурсивно (runaway), а subagent в subagent —
 * вложенные циклы без контроля. Агент в фоне делает работу САМ.
 */
const NESTED_BLOCKED = new Set(['delegate', 'subagent'])

/**
 * Прогоняет автономную задачу до результата. Никогда не бросает — при сбое
 * возвращает ok:false с пояснением в summary.
 */
export async function runAgentLoop(opts: AgentRunOptions): Promise<AgentRunResult> {
  const maxRounds = opts.maxRounds ?? 20
  const deadline = Date.now() + (opts.timeoutMs ?? 8 * 60_000)
  const steps: AgentStep[] = []
  const skippedDangerous: string[] = []
  let collected = ''

  let kira: typeof import('./kira')
  try {
    kira = await import('./kira')
  } catch (err) {
    return { ok: false, summary: `Не удалось запустить агента: ${(err as Error).message}`, steps, rounds: 0, skippedDangerous }
  }
  const { buildSystemPrompt, parseActions, stripActions, executeAction, isDangerous, describeAction } = kira

  const framing =
    `Твоя задача — выполнить АВТОНОМНО, до конца, без пользователя рядом (ты работаешь в фоне):\n«${opts.goal}»\n\n` +
    'Сначала коротко составь план (1-3 пункта), затем выполняй его по шагам своими инструментами ' +
    '[[kira:…]], не останавливаясь и ничего не переспрашивая. После каждого действия результат придёт ' +
    'следующим сообщением — учитывай его и продолжай. Если шаг не удался — попробуй другой способ. ' +
    'ВАЖНО: необратимые/опасные действия (удаление, отправка сообщений, выключение, произвольные команды) ' +
    'в фоновом режиме выполнить нельзя — если такое нужно, пропусти шаг и отметь его в итоге как требующий ' +
    'подтверждения. Когда цель достигнута (или дальше не продвинуться) — НЕ вызывай больше инструментов, ' +
    'а дай короткий человеческий итог: что сделано, что осталось.'

  const history: AIMessage[] = [
    { role: 'system', content: buildSystemPrompt({ withTools: true, extraContext: opts.systemExtra }) },
    { role: 'user', content: framing }
  ]

  const executedSignatures = new Set<string>()
  let searchCalls = 0
  let idleRounds = 0
  let rounds = 0

  for (let round = 0; round < maxRounds; round++) {
    if (opts.isCancelled?.()) return finish(false, true)
    if (Date.now() > deadline) {
      collected += (collected ? '\n' : '') + '(достигнут лимит времени)'
      break
    }
    rounds = round + 1

    let text: string
    try {
      text = await completeChatResilient(history)
    } catch (err) {
      collected += (collected ? '\n' : '') + `Сбой модели: ${(err as Error).message}`
      return finish(false, false)
    }

    const visible = stripActions(text)
    if (visible) collected += (collected ? '\n\n' : '') + visible

    const actions = parseActions(text)
    if (!actions.length) break // модель дала финальный ответ — задача завершена

    history.push({ role: 'assistant', content: text })

    const results: string[] = []
    const outcomes: AgentActionOutcome[] = []
    let executedInRound = false

    for (const action of actions) {
      if (opts.isCancelled?.()) return finish(false, true)

      if (NESTED_BLOCKED.has(action.name)) {
        results.push(`${action.name}: НЕДОСТУПНО в автономном режиме — выполни задачу сам, своими инструментами.`)
        continue
      }

      const signature = `${action.name}|${action.args.join('|')}`
      if (executedSignatures.has(signature)) {
        results.push(`${action.name}: УЖЕ ВЫПОЛНЯЛОСЬ — не повторяй, используй прошлый результат.`)
        continue
      }
      executedSignatures.add(signature)

      if (SEARCH_ACTIONS.has(action.name)) {
        searchCalls++
        if (searchCalls > SEARCH_BUDGET) {
          results.push(`${action.name}: ЛИМИТ ПОИСКОВ исчерпан — отвечай по собранному.`)
          continue
        }
      }

      // без человека необратимое не выполняем — честно отмечаем
      if (isDangerous(action)) {
        const desc = describeAction(action)
        skippedDangerous.push(desc)
        results.push(`${action.name}: ПРОПУЩЕНО — требует подтверждения пользователя (${desc}).`)
        outcomes.push({ name: action.name, ok: false, message: 'пропущено (нужно подтверждение)' })
        continue
      }

      let outcome: AgentActionOutcome
      try {
        const res = await executeAction(action)
        outcome = { name: action.name, ok: res.ok, message: res.message }
        const dataStr = res.data != null ? `\n${String(res.data).slice(0, 3000)}` : ''
        results.push(`${action.name}: ${res.ok ? 'OK' : 'ОШИБКА'} — ${res.message}${dataStr}`)
      } catch (err) {
        outcome = { name: action.name, ok: false, message: (err as Error).message }
        results.push(`${action.name}: ОШИБКА — ${(err as Error).message}`)
      }
      outcomes.push(outcome)
      executedInRound = true
    }

    const step: AgentStep = { round: rounds, text: visible, actions: outcomes }
    steps.push(step)
    try { opts.onStep?.(step) } catch { /* колбэк не должен ронять цикл */ }

    if (!executedInRound) {
      idleRounds++
      if (idleRounds >= 2) break // зациклилась на дублях/лимитах — завершаем
    } else {
      idleRounds = 0
    }

    history.push({
      role: 'user',
      content:
        `[СИСТЕМА: результаты действий]\n${results.join('\n')}\n\n` +
        `Цель: «${opts.goal}». Продолжай к её достижению. ЗАПРЕЩЕНО повторять уже выполненное и писать ` +
        '«сейчас сделаю» без самого действия. Если цель достигнута — дай короткий итог БЕЗ новых инструментов.'
    })
  }

  return finish(true, false)

  function finish(_ok: boolean, cancelled: boolean): AgentRunResult {
    const summary = (collected.trim() || (cancelled ? 'Задача отменена.' : 'Готово.')).slice(0, 4000)
    logger.info('agent', `Автономная задача завершена за ${rounds} р.: ${summary.slice(0, 80)}`)
    return {
      ok: !cancelled && !!collected.trim(),
      summary,
      steps,
      rounds,
      cancelled: cancelled || undefined,
      skippedDangerous
    }
  }
}
