[CmdletBinding()]
param([switch]$StartNow)
$ErrorActionPreference = 'Stop'
$taskName = 'HS-LMS-Notifier'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runner = Join-Path $PSScriptRoot 'run-monitor.ps1'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$description = 'HS-LMS-Notifier managed task | ' + $projectDirectory
$existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne $description) {
    throw 'An unrelated HS-LMS-Notifier task already exists. Nothing was changed.'
}
$arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -NodePath "{1}"' -f $runner, $nodePath
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $projectDirectory
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(30) -RepetitionInterval (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $description -Force | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $taskName -TaskPath '\' }
& (Join-Path $PSScriptRoot 'manage-task.ps1') -Action Status
