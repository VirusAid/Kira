# -*- coding: utf-8 -*-
"""
webrtcvad для Python 3.14 — полноценная чистая реализация энергетического VAD.

Оригинальный webrtcvad — C-расширение без колёс под 3.14. Этот модуль повторяет
его API (Vad, set_mode, is_speech) и РЕАЛЬНО детектирует речь по энергии кадра
(RMS) с порогами по агрессивности режима. resemblyzer использует его для
обрезки тишины перед построением голосового эмбеддинга — с этой реализацией
тримминг работает по-настоящему (resemblyzer нормализует аудио к -30 dBFS,
поэтому фиксированные пороги стабильны).

API совместим с webrtcvad 2.x:
    vad = Vad(mode)          # mode 0..3, выше = агрессивнее режет тишину
    vad.is_speech(frame, sample_rate)   # frame: 10/20/30 мс 16-bit mono PCM
"""
import array
import math


class Vad:
    # RMS-пороги (int16) для аудио, нормализованного к ~-30 dBFS:
    # речь даёт RMS 1500–8000, шум/тишина — до нескольких сотен.
    _THRESHOLDS = {0: 150.0, 1: 300.0, 2: 500.0, 3: 700.0}

    def __init__(self, mode=1):
        self._mode = 1
        self.set_mode(mode)

    def set_mode(self, mode):
        if mode not in (0, 1, 2, 3):
            raise ValueError("mode must be 0, 1, 2 or 3")
        self._mode = mode

    def is_speech(self, buf, sample_rate, length=None):
        if sample_rate not in (8000, 16000, 32000, 48000):
            raise ValueError("sample rate must be 8000, 16000, 32000 or 48000")
        data = bytes(buf)
        if length is not None:
            data = data[: length * 2]
        usable = len(data) // 2 * 2
        if usable == 0:
            return False
        pcm = array.array("h")
        pcm.frombytes(data[:usable])
        acc = 0
        for s in pcm:
            acc += s * s
        rms = math.sqrt(acc / len(pcm))
        return rms >= self._THRESHOLDS[self._mode]


def valid_rate_and_frame_length(rate, frame_length):
    """Совместимость с API webrtcvad."""
    if rate not in (8000, 16000, 32000, 48000):
        return False
    ms = frame_length * 1000 // rate
    return ms in (10, 20, 30)
