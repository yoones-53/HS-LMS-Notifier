param(
    [ValidateSet('Setup','Status','Read','Remove','TestWrite','Save')][string]$Action,
    [string]$Target = 'HS-LMS-Notifier:LMS:v1'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$stage = 'INITIALIZE'
try {
    if ($Target -notin @('HS-LMS-Notifier:LMS:v1','HS-LMS-Notifier:Discord:v1') -and $Target -notmatch '^HS-LMS-Notifier:test:[a-f0-9-]{36}$') { throw 'INVALID_TARGET' }
    Add-Type -Path (Join-Path $PSScriptRoot 'WinCredential.cs') -ErrorAction Stop
    switch ($Action) {
        'Save' {
            if (-not [Console]::IsInputRedirected) { throw 'PRIVATE_PIPE_REQUIRED' }
            $secureId = $null; $securePassword = $null; $inputBytes = $null; $parsedInput = $null; $framedInput = $null
            try {
                $framedInput = [Console]::In.ReadToEnd()
                if ($framedInput.Length -gt 16384) { throw 'INPUT_TOO_LARGE' }
                $inputBytes = [Convert]::FromBase64String($framedInput)
                $parsedInput = [Text.Encoding]::UTF8.GetString($inputBytes) | ConvertFrom-Json
                if ($parsedInput.id -isnot [string] -or $parsedInput.password -isnot [string]) { throw 'INVALID_INPUT' }
                $secureId = ConvertTo-SecureString $parsedInput.id -AsPlainText -Force
                $securePassword = ConvertTo-SecureString $parsedInput.password -AsPlainText -Force
                [HsLmsCredential]::Save($Target, $secureId, $securePassword)
            } finally {
                if ($null -ne $secureId) { $secureId.Dispose() }
                if ($null -ne $securePassword) { $securePassword.Dispose() }
                if ($null -ne $inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
                $parsedInput = $null; $framedInput = $null
            }
            [Console]::WriteLine('CREDENTIALS_SAVED')
        }
        'Setup' {
            # Read-Host secure input is not echoed and is not placed in command arguments/history.
            $lmsId = $null; $lmsPassword = $null
            try {
                $lmsId = Read-Host 'LMS ID (hidden)' -AsSecureString
                $lmsPassword = Read-Host 'LMS Password (hidden)' -AsSecureString
                [HsLmsCredential]::Save($Target, $lmsId, $lmsPassword)
            } finally {
                if ($null -ne $lmsId) { $lmsId.Dispose() }
                if ($null -ne $lmsPassword) { $lmsPassword.Dispose() }
            }
            [Console]::WriteLine('CREDENTIALS_SAVED')
        }
        'Status' { [Console]::WriteLine($(if ([HsLmsCredential]::Exists($Target)) { 'CONFIGURED' } else { 'NOT_CONFIGURED' })) }
        'Remove' { [HsLmsCredential]::Remove($Target); [Console]::WriteLine('CREDENTIALS_REMOVED') }
        'Read' {
            # Internal IPC only. The public npm commands never print this payload.
            if (-not [Console]::IsOutputRedirected) { throw 'PRIVATE_PIPE_REQUIRED' }
            $values = [HsLmsCredential]::Read($Target)
            $payload = if ($null -eq $values) { 'null' } else { @{ id=$values[0]; password=$values[1] } | ConvertTo-Json -Compress }
            # ASCII framing avoids console codepage/invalid stdin handle problems in hidden tasks.
            # Base64 is transport framing, NOT encryption or a persisted credential format.
            $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
            try { [Console]::Write([Convert]::ToBase64String($bytes)) }
            finally { [Array]::Clear($bytes, 0, $bytes.Length); $payload = $null; $values = $null }
        }
        'TestWrite' {
            $stage = 'TEST_TARGET'
            if ($Target -notmatch '^HS-LMS-Notifier:test:[a-f0-9-]{36}$') { throw 'TEST_TARGET_REQUIRED' }
            $stage = 'TEST_SECURE_STRING'
            $testId = ConvertTo-SecureString 'synthetic-user' -AsPlainText -Force
            $testSecret = ConvertTo-SecureString 'synthetic-not-an-lms-password' -AsPlainText -Force
            $stage = 'TEST_SAVE'
            try { [HsLmsCredential]::Save($Target, $testId, $testSecret) }
            finally { $testId.Dispose(); $testSecret.Dispose() }
            [Console]::WriteLine('TEST_SAVED')
        }
    }
    exit 0
} catch {
    # No exception details, request data, ID, password or credential object.
    [Console]::Error.WriteLine('CREDENTIAL_STORE_ERROR:' + $stage + ':' + $_.Exception.GetType().Name)
    exit 1
}
