#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Embeddings sidecar для Kira — семантическая память.

Локально считает эмбеддинги текста (multilingual-e5-small, работает на CPU,
хорошо понимает русский). Позволяет искать по СМЫСЛУ, а не по словам.

Протокол (line-JSON через stdin/stdout):
  ← {"type":"ready","dim":384}
  → {"id":1,"texts":["...","..."]}
  ← {"id":1,"ok":true,"vectors":[[...],[...]]}
"""
import sys
import os
import json

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else None
    try:
        from fastembed import TextEmbedding
        model = TextEmbedding(model_name=MODEL, cache_dir=cache)
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "error": f"Не удалось загрузить модель эмбеддингов: {e}"})
        return
    emit({"type": "ready", "dim": 384})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:  # noqa: BLE001
            continue
        rid = req.get("id")
        texts = req.get("texts", [])
        try:
            vecs = [v.tolist() for v in model.embed(texts)]
            emit({"id": rid, "ok": True, "vectors": vecs})
        except Exception as e:  # noqa: BLE001
            emit({"id": rid, "ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
