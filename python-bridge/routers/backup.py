import os
import sys
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from google.cloud import storage
from google.oauth2 import service_account

# File location: python-bridge/routers/backup.py
# parent is python-bridge/routers/, parent.parent is python-bridge/
BRIDGE_DIR = Path(os.path.dirname(os.path.abspath(__file__))).parent
GCP_BUCKET_NAME = os.getenv("GCP_BUCKET_NAME", "wealth-aggregator.firebasestorage.app")
GCP_CREDENTIALS_PATH = os.getenv("GCP_CREDENTIALS_PATH", str(BRIDGE_DIR / "gcp-credentials.json"))

router = APIRouter(prefix="/api/backup", tags=["backup"])

class BackupUploadRequest(BaseModel):
    userId: str
    backupData: dict

def get_gcs_bucket():
    creds_path = Path(GCP_CREDENTIALS_PATH)
    if not creds_path.is_absolute():
        creds_path = BRIDGE_DIR / GCP_CREDENTIALS_PATH

    if not creds_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"GCP credentials file not found at: {creds_path}"
        )

    try:
        credentials = service_account.Credentials.from_service_account_file(str(creds_path))
        client = storage.Client(credentials=credentials)
        bucket = client.bucket(GCP_BUCKET_NAME)
        return bucket
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to initialize GCP Cloud Storage client: {str(e)}"
        )

@router.post("/upload")
async def upload_backup(req: BackupUploadRequest):
    if not req.userId:
        raise HTTPException(status_code=400, detail="Missing userId")

    bucket = get_gcs_bucket()
    blob_path = f"backups/{req.userId}/wealth_backup.json"
    
    try:
        blob = bucket.blob(blob_path)
        # Compact serialization: smaller objects, faster downloads.
        # (json.loads on download is format-agnostic, so old indent=2 blobs stay readable.)
        json_str = json.dumps(req.backupData, separators=(",", ":"), ensure_ascii=False)
        blob.upload_from_string(json_str, content_type="application/json")
        return {"status": "success", "message": f"Successfully backed up to GCS path: {blob_path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload backup: {str(e)}")

@router.get("/download")
async def download_backup(userId: str):
    if not userId:
        raise HTTPException(status_code=400, detail="Missing userId")

    bucket = get_gcs_bucket()
    blob_path = f"backups/{userId}/wealth_backup.json"
    
    try:
        blob = bucket.blob(blob_path)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="No backup file found in cloud storage.")
            
        json_str = blob.download_as_text()
        data = json.loads(json_str)
        return {"status": "success", "backupData": data}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download backup: {str(e)}")
