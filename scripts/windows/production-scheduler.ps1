[CmdletBinding()]
param(
  [ValidateSet('Status','Ensure','Disable','MigrateLegacy','Remove')]
  [string]$Action = 'Status',
  [string]$ExecutablePath
)

$ErrorActionPreference = 'Stop'
$productionName = 'HS-LMS-Notifier Background'
$legacyName = 'HS-LMS-Notifier'
$owner = 'HS-LMS-Notifier production scheduler v1'

function Get-Task([string]$Name) { Get-ScheduledTask -TaskName $Name -TaskPath '\' -ErrorAction SilentlyContinue }
function State-Of($task) { if ($null -eq $task) { 'ABSENT' } elseif ($task.State -eq 'Disabled') { 'INACTIVE' } else { 'ACTIVE' } }
function Next-Of($task) { if ($null -eq $task) { return $null }; $info = Get-ScheduledTaskInfo -InputObject $task; if ($info.NextRunTime.Year -gt 2000) { return $info.NextRunTime.ToUniversalTime().ToString('o') }; return $null }
function Is-Owned($task) { return $null -ne $task -and $task.Description -eq $owner }
function Is-Legacy($task) {
  if ($null -eq $task -or $task.Description -notlike 'HS-LMS-Notifier managed task | *') { return $false }
  return @($task.Actions | Where-Object { $_.Execute -match 'powershell\.exe$' -and $_.Arguments -match 'run-monitor\.ps1' }).Count -gt 0
}
function Emit($mode) {
  $prod = Get-Task $productionName; $legacy = Get-Task $legacyName; $state = State-Of $prod
  if ($null -eq $mode) {
    if ($null -ne $prod -and -not (Is-Owned $prod)) { $mode = 'CONFLICT' }
    elseif ($null -ne $prod -and (Is-Owned $prod)) { $mode = if ($state -eq 'ACTIVE') { 'PRODUCTION' } else { 'STALE' } }
    elseif ((Is-Legacy $legacy)) { $mode = 'LEGACY' }
    elseif ($null -ne $legacy) { $mode = 'CONFLICT' }
    else { $mode = 'ABSENT' }
  }
  @{ mode=$mode; state=$state; nextAt=(Next-Of $prod); legacyDetected=(Is-Legacy $legacy); legacyActive=((State-Of $legacy) -eq 'ACTIVE'); targetCurrent=(Is-Owned $prod) } | ConvertTo-Json -Compress
}
function Require-Executable {
  if ([string]::IsNullOrWhiteSpace($ExecutablePath) -or -not [IO.Path]::IsPathRooted($ExecutablePath) -or -not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { throw 'A valid installed executable path is required.' }
}
function Register-Production([bool]$Enabled) {
  Require-Executable; $prod = Get-Task $productionName
  if ($null -ne $prod -and -not (Is-Owned $prod)) { Emit 'CONFLICT'; return }
  $full = [IO.Path]::GetFullPath($ExecutablePath)
  $action = New-ScheduledTaskAction -Execute $full -Argument '--scheduled-check' -WorkingDirectory (Split-Path -Parent $full)
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(30) -RepetitionInterval (New-TimeSpan -Minutes 30)
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $productionName -TaskPath '\' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $owner -Force | Out-Null
  if (-not $Enabled) { Disable-ScheduledTask -TaskName $productionName -TaskPath '\' | Out-Null }
}
try {
  $production = Get-Task $productionName; $legacy = Get-Task $legacyName
  switch ($Action) {
    'Status' { Emit $null; break }
    'Ensure' { if ((Is-Legacy $legacy) -and (State-Of $legacy) -eq 'ACTIVE' -and $null -eq $production) { Emit 'LEGACY'; break }; Register-Production $true; Emit $null; break }
    'Disable' { if (Is-Owned $production) { Disable-ScheduledTask -TaskName $productionName -TaskPath '\' | Out-Null }; Emit $null; break }
    'MigrateLegacy' {
      if (-not (Is-Legacy $legacy)) { Emit $null; break }
      if ($null -ne $production -and -not (Is-Owned $production)) { Emit 'CONFLICT'; break }
      try { Register-Production $false; Disable-ScheduledTask -TaskName $legacyName -TaskPath '\' | Out-Null; Enable-ScheduledTask -TaskName $productionName -TaskPath '\' | Out-Null; Emit 'PRODUCTION' }
      catch { if (Is-Legacy (Get-Task $legacyName)) { Enable-ScheduledTask -TaskName $legacyName -TaskPath '\' -ErrorAction SilentlyContinue | Out-Null }; throw }
      break
    }
    'Remove' { if (Is-Owned $production) { Unregister-ScheduledTask -TaskName $productionName -TaskPath '\' -Confirm:$false }; Emit $null; break }
  }
} catch { @{ mode='UNKNOWN'; state='UNKNOWN'; nextAt=$null; legacyDetected=$false; legacyActive=$false; targetCurrent=$false } | ConvertTo-Json -Compress }
