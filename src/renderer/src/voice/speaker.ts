/**
 * Speaker — одиночный проигрыватель речи для разовой озвучки (кнопка «прочитать»
 * у сообщений). Использует нейросетевой Edge TTS с откатом на системный голос.
 * Независим от голосового режима.
 */
import { kira } from '@/api'
import { useAppStore } from '@/state/appStore'

let current: HTMLAudioElement | null = null
let token = 0
const listeners = new Set<(id: string | null) => void>()
let speakingId: string | null = null

function setSpeaking(id: string | null): void {
  speakingId = id
  for (const l of listeners) l(id)
}

export function onSpeakingChange(cb: (id: string | null) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getSpeakingId(): string | null {
  return speakingId
}

export function stopSpeaker(): void {
  token++
  speechSynthesis.cancel()
  if (current) { current.pause(); current = null }
  setSpeaking(null)
}

function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' … код … ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_#>|]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'ссылка')
    .slice(0, 3000)
    .trim()
}

function speakSystem(text: string): void {
  const s = useAppStore.getState().settings
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const voices = speechSynthesis.getVoices()
  const preferred =
    voices.find((v) => v.name === s?.voiceName) ??
    voices.find((v) => v.lang.startsWith('ru') && /irina|svetlana|female|женск/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith('ru'))
  if (preferred) u.voice = preferred
  u.rate = s?.voiceRate ?? 1
  u.pitch = 1.08
  u.onend = () => setSpeaking(null)
  speechSynthesis.speak(u)
}

/** Озвучить текст. id — идентификатор сообщения для подсветки кнопки. */
export async function speakOnce(text: string, id: string): Promise<void> {
  const s = useAppStore.getState().settings
  const clean = cleanText(text)
  if (!clean) return

  // повторный клик по тому же — остановить
  if (speakingId === id) { stopSpeaker(); return }
  stopSpeaker()

  setSpeaking(id)
  const myToken = ++token

  if (s?.ttsEngine === 'system') {
    speakSystem(clean)
    return
  }

  try {
    const result = await kira.tts.synthesize(clean)
    if (myToken !== token) return
    if (!result.ok || !result.audio) { speakSystem(clean); return }
    const mime = result.format === 'wav' ? 'audio/wav' : 'audio/mpeg'
    const bytes = atob(result.audio)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    const url = URL.createObjectURL(new Blob([arr], { type: mime }))
    const audio = new Audio(url)
    audio.playbackRate = s?.voiceRate ?? 1
    current = audio
    audio.onended = () => {
      URL.revokeObjectURL(url)
      if (current === audio) current = null
      setSpeaking(null)
    }
    audio.onerror = () => { if (current === audio) current = null; speakSystem(clean) }
    void audio.play().catch(() => { if (current === audio) { current = null; speakSystem(clean) } })
  } catch {
    if (myToken === token) speakSystem(clean)
  }
}
