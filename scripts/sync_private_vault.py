#!/usr/bin/env python3
"""
WealthOS Seamless Vault & Legacy Sync Engine
Non-destructive incremental synchronization between active WealthOS project,
the legacy development workspace, and the private WealthOS Master Vault.
"""

import os
import sys
import shutil
import filecmp
from datetime import datetime

# Configure UTF-8 stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ACTIVE_DIR = r"C:\Users\gadda\Desktop\Projects\wealthos"
LEGACY_DIR = r"C:\Users\gadda\Desktop\Projects\1. Wealth Dashboard v2"
VAULT_DIR = r"C:\Users\gadda\Desktop\WealthOS_Master_Vault\00_Repository_Docs_Master"

IGNORED_DIRS = {
    '.git', 'node_modules', 'dist', 'dist-ssr', 'build', '__pycache__',
    '.pytest_cache', '.ruff_cache', 'venv', '.venv', '.idea', '.vscode'
}

IGNORED_FILES = {
    'cache.db', 'Desktop.ini', 'Thumbs.db', '.DS_Store'
}

def sync_directories(src, dest, dest_name):
    print(f"\n=======================================================")
    print(f"[*] Starting Sync: Active WealthOS -> {dest_name}")
    print(f"    Source: {src}")
    print(f"    Target: {dest}")
    print(f"=======================================================")

    if not os.path.exists(dest):
        print(f"[!] Target directory does not exist: {dest}. Skipping.")
        return 0, 0

    copied = 0
    updated = 0
    skipped = 0

    for root, dirs, files in os.walk(src):
        # Prune ignored directories
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]

        rel_path = os.path.relpath(root, src)
        dest_root = os.path.join(dest, rel_path)

        for f in files:
            if f in IGNORED_FILES or f.endswith(('.pyc', '.log')):
                continue

            src_file = os.path.join(root, f)
            dest_file = os.path.join(dest_root, f)

            if not os.path.exists(dest_file):
                # New file in active project: copy to target
                os.makedirs(dest_root, exist_ok=True)
                shutil.copy2(src_file, dest_file)
                copied += 1
            else:
                # File exists in both: check if active project file is newer/different
                src_stat = os.stat(src_file)
                dest_stat = os.stat(dest_file)

                if src_stat.st_mtime > dest_stat.st_mtime and not filecmp.cmp(src_file, dest_file, shallow=False):
                    shutil.copy2(src_file, dest_file)
                    updated += 1
                else:
                    skipped += 1

    print(f"[+] Sync completed for {dest_name}:")
    print(f"    - New files transferred: {copied}")
    print(f"    - Updated files synchronized: {updated}")
    print(f"    - Unchanged files preserved: {skipped}")
    print(f"    - Target-only files (legacy docs/notes): 100% PRESERVED (Zero Deletions)")
    return copied, updated

def main():
    start_time = datetime.now()
    print("=======================================================")
    print("🦁 WealthOS Automated Safe Synchronizer")
    print(f"Timestamp: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("Mode: Non-Destructive Incremental Safe Sync")
    print("=======================================================")

    # 1. Sync Active -> Legacy Workspace
    sync_directories(ACTIVE_DIR, LEGACY_DIR, "Legacy Workspace (1. Wealth Dashboard v2)")

    # 2. Sync Active -> Master Vault (if vault exists)
    if os.path.exists(VAULT_DIR):
        sync_directories(ACTIVE_DIR, VAULT_DIR, "WealthOS Master Vault (Private)")

    duration = (datetime.now() - start_time).total_seconds()
    print(f"\n[OK] All sync targets updated safely in {duration:.2f}s.")

if __name__ == '__main__':
    main()
