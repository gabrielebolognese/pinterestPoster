# Stops the background runner:        powershell -ExecutionPolicy Bypass -File stop.ps1
# Stops it and removes the autostart: powershell -ExecutionPolicy Bypass -File stop.ps1 -Uninstall
param([switch]$Uninstall)

$lock = Join-Path $PSScriptRoot "logs\runner.lock"
if (Test-Path $lock) {
  $id = [int](Get-Content $lock)
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq "node") {
    Stop-Process -Id $id -Force
    Write-Host "Runner stopped (process $id)."
  } else {
    Write-Host "The runner was not running."
  }
  Remove-Item $lock -Force
} else {
  Write-Host "The runner was not running."
}

if ($Uninstall) {
  $link = Join-Path ([Environment]::GetFolderPath("Startup")) "pinterest-autopost.lnk"
  if (Test-Path $link) { Remove-Item $link -Force }
  if (Get-ScheduledTask -TaskName "pinterest-autopost" -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName "pinterest-autopost" -Confirm:$false
  }
  Write-Host "Autostart removed."
}
