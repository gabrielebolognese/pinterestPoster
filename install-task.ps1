# Registers the night scan in Windows Task Scheduler: every day at 02:00.
# If the PC is off at 02:00 the scan runs at the next startup; if it is asleep, the task wakes it.
# Run once from this folder:  powershell -ExecutionPolicy Bypass -File install-task.ps1
# Remove it with:             Unregister-ScheduledTask -TaskName "pinterest-night-scan" -Confirm:$false

$root = $PSScriptRoot
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "scan.mjs" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At "02:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName "pinterest-night-scan" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Schedules new Pinterest images found in $root" -Force | Out-Null
Write-Host "Night scan registered: every day at 02:00 (task name: pinterest-night-scan)."
