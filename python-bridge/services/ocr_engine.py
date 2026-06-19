"""
ocr_engine.py
EasyOCR-based screenshot parser.
Converts advisory channel image bytes into structured trade signals.
"""
import re
import logging
from typing import Optional

log = logging.getLogger("ocr_engine")
_reader = None  # Lazy-load to avoid startup delay


def get_reader():
    global _reader
    if _reader is None:
        import easyocr
        log.info("Loading EasyOCR model (first run downloads ~150MB)...")
        _reader = easyocr.Reader(['en'], gpu=False, verbose=False)
        log.info("EasyOCR model loaded.")
    return _reader


def extract_signal_from_image(image_bytes: bytes) -> dict:
    """
    Parse a screenshot (bytes) into a structured trade signal.
    Returns dict with symbol, action, cmp, sl, target fields.
    """
    try:
        reader = get_reader()
        results = reader.readtext(image_bytes, detail=0)  # text strings only
        full_text = " ".join(results)
        log.debug(f"OCR raw text: {full_text[:200]}")
        return parse_signal_text(full_text)
    except Exception as e:
        log.error(f"OCR extraction failed: {e}")
        return {"raw_text": "", "error": str(e)}


def parse_signal_text(text: str) -> dict:
    """
    Extract structured fields from raw OCR text.
    Handles common Indian advisory channel formats.
    """
    signal = {"raw_text": text, "confidence": "medium"}

    # ── Stock symbol ──────────────────────────────────────────────────────
    # Matches: NSE symbols like SBIN, RELIANCE, BANKNIFTY, NIFTY24500CE
    sym = re.search(
        r'\b(NIFTY\s*\d+\s*(?:CE|PE)?|BANKNIFTY\s*\d+\s*(?:CE|PE)?'
        r'|[A-Z]{3,12}(?:-EQ)?)\b', text
    )
    if sym: signal["symbol"] = sym.group().replace(" ", "")

    # ── Action ───────────────────────────────────────────────────────────
    if re.search(r'\bBUY\b|\bLONG\b|\bACCUMULATE\b', text, re.I):
        signal["action"] = "BUY"
    elif re.search(r'\bSELL\b|\bSHORT\b|\bEXIT\b', text, re.I):
        signal["action"] = "SELL"

    # ── Prices ───────────────────────────────────────────────────────────
    def extract_price(pattern: str) -> Optional[str]:
        m = re.search(pattern, text, re.I)
        return m.group(1) if m else None

    signal["cmp"]    = extract_price(r'(?:CMP|LTP|PRICE)[:\s=₹]*(\d+\.?\d*)')
    signal["sl"]     = extract_price(r'(?:SL|STOP\s*LOSS|STOPLOSS)[:\s=₹]*(\d+\.?\d*)')
    signal["target"] = extract_price(r'(?:TGT|TARGET|TP)[:\s=₹]*(\d+\.?\d*)')

    return signal
