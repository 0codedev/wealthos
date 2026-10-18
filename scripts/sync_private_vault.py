#!/usr/bin/env python3
"""
WealthOS Intelligent Vault & Workspace Synchronizer
- Target 1: Legacy Workspace (1. Wealth Dashboard v2) -> Mirrors ALL code, components, and scripts non-destructively.
- Target 2: Master Vault (00_Repository_Docs_Master) -> Mirrors ONLY official documentation, architecture volumes, and governance manuals.
Zero deletions invariant: target-only files, private docs, and backups are 100% preserved.
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
VAULT_DOCS_DIR = r"C:\Users\gadda\Desktop\WealthOS_Master_Vault\00_Repository_Docs_Master"

IGNORED_DIRS = {
    '.git', 'node_modules', 'dist', 'dist-ssr', 'build', '__pycache__',
    '.pytest_cache', '.ruff_cache', 'venv', '.venv', '.idea', '.vscode'
}

IGNORED_FILES = {
    'cache.db', 'Desktop.ini', 'Thumbs.db', '.DS_Store'
}

DOCS_ONLY_EXTS = {'.md', '.txt', '.png', '.jpg', '.jpeg', '.svg'}
DOCS_ONLY_DIRS = {'architecture_volumes'}

def sync_full_codebase(src, dest):
    """Syncs all code, scripts, styles, and configs non-destructively to legacy workspace."""
    print(f"\n[*] Target 1: Full Codebase Mirror -> {dest}")
    if not os.path.exists(dest):
        print(f"[!] Legacy destination {dest} not found. Skipping.")
        return 0, 0

    copied = 0
    updated = 0
    skipped = 0

    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
        rel_path = os.path.relpath(root, src)
        dest_root = os.path.join(dest, rel_path)

        for f in files:
            if f in IGNORED_FILES or f.endswith(('.pyc', '.log')):
                continue

            src_file = os.path.join(root, f)
            dest_file = os.path.join(dest_root, f)

            if not os.path.exists(dest_file):
                os.makedirs(dest_root, exist_ok=True)
                shutil.copy2(src_file, dest_file)
                copied += 1
            else:
                src_stat = os.stat(src_file)
                dest_stat = os.stat(dest_file)
                if src_stat.st_mtime > dest_stat.st_mtime and not filecmp.cmp(src_file, dest_file, shallow=False):
                    shutil.copy2(src_file, dest_file)
                    updated += 1
                else:
                    skipped += 1

    print(f"[+] Codebase sync complete:")
    print(f"    - New files added: {copied}")
    print(f"    - Modified files updated: {updated}")
    print(f"    - Unchanged files preserved: {skipped}")
    print(f"    - Legacy private docs & notes: 100% PRESERVED (Zero Deletions)")
    return copied, updated

def sync_documentation_only(src, dest):
    """Syncs ONLY official documentation and architecture volumes to the Master Vault."""
    print(f"\n[*] Target 2: Documentation Mirror -> {dest}")
    if not os.path.exists(dest):
        print(f"[!] Vault destination {dest} not found. Skipping.")
        return 0, 0

    copied = 0
    updated = 0
    skipped = 0

    # 1. Sync Root Documentation Files
    root_doc_files = [
        'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', '.env.example'
    ]
    for doc_name in root_doc_files:
        src_path = os.path.join(src, doc_name)
        dest_path = os.path.join(dest, doc_name)
        if os.path.exists(src_path):
            if not os.path.exists(dest_path):
                shutil.copy2(src_path, dest_path)
                copied += 1
            else:
                if not filecmp.cmp(src_path, dest_path, shallow=False):
                    shutil.copy2(src_path, dest_path)
                    updated += 1
                else:
                    skipped += 1

    # 2. Sync architecture_volumes directory
    src_vols = os.path.join(src, 'architecture_volumes')
    dest_vols = os.path.join(dest, 'architecture_volumes')
    if os.path.exists(src_vols):
        os.makedirs(dest_vols, exist_ok=True)
        for f in os.listdir(src_vols):
            if f.endswith('.md'):
                src_f = os.path.join(src_vols, f)
                dest_f = os.path.join(dest_vols, f)
                if not os.path.exists(dest_f):
                    shutil.copy2(src_f, dest_f)
                    copied += 1
                else:
                    if not filecmp.cmp(src_f, dest_f, shallow=False):
                        shutil.copy2(src_f, dest_f)
                        updated += 1
                    else:
                        skipped += 1

    print(f"[+] Vault documentation sync complete:")
    print(f"    - New docs added: {copied}")
    print(f"    - Updated docs synchronized: {updated}")
    print(f"    - Unchanged docs preserved: {skipped}")
    print(f"    - Private env backups & archives: 100% PRESERVED (Zero Deletions)")
    return copied, updated

def main():
    start_time = datetime.now()
    print("=======================================================")
    print("🦁 WealthOS Dual-Target Safe Synchronizer")
    print(f"Timestamp: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("Mode: Non-Destructive Code & Doc Routing")
    print("=======================================================")

    # 1. Full code mirror to legacy workspace
    sync_full_codebase(ACTIVE_DIR, LEGACY_DIR)

    # 2. Documentation-only mirror to master vault
    if os.path.exists(VAULT_DOCS_DIR):
        sync_documentation_only(ACTIVE_DIR, VAULT_DOCS_DIR)

    duration = (datetime.now() - start_time).total_seconds()
    print(f"\n[OK] Synchronization finished safely in {duration:.2f}s.")

if __name__ == '__main__':
    main()
