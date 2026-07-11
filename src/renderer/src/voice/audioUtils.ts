/** Утилиты аудио для узнавания голоса: запись → PCM 16 кГц Float32 (base64). */

/** Декодирует записанный blob в моно-PCM 16 кГц Float32, кодирует в base64. */
export async function blobToPcm16Base64(blob: Blob): Promise<string> {
  const arr = await blob.arrayBuffer()
  // AudioContext с частотой 16000 — decodeAudioData сам ресемплит к ней
  const ctx = new AudioContext({ sampleRate: 16000 })
  try {
    const buf = await ctx.decodeAudioData(arr)
    const data = buf.getChannelData(0)
    const f32 = new Float32Array(data) // копия
    return float32ToBase64(f32)
  } finally {
    void ctx.close()
  }
}

export function float32ToBase64(f32: Float32Array): string {
  const bytes = new Uint8Array(f32.buffer)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** Кодирует Float32 PCM в WAV (16-bit) и возвращает base64 — для точного Whisper. */
export function encodeWavBase64(f32: Float32Array, sampleRate = 16000): string {
  const len = f32.length
  const buffer = new ArrayBuffer(44 + len * 2)
  const view = new DataView(buffer)
  const wr = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
  wr(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true); wr(8, 'WAVE')
  wr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  wr(36, 'data'); view.setUint32(40, len * 2, true)
  let off = 44
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return uint8ToBase64(new Uint8Array(buffer))
}

/** Записать N миллисекунд с микрофона и вернуть PCM 16 кГц base64 (для обучения голоса). */
export async function recordSampleBase64(ms: number): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true }
  })
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  return new Promise<string>((resolve, reject) => {
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      try {
        resolve(await blobToPcm16Base64(new Blob(chunks, { type: mimeType })))
      } catch (e) {
        reject(e)
      }
    }
    recorder.start()
    setTimeout(() => recorder.stop(), ms)
  })
}
