# One-Click Synchronizer: Active WealthOS -> Legacy Workspace & Master Vault
$ErrorActionPreference = "Stop"

Write-Host "Starting WealthOS Non-Destructive Safe Sync..." -ForegroundColor Cyan
python "$PSScriptRoot\sync_private_vault.py"
Write-Host "Sync Complete. All files updated without deleting any legacy docs." -ForegroundColor Green
