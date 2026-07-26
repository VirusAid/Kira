/**
 * Микрофон — выбор устройства и открытие потока.
 *
 * Раньше Kira молча слушала «устройство по умолчанию» Windows. У многих
 * одновременно веб-камера, гарнитура и микрофон в мониторе, и Windows часто
 * выбирает не тот — Kira «не слышит», хотя микрофон работает. Теперь устройство
 * выбирается явно, а если выбранное исчезло (отключили гарнитуру), поток
 * открывается на системном и об этом честно сообщается, а не тихо молчит.
 */

export interface MicDevice {
  id: string
  label: string
}

/** Обработка звука, одинаковая везде: подавление эха, шума, авто-громкость. */
function audioConstraints(deviceId: string): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
  // exact — чтобы система не подменила устройство молча: подмену нужно заметить
  // и сказать о ней, а не гадать, почему Kira слышит не то
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : base
}

/**
 * Список микрофонов. Названия устройств браузер отдаёт только после того, как
 * доступ к звуку был выдан хотя бы раз — поэтому при пустых названиях сначала
 * коротко открываем поток и сразу закрываем.
 */
export async function listMicrophones(): Promise<MicDevice[]> {
  const read = async (): Promise<MediaDeviceInfo[]> =>
    (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')

  let inputs = await read()
  if (inputs.length && inputs.every((d) => !d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      inputs = await read()
    } catch { /* доступа нет — покажем устройства без названий */ }
  }
  return inputs.map((d, i) => ({
    id: d.deviceId,
    label: d.label || `Микрофон ${i + 1}`
  }))
}

export interface MicStream {
  stream: MediaStream
  /** Пришлось ли откатиться на системный микрофон (выбранный недоступен). */
  fellBack: boolean
}

/** Открыть поток с выбранного микрофона; если его нет — с системного. */
export async function openMicStream(deviceId: string): Promise<MicStream> {
  if (deviceId) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId) }), fellBack: false }
    } catch { /* устройство отключили или занято — ниже пробуем системное */ }
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints('') })
  return { stream, fellBack: !!deviceId }
}
