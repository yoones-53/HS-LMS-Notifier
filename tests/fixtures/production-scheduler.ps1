param([string]$ScriptPath, [string]$Action, [switch]$Conflict)
$global:fixtureCalls = [Collections.Generic.List[string]]::new()
$global:fixtureProd = [pscustomobject]@{ State='Ready'; Description='HS-LMS-Notifier production scheduler v1'; Actions=@([pscustomobject]@{ Execute="$PSHOME\powershell.exe"; Arguments='--scheduled-check' }) }
$global:fixtureLegacy = [pscustomobject]@{ State='Ready'; Description='HS-LMS-Notifier managed task | synthetic'; Actions=@([pscustomobject]@{ Execute='powershell.exe'; Arguments='-File run-monitor.ps1' }) }
if ($Conflict) { $global:fixtureProd.Description='Other application' }
function Get-ScheduledTask { param($TaskName,$TaskPath,$ErrorAction); if ($TaskName -eq 'HS-LMS-Notifier Background') { $global:fixtureProd } else { $global:fixtureLegacy } }
function Get-ScheduledTaskInfo { param($InputObject); [pscustomobject]@{NextRunTime=[datetime]'2030-01-01T12:00:00'} }
function Disable-ScheduledTask { param($TaskName,$TaskPath); $global:fixtureCalls.Add("Disable:$TaskName"); if ($TaskName -eq 'HS-LMS-Notifier Background') { $global:fixtureProd.State='Disabled' } else { $global:fixtureLegacy.State='Disabled' } }
function Enable-ScheduledTask { param($TaskName,$TaskPath); $global:fixtureCalls.Add("Enable:$TaskName") }
function Register-ScheduledTask { throw 'Active current tasks must not be registered again.' }
function New-ScheduledTaskAction { throw 'Active current tasks must preserve their trigger.' }
$result = & $ScriptPath -Action $Action -ExecutablePath "$PSHOME\powershell.exe"
@{ result=($result | ConvertFrom-Json); calls=@($global:fixtureCalls.ToArray()) } | ConvertTo-Json -Depth 5 -Compress
