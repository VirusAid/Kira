#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Silero TTS sidecar для Kira.

Локальный нейросетевой синтез речи (работает на CPU, не занимает GPU).
Лучшее качество русского голоса среди бесплатных open-source решений.

Протокол общения с Electron (line-delimited JSON через stdin/stdout):
  ← {"type":"ready"}                          — модель загружена
  → {"id":1,"text":"...","speaker":"xenia"}   — запрос синтеза
  ← {"id":1,"ok":true,"audio":"<base64 wav>"} — ответ (24 kHz mono WAV)
  ← {"id":1,"ok":false,"error":"..."}         — ошибка

Модель кэшируется в <userData>/silero. Голоса v4_ru:
  aidar, baya, kseniya, xenia, eugene  (+ random)
"""
import sys
import os
import io
import json
import wave
import base64

SAMPLE_RATE = 24000
# Основной источник — официальный; зеркало на HuggingFace как резерв
# (официальный host бывает недоступен из некоторых сетей).
MODEL_URLS = [
    "https://huggingface.co/Derur/silero-models/resolve/main/tts/ru/ru_v4/v4_ru.pt",
    "https://models.silero.ai/models/tts/ru/v4_ru.pt",
]
VALID_SPEAKERS = {"aidar", "baya", "kseniya", "xenia", "eugene", "random"}


def log(msg):
    print(json.dumps({"type": "log", "message": str(msg)}), flush=True)


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def load_model(cache_dir):
    import torch

    torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
    os.makedirs(cache_dir, exist_ok=True)
    model_path = os.path.join(cache_dir, "v4_ru.pt")

    # если модель вшита в установщик рядом со скриптом — берём её (без скачивания)
    if not os.path.exists(model_path):
        bundled = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model", "v4_ru.pt")
        if os.path.exists(bundled):
            import shutil
            log("Беру вшитую модель Silero…")
            shutil.copyfile(bundled, model_path)

    if not os.path.exists(model_path):
        log("Скачиваю модель Silero (~40 МБ, один раз)…")
        last_err = None
        for url in MODEL_URLS:
            try:
                torch.hub.download_url_to_file(url, model_path, progress=False)
                last_err = None
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
        if last_err is not None:
            raise last_err

    model = torch.package.PackageImporter(model_path).load_pickle("tts_models", "model")
    model.to(torch.device("cpu"))
    return model


def to_wav_base64(audio_tensor):
    import numpy as np

    audio = audio_tensor.numpy()
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm.tobytes())
    return base64.b64encode(buf.getvalue()).decode("ascii")


import re as _re
import torch as _torch


def _silence():
    return to_wav_base64(_torch.zeros(int(SAMPLE_RATE * 0.12)))


def synth(model, text, speaker):
    if speaker not in VALID_SPEAKERS:
        speaker = "xenia"
    text = (text or "").strip()
    # убираем то, что Silero не произносит и на чём падает: ссылки, домены, пути
    text = _re.sub(r"https?://\S+", " ", text)
    text = _re.sub(r"[A-Za-z0-9.\-_/]+\.[A-Za-z]{2,6}\S*", " ", text)  # домены/пути
    text = _re.sub(r"[A-Za-z]:\\\S+", " ", text)  # windows-пути
    text = _re.sub(r"\s+", " ", text).strip()
    # если нет кириллицы — произносить нечего, возвращаем короткую тишину (не падаем)
    if not _re.search(r"[а-яё]", text, _re.I):
        return _silence()
    try:
        audio = model.apply_tts(text=text[:1000], speaker=speaker, sample_rate=SAMPLE_RATE, put_accent=True, put_yo=True)
        return to_wav_base64(audio)
    except Exception:
        # вторая попытка: только буквы/цифры/базовая пунктуация
        clean = _re.sub(r"[^А-Яа-яЁёA-Za-z0-9 .,!?\-]", " ", text)
        clean = _re.sub(r"\s+", " ", clean).strip()
        if not _re.search(r"[а-яё]", clean, _re.I):
            return _silence()
        try:
            audio = model.apply_tts(text=clean[:1000], speaker=speaker, sample_rate=SAMPLE_RATE, put_accent=True, put_yo=True)
            return to_wav_base64(audio)
        except Exception:
            return _silence()


def main():
    cache_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.getcwd(), "silero")
    try:
        model = load_model(cache_dir)
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "error": f"Не удалось загрузить Silero: {e}"})
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
        req_id = req.get("id")
        try:
            audio = synth(model, req.get("text", ""), req.get("speaker", "xenia"))
            emit({"id": req_id, "ok": True, "audio": audio})
        except Exception as e:  # noqa: BLE001
            emit({"id": req_id, "ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
