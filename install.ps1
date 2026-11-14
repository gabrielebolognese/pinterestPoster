# Makes the runner live in the background on this PC. Run once from this folder:
#   powershell -ExecutionPolicy Bypass -File install.ps1
# It does three things:
#   1. adds a shortcut to the Windows Startup folder, so the runner starts (with no window) when you log in;
#   2. registers a 02:00 task that wakes the PC if it is asleep and starts the runner if it is not running;
#   3. starts the runner now.
# Undo everything with:  powershell -ExecutionPolicy Bypass -File stop.ps1 -Uninstall

$root = $PSScriptRoot
$vbs = Join-Path $root "run-hidden.vbs"
$wscript = Join-Path $env:WINDIR "System32\wscript.exe"

$link = Join-Path ([Environment]::GetFolderPath("Startup")) "pinterest-autopost.lnk"
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$s.TargetPath = $wscript
$s.Arguments = "`"$vbs`""
$s.WorkingDirectory = $root
$s.Save()

$action = New-ScheduledTaskAction -Execute $wscript -Argument "`"$vbs`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At "02:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "pinterest-autopost" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Wakes the PC at 02:00 and makes sure the Pinterest runner in $root is running" -Force | Out-Null

& $wscript $vbs
Write-Host "Runner installed and started. It starts at every login and is checked every night at 02:00."
Write-Host "What it does is written to logs\runner.log"
