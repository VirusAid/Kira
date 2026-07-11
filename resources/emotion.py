#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Emotion sidecar для Kira — грубая оценка эмоционального тона по голосу.

Считает просодические признаки (высота тона, энергия, темп) через librosa и
выдаёт короткий ярлык настроения. Не научная точность — сигнал для Kira, чтобы
подстроить тон ответа.

Вход (stdin, line-JSON): {"id":1,"pcm":"<base64 float32 LE, 16kHz mono>"}
Выход: {"id":1,"ok":true,"label":"спокойно","arousal":0.4,"pitch":150}
"""
import sys
import json
import base64
import numpy as np


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def analyze(wav, sr=16000):
    import librosa
    wav = wav.astype(np.float32)
    if len(wav) < sr // 2:
        return {"label": "нейтрально", "arousal": 0.5, "pitch": 0}
    # нормализуем громкость (микрофон/TTS уже нормализованы — опираемся на тон)
    peak = float(np.max(np.abs(wav))) or 1.0
    wav = wav / peak
    # динамика энергии (вариативность важнее абсолютной громкости)
    rms_frames = librosa.feature.rms(y=wav)[0]
    rms_var = float(np.std(rms_frames))
    # высота тона (f0) — главный признак возбуждения
    try:
        f0, _, _ = librosa.pyin(wav, fmin=80, fmax=400, sr=sr)
        f0v = f0[~np.isnan(f0)]
        pitch = float(np.median(f0v)) if len(f0v) else 0.0
        pitch_var = float(np.std(f0v)) if len(f0v) else 0.0
    except Exception:  # noqa: BLE001
        pitch, pitch_var = 0.0, 0.0

    # шкала возбуждения 0..1: тон выше нормы + его вариативность + динамика энергии
    hi = max(0.0, (pitch - 145) / 130) if pitch else 0.0
    lo = max(0.0, (150 - pitch) / 120) if pitch else 0.0
    arousal = min(1.0, hi * 0.6 + (pitch_var / 55) * 0.3 + (rms_var * 4) * 0.1)

    if arousal > 0.6 and pitch_var > 40:
        label = "воодушевлённо"
    elif arousal > 0.58:
        label = "взволнованно"
    elif lo > 0.35 and arousal < 0.32:
        label = "устало"
    elif arousal < 0.34:
        label = "спокойно, ровно"
    else:
        label = "спокойно"
    return {"label": label, "arousal": round(arousal, 2), "pitch": round(pitch, 1)}


def main():
    try:
        import librosa  # noqa: F401
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "error": f"librosa недоступна: {e}"})
        return
    emit({"type": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:  # noqa: BLE001
            continue
        rid = req.get("id")
        try:
            raw = base64.b64decode(req["pcm"])
            wav = np.frombuffer(raw, dtype="<f4")
            res = analyze(wav)
            res.update({"id": rid, "ok": True})
            emit(res)
        except Exception as e:  # noqa: BLE001
            emit({"id": rid, "ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
