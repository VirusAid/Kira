#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Vosk STT sidecar — офлайн-распознавание ГОТОВОЙ записи (WAV) для Kira.

Резервный путь, когда облачный Whisper (Groq) недоступен: нет интернета или
не задан ключ. Использует ту же модель, что и wake-word (vosk-model-small-ru).

Протокол (line-delimited JSON через stdin/stdout):
  ← {"type":"ready"}                        — модель загружена
  → {"id":1,"wav":"<base64 wav>"}           — запрос распознавания
  ← {"id":1,"ok":true,"text":"..."}         — результат
  ← {"id":1,"ok":false,"error":"..."}       — ошибка
"""
import sys
import os
import io
import json
import base64
import wave


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    model_dir = sys.argv[1] if len(sys.argv) > 1 else "model"
    if not os.path.isdir(model_dir):
        emit({"type": "error", "error": f"Модель Vosk не найдена: {model_dir}"})
        return
    try:
        from vosk import Model, KaldiRecognizer, SetLogLevel
        SetLogLevel(-1)
        model = Model(model_dir)
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "error": f"Не удалось загрузить Vosk: {e}"})
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
            raw = base64.b64decode(req.get("wav", ""))
            wf = wave.open(io.BytesIO(raw), "rb")
            rate = wf.getframerate()
            # распознаём с частотой из заголовка WAV (renderer шлёт 16 kHz mono 16-bit)
            rec = KaldiRecognizer(model, rate)
            rec.SetWords(False)
            while True:
                data = wf.readframes(4000)
                if not data:
                    break
                rec.AcceptWaveform(data)
            res = json.loads(rec.FinalResult())
            emit({"id": rid, "ok": True, "text": res.get("text", "").strip()})
        except Exception as e:  # noqa: BLE001
            emit({"id": rid, "ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
