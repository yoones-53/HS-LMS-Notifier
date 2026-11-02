param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'task-result.ps1')
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$exitCode = 1
$invocationId = [guid]::NewGuid().ToString()
$logDirectory = Join-Path $projectDirectory 'logs'
$result = $null
$pushed = $false
$phase = 'PREPARE'
try {
    Push-Location -LiteralPath $projectDirectory
    $pushed = $true
    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Node executable not found' }
    # No raw process transcript: the app writes only sanitized events to logs/.
    $env:HEADLESS = 'true'
    $env:HS_LMS_RUN_TOKEN = $invocationId
    Remove-Item Env:DEBUG -ErrorAction SilentlyContinue
    Remove-Item Env:PWDEBUG -ErrorAction SilentlyContinue
    $phase = 'START_MONITOR'
    & $NodePath --import tsx src/main.ts --check 1>$null 2>$null
    $exitCode = $LASTEXITCODE
    $phase = 'RESOLVE_LOG_PATH'
    # Resolve after the process: migration activation can occur while acquiring its lock.
    $logDirectory = Get-RuntimeLogDirectory $projectDirectory
    $phase = 'VERIFY_RESULT'
    $envelope = Read-MonitorResult (Join-Path $logDirectory 'latest-scheduler-run.json')
    if ($envelope -and $envelope.invocationId -eq $invocationId) { $result = $envelope.result }
    if (-not $result) { throw 'Monitor did not publish a matching safe result' }
} catch {
    # Fixed messages only; never serialize PowerShell/Node exceptions or stdout.
    $exitCode = 1
    $runtimeIssue = 'NONE'
    if ($_.Exception.Message -in @('RUNTIME_ROUTE_UNREADABLE','RUNTIME_APPDATA_MISSING','RUNTIME_ROUTE_INVALID','RUNTIME_ROOT_MISMATCH','RUNTIME_DB_MISSING','RUNTIME_METADATA_UNREADABLE','RUNTIME_METADATA_INVALID')) {
        $runtimeIssue = $_.Exception.Message
    }
    $result = [pscustomobject]@{
        status='INITIALIZATION_ERROR'; code='INITIALIZATION_ERROR'; title='Monitor could not start or publish its result'
        reason=('No verified result from this invocation. Stage: ' + $phase + '. Runtime: ' + $runtimeIssue + '. Check Node installation and runtime/log permissions.')
        action='Check installation and logs; the next scheduled execution is retained.'
        recoverable=$false; occurredAt=(Get-Date).ToUniversalTime().ToString('o'); exitCode=1; errors=@(); warnings=@(); affectedScopes=@('INITIALIZATION')
    }
} finally {
    try {
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        $record = [ordered]@{ time=(Get-Date).ToString('o'); event='SCHEDULER_EXIT'; invocationId=$invocationId
            status=$result.status; statusCode=$result.code; reason=$result.reason; action=$result.action
            recoverable=$result.recoverable; exitCode=$exitCode; errors=$result.errors
            collectionStatus=$result.collectionStatus; databaseStatus=$result.databaseStatus; notificationStatus=$result.notificationStatus }
        Add-Content -LiteralPath (Join-Path $logDirectory ('scheduler-{0}.log' -f (Get-Date -Format 'yyyy-MM-dd'))) -Encoding UTF8 -Value ($record | ConvertTo-Json -Depth 10 -Compress)
        # Publish wrapper failures too; never display an old successful run as this one.
        $envelope = @{ invocationId=$invocationId; result=$result } | ConvertTo-Json -Depth 10
        $path = Join-Path $logDirectory 'latest-scheduler-run.json'
        [IO.File]::WriteAllText(($path + '.tmp'), $envelope, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath ($path + '.tmp') -Destination $path -Force
    } catch { $exitCode = 1 }
    if ($pushed) { Pop-Location -ErrorAction SilentlyContinue }
}
exit $exitCode
