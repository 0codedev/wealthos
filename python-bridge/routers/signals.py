"""
signals.py
FastAPI router exposing OCR parsing and live signal streaming endpoints.
"""
import json
import asyncio
import os
import sys
from fastapi import APIRouter, UploadFile, File, WebSocket, HTTPException
from fastapi.responses import JSONResponse
from logger import get_logger

log = get_logger("signals_router", tag="SIGNALS")
router = APIRouter()


@router.post("/api/ocr/parse")
async def parse_screenshot(image: UploadFile = File(...)):
    """
    Accept a screenshot upload and return a structured trade signal.
    Called by ocrService.ts when a new image arrives from Telegram.
    """
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
        from ocr_engine import extract_signal_from_image
        image_bytes = await image.read()
        signal = extract_signal_from_image(image_bytes)
        return JSONResponse(content=signal)
    except Exception as e:
        log.error(f"OCR Parsing failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.websocket("/ws/signals")
async def signal_stream(websocket: WebSocket):
    """
    WebSocket stream consumed by TelegramEarManager.ts.
    Pushes parsed signals in real time as Telethon receives them.
    """
    token = websocket.query_params.get("token")
    expected_token = os.getenv("TELEGRAM_EAR_TOKEN", os.getenv("BRIDGE_API_SECRET", "local-dev-token-v1"))
    is_prod = os.getenv("NODE_ENV") == "production" or os.getenv("ENVIRONMENT") == "production"

    if is_prod and (not token or token == "local-dev-token-v1" or token != expected_token):
        await websocket.close(code=1008, reason="Unauthorized")
        log.warning("WebSocket unauthorized connection rejected.")
        return
    elif token and expected_token and token != expected_token:
        await websocket.close(code=1008, reason="Unauthorized")
        log.warning("WebSocket unauthorized connection rejected.")
        return

    await websocket.accept()
    log.info("WebSocket connection established for signals.")
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
        from telegram_ear import signal_queue
        from ocr_engine import extract_signal_from_image

        while True:
            # Consume from queue
            try:
                payload = await asyncio.wait_for(signal_queue.get(), timeout=30.0)
                if payload.get("has_image") and payload.get("image_bytes"):
                    img_bytes = bytes(payload["image_bytes"])
                    parsed = extract_signal_from_image(img_bytes)
                    payload["parsed_signal"] = parsed
                await websocket.send_json(payload)
            except asyncio.TimeoutError:
                # Keep-alive ping
                await websocket.send_json({"type": "ping"})
    except Exception as e:
        log.warning(f"WebSocket client disconnected or failed: {e}")
    finally:
        log.info("WebSocket connection closed for signals.")
