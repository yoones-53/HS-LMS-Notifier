$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../scripts/task-result.ps1')
@(0,267009,0x41301,267777) | ForEach-Object { Get-TaskResultMeaning $_ }
