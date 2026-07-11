/**
 * Edge TTS — нейросетевой синтез речи Microsoft (тот же движок, что «читать вслух»
 * в браузере Edge). Полностью бесплатен, без API-ключа, звучит естественно и живо.
 *
 * Kira использует его по умолчанию для нежного женского голоса. При отсутствии
 * интернета renderer автоматически откатывается на системный голос Windows.
 */
import WebSocket from 'ws'
import { createHash, randomUUID } from 'crypto'

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WSS_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'

/**
 * Microsoft «версионно» блокирует устаревшие клиенты (403 на рукопожатии).
 * Пробуем несколько версий Edge по очереди — так синтез переживает будущие
 * ужесточения без обновления приложения.
 */
const CLIENT_VERSIONS = ['140.0.3485.14', '138.0.3351.65', '131.0.2903.86']

/** Каталог рекомендованных естественных голосов (нейросетевые). */
export interface VoiceOption {
  id: string
  label: string
  gender: 'female' | 'male'
  lang: string
}

export const EDGE_VOICES: VoiceOption[] = [
  { id: 'ru-RU-SvetlanaNeural', label: 'Светлана — нежный женский (RU)', gender: 'female', lang: 'ru-RU' },
  { id: 'ru-RU-DariyaNeural', label: 'Дария — тёплый женский (RU)', gender: 'female', lang: 'ru-RU' },
  { id: 'ru-RU-DmitryNeural', label: 'Дмитрий — мужской (RU)', gender: 'male', lang: 'ru-RU' },
  { id: 'uk-UA-PolinaNeural', label: 'Поліна — жіночий (UA)', gender: 'female', lang: 'uk-UA' },
  { id: 'en-US-AriaNeural', label: 'Aria — natural female (EN)', gender: 'female', lang: 'en-US' },
  { id: 'en-US-JennyNeural', label: 'Jenny — soft female (EN)', gender: 'female', lang: 'en-US' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia — female (EN-GB)', gender: 'female', lang: 'en-GB' },
  { id: 'de-DE-KatjaNeural', label: 'Katja — female (DE)', gender: 'female', lang: 'de-DE' }
]

/** Токен Sec-MS-GEC: SHA-256 от (winFileTime, округлённого до 5 минут) + токен. */
function generateSecMsGec(): string {
  let ticks = BigInt(Date.now()) * 10_000n + 116_444_736_000_000_000n
  ticks -= ticks % 3_000_000_000n
  return createHash('sha256')
    .update(ticks.toString() + TRUSTED_TOKEN, 'ascii')
    .digest('hex')
    .toUpperCase()
}

function ssmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildSsml(text: string, voice: string, rate: number, pitch: number): string {
  // rate/pitch в процентах относительно нормы; лёгкая тёплая просодия по умолчанию
  const ratePct = Math.round((rate - 1) * 100)
  const pitchPct = Math.round(pitch)
  const rateStr = `${ratePct >= 0 ? '+' : ''}${ratePct}%`
  const pitchStr = `${pitchPct >= 0 ? '+' : ''}${pitchPct}Hz`
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${rateStr}' pitch='${pitchStr}'>${ssmlEscape(text)}</prosody>` +
    `</voice></speak>`
  )
}

function isoDate(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z') + ''
}

export interface TtsOptions {
  voice?: string
  rate?: number
  pitch?: number
}

/**
 * Синтез речи. Возвращает MP3 в base64 (audio-24khz-48kbitrate-mono-mp3).
 * Перебирает версии клиента при 403 (Microsoft блокирует устаревшие версии).
 */
export async function synthesize(text: string, options: TtsOptions = {}): Promise<string> {
  const voice = options.voice || 'ru-RU-SvetlanaNeural'
  const rate = options.rate ?? 1
  const pitch = options.pitch ?? 0
  const clean = text.slice(0, 4000)

  let lastError: Error | null = null
  for (const version of CLIENT_VERSIONS) {
    try {
      return await synthesizeWith(clean, voice, rate, pitch, version)
    } catch (err) {
      lastError = err as Error
      // 403 — версия заблокирована, пробуем следующую; иначе прекращаем
      if (!/403/.test(lastError.message)) break
    }
  }
  throw lastError ?? new Error('Edge TTS: не удалось синтезировать речь')
}

function synthesizeWith(
  clean: string, voice: string, rate: number, pitch: number, version: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const gec = generateSecMsGec()
    const url =
      `${WSS_URL}?TrustedClientToken=${TRUSTED_TOKEN}` +
      `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${version}&ConnectionId=${randomUUID().replace(/-/g, '')}`

    const ws = new WebSocket(url, {
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Origin': 'chrome-extension://jdiccldimpstbolpdgfkhqfblkgnbihb',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        'User-Agent':
          `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
          `Chrome/${version} Safari/537.36 Edg/${version}`
      }
    })

    const chunks: Buffer[] = []
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        ws.terminate()
        reject(new Error('Edge TTS: таймаут соединения'))
      }
    }, 15_000)

    const done = (err: Error | null, audio?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* ignore */ }
      if (err) reject(err)
      else resolve(audio!)
    }

    ws.on('open', () => {
      const configMsg =
        `X-Timestamp:${isoDate()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
              }
            }
          }
        })
      ws.send(configMsg)

      const ssmlMsg =
        `X-RequestId:${randomUUID().replace(/-/g, '')}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${isoDate()}\r\n` +
        `Path:ssml\r\n\r\n` +
        buildSsml(clean, voice, rate, pitch)
      ws.send(ssmlMsg)
    })

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        const buf = data as Buffer
        // бинарный кадр: [2 байта длины заголовка][заголовок][аудио]
        const headerLen = buf.readUInt16BE(0)
        const audio = buf.subarray(2 + headerLen)
        if (audio.length > 0) chunks.push(audio)
      } else {
        const msg = data.toString()
        if (msg.includes('Path:turn.end')) {
          if (chunks.length === 0) return done(new Error('Edge TTS: пустой ответ'))
          done(null, Buffer.concat(chunks).toString('base64'))
        }
      }
    })

    ws.on('error', (err: Error) => done(err))

    ws.on('close', () => {
      if (!settled) {
        if (chunks.length > 0) done(null, Buffer.concat(chunks).toString('base64'))
        else done(new Error('Edge TTS: соединение закрыто без аудио'))
      }
    })
  })
}
