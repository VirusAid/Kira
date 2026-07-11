import { randomBytes } from 'crypto'

/** Короткий уникальный id: время + случайность — сортируется хронологически. */
export function newId(): string {
  return Date.now().toString(36) + '-' + randomBytes(4).toString('hex')
}
