#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Speaker sidecar для Kira — узнавание голоса (verification).

Считает голосовой «отпечаток» (d-vector, 256) через resemblyzer. Kira сравнивает
его с эталоном хозяина и реагирует только на его голос.

Вход (stdin, line-JSON): {"id":1,"pcm":"<base64 float32 LE, 16kHz mono>"}
Выход: {"id":1,"ok":true,"vector":[...]}  |  {"id":1,"ok":false,"error":"..."}
"""
import sys
import json
import base64
import numpy as np


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    try:
        from resemblyzer import VoiceEncoder, preprocess_wav
        enc = VoiceEncoder("cpu", verbose=False)
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "error": f"Не удалось загрузить модель голоса: {e}"})
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
            wav = np.frombuffer(raw, dtype="<f4").astype(np.float32)
            wav = preprocess_wav(wav, source_sr=16000)
            vec = enc.embed_utterance(wav)
            emit({"id": rid, "ok": True, "vector": vec.tolist()})
        except Exception as e:  # noqa: BLE001
            emit({"id": rid, "ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
