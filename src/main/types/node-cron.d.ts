declare module 'node-cron' {
  export interface ScheduledTask {
    start: () => void
    stop: () => void
  }
  export function schedule(
    expression: string,
    func: () => void,
    options?: { scheduled?: boolean; timezone?: string }
  ): ScheduledTask
  export function validate(expression: string): boolean
  const _default: { schedule: typeof schedule; validate: typeof validate }
  export default _default
}
