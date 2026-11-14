param([ValidateSet('Status','Disable','Enable','Start')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'task-result.ps1')
$taskName = 'HS-LMS-Notifier'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
if ($task.Description -ne ('HS-LMS-Notifier managed task | ' + $projectDirectory)) {
    throw 'This task belongs to a different project. Nothing was changed.'
}
switch ($Action) {
    'Disable' { Disable-ScheduledTask -InputObject $task | Out-Null }
    'Enable' { Enable-ScheduledTask -InputObject $task | Out-Null }
    'Start' { Start-ScheduledTask -InputObject $task }
}
$current = Get-ScheduledTask -TaskName $taskName -TaskPath '\'
$info = Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\'
$logDirectory = Get-RuntimeLogDirectory $projectDirectory
$lastMonitor = Read-MonitorResult (Join-Path $logDirectory 'latest-run.json')
$lastScheduler = Read-MonitorResult (Join-Path $logDirectory 'latest-scheduler-run.json')
[pscustomobject]@{
    Task=$current.TaskName; State=$current.State; 'Last run'=$info.LastRunTime; 'Next run'=$info.NextRunTime
    'Last task result'=('{0} ({1})' -f $info.LastTaskResult, (Get-TaskResultMeaning $info.LastTaskResult))
    'Last monitor'=$(if ($lastMonitor) { '{0} / {1}' -f $lastMonitor.status, $lastMonitor.code } else { 'NOT_AVAILABLE' })
    'Monitor time'=$(if ($lastMonitor) { $lastMonitor.occurredAt } else { 'NOT_AVAILABLE' })
    'LMS / DB / Discord'=$(if ($lastMonitor -and $lastMonitor.collectionStatus) { '{0} / {1} / {2}' -f $lastMonitor.collectionStatus, $lastMonitor.databaseStatus, $lastMonitor.notificationStatus } else { 'NOT_AVAILABLE' })
    'Reason'=$(if ($lastMonitor) { $lastMonitor.reason } else { 'Run npm run check to create a status summary.' })
    'Action'=$(if ($lastMonitor) { $lastMonitor.action } else { '' })
    'Last scheduled monitor'=$(if ($lastScheduler) { '{0} / {1} ({2})' -f $lastScheduler.result.status, $lastScheduler.result.code, $lastScheduler.result.occurredAt } else { 'NOT_AVAILABLE' })
} | Format-List
