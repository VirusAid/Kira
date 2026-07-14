/**
 * Event Bus ядра — типизированный pub/sub. Автоматизация, агенты и UI
 * подписываются на события действий, не зная друг о друге.
 */
import type { CoreEvents } from './types'

type Handler<K extends keyof CoreEvents> = (payload: CoreEvents[K]) => void

class EventBus {
  private handlers = new Map<keyof CoreEvents, Set<Handler<never>>>()

  on<K extends keyof CoreEvents>(event: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(event)
    if (!set) { set = new Set(); this.handlers.set(event, set) }
    set.add(fn as Handler<never>)
    return () => set!.delete(fn as Handler<never>)
  }

  emit<K extends keyof CoreEvents>(event: K, payload: CoreEvents[K]): void {
    const set = this.handlers.get(event)
    if (!set) return
    for (const fn of set) {
      try { (fn as Handler<K>)(payload) } catch { /* подписчик не должен ронять ядро */ }
    }
  }
}

export const bus = new EventBus()
