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
  'мм': { dim: 'length', factor: 0.001, label: 'мм' }, 'миллиметр': { dim: 'length', factor: 0.001, label: 'мм' }, 'миллиметра': { dim: 'length', factor: 0.001, label: 'мм' }, 'миллиметры': { dim: 'length', factor: 0.001, label: 'мм' }, 'миллиметров': { dim: 'length', factor: 0.001, label: 'мм' },
  'см': { dim: 'length', factor: 0.01, label: 'см' }, 'сантиметр': { dim: 'length', factor: 0.01, label: 'см' }, 'сантиметра': { dim: 'length', factor: 0.01, label: 'см' }, 'сантиметры': { dim: 'length', factor: 0.01, label: 'см' }, 'сантиметров': { dim: 'length', factor: 0.01, label: 'см' },
  'дм': { dim: 'length', factor: 0.1, label: 'дм' },
  'м': { dim: 'length', factor: 1, label: 'м' }, 'метр': { dim: 'length', factor: 1, label: 'м' }, 'метра': { dim: 'length', factor: 1, label: 'м' }, 'метры': { dim: 'length', factor: 1, label: 'м' }, 'метров': { dim: 'length', factor: 1, label: 'м' },
  'км': { dim: 'length', factor: 1000, label: 'км' }, 'километр': { dim: 'length', factor: 1000, label: 'км' }, 'километра': { dim: 'length', factor: 1000, label: 'км' }, 'километры': { dim: 'length', factor: 1000, label: 'км' }, 'километров': { dim: 'length', factor: 1000, label: 'км' },
  'миля': { dim: 'length', factor: 1609.344, label: 'миль' }, 'миль': { dim: 'length', factor: 1609.344, label: 'миль' }, 'мили': { dim: 'length', factor: 1609.344, label: 'миль' }, 'mile': { dim: 'length', factor: 1609.344, label: 'миль' },
  'ярд': { dim: 'length', factor: 0.9144, label: 'ярд' }, 'ярда': { dim: 'length', factor: 0.9144, label: 'ярд' }, 'ярды': { dim: 'length', factor: 0.9144, label: 'ярд' }, 'ярдов': { dim: 'length', factor: 0.9144, label: 'ярд' },
  'фут': { dim: 'length', factor: 0.3048, label: 'фут' }, 'фута': { dim: 'length', factor: 0.3048, label: 'фут' }, 'футы': { dim: 'length', factor: 0.3048, label: 'фут' }, 'футов': { dim: 'length', factor: 0.3048, label: 'фут' }, 'foot': { dim: 'length', factor: 0.3048, label: 'фут' }, 'feet': { dim: 'length', factor: 0.3048, label: 'фут' },
  'дюйм': { dim: 'length', factor: 0.0254, label: 'дюйм' }, 'дюйма': { dim: 'length', factor: 0.0254, label: 'дюйм' }, 'дюймы': { dim: 'length', factor: 0.0254, label: 'дюйм' }, 'дюймов': { dim: 'length', factor: 0.0254, label: 'дюйм' }, 'inch': { dim: 'length', factor: 0.0254, label: 'дюйм' },
  // масса (база — кг)
  'мг': { dim: 'mass', factor: 1e-6, label: 'мг' }, 'миллиграмм': { dim: 'mass', factor: 1e-6, label: 'мг' },
  'г': { dim: 'mass', factor: 0.001, label: 'г' }, 'грамм': { dim: 'mass', factor: 0.001, label: 'г' }, 'грамма': { dim: 'mass', factor: 0.001, label: 'г' }, 'граммы': { dim: 'mass', factor: 0.001, label: 'г' }, 'граммов': { dim: 'mass', factor: 0.001, label: 'г' },
  'кг': { dim: 'mass', factor: 1, label: 'кг' }, 'килограмм': { dim: 'mass', factor: 1, label: 'кг' }, 'килограмма': { dim: 'mass', factor: 1, label: 'кг' }, 'килограммы': { dim: 'mass', factor: 1, label: 'кг' }, 'килограммов': { dim: 'mass', factor: 1, label: 'кг' },
  'т': { dim: 'mass', factor: 1000, label: 'т' }, 'тонна': { dim: 'mass', factor: 1000, label: 'т' }, 'тонны': { dim: 'mass', factor: 1000, label: 'т' }, 'тонн': { dim: 'mass', factor: 1000, label: 'т' },
  'фунт': { dim: 'mass', factor: 0.453592, label: 'фунт' }, 'фунта': { dim: 'mass', factor: 0.453592, label: 'фунт' }, 'фунты': { dim: 'mass', factor: 0.453592, label: 'фунт' }, 'фунтов': { dim: 'mass', factor: 0.453592, label: 'фунт' }, 'pound': { dim: 'mass', factor: 0.453592, label: 'фунт' }, 'lb': { dim: 'mass', factor: 0.453592, label: 'фунт' },
  'унция': { dim: 'mass', factor: 0.0283495, label: 'унц' }, 'унции': { dim: 'mass', factor: 0.0283495, label: 'унц' }, 'унций': { dim: 'mass', factor: 0.0283495, label: 'унц' }, 'oz': { dim: 'mass', factor: 0.0283495, label: 'унц' },
  // объём (база — литр)
  'мл': { dim: 'volume', factor: 0.001, label: 'мл' }, 'миллилитр': { dim: 'volume', factor: 0.001, label: 'мл' }, 'миллилитров': { dim: 'volume', factor: 0.001, label: 'мл' },
  'л': { dim: 'volume', factor: 1, label: 'л' }, 'литр': { dim: 'volume', factor: 1, label: 'л' }, 'литра': { dim: 'volume', factor: 1, label: 'л' }, 'литры': { dim: 'volume', factor: 1, label: 'л' }, 'литров': { dim: 'volume', factor: 1, label: 'л' },
  'галлон': { dim: 'volume', factor: 3.78541, label: 'галлон' }, 'галлона': { dim: 'volume', factor: 3.78541, label: 'галлон' }, 'галлоны': { dim: 'volume', factor: 3.78541, label: 'галлон' }, 'галлонов': { dim: 'volume', factor: 3.78541, label: 'галлон' }, 'gallon': { dim: 'volume', factor: 3.78541, label: 'галлон' },
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

/** Слово — единица измерения (или температура)? Единый источник для роутинга единицы/валюта. */
export function isUnitWord(word: string): boolean {
  const k = word.trim().toLowerCase()
  return !!UNITS[k] || TEMP.has(k)
}

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
  'доллар': 'USD', 'доллара': 'USD', 'доллары': 'USD', 'долларов': 'USD', 'долларах': 'USD',
  'бакс': 'USD', 'бакса': 'USD', 'баксы': 'USD', 'баксов': 'USD', 'usd': 'USD', '$': 'USD',
  'евро': 'EUR', 'eur': 'EUR', '€': 'EUR',
  'рубль': 'RUB', 'рубля': 'RUB', 'рубли': 'RUB', 'рублей': 'RUB', 'рублях': 'RUB', 'руб': 'RUB', 'rub': 'RUB',
  'гривна': 'UAH', 'гривны': 'UAH', 'гривну': 'UAH', 'гривен': 'UAH', 'гривнах': 'UAH', 'грн': 'UAH', 'uah': 'UAH',
  'фунт': 'GBP', 'фунта': 'GBP', 'фунты': 'GBP', 'фунтов': 'GBP', 'gbp': 'GBP', '£': 'GBP',
  'юань': 'CNY', 'юаня': 'CNY', 'юани': 'CNY', 'юаней': 'CNY', 'cny': 'CNY',
  'тенге': 'KZT', 'kzt': 'KZT', 'злотый': 'PLN', 'злотых': 'PLN', 'pln': 'PLN',
  'йена': 'JPY', 'йены': 'JPY', 'иена': 'JPY', 'иен': 'JPY', 'jpy': 'JPY',
  'лира': 'TRY', 'лиры': 'TRY', 'лир': 'TRY', 'try': 'TRY',
  'франк': 'CHF', 'франка': 'CHF', 'франков': 'CHF', 'chf': 'CHF', 'драм': 'AMD', 'драмов': 'AMD'
}

export async function currencyConvert(amount: number, fromRaw: string, toRaw: string): Promise<ActionResult> {
  const from = FIAT[fromRaw.trim().toLowerCase()] ?? fromRaw.trim().toUpperCase()
  const to = FIAT[toRaw.trim().toLowerCase()] ?? toRaw.trim().toUpperCase()
  // не гоняем в API мусор («5 яблок в корзину») — валюты это ISO-коды из 3 латинских букв
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return { ok: false, message: `Не знаю валюту «${!/^[A-Z]{3}$/.test(from) ? fromRaw : toRaw}»` }
  }
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
  return { ok: true, message: `Таймеров: ${active.length}`, content: lines.join('\n') }
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

// ─── Счёт в уме ──────────────────────────────────────────────────────────────
/*
 * «Сколько будет 15 умножить на 7» — самая обычная просьба, и до сих пор она
 * уходила в облако: ядро умело переводить мили в километры, но не складывать.
 * Считаем сами — мгновенно, офлайн и без лимитов чужого API.
 *
 * eval здесь недопустим ни в каком виде: выражение приходит из голоса и чата,
 * то есть снаружи. Поэтому разбираем сами — рекурсивным спуском по крошечной
 * грамматике, где просто нет места ничему, кроме чисел и четырёх действий.
 */

/*
 * Словами люди говорят чаще, чем знаками, — приводим к знакам.
 *
 * Границы слова заданы вручную, БЕЗ \b. В JavaScript \b считает буквой только
 * латиницу с цифрами, поэтому «\bумножить\b» не совпадает ни с чем русским —
 * весь разбор молча проваливался, а Kira отвечала «тут что-то кроме чисел».
 *
 * Порядок строк тоже значим: «разделить НА» должно разобраться раньше, чем
 * одинокое «на» превратится в умножение, иначе «100 разделить на 4» станет
 * «100 разделить * 4».
 */
const B = '(?<![а-яёa-z])' // начало слова
const A = '(?![а-яёa-z])'  // конец слова
const w = (...words: string[]): RegExp => new RegExp(`${B}(?:${words.join('|')})${A}`, 'g')

const MATH_WORDS: Array<[RegExp, string]> = [
  [w('скобка открывается', 'открыть скобку'), '('],
  [w('скобка закрывается', 'закрыть скобку'), ')'],
  [w('в степени', 'в квадрате'), '^'],
  [w('корень из', 'квадратный корень из'), '√'],
  [w('разделить на', 'поделить на', 'делённое на', 'деленное на', 'дели на'), '/'],
  [w('умножить на', 'умноженное на', 'умножь на', 'помножить на'), '*'],
  [w('плюс', 'прибавить', 'сложить'), '+'],
  [w('минус', 'вычесть', 'отнять'), '-'],
  // одинокое «на» между числами — тоже умножение («5 на 3»), но только после
  // того, как разобраны явные словосочетания выше
  [new RegExp(`${B}на${A}(?=\\s*\\d)`, 'g'), '*'],
  [/(?<=\d)\s*[хx]\s*(?=\d)/g, '*'],
  [/,(?=\d)/g, '.'] // «3,5» — десятичная запятая
]

/** Похоже ли на арифметику: есть число и хотя бы один знак действия. */
export function looksLikeMath(raw: string): boolean {
  const e = toExpression(raw)
  return /\d/.test(e) && /[+\-*/^√]/.test(e) && !/[a-zа-яё]/i.test(e)
}

function toExpression(raw: string): string {
  // ё НЕ сворачиваем: «делённое» и «деленное» перечислены отдельно, а свёртка
  // сломала бы границы слов в уже написанных правилах
  let s = raw.toLowerCase().trim()
  s = s.replace(/^(?:сколько будет|посчитай|вычисли|сосчитай|реши)\s+/, '')
  s = s.replace(/\s*[?.!]+\s*$/, '')
  for (const [re, sign] of MATH_WORDS) s = s.replace(re, sign)
  // «процентов от» → умножение на долю: «20 процентов от 350»
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:%|процент(?:а|ов)?)\s*от\s*/g, '($1/100)*')
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:%|процент(?:а|ов)?)/g, '($1/100)')
  return s.replace(/\s+/g, '')
}

/** Разбор выражения: число, скобки, степень, умножение/деление, сложение. */
function parseExpression(src: string): number {
  let i = 0
  const peek = (): string => src[i] ?? ''
  const fail = (): never => { throw new Error('не понимаю выражение') }

  const number = (): number => {
    if (peek() === '(') {
      i++
      const v = sum()
      if (peek() !== ')') fail()
      i++
      return v
    }
    if (peek() === '√') { i++; return Math.sqrt(number()) }
    if (peek() === '-') { i++; return -number() }
    if (peek() === '+') { i++; return number() }
    const start = i
    while (/[\d.]/.test(peek())) i++
    if (i === start) fail()
    const v = Number(src.slice(start, i))
    if (!Number.isFinite(v)) fail()
    return v
  }
  const power = (): number => {
    let v = number()
    while (peek() === '^') { i++; v = v ** number() }
    return v
  }
  const product = (): number => {
    let v = power()
    for (;;) {
      const op = peek()
      if (op !== '*' && op !== '/') return v
      i++
      const rhs = power()
      if (op === '/' && rhs === 0) throw new Error('на ноль делить нельзя')
      v = op === '*' ? v * rhs : v / rhs
    }
  }
  const sum = (): number => {
    let v = product()
    for (;;) {
      const op = peek()
      if (op !== '+' && op !== '-') return v
      i++
      v = op === '+' ? v + product() : v - product()
    }
  }
  const result = sum()
  if (i < src.length) fail() // остался хвост — значит, разобрали не всё
  return result
}

export function calculate(raw: string): ActionResult {
  const expr = toExpression(raw)
  if (!expr) return { ok: false, message: 'Нечего считать' }
  if (/[^\d.+\-*/^√()]/.test(expr)) {
    return { ok: false, message: 'Тут есть что-то кроме чисел и действий — уточни выражение' }
  }
  try {
    const value = parseExpression(expr)
    if (!Number.isFinite(value)) return { ok: false, message: 'Получилось не число — проверь выражение' }
    // длинные хвосты после запятой человеку не нужны
    const pretty = Number.isInteger(value) ? String(value) : String(Math.round(value * 1e6) / 1e6)
    return { ok: true, message: `${expr.replace(/\*/g, '×').replace(/\//g, '÷')} = ${pretty}`, data: value }
  } catch (e) {
    return { ok: false, message: (e as Error).message === 'на ноль делить нельзя'
      ? 'На ноль делить нельзя' : 'Не разобрала выражение — скажи попроще, например «15 умножить на 7»' }
  }
}

// ─── Перевод ─────────────────────────────────────────────────────────────────
/*
 * Перевод без ключей и без облачной модели: MyMemory отдаёт результат по
 * обычному GET. Это не замена большой модели, но «переведи hello на русский»
 * должно работать мгновенно и у того, кто вообще не подключал провайдера.
 */
const LANGS: Record<string, string> = {
  'русский': 'ru', 'русском': 'ru', 'ru': 'ru', 'рус': 'ru',
  'английский': 'en', 'английском': 'en', 'англ': 'en', 'en': 'en',
  'немецкий': 'de', 'немецком': 'de', 'de': 'de',
  'французский': 'fr', 'французском': 'fr', 'fr': 'fr',
  'испанский': 'es', 'испанском': 'es', 'es': 'es',
  'итальянский': 'it', 'итальянском': 'it', 'it': 'it',
  'китайский': 'zh', 'китайском': 'zh', 'zh': 'zh',
  'японский': 'ja', 'японском': 'ja', 'ja': 'ja',
  'турецкий': 'tr', 'турецком': 'tr', 'tr': 'tr',
  'польский': 'pl', 'польском': 'pl', 'pl': 'pl',
  'украинский': 'uk', 'украинском': 'uk', 'uk': 'uk'
}

/** Язык текста на глаз: кириллица → ru, иначе en. Хватает для выбора пары. */
function guessLang(text: string): string {
  return /[а-яё]/i.test(text) ? 'ru' : 'en'
}

export async function translateText(text: string, toRaw?: string): Promise<ActionResult> {
  const body = text.trim()
  if (!body) return { ok: false, message: 'Нечего переводить' }
  const from = guessLang(body)
  // язык не назвали — переводим «в другую сторону» от того, что видим
  const to = LANGS[(toRaw ?? '').trim().toLowerCase()] ?? (from === 'ru' ? 'en' : 'ru')
  if (from === to) return { ok: true, message: body, content: body }
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(body.slice(0, 480))}&langpair=${from}|${to}`
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!r.ok) return { ok: false, message: `Переводчик не ответил (${r.status})` }
    const j = (await r.json()) as { responseData?: { translatedText?: string } }
    const out = (j.responseData?.translatedText ?? '').trim()
    if (!out) return { ok: false, message: 'Перевод не получился — попробуй короче' }
    return { ok: true, message: out, content: out, data: out }
  } catch (e) {
    return { ok: false, message: `Не удалось перевести: ${(e as Error).message}` }
  }
}
