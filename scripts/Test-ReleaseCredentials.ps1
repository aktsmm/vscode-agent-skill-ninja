[CmdletBinding()]
param(
    [string]$Publisher = "yamapan",
    [string]$ExtensionId = "yamapan.agent-skill-ninja",
    [string]$ExpectedVersion,
    [switch]$UseProcessCredential,
    [string]$VsceExecutable
)

$ErrorActionPreference = "Stop"

if (-not $UseProcessCredential) {
    $userPat = [Environment]::GetEnvironmentVariable("VSCE_PAT", "User")
    if (-not [string]::IsNullOrWhiteSpace($userPat)) {
        $env:VSCE_PAT = $userPat
    }
}

if ([string]::IsNullOrWhiteSpace($env:VSCE_PAT)) {
    throw "VSCE_PAT is not configured. Set a User-scoped PAT with Marketplace > Manage and a future expiration date."
}

if ($VsceExecutable) {
    if (-not (Test-Path -LiteralPath $VsceExecutable -PathType Leaf)) {
        throw "VSCE executable not found: $VsceExecutable"
    }
    $command = $VsceExecutable
    $prefix = @()
} else {
    $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $npx) {
        $npx = Get-Command npx -CommandType Application -ErrorAction Stop | Select-Object -First 1
    }
    $command = $npx.Source
    $prefix = @("--yes", "@vscode/vsce")
}

& $command @prefix verify-pat $Publisher
if ($LASTEXITCODE -ne 0) {
    throw "Marketplace credential verification failed. Stop before changing version metadata or creating release commits."
}

if ($ExpectedVersion) {
    if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+$') {
        throw "ExpectedVersion must be a SemVer core version such as 0.9.50."
    }
    $raw = & $command @prefix show $ExtensionId --json
    if ($LASTEXITCODE -ne 0) {
        throw "Could not query Marketplace versions for $ExtensionId."
    }
    $metadata = $raw | ConvertFrom-Json
    $published = @($metadata.versions | ForEach-Object { $_.version })
    if ($published -contains $ExpectedVersion) {
        throw "Marketplace version $ExpectedVersion already exists. Select a newer version before changing release metadata."
    }

    $packagePath = Join-Path ([IO.Path]::GetTempPath()) "release-preflight-$([guid]::NewGuid().ToString('N')).vsix"
    $packageExists = $false
    try {
        $packageResponse = Invoke-WebRequest `
            -Uri "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/$Publisher/vsextensions/$($ExtensionId.Split('.')[1])/$ExpectedVersion/vspackage" `
            -Method Get `
            -OutFile $packagePath `
            -PassThru
        if ($packageResponse.StatusCode -ne 200 -or -not (Test-Path -LiteralPath $packagePath -PathType Leaf) -or (Get-Item -LiteralPath $packagePath).Length -eq 0) {
            throw "Could not verify Marketplace package availability for $ExtensionId $ExpectedVersion."
        }
        $packageExists = $true
    } catch {
        $statusCode = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        } elseif ($_.Exception.StatusCode) {
            $statusCode = [int]$_.Exception.StatusCode
        }
        if ($statusCode -ne 404) {
            throw "Could not verify Marketplace package availability for $ExtensionId $ExpectedVersion."
        }
    } finally {
        if (Test-Path -LiteralPath $packagePath -PathType Leaf) {
            Remove-Item -LiteralPath $packagePath -Force
        }
    }

    if ($packageExists) {
        throw "Marketplace version $ExpectedVersion already exists. Select a newer version before changing release metadata."
    }
}

[pscustomobject]@{
    Result = "PASS"
    Publisher = $Publisher
    ExtensionId = $ExtensionId
    ExpectedVersion = $ExpectedVersion
    CredentialSource = if ($UseProcessCredential) { "process" } else { "user-or-process" }
}