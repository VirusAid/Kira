#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Vosk wake-word sidecar для Kira.

Непрерывное ЛОКАЛЬНОЕ распознавание речи (офлайн, без облака) для детекции
слова-активатора «Кира». Аудио приходит из Electron: сырой PCM 16 kHz, 16-bit,
mono — бинарными кадрами через stdin. На stdout — JSON-строки:

  {"type":"ready"}                     — модель загружена
  {"type":"partial","text":"..."}      — промежуточное распознавание
  {"type":"final","text":"..."}        — финал фразы (после паузы)

Протокол stdin: [4 байта длины кадра LE][PCM-данные] ...
"""
import sys
import os
import json
import struct

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
        rec = KaldiRecognizer(model, 16000)
        rec.SetWords(False)
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "error": f"Не удалось загрузить Vosk: {e}"})
        return

    emit({"type": "ready"})

    stdin = sys.stdin.buffer
    while True:
        header = stdin.read(4)
        if len(header) < 4:
            break
        (length,) = struct.unpack("<I", header)
        if length == 0:
            continue
        data = b""
        while len(data) < length:
            chunk = stdin.read(length - len(data))
            if not chunk:
                break
            data += chunk
        if len(data) < length:
            break
        try:
            if rec.AcceptWaveform(data):
                res = json.loads(rec.Result())
                text = res.get("text", "").strip()
                if text:
                    emit({"type": "final", "text": text})
            else:
                res = json.loads(rec.PartialResult())
                text = res.get("partial", "").strip()
                if text:
                    emit({"type": "partial", "text": text})
        except Exception:  # noqa: BLE001
            continue

if __name__ == "__main__":
    main()
