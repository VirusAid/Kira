/**
 * useVoice — полноценный голосовой режим Kira:
 *  • непрерывное прослушивание микрофона с детекцией речи по громкости
 *  • автостоп по тишине → распознавание через Groq Whisper (бесплатно)
 *  • озвучивание ответов системным TTS (Web Speech API, голоса Windows)
 *  • пользователь может перебить Kira — начало речи останавливает TTS
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { kira } from '@/api'
import { useAppStore } from '@/state/appStore'
import { useChatStore } from '@/state/chatStore'
import { float32ToBase64, encodeWavBase64 } from './audioUtils'

export type VoiceState = 'off' | 'listening' | 'recording' | 'transcribing' | 'thinking' | 'speaking'

const SPEECH_THRESHOLD = 0.030 // базовый RMS-порог начала речи (над шумом)
const SILENCE_MS = 1100 // тишина до конца фразы
const MIN_SPEECH_MS = 450 // минимальная длительность речи
const SPEECH_START_MS = 120 // сколько мс устойчивой громкости = начало речи
const INTERRUPT_MS = 220 // мс речи, чтобы перебить Kira
const MIN_LOUD_MS = 350 // минимум мс реальной речи в записи, иначе отбрасываем как шум
const TYPING_SUPPRESS_MS = 1200 // столько мс после нажатия клавиши не реагируем на звук (стук клавиш)
const VAD_BUFFER = 1024 // размер аудио-кадра (1024/16000 ≈ 64 мс) — работает в фоне (аудио-поток)
const PRE_FRAMES = 8 // сколько кадров пред-буфера (~500 мс) прицепить перед началом речи

export function useVoice() {
  const [state, setState] = useState<VoiceState>('off')
  const [level, setLevel] = useState(0)
  const [lastError, setLastError] = useState('')

  const stateRef = useRef<VoiceState>('off')
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const preBufferRef = useRef<Float32Array[]>([]) // пред-буфер (~400 мс) — не терять начало речи
  const cmdBufferRef = useRef<Float32Array[]>([]) // накопление PCM команды
  const speechStartRef = useRef(0)
  const lastSoundRef = useRef(0)
  const voiceStartRef = useRef(0) // когда началась текущая непрерывная громкость (0 — тихо)
  const loudMsRef = useRef(0) // накоплено мс речи в текущей записи (для отсева шума)
  const lastLevelAtRef = useRef(0) // троттлинг обновления UI-уровня
  const noiseFloorRef = useRef(0.006) // адаптивный уровень фонового шума
  const lastTypeRef = useRef(0) // время последнего нажатия клавиши (глушим микрофон при печати)
  const typeHandlerRef = useRef<(() => void) | null>(null)
  const offlineWakeRef = useRef(false) // активен ли офлайн-детектор «Кира» (Vosk)
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null)
  const wakeOffRef = useRef<(() => void) | null>(null)
  const verifyVoiceRef = useRef(false) // проверять ли, что говорит хозяин
  const emotionRef = useRef(false) // анализировать ли эмоции по голосу
  const audioRef = useRef<HTMLAudioElement | null>(null)
  /** Токен последнего запроса TTS — отменяет устаревший синтез при перебивании. */
  const ttsTokenRef = useRef(0)
  const ttsQueueRef = useRef<string[]>([]) // очередь фраз на озвучку (потоковый голос)
  const ttsPlayingRef = useRef(false)
  const streamedRef = useRef(false) // озвучивали ли ответ по предложениям в этом стриме
  const fillerSpokenRef = useRef(false) // «секунду…» — не чаще одного раза на запрос

  const setVoiceState = useCallback((s: VoiceState) => {
    stateRef.current = s
    setState(s)
  }, [])

  /** Чтение текущего состояния без сужения типа (ref меняется между await). */
  const currentState = useCallback((): VoiceState => stateRef.current, [])

  /** Системный синтез (Web Speech) — резервный вариант без интернета. */
  const speakSystem = useCallback((text: string, rate: number, voiceName: string) => {
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const voices = speechSynthesis.getVoices()
    const preferred =
      voices.find((v) => v.name === voiceName) ??
      voices.find((v) => v.lang.startsWith('ru') && /irina|svetlana|female|женск/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith('ru'))
    if (preferred) utterance.voice = preferred
    utterance.rate = rate
    utterance.pitch = 1.08
    utterance.onstart = () => { if (stateRef.current !== 'off') setVoiceState('speaking') }
    utterance.onend = () => { if (stateRef.current === 'speaking') setVoiceState('listening') }
    speechSynthesis.speak(utterance)
  }, [setVoiceState])

  // очистка текста для озвучки: убираем то, что не нужно проговаривать вслух —
  // код, пути к файлам, ссылки, разметку, технические скобки
  const cleanForTts = (text: string): string =>
    text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/www\.\S+/g, ' ')
      .replace(/[A-Za-z]:\\[^\s"'<>]+/g, ' ') // Windows-пути C:\...
      .replace(/[\w-]+\.[a-z]{2,6}(?:\/\S*)?/gi, ' ') // голые домены и пути site.com/...
      .replace(/[?&][\w=+%.-]+/g, ' ') // query-строки ?q=...
      .replace(/(?:\/[\w.\-]+){2,}/g, ' ') // unix-пути
      .replace(/[*_#>|~]/g, '')
      .replace(/\(\s*(?:путь|url|ссылка|файл|адрес)[^)]*\)/gi, '') // технические скобки
      .replace(/\s{2,}/g, ' ')
      .slice(0, 2000)
      .trim()

  /**
   * Очередь озвучки. Предложения добавляются по мере генерации ответа (потоковый
   * голос) — Kira начинает говорить, не дожидаясь конца ответа. Синтез следующей
   * фразы идёт, пока звучит текущая.
   */
  const drainQueue = useCallback(async () => {
    if (ttsPlayingRef.current) return
    const settings = useAppStore.getState().settings
    if (!settings) return
    ttsPlayingRef.current = true
    const token = ttsTokenRef.current
    const alive = (): boolean => token === ttsTokenRef.current && currentState() !== 'off'

    const playChunk = (b64: string, format: string): Promise<void> =>
      new Promise<void>((resolve) => {
        if (!alive()) return resolve()
        const mime = format === 'wav' ? 'audio/wav' : 'audio/mpeg'
        const audio = new Audio(URL.createObjectURL(base64ToBlob(b64, mime)))
        audio.playbackRate = settings.voiceRate
        audioRef.current = audio
        audio.onplay = () => { if (currentState() !== 'off') setVoiceState('speaking') }
        let done = false
        const finish = (): void => {
          if (done) return
          done = true
          URL.revokeObjectURL(audio.src)
          if (audioRef.current === audio) audioRef.current = null
          resolve()
        }
        audio.onended = finish
        audio.onerror = finish
        // перебивание: stopSpeaking() ставит паузу — завершаем promise, иначе
        // конвейер озвучки зависал навсегда на прерванной фразе
        audio.onpause = () => { if (!audio.ended) finish() }
        void audio.play().catch(finish)
      })

    try {
      let prefetch: ReturnType<typeof kira.tts.synthesize> | null = null
      while (ttsQueueRef.current.length && alive()) {
        const sentence = ttsQueueRef.current.shift()!
        const synthP = prefetch ?? kira.tts.synthesize(sentence)
        prefetch = null
        const result = await synthP
        if (!alive()) break
        // предвыборка следующей фразы, пока играет текущая
        if (ttsQueueRef.current.length) prefetch = kira.tts.synthesize(ttsQueueRef.current[0])
        if (!result.ok || !result.audio) {
          speakSystem(sentence, settings.voiceRate, settings.voiceName)
          continue
        }
        await playChunk(result.audio, result.format)
      }
    } catch { /* пропускаем сбойную фразу */ }

    ttsPlayingRef.current = false
    if (token === ttsTokenRef.current && currentState() === 'speaking' && !ttsQueueRef.current.length) {
      // если ответ ещё генерируется — возвращаемся в «думаю», иначе снова слушаем
      setVoiceState(useChatStore.getState().streaming ? 'thinking' : 'listening')
    }
  }, [speakSystem, setVoiceState, currentState])

  /** Озвучить текст (полный ответ или отдельное предложение из стрима). */
  const speak = useCallback((text: string) => {
    const settings = useAppStore.getState().settings
    if (!settings?.voiceEnabled) return
    const clean = cleanForTts(text)
    if (!clean) return
    if (settings.ttsEngine === 'system') {
      speakSystem(clean, settings.voiceRate, settings.voiceName)
      return
    }
    for (const s of splitSentences(clean)) ttsQueueRef.current.push(s)
    void drainQueue()
  }, [drainQueue, speakSystem])

  const stopSpeaking = useCallback(() => {
    ttsTokenRef.current++
    ttsQueueRef.current = []
    ttsPlayingRef.current = false
    speechSynthesis.cancel()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (stateRef.current === 'speaking') setVoiceState('listening')
  }, [setVoiceState])

  /** Начать накопление команды: включаем в неё пред-буфер (чтобы не терять начало). */
  const beginRecording = useCallback(() => {
    // пользователь говорит новую команду — старая генерация больше не нужна:
    // обрываем её, иначе она продолжит стримить и ГОВОРИТЬ поверх новой
    if (useChatStore.getState().streaming) useChatStore.getState().stopGeneration()
    fillerSpokenRef.current = false
    cmdBufferRef.current = preBufferRef.current.slice()
    speechStartRef.current = Date.now()
    lastSoundRef.current = Date.now()
    loudMsRef.current = MIN_LOUD_MS / 2
    voiceStartRef.current = 0
    setVoiceState('recording')
  }, [setVoiceState])

  /** Обработать записанную команду (сырой PCM 16 кГц): проверки → Whisper → отправка. */
  const processCommand = useCallback(async (pcm: Float32Array) => {
    if (currentState() === 'off') return
    setVoiceState('transcribing')
    try {
      const pcmB64 = float32ToBase64(pcm) // для узнавания голоса и эмоций

      // узнавание голоса: реагируем только на хозяина
      if (verifyVoiceRef.current) {
        try {
          const v = await kira.speaker.verify(pcmB64)
          if (currentState() === 'off') return
          if (!v.isOwner) { setVoiceState('listening'); return }
        } catch { /* не блокируем при сбое */ }
      }

      // эмоции по голосу
      let toneHint = ''
      if (emotionRef.current) {
        try {
          const emo = await kira.emotion.analyze(pcmB64)
          if (emo && emo.label) toneHint = `[голос звучит ${emo.label}] `
        } catch { /* не критично */ }
      }

      // распознавание: отдаём Whisper чистый WAV 16 кГц (без потерь начала)
      const wav = encodeWavBase64(pcm, 16000)
      const result = await kira.ai.transcribe(wav, 'audio/wav')
      if (currentState() === 'off') return
      if (result.ok && result.text) {
        const settings = useAppStore.getState().settings
        let text = result.text

        if (settings?.wakeWordEnabled && !offlineWakeRef.current) {
          const wake = (settings.wakeWord || 'кира').toLowerCase()
          const idx = text.toLowerCase().indexOf(wake)
          if (idx === -1) { setVoiceState('listening'); return }
          text = text.slice(idx + wake.length).replace(/^[\s,.!?—-]+/, '').trim()
          if (!text) {
            await useChatStore.getState().sendMessage('(пользователь позвал тебя по имени — коротко и тепло отзовись одной фразой)')
            return
          }
        }

        setVoiceState('thinking')
        await useChatStore.getState().sendMessage(toneHint + text)
      } else {
        if (result.error) setLastError(result.error)
        setVoiceState('listening')
      }
    } catch (err) {
      setLastError((err as Error).message)
      if (currentState() !== 'off') setVoiceState('listening')
    }
  }, [currentState, setVoiceState])

  /** Собрать накопленные PCM-кадры в один массив. */
  const finishAndProcess = useCallback(() => {
    const frames = cmdBufferRef.current
    cmdBufferRef.current = []
    const duration = Date.now() - speechStartRef.current
    // отбрасываем шум/тишину
    if (duration < MIN_SPEECH_MS || loudMsRef.current < MIN_LOUD_MS || !frames.length) {
      if (currentState() !== 'off') setVoiceState('listening')
      return
    }
    let total = 0
    for (const f of frames) total += f.length
    const pcm = new Float32Array(total)
    let off = 0
    for (const f of frames) { pcm.set(f, off); off += f.length }
    void processCommand(pcm)
  }, [currentState, setVoiceState, processCommand])

  /**
   * Анализ одного аудио-кадра — VAD. Вызывается из ScriptProcessorNode (аудио-поток),
   * поэтому продолжает работать, когда окно скрыто/свернуто в трей.
   */
  const vadFrame = useCallback((buf: Float32Array) => {
    const s0 = stateRef.current
    if (s0 === 'off') return
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    const now = Date.now()
    const frameMs = (buf.length / 16000) * 1000

    // копия кадра (буфер переиспользуется аудио-потоком) в пред-буфер / команду
    const frame = new Float32Array(buf)
    preBufferRef.current.push(frame)
    if (preBufferRef.current.length > PRE_FRAMES) preBufferRef.current.shift()
    if (s0 === 'recording') cmdBufferRef.current.push(frame)

    if (now - lastLevelAtRef.current > 50) {
      lastLevelAtRef.current = now
      setLevel(Math.min(1, rms * 12))
    }

    // адаптация шумового пола — ТОЛЬКО в тишине прослушивания. Во время речи
    // Kira её собственный голос из динамиков задирал пол → порог перебивания
    // становился недостижимым, и перебить её было невозможно
    if (s0 === 'listening') {
      noiseFloorRef.current = noiseFloorRef.current * 0.96 + rms * 0.04
    }
    const threshold = Math.max(SPEECH_THRESHOLD, noiseFloorRef.current * 2.6 + 0.006)
    const loud = rms > threshold
    const typing = now - lastTypeRef.current < TYPING_SUPPRESS_MS

    if (s0 === 'listening') {
      // в офлайн-режиме запись стартует только по слову «Кира» (Vosk), не по громкости
      if (loud && !typing && !offlineWakeRef.current) {
        if (!voiceStartRef.current) voiceStartRef.current = now
        if (now - voiceStartRef.current >= SPEECH_START_MS) beginRecording()
      } else {
        voiceStartRef.current = 0
      }
    } else if (s0 === 'speaking') {
      if (loud) {
        if (!voiceStartRef.current) voiceStartRef.current = now
        if (now - voiceStartRef.current >= INTERRUPT_MS) { stopSpeaking(); beginRecording() }
      } else {
        voiceStartRef.current = 0
      }
    } else if (s0 === 'recording') {
      if (loud) {
        lastSoundRef.current = now
        loudMsRef.current += frameMs
      }
      if (now - lastSoundRef.current > SILENCE_MS) {
        finishAndProcess()
      }
    }
  }, [beginRecording, finishAndProcess, setVoiceState, stopSpeaking])

  const start = useCallback(async () => {
    if (stateRef.current !== 'off') return
    setLastError('')
    voiceStartRef.current = 0
    loudMsRef.current = 0
    noiseFloorRef.current = 0.006

    // глушим микрофон, пока пользователь печатает (стук клавиш не должен стать командой)
    const onKey = (): void => { lastTypeRef.current = Date.now() }
    window.addEventListener('keydown', onKey)
    typeHandlerRef.current = onKey

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      streamRef.current = stream
      // 16 кГц — совместимо с Vosk (офлайн-активатор) и достаточно для VAD
      const ctx = new AudioContext({ sampleRate: 16000 })
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)

      // узнавание голоса хозяина: включаем, если настроено, обучено и доступно
      verifyVoiceRef.current = false
      emotionRef.current = false
      const cfg = useAppStore.getState().settings
      if (cfg?.speakerVerify) {
        try {
          verifyVoiceRef.current = (await kira.speaker.enrolled()) && (await kira.speaker.available())
        } catch { /* недоступно */ }
      }
      if (cfg?.emotionSense) {
        try { emotionRef.current = await kira.emotion.available() } catch { /* недоступно */ }
      }

      // офлайн слово-активатор «Кира» через Vosk (если установлен и включён)
      offlineWakeRef.current = false
      if (cfg?.wakeWordEnabled && (await kira.wake.available())) {
        offlineWakeRef.current = true
        await kira.wake.start()
        wakeOffRef.current = kira.on('wake:detected', () => {
          const cur = stateRef.current
          if (cur === 'speaking') stopSpeaking()
          if (cur === 'listening' || cur === 'speaking') beginRecording()
        })
      }

      // ЕДИНЫЙ аудио-узел: VAD + (при офлайн-режиме) поток в Vosk. Работает на
      // аудио-потоке → продолжает слушать, когда окно скрыто/свернуто в трей.
      const sp = ctx.createScriptProcessor(VAD_BUFFER, 1, 1)
      const zero = ctx.createGain()
      zero.gain.value = 0
      source.connect(sp)
      sp.connect(zero)
      zero.connect(ctx.destination)
      sp.onaudioprocess = (e) => {
        const f32 = e.inputBuffer.getChannelData(0)
        vadFrame(f32)
        // офлайн wake-word: гоним PCM в Vosk, только пока ждём (listening)
        if (offlineWakeRef.current && stateRef.current === 'listening') {
          const i16 = new Int16Array(f32.length)
          for (let i = 0; i < f32.length; i++) {
            const v = Math.max(-1, Math.min(1, f32[i]))
            i16[i] = v * 32767
          }
          kira.wake.feed(i16.buffer)
        }
      }
      scriptNodeRef.current = sp

      // потоковая озвучка: говорим предложения по мере генерации ответа
      streamedRef.current = false
      useChatStore.getState().setOnAssistantSentence((sentence) => {
        if (stateRef.current === 'off') return
        // пользователь диктует новую команду — «хвосты» старого ответа молчат
        if (stateRef.current === 'recording' || stateRef.current === 'transcribing') return
        streamedRef.current = true
        speak(sentence)
      })
      // финал ответа: если уже озвучивали по предложениям — не повторяем
      useChatStore.getState().setOnAssistantDone((text) => {
        if (stateRef.current === 'off') return
        if (streamedRef.current) {
          streamedRef.current = false
          if (stateRef.current === 'thinking') setVoiceState('listening')
          return
        }
        if (text && text.trim()) speak(text)
        else if (stateRef.current === 'thinking') setVoiceState('listening')
      })
      // при ошибке генерации — выходим из «думаю» и снова слушаем
      useChatStore.getState().setOnAssistantError(() => {
        streamedRef.current = false
        if (stateRef.current !== 'off') setVoiceState('listening')
      })

      setVoiceState('listening')
    } catch {
      setLastError('Нет доступа к микрофону. Проверь разрешения Windows.')
    }
  }, [vadFrame, setVoiceState, speak, stopSpeaking, beginRecording])

  const stop = useCallback(() => {
    setVoiceState('off')
    speechSynthesis.cancel()
    preBufferRef.current = []
    cmdBufferRef.current = []
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void audioCtxRef.current?.close()
    audioCtxRef.current = null
    if (typeHandlerRef.current) {
      window.removeEventListener('keydown', typeHandlerRef.current)
      typeHandlerRef.current = null
    }
    // офлайн-активатор
    if (offlineWakeRef.current) {
      void kira.wake.stop()
      offlineWakeRef.current = false
    }
    if (scriptNodeRef.current) {
      scriptNodeRef.current.onaudioprocess = null
      try { scriptNodeRef.current.disconnect() } catch { /* ignore */ }
      scriptNodeRef.current = null
    }
    if (wakeOffRef.current) { wakeOffRef.current(); wakeOffRef.current = null }
    useChatStore.getState().setOnAssistantDone(null)
    useChatStore.getState().setOnAssistantSentence(null)
    useChatStore.getState().setOnAssistantError(null)
    ttsQueueRef.current = []
    ttsPlayingRef.current = false
    setLevel(0)
  }, [setVoiceState])

  useEffect(() => () => stop(), [stop])

  // живые реакции: если Kira долго думает — короткая реплика «секунду…».
  // СТРОГО один раз на запрос: в многораундовом поиске состояние «думаю»
  // наступает после каждой озвученной фразы, и без ограничителя Kira
  // бесконечно бормотала «секунду… минутку… момент…»
  useEffect(() => {
    if (state !== 'thinking') return
    const fillers = ['Секунду…', 'Минутку…', 'Так, сейчас посмотрю…', 'Момент…']
    const id = setTimeout(() => {
      if (stateRef.current === 'thinking' && !ttsPlayingRef.current && !fillerSpokenRef.current) {
        fillerSpokenRef.current = true
        speak(fillers[Math.floor(Math.random() * fillers.length)])
      }
    }, 2800)
    return () => clearTimeout(id)
  }, [state, speak])

  return { state, level, lastError, start, stop, speak, stopSpeaking }
}

/** Режем текст на фразы для конвейерного синтеза (первая — короткая = быстрый старт). */
function splitSentences(text: string): string[] {
  const raw = text.match(/[^.!?…\n]+[.!?…]*\s*/g) ?? [text]
  const chunks: string[] = []
  let buf = ''
  for (const part of raw) {
    buf += part
    // накапливаем до ~180 символов, чтобы фразы не были слишком мелкими
    if (buf.trim().length >= 180 || /[.!?…]\s*$/.test(part)) {
      if (buf.trim()) chunks.push(buf.trim())
      buf = ''
    }
  }
  if (buf.trim()) chunks.push(buf.trim())
  // первую фразу делаем покороче — чтобы Kira заговорила быстрее
  if (chunks.length && chunks[0].length > 140) {
    const first = chunks[0]
    const cut = first.search(/[,;:]\s/)
    if (cut > 30 && cut < 130) {
      chunks[0] = first.slice(cut + 1).trim()
      chunks.unshift(first.slice(0, cut + 1).trim())
    }
  }
  return chunks.length ? chunks : [text]
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
