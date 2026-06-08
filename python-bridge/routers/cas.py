"""
eCAS (Consolidated Account Statement) parser endpoint (CC51).
Wraps casparser (MIT, PyPI) for CAMS / KFintech statements.
v1: CAMS / KFintech only — NSDL / CDSL return a friendly "not supported" error.
"""
import os
import sys
import io
from fastapi import APIRouter, File, Form, UploadFile, HTTPException

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.shared import (
    parse_cas_pdf,
    CASUnreadableError,
    CASWrongPasswordError,
    CASIntegrityError_,
    NSDLNotSupportedError,
    CASParserUnavailableError,
)

router = APIRouter(prefix="/api/cas", tags=["cas"])


@router.post("/parse")
async def parse_cas(
    file: UploadFile = File(...),
    password: str = Form(default=""),
):
    """
    Accept an eCAS PDF (multipart upload, field name 'file') and an optional
    'password' form field (the investor's PAN, when the PDF is PAN-encrypted).
    Return parsed folios/schemes as JSON. The PDF is held in memory only and
    never written to disk.
    """
    ct = (file.content_type or "").lower()
    if ct and not (
        ct == "application/pdf"
        or ct == "application/octet-stream"
        or ct.startswith("application/")
    ):
        raise HTTPException(status_code=415, detail=f"Unsupported content-type: {ct}")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file")
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(
            status_code=400, detail="File does not look like a PDF (missing %PDF header)"
        )

    fileobj = io.BytesIO(pdf_bytes)

    try:
        result = parse_cas_pdf(fileobj, password=password)
    except CASUnreadableError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except CASWrongPasswordError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except CASIntegrityError_ as e:
        raise HTTPException(status_code=422, detail=str(e))
    except NSDLNotSupportedError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except CASParserUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        # Defensive: never let an unhandled error leak the PDF contents
        raise HTTPException(status_code=500, detail=f"eCAS parse failed: {type(e).__name__}")

    return {"status": "success", "result": result}
