# webrtcvad stub for resemblyzer.
#
# The real webrtcvad is a C-extension with no wheels for Python 3.14.
# resemblyzer only uses it to trim leading/trailing silence before building
# the speaker embedding. This stub reports "speech" for every frame, i.e. it
# disables trimming. For the short voice commands Kira records this has no
# noticeable effect on embedding quality.
#
# The installer (Установить Kira.bat) copies this file into pyenv/ so that
# `import webrtcvad` succeeds without the native extension.


class Vad:
    def __init__(self, mode=0):
        self.mode = mode

    def set_mode(self, mode):
        self.mode = mode

    def is_speech(self, frame, sample_rate):
        return True
