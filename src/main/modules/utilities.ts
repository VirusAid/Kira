/**
 * Utilities — бытовые локальные функции Kira: конвертер единиц, курсы валют и
 * крипты, генерация QR, таймеры, ИМТ, замер скорости интернета.
 *
 * Всё это выполняется ядром напрямую (Local First). Часть тянет данные из
 * бесплатных публичных API без ключей (курсы, QR) — с таймаутами, чтобы
 * зависшая сеть не вешала Kira.
 */
import { shell, Notification } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { logger } from './logger'
import type { ActionResult } from '../../shared/types'

// ─── Конвертер единиц ────────────────────────────────────────────────────────

type Dim = 'length' | 'mass' | 'volume' | 'speed' | 'temp' | 'data'

interface Unit { dim: Dim; factor: number; label: string }

// factor — во сколько раз единица больше базовой (метр/кг/литр/(м/с)/байт)
const UNITS: Record<string, Unit> = {
  // длина (база — метр)
  'мм': { dim: 'length', factor: 0.001, label: 'мм' }, 'миллиметр': { dim: 'length', factor: 0.001, label: 'мм' },
  'см': { dim: 'length', factor: 0.01, label: 'см' }, 'сантиметр': { dim: 'length', factor: 0.01, label: 'см' },
  'дм': { dim: 'length', factor: 0.1, label: 'дм' },
  'м': { dim: 'length', factor: 1, label: 'м' }, 'метр': { dim: 'length', factor: 1, label: 'м' }, 'метров': { dim: 'length', factor: 1, label: 'м' },
  'км': { dim: 'length', factor: 1000, label: 'км' }, 'километр': { dim: 'length', factor: 1000, label: 'км' }, 'километров': { dim: 'length', factor: 1000, label: 'км' },
  'миля': { dim: 'length', factor: 1609.344, label: 'миль' }, 'миль': { dim: 'length', factor: 1609.344, label: 'миль' }, 'мили': { dim: 'length', factor: 1609.344, label: 'миль' }, 'mile': { dim: 'length', factor: 1609.344, label: 'миль' },
  'ярд': { dim: 'length', factor: 0.9144, label: 'ярд' }, 'ярдов': { dim: 'length', factor: 0.9144, label: 'ярд' },
  'фут': { dim: 'length', factor: 0.3048, label: 'фут' }, 'футов': { dim: 'length', factor: 0.3048, label: 'фут' }, 'foot': { dim: 'length', factor: 0.3048, label: 'фут' }, 'feet': { dim: 'length', factor: 0.3048, label: 'фут' },
  'дюйм': { dim: 'length', factor: 0.0254, label: 'дюйм' }, 'дюймов': { dim: 'length', factor: 0.0254, label: 'дюйм' }, 'inch': { dim: 'length', factor: 0.0254, label: 'дюйм' },
  // масса (база — кг)
  'мг': { dim: 'mass', factor: 1e-6, label: 'мг' }, 'миллиграмм': { dim: 'mass', factor: 1e-6, label: 'мг' },
  'г': { dim: 'mass', factor: 0.001, label: 'г' }, 'грамм': { dim: 'mass', factor: 0.001, label: 'г' }, 'граммов': { dim: 'mass', factor: 0.001, label: 'г' },
  'кг': { dim: 'mass', factor: 1, label: 'кг' }, 'килограмм': { dim: 'mass', factor: 1, label: 'кг' }, 'килограммов': { dim: 'mass', factor: 1, label: 'кг' },
  'т': { dim: 'mass', factor: 1000, label: 'т' }, 'тонна': { dim: 'mass', factor: 1000, label: 'т' }, 'тонн': { dim: 'mass', factor: 1000, label: 'т' },
  'фунт': { dim: 'mass', factor: 0.453592, label: 'фунт' }, 'фунтов': { dim: 'mass', factor: 0.453592, label: 'фунт' }, 'pound': { dim: 'mass', factor: 0.453592, label: 'фунт' }, 'lb': { dim: 'mass', factor: 0.453592, label: 'фунт' },
  'унция': { dim: 'mass', factor: 0.0283495, label: 'унц' }, 'унций': { dim: 'mass', factor: 0.0283495, label: 'унц' }, 'oz': { dim: 'mass', factor: 0.0283495, label: 'унц' },
  // объём (база — литр)
  'мл': { dim: 'volume', factor: 0.001, label: 'мл' }, 'миллилитр': { dim: 'volume', factor: 0.001, label: 'мл' },
  'л': { dim: 'volume', factor: 1, label: 'л' }, 'литр': { dim: 'volume', factor: 1, label: 'л' }, 'литров': { dim: 'volume', factor: 1, label: 'л' },
  'галлон': { dim: 'volume', factor: 3.78541, label: 'галлон' }, 'галлонов': { dim: 'volume', factor: 3.78541, label: 'галлон' }, 'gallon': { dim: 'volume', factor: 3.78541, label: 'галлон' },
  // скорость (база — м/с)
  'м/с': { dim: 'speed', factor: 1, label: 'м/с' },
  'км/ч': { dim: 'speed', factor: 0.277778, label: 'км/ч' }, 'кмч': { dim: 'speed', factor: 0.277778, label: 'км/ч' },
  'миль/ч': { dim: 'speed', factor: 0.44704, label: 'миль/ч' }, 'mph': { dim: 'speed', factor: 0.44704, label: 'миль/ч' },
  'узел': { dim: 'speed', factor: 0.514444, label: 'узл' }, 'узлов': { dim: 'speed', factor: 0.514444, label: 'узл' },
  // данные (база — байт)
  'байт': { dim: 'data', factor: 1, label: 'байт' },
  'кб': { dim: 'data', factor: 1024, label: 'КБ' }, 'килобайт': { dim: 'data', factor: 1024, label: 'КБ' },
  'мб': { dim: 'data', factor: 1024 ** 2, label: 'МБ' }, 'мегабайт': { dim: 'data', factor: 1024 ** 2, label: 'МБ' },
  'гб': { dim: 'data', factor: 1024 ** 3, label: 'ГБ' }, 'гигабайт': { dim: 'data', factor: 1024 ** 3, label: 'ГБ' },
  'тб': { dim: 'data', factor: 1024 ** 4, label: 'ТБ' }, 'терабайт': { dim: 'data', factor: 1024 ** 4, label: 'ТБ' }
}

// температура — отдельно (сдвиг, не только множитель)
const TEMP = new Set(['c', 'с', 'цельсий', 'цельсия', 'f', 'фаренгейт', 'фаренгейта', 'k', 'кельвин', 'кельвина'])
function tempToC(v: number, u: string): number {
  if (u === 'f' || u.startsWith('фаренгейт')) return (v - 32) * 5 / 9
  if (u === 'k' || u.startsWith('кельвин')) return v - 273.15
  return v
}
function cToTemp(c: number, u: string): number {
  if (u === 'f' || u.startsWith('фаренгейт')) return c * 9 / 5 + 32
  if (u === 'k' || u.startsWith('кельвин')) return c + 273.15
  return c
}
const round = (n: number): number => Math.round(n * 1000) / 1000

export function convertUnits(value: number, fromRaw: string, toRaw: string): ActionResult {
  const from = fromRaw.trim().toLowerCase()
  const to = toRaw.trim().toLowerCase()
  if (!isFinite(value)) return { ok: false, message: 'Не поняла число для конвертации' }

  if (TEMP.has(from) && TEMP.has(to)) {
    const res = round(cToTemp(tempToC(value, from), to))
    return { ok: true, message: `${value}° ${from.toUpperCase()} = ${res}° ${to.toUpperCase()}`, data: res }
  }
  const uf = UNITS[from]
  const ut = UNITS[to]
  if (!uf || !ut) return { ok: false, message: `Не знаю единицы «${fromRaw}» или «${toRaw}»` }
  if (uf.dim !== ut.dim) return { ok: false, message: `Нельзя перевести ${uf.label} в ${ut.label} — разные величины` }
  const res = round((value * uf.factor) / ut.factor)
  return { ok: true, message: `${value} ${uf.label} = ${res} ${ut.label}`, data: res }
}

// ─── Курсы валют и криптовалют ───────────────────────────────────────────────

const FIAT: Record<string, string> = {
  'доллар': 'USD', 'долларов': 'USD', 'долларах': 'USD', 'бакс': 'USD', 'usd': 'USD', '$': 'USD',
  'евро': 'EUR', 'eur': 'EUR', '€': 'EUR',
  'рубль': 'RUB', 'рублей': 'RUB', 'рублях': 'RUB', 'руб': 'RUB', 'rub': 'RUB',
  'гривна': 'UAH', 'гривен': 'UAH', 'грн': 'UAH', 'uah': 'UAH',
  'фунт': 'GBP', 'фунтов': 'GBP', 'gbp': 'GBP', '£': 'GBP',
  'юань': 'CNY', 'юаней': 'CNY', 'cny': 'CNY',
  'тенге': 'KZT', 'kzt': 'KZT', 'злотый': 'PLN', 'pln': 'PLN',
  'йена': 'JPY', 'иена': 'JPY', 'jpy': 'JPY', 'лира': 'TRY', 'try': 'TRY',
  'франк': 'CHF', 'chf': 'CHF', 'ram': 'AMD', 'драм': 'AMD'
}

export async function currencyConvert(amount: number, fromRaw: string, toRaw: string): Promise<ActionResult> {
  const from = FIAT[fromRaw.trim().toLowerCase()] ?? fromRaw.trim().toUpperCase()
  const to = FIAT[toRaw.trim().toLowerCase()] ?? toRaw.trim().toUpperCase()
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${from}`, { signal: AbortSignal.timeout(12_000) })
    const j = (await r.json()) as { result?: string; rates?: Record<string, number> }
    const rate = j.rates?.[to]
    if (j.result !== 'success' || !rate) return { ok: false, message: `Не удалось получить курс ${from}→${to}` }
    const res = Math.round(amount * rate * 100) / 100
    return { ok: true, message: `${amount} ${from} = ${res} ${to} (курс ${Math.round(rate * 1000) / 1000})`, data: res }
  } catch (e) {
    return { ok: false, message: `Курс недоступен: ${(e as Error).message}` }
  }
}

const COINS: Record<string, string> = {
  'биткоин': 'bitcoin', 'биткоина': 'bitcoin', 'битка': 'bitcoin', 'btc': 'bitcoin', 'bitcoin': 'bitcoin',
  'эфир': 'ethereum', 'эфира': 'ethereum', 'этериум': 'ethereum', 'eth': 'ethereum', 'ethereum': 'ethereum',
  'солана': 'solana', 'соланы': 'solana', 'sol': 'solana', 'solana': 'solana',
  'тон': 'the-open-network', 'toncoin': 'the-open-network', 'ton': 'the-open-network',
  'догикоин': 'dogecoin', 'доге': 'dogecoin', 'doge': 'dogecoin',
  'рипл': 'ripple', 'xrp': 'ripple', 'ripple': 'ripple',
  'кардано': 'cardano', 'ада': 'cardano', 'ada': 'cardano',
  'бнб': 'binancecoin', 'bnb': 'binancecoin', 'лайткоин': 'litecoin', 'ltc': 'litecoin',
  'трон': 'tron', 'trx': 'tron', 'полигон': 'matic-network', 'matic': 'matic-network',
  'нот': 'notcoin', 'notcoin': 'notcoin'
}

export async function cryptoRate(coinRaw: string, vsRaw = 'usd'): Promise<ActionResult> {
  const id = COINS[coinRaw.trim().toLowerCase()] ?? coinRaw.trim().toLowerCase()
  const vs = (FIAT[vsRaw.trim().toLowerCase()] ?? vsRaw).toLowerCase()
  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`,
      { signal: AbortSignal.timeout(12_000) }
    )
    const j = (await r.json()) as Record<string, Record<string, number>>
    const price = j[id]?.[vs]
    if (price == null) return { ok: false, message: `Не нашла курс «${coinRaw}»` }
    const chg = j[id]?.[`${vs}_24h_change`]
    const chgStr = chg != null ? ` (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% за сутки)` : ''
    return { ok: true, message: `${coinRaw}: ${price} ${vs.toUpperCase()}${chgStr}`, data: price }
  } catch (e) {
    return { ok: false, message: `Курс крипты недоступен: ${(e as Error).message}` }
  }
}

/** «курс X» / «сколько стоит X» — крипта или фиат (в рублях). */
export async function rate(query: string): Promise<ActionResult> {
  const key = query.trim().toLowerCase()
  if (COINS[key]) return cryptoRate(query)
  if (FIAT[key]) return currencyConvert(1, query, 'RUB')
  // не распознали — пробуем как id крипты (coingecko)
  return cryptoRate(query)
}

// ─── QR-код ──────────────────────────────────────────────────────────────────

export async function generateQr(text: string): Promise<ActionResult> {
  const data = text.trim()
  if (!data) return { ok: false, message: 'Нечего кодировать в QR' }
  try {
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=12&data=${encodeURIComponent(data)}`
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!r.ok) return { ok: false, message: `QR-сервис недоступен (${r.status})` }
    const buf = Buffer.from(await r.arrayBuffer())
    const file = join(tmpdir(), `kira-qr-${Date.now()}.png`)
    await writeFile(file, buf)
    await shell.openPath(file)
    return { ok: true, message: `QR-код готов и открыт: ${data.slice(0, 40)}`, data: file }
  } catch (e) {
    return { ok: false, message: `Не удалось создать QR: ${(e as Error).message}` }
  }
}

// ─── ИМТ (индекс массы тела) ─────────────────────────────────────────────────

export function bmi(heightCm: number, weightKg: number): ActionResult {
  if (!(heightCm > 0) || !(weightKg > 0)) return { ok: false, message: 'Нужны рост (см) и вес (кг)' }
  const h = heightCm / 100
  const val = weightKg / (h * h)
  const v = Math.round(val * 10) / 10
  const cat =
    v < 18.5 ? 'недостаток веса' : v < 25 ? 'норма' : v < 30 ? 'избыточный вес' : 'ожирение'
  return { ok: true, message: `ИМТ = ${v} (${cat})`, data: v }
}

// ─── Таймеры ─────────────────────────────────────────────────────────────────

interface ActiveTimer { id: string; label: string; fireAt: number; handle: NodeJS.Timeout }
const timers = new Map<string, ActiveTimer>()

export function startTimer(ms: number, label = ''): ActionResult {
  if (!(ms > 0) || ms > 24 * 3600_000) return { ok: false, message: 'Некорректная длительность таймера' }
  const id = 't' + Date.now().toString(36)
  const handle = setTimeout(() => {
    timers.delete(id)
    const title = 'Таймер Kira'
    const body = label ? `Время вышло: ${label}` : 'Время вышло!'
    try {
      if (Notification.isSupported()) new Notification({ title, body }).show()
    } catch { /* уведомления недоступны */ }
    logger.info('kira', `Таймер сработал: ${label || '(без метки)'}`)
  }, ms)
  timers.set(id, { id, label, fireAt: Date.now() + ms, handle })
  const mins = Math.round(ms / 60000)
  const human = mins >= 1 ? `${mins} мин` : `${Math.round(ms / 1000)} сек`
  return { ok: true, message: `Таймер на ${human}${label ? ` (${label})` : ''} запущен`, data: id }
}

export function listTimers(): ActionResult {
  const now = Date.now()
  const active = [...timers.values()].filter((t) => t.fireAt > now)
  if (!active.length) return { ok: true, message: 'Активных таймеров нет' }
  const lines = active.map((t) => {
    const left = Math.max(0, Math.round((t.fireAt - now) / 1000))
    const m = Math.floor(left / 60), s = left % 60
    return `• ${t.label || 'таймер'}: осталось ${m}:${String(s).padStart(2, '0')}`
  })
  return { ok: true, message: `Таймеров: ${active.length}`, data: lines.join('\n') }
}

export function cancelTimers(): ActionResult {
  const n = timers.size
  for (const t of timers.values()) clearTimeout(t.handle)
  timers.clear()
  return { ok: true, message: n ? `Отменила таймеры (${n})` : 'Активных таймеров не было' }
}

// ─── Скорость интернета ──────────────────────────────────────────────────────

export async function speedTest(): Promise<ActionResult> {
  // пинг — время до лёгкого ответа; загрузка — ~2 МБ тестовый файл
  try {
    const t0 = Date.now()
    await fetch('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(8_000) })
    const ping = Date.now() - t0

    const sizeBytes = 2_000_000
    const start = Date.now()
    const r = await fetch(`https://speed.cloudflare.com/__down?bytes=${sizeBytes}`, { signal: AbortSignal.timeout(20_000) })
    const buf = await r.arrayBuffer()
    const secs = (Date.now() - start) / 1000
    const mbps = secs > 0 ? (buf.byteLength * 8) / secs / 1e6 : 0
    return {
      ok: true,
      message: `Скорость загрузки ≈ ${mbps.toFixed(1)} Мбит/с, пинг ${ping} мс`,
      data: { mbps: Math.round(mbps * 10) / 10, pingMs: ping }
    }
  } catch (e) {
    return { ok: false, message: `Не удалось замерить скорость: ${(e as Error).message}` }
  }
}
