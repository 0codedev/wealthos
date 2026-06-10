from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
import sys
import os

router = APIRouter()

@router.post("/api/speech-to-text")
async def transcribe_audio(audio: UploadFile = File(...)):
    """Transcribe uploaded audio file to text locally using Faster-Whisper."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
        from voice_processor import transcribe_audio_bytes
        audio_data = await audio.read()
        text = transcribe_audio_bytes(audio_data)
        if text is None:
            raise HTTPException(status_code=500, detail="Transcription failed")
        return {"transcript": text, "source": "faster-whisper"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
