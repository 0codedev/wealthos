#!/usr/bin/env python
"""
GCP Cloud Backup System for Wealth Dashboard v2
Supports smart incremental sync, zipped checkpoints, and restoring data.
"""

import os
import sys
import argparse
import zipfile
import time
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed

# Try importing google-cloud-storage
try:
    from google.cloud import storage
    from google.oauth2 import service_account
except ImportError:
    print("Error: google-cloud-storage is not installed. Run 'pip install -r requirements.txt'")
    sys.exit(1)

# Try importing tqdm for progress bars, fallback to basic logging
try:
    from tqdm import tqdm
except ImportError:
    tqdm = None

# Resolve paths
BRIDGE_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = BRIDGE_DIR / "data"

# Load environment variables
parent_dir = BRIDGE_DIR.parent
dotenv_path = parent_dir / ".env"
if dotenv_path.exists():
    load_dotenv(dotenv_path)
else:
    load_dotenv()

# GCP Default Config
GCP_BUCKET_NAME = os.getenv("GCP_BUCKET_NAME")
GCP_CREDENTIALS_PATH = os.getenv("GCP_CREDENTIALS_PATH", str(BRIDGE_DIR / "gcp-credentials.json"))

def get_storage_client(creds_path):
    """Initializes and returns a GCS Storage client."""
    # Resolve relative credentials path
    resolved_path = Path(creds_path)
    if not resolved_path.is_absolute():
        # Try relative to current working dir first, then script dir
        if not resolved_path.exists():
            resolved_path = BRIDGE_DIR / creds_path
            
    if not resolved_path.exists():
        print(f"\n[ERROR] GCP credentials file not found at: {creds_path} (Resolved: {resolved_path.absolute()})")
        print("Please place your Service Account JSON key at this path or configure GCP_CREDENTIALS_PATH in your .env file.")
        print("Verify your file is named exactly 'gcp-credentials.json' and is located in the 'python-bridge/' folder.")
        sys.exit(1)
    
    try:
        credentials = service_account.Credentials.from_service_account_file(str(resolved_path))
        client = storage.Client(credentials=credentials)
        return client
    except Exception as e:
        print(f"[ERROR] Failed to initialize Google Cloud Storage client: {e}")
        sys.exit(1)

def get_bucket(client, bucket_name):
    """Retrieves the bucket reference lazily to bypass bucket-level permissions check."""
    if not bucket_name:
        print("\n[ERROR] GCP_BUCKET_NAME is not set.")
        print("Please define GCP_BUCKET_NAME in your .env file or use the --bucket CLI argument.")
        sys.exit(1)
    # Using client.bucket() instead of get_bucket() avoids requiring 'storage.buckets.get' permission.
    # It allows service accounts with 'Storage Object Admin' to sync objects successfully.
    return client.bucket(bucket_name)

def get_local_files():
    """Traverses the local data directory and yields relative paths and absolute paths."""
    if not DATA_DIR.exists():
        print(f"[WARNING] Local data directory does not exist: {DATA_DIR}")
        return {}
    
    local_files = {}
    for root, _, files in os.walk(DATA_DIR):
        for file in files:
            # Skip SQLite databases or temporary lock files just in case
            if file.endswith((".db", "-wal", "-shm", ".tmp", ".log")):
                continue
            
            abs_path = Path(root) / file
            # Relative path from python-bridge/ (e.g. data/options/NIFTY/...)
            rel_path = abs_path.relative_to(BRIDGE_DIR).as_posix()
            local_files[rel_path] = {
                "abs_path": abs_path,
                "size": abs_path.stat().st_size
            }
    return local_files

def get_remote_files(bucket, prefix="data/"):
    """Fetches all blobs under the prefix in GCS and parses their metadata."""
    print(f"Fetching remote metadata from bucket '{bucket.name}'...")
    blobs = bucket.list_blobs(prefix=prefix)
    remote_files = {}
    for blob in blobs:
        remote_files[blob.name] = {
            "size": blob.size,
            "updated": blob.updated
        }
    return remote_files

def upload_single_file(bucket, rel_path, abs_path):
    """Worker function to upload a single file to GCS."""
    blob = bucket.blob(rel_path)
    blob.upload_from_filename(str(abs_path))
    return rel_path

def run_sync_upload(bucket, dry_run=False, force=False, workers=20):
    """Compares local files with GCS and uploads missing or modified files in parallel."""
    local_files = get_local_files()
    remote_files = get_remote_files(bucket)
    
    to_upload = []
    already_synced_count = 0
    total_upload_size = 0
    
    for rel_path, info in local_files.items():
        local_size = info["size"]
        if rel_path in remote_files:
            remote_size = remote_files[rel_path]["size"]
            if local_size == remote_size and not force:
                already_synced_count += 1
                continue
        
        # Mark for upload
        to_upload.append((rel_path, info["abs_path"], local_size))
        total_upload_size += local_size

    print("\n--- Sync Status ---")
    print(f"Total Local Files: {len(local_files)}")
    print(f"Already In Sync:   {already_synced_count}")
    print(f"Files to Upload:   {len(to_upload)} ({total_upload_size / (1024*1024):.2f} MB)")
    print("-------------------")
    
    if len(to_upload) == 0:
        print("Everything is up-to-date! No uploads needed.")
        return
        
    if dry_run:
        print("\n[DRY RUN] The following files would be uploaded:")
        for rel_path, _, size in to_upload[:15]:
            print(f"  - {rel_path} ({size / 1024:.1f} KB)")
        if len(to_upload) > 15:
            print(f"  ... and {len(to_upload) - 15} more files.")
        return

    print(f"\nStarting parallel upload of {len(to_upload)} files using {workers} workers...")
    
    success_count = 0
    failed_count = 0
    
    # Run uploads in parallel using ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_file = {
            executor.submit(upload_single_file, bucket, rel_path, abs_path): rel_path
            for rel_path, abs_path, _ in to_upload
        }
        
        if tqdm:
            progress = tqdm(as_completed(future_to_file), total=len(to_upload), desc="Uploading", unit="file")
        else:
            progress = as_completed(future_to_file)
            
        for future in progress:
            rel_path = future_to_file[future]
            try:
                future.result()
                success_count += 1
            except Exception as e:
                if not tqdm:
                    print(f"[ERROR] Failed to upload {rel_path}: {e}")
                failed_count += 1
                
    print(f"\nSync complete! Success: {success_count}, Failed: {failed_count}")

def run_checkpoint_upload(bucket, dry_run=False):
    """Zips the local data directory and uploads it as a checkpoint."""
    if not DATA_DIR.exists():
        print(f"[ERROR] Local data directory does not exist: {DATA_DIR}")
        return

    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    zip_filename = f"backup_{timestamp}.zip"
    temp_zip_path = BRIDGE_DIR / f"temp_{zip_filename}"
    gcs_dest_path = f"checkpoints/{zip_filename}"

    if dry_run:
        print(f"[DRY RUN] Would compress local 'data/' directory to '{zip_filename}' and upload to 'checkpoints/'.")
        return

    print(f"Compressing local 'data/' folder into {temp_zip_path.name}...")
    
    local_files = get_local_files()
    if len(local_files) == 0:
        print("No files to zip inside data folder.")
        return

    # Zip files
    try:
        with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            if tqdm:
                file_list = tqdm(local_files.items(), desc="Zipping", unit="file")
            else:
                file_list = local_files.items()
                
            for rel_path, info in file_list:
                # Store relative to DATA_DIR so it unzips directly into target folder structure
                archive_name = info["abs_path"].relative_to(DATA_DIR).as_posix()
                zipf.write(info["abs_path"], archive_name)
    except Exception as e:
        print(f"[ERROR] Zipping failed: {e}")
        if temp_zip_path.exists():
            temp_zip_path.unlink()
        return

    zip_size_mb = temp_zip_path.stat().st_size / (1024*1024)
    print(f"Zip completed successfully. Size: {zip_size_mb:.2f} MB")
    
    # Upload to GCS
    print(f"Uploading zip to GCP Cloud Storage: {gcs_dest_path}...")
    try:
        blob = bucket.blob(gcs_dest_path)
        blob.upload_from_filename(str(temp_zip_path))
        print(f"Successfully uploaded checkpoint backup to GCS: {gcs_dest_path}")
    except Exception as e:
        print(f"[ERROR] Uploading zip failed: {e}")
    finally:
        # Cleanup local temp zip
        if temp_zip_path.exists():
            temp_zip_path.unlink()
            print("Removed local temporary zip file.")

def download_single_file(bucket, rel_path, local_dest_path):
    """Worker function to download a single file from GCS."""
    local_dest_path.parent.mkdir(parents=True, exist_ok=True)
    blob = bucket.blob(rel_path)
    blob.download_to_filename(str(local_dest_path))
    return rel_path

def run_sync_restore(bucket, dry_run=False, force=False, workers=20):
    """Restores files from GCS to local directory incrementally in parallel."""
    remote_files = get_remote_files(bucket)
    local_files = get_local_files()

    to_download = []
    already_restored_count = 0
    total_download_size = 0

    for rel_path, info in remote_files.items():
        # Only download files under data/ prefix
        if not rel_path.startswith("data/"):
            continue
            
        remote_size = info["size"]
        if rel_path in local_files:
            local_size = local_files[rel_path]["size"]
            if local_size == remote_size and not force:
                already_restored_count += 1
                continue

        to_download.append((rel_path, remote_size))
        total_download_size += remote_size

    print("\n--- Restore Status ---")
    print(f"Total Remote Files: {len(remote_files)}")
    print(f"Already Matching:   {already_restored_count}")
    print(f"Files to Download:  {len(to_download)} ({total_download_size / (1024*1024):.2f} MB)")
    print("----------------------")

    if len(to_download) == 0:
        print("Local directory matches GCS perfectly! No restore needed.")
        return

    if dry_run:
        print("\n[DRY RUN] The following files would be downloaded from GCS:")
        for rel_path, size in to_download[:15]:
            print(f"  - {rel_path} ({size / 1024:.1f} KB)")
        if len(to_download) > 15:
            print(f"  ... and {len(to_download) - 15} more files.")
        return

    print(f"\nRestoring {len(to_download)} files from cloud using {workers} parallel workers...")
    
    success_count = 0
    failed_count = 0

    # Run downloads in parallel using ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_file = {}
        for rel_path, _ in to_download:
            local_dest_path = BRIDGE_DIR / rel_path
            future = executor.submit(download_single_file, bucket, rel_path, local_dest_path)
            future_to_file[future] = rel_path
            
        if tqdm:
            progress = tqdm(as_completed(future_to_file), total=len(to_download), desc="Downloading", unit="file")
        else:
            progress = as_completed(future_to_file)
            
        for future in progress:
            rel_path = future_to_file[future]
            try:
                future.result()
                success_count += 1
            except Exception as e:
                if not tqdm:
                    print(f"[ERROR] Failed to download {rel_path}: {e}")
                failed_count += 1

    print(f"\nRestore complete! Success: {success_count}, Failed: {failed_count}")

def run_checkpoint_restore(bucket, checkpoint_name=None, dry_run=False):
    """Lists checkpoints in GCS, downloads and extracts the selected checkpoint."""
    # List all checkpoints
    blobs = bucket.list_blobs(prefix="checkpoints/")
    checkpoints = [blob.name for blob in blobs if blob.name.endswith(".zip")]

    if not checkpoints:
        print("[ERROR] No zipped checkpoints found in GCS under checkpoints/ directory.")
        return

    # Sort checkpoints alphabetically/chronologically
    checkpoints.sort(reverse=True)

    selected_checkpoint = checkpoint_name
    if not selected_checkpoint:
        print("\nAvailable checkpoints in GCS:")
        for idx, cp in enumerate(checkpoints):
            print(f"  [{idx}] {cp.split('/')[-1]}")
        print(f"\nDefaulting to latest checkpoint: {checkpoints[0].split('/')[-1]}")
        selected_checkpoint = checkpoints[0]
    else:
        # Format input name if user just typed 'backup_XXX.zip'
        if not selected_checkpoint.startswith("checkpoints/"):
            selected_checkpoint = f"checkpoints/{selected_checkpoint}"
        if selected_checkpoint not in checkpoints:
            print(f"[ERROR] Specified checkpoint '{checkpoint_name}' not found in bucket.")
            return

    cp_filename = selected_checkpoint.split("/")[-1]
    temp_zip_path = BRIDGE_DIR / f"temp_restore_{cp_filename}"

    if dry_run:
        print(f"[DRY RUN] Would download '{selected_checkpoint}' from GCS and extract into '{DATA_DIR}'.")
        return

    # Download checkpoint
    print(f"Downloading checkpoint: {selected_checkpoint}...")
    try:
        blob = bucket.blob(selected_checkpoint)
        blob.download_to_filename(str(temp_zip_path))
        print("Download completed. Extracting zip archive...")
    except Exception as e:
        print(f"[ERROR] Failed to download checkpoint: {e}")
        if temp_zip_path.exists():
            temp_zip_path.unlink()
        return

    # Extract checkpoint
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(temp_zip_path, 'r') as zipf:
            zip_infos = zipf.infolist()
            
            if tqdm:
                zip_files = tqdm(zip_infos, desc="Extracting", unit="file")
            else:
                zip_files = zip_infos
                
            for info in zip_files:
                if not tqdm:
                    print(f"Extracting {info.filename}...")
                zipf.extract(info, path=DATA_DIR)
                
        print(f"\nCheckpoint restore completed! Data extracted to: {DATA_DIR}")
    except Exception as e:
        print(f"[ERROR] Extraction failed: {e}")
    finally:
        if temp_zip_path.exists():
            temp_zip_path.unlink()
            print("Cleaned up temporary restore zip file.")

def run_status(bucket):
    """Displays synchronization status between local directory and GCS."""
    local_files = get_local_files()
    remote_files = get_remote_files(bucket)

    local_total_size = sum(f["size"] for f in local_files.values())
    remote_data_files = {k: v for k, v in remote_files.items() if k.startswith("data/")}
    remote_total_size = sum(f["size"] for f in remote_data_files.values())

    # Get checkpoints
    blobs = bucket.list_blobs(prefix="checkpoints/")
    checkpoints = [blob for blob in blobs if blob.name.endswith(".zip")]

    print("\n========= Cloud Backup Status Summary =========")
    print(f"Bucket Name:            {bucket.name}")
    print(f"Local Data Folder Path: {DATA_DIR}")
    print(f"Local Data File Count:  {len(local_files)}")
    print(f"Local Data Total Size:  {local_total_size / (1024*1024):.2f} MB")
    print(f"Remote Data File Count: {len(remote_data_files)}")
    print(f"Remote Data Total Size: {remote_total_size / (1024*1024):.2f} MB")
    print(f"Zipped Checkpoints:     {len(checkpoints)}")
    
    if checkpoints:
        print("\nLast 5 Checkpoints:")
        checkpoints.sort(key=lambda x: x.name, reverse=True)
        for cp in checkpoints[:5]:
            print(f"  - {cp.name.split('/')[-1]} ({cp.size / (1024*1024):.2f} MB) - Uploaded: {cp.updated}")
    print("===============================================")

def main():
    parser = argparse.ArgumentParser(description="Wealth Dashboard GCP Backup Utility")
    parser.add_argument("--action", choices=["sync", "checkpoint", "restore", "status"], default="sync",
                        help="Action to perform: sync (incremental upload), checkpoint (zip & upload), restore (download), status (details)")
    parser.add_argument("--bucket", help="Google Cloud Storage Bucket Name (Overrides GCP_BUCKET_NAME env)")
    parser.add_argument("--credentials", help="Path to Service Account JSON Key (Overrides GCP_CREDENTIALS_PATH env)")
    parser.add_argument("--dry-run", action="store_true", help="Print operations without executing them")
    parser.add_argument("--force", action="store_true", help="Force upload or download even if size matches")
    parser.add_argument("--source", choices=["sync", "checkpoint"], default="sync",
                        help="Only used with 'restore'. Restore dynamically (sync) or via zipped checkpoint (checkpoint)")
    parser.add_argument("--checkpoint-name", help="Specific checkpoint zip filename to restore. Default is latest.")
    parser.add_argument("--workers", type=int, default=20,
                        help="Number of concurrent worker threads for sync upload/download. Default is 20.")

    args = parser.parse_args()

    # Determine configuration values
    bucket_name = args.bucket or GCP_BUCKET_NAME
    creds_path = args.credentials or GCP_CREDENTIALS_PATH

    print("====================================================")
    print(f"Wealth Dashboard Cloud Backup Tool | Action: {args.action.upper()}")
    print("====================================================")

    # Initialize GCP Client
    client = get_storage_client(creds_path)
    bucket = get_bucket(client, bucket_name)

    if args.action == "sync":
        run_sync_upload(bucket, dry_run=args.dry_run, force=args.force, workers=args.workers)
    elif args.action == "checkpoint":
        run_checkpoint_upload(bucket, dry_run=args.dry_run)
    elif args.action == "restore":
        if args.source == "sync":
            run_sync_restore(bucket, dry_run=args.dry_run, force=args.force, workers=args.workers)
        else:
            run_checkpoint_restore(bucket, checkpoint_name=args.checkpoint_name, dry_run=args.dry_run)
    elif args.action == "status":
        run_status(bucket)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nOperation aborted by user.")
        sys.exit(0)
