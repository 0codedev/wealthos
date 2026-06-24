import logging
import tempfile
import os
from typing import Optional

log = logging.getLogger("voice_processor")
_model = None

def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        log.info("Loading Faster-Whisper model ('base'...)")
        # Use CPU with float32 or int8 quantizations
        _model = WhisperModel("base", device="cpu", compute_type="int8")
        log.info("Whisper model loaded.")
    return _model

def transcribe_audio_bytes(audio_bytes: bytes) -> Optional[str]:
    """Transcribes raw audio bytes into text locally."""
    try:
        model = get_model()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        
        segments, info = model.transcribe(tmp_path, language="en")
        text = " ".join([seg.text for seg in segments]).strip()
        os.remove(tmp_path)
        return text
    except Exception as e:
        log.error(f"Local transcription failed: {e}")
        return None
