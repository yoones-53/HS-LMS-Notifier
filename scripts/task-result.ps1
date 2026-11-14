# Pure helpers: safe to dot-source from fixture tests without touching Task Scheduler.
function Get-RuntimeLogDirectory([string]$ProjectDirectory) {
    $routePath = Join-Path $ProjectDirectory 'data/runtime-location.json'
    if (-not (Test-Path -LiteralPath $routePath -PathType Leaf)) { return (Join-Path $ProjectDirectory 'logs') }
    try { $route = Get-Content -LiteralPath $routePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { throw 'RUNTIME_ROUTE_UNREADABLE' }
    if (-not $env:APPDATA) { throw 'RUNTIME_APPDATA_MISSING' }
    $allowed = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'HS-LMS-Notifier'))
    $parsedId = [guid]::Empty
    if ($route.version -ne 1 -or -not [guid]::TryParse($route.migrationId, [ref]$parsedId)) { throw 'RUNTIME_ROUTE_INVALID' }
    $actual = [IO.Path]::GetFullPath($route.root)
    $packagePrefix = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Packages')) + '\'
    $packageRoot = $actual.StartsWith($packagePrefix, [StringComparison]::OrdinalIgnoreCase) -and
        $actual.Substring($packagePrefix.Length) -match '^[A-Za-z0-9._-]+\\LocalCache\\Roaming\\HS-LMS-Notifier$'
    if ($actual -ne $allowed -and -not $packageRoot) { throw 'RUNTIME_ROOT_MISMATCH' }
    if (-not (Test-Path -LiteralPath (Join-Path $actual 'data/lms.sqlite') -PathType Leaf)) { throw 'RUNTIME_DB_MISSING' }
    try { $migration = Get-Content -LiteralPath (Join-Path $actual 'state/migration.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch { throw 'RUNTIME_METADATA_UNREADABLE' }
    if ($migration.version -ne 1 -or $migration.status -ne 'ACTIVE' -or $migration.schemaVersion -ne 4 -or
        $migration.id -ne $route.migrationId) { throw 'RUNTIME_METADATA_INVALID' }
    return (Join-Path $actual 'logs')
}
function Get-TaskResultMeaning([long]$Value) {
    switch ($Value) {
        0 { return 'SUCCESS' }
        267009 { return 'TASK_RUNNING (Task is currently running)' }
        default { return ('UNKNOWN_TASK_RESULT ({0})' -f $Value) }
    }
}
function Read-MonitorResult([string]$Path) {
    try {
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
        return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch { return $null }
}
