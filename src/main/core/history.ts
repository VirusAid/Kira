/**
 * История действий ядра — каждое выполненное Action фиксируется здесь
 * (отдельно от журнала логов): кто вызвал, с какими аргументами, результат.
 */
import { Collection } from '../modules/storage'
import { newId } from '../modules/ids'
import type { ActionRecord } from './types'

const MAX_RECORDS = 500

class ActionHistory {
  private col = new Collection<ActionRecord>('action-history')

  record(entry: Omit<ActionRecord, 'id' | 'at'>): void {
    this.col.put({ ...entry, id: newId(), at: Date.now() })
    // держим историю компактной
    if (this.col.size > MAX_RECORDS + 50) {
      const oldest = this.col.all().sort((a, b) => a.at - b.at).slice(0, this.col.size - MAX_RECORDS)
      for (const r of oldest) this.col.delete(r.id)
    }
  }

  list(limit = 100): ActionRecord[] {
    return this.col.all().sort((a, b) => b.at - a.at).slice(0, limit)
  }

  flushSync(): void {
    this.col.flushSync()
  }
}

export const actionHistory = new ActionHistory()
