$ErrorActionPreference = 'Stop'
try {
    $task = Get-ScheduledTask -TaskPath '\' -ErrorAction Stop | Where-Object { $_.TaskName -eq 'HS-LMS-Notifier' }
    if ($null -eq $task) { @{ state='ABSENT'; nextAt=$null; matchingProject=$false } | ConvertTo-Json -Compress; exit 0 }
    $info = Get-ScheduledTaskInfo -InputObject $task
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    @{ state=$(if ($task.State -eq 'Disabled') { 'INACTIVE' } else { 'ACTIVE' });
       nextAt=$(if ($info.NextRunTime.Year -gt 2000) { $info.NextRunTime.ToUniversalTime().ToString('o') } else { $null });
       matchingProject=($task.Description -eq ('HS-LMS-Notifier managed task | ' + $root)) } | ConvertTo-Json -Compress
} catch { @{ state='UNKNOWN'; nextAt=$null; matchingProject=$false } | ConvertTo-Json -Compress }
