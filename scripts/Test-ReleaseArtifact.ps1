[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$VsixPath,

    [Parameter(Mandatory)]
    [string]$ExpectedVersion,

    [string]$ProjectRoot = (Join-Path $PSScriptRoot "..")
)

$ErrorActionPreference = "Stop"
$resolvedVsix = (Resolve-Path -LiteralPath $VsixPath).Path
$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedVsix)

function Get-ArchiveText {
    param([Parameter(Mandatory)][string]$EntryName)

    # vsce の版によって収録名の大文字小文字が違う（CHANGELOG.md / changelog.md）。
    # GetEntry は区別するので、必須判定と同じく大文字小文字を無視して引く。
    $entry = $archive.Entries | Where-Object {
        $_.FullName -ieq $EntryName
    } | Select-Object -First 1
    if (-not $entry) {
        throw "Required VSIX entry is missing: $EntryName"
    }

    $reader = [System.IO.StreamReader]::new($entry.Open())
    try {
        return $reader.ReadToEnd()
    } finally {
        $reader.Dispose()
    }
}

function Test-JsonEqual {
    param($Left, $Right)

    if ($null -eq $Left -or $null -eq $Right) {
        return $null -eq $Left -and $null -eq $Right
    }
    if ($Left -is [System.Collections.IDictionary]) {
        if ($Right -isnot [System.Collections.IDictionary] -or $Left.Count -ne $Right.Count) {
            return $false
        }
        foreach ($key in $Left.Keys) {
            if (-not $Right.Contains($key) -or -not (Test-JsonEqual $Left[$key] $Right[$key])) {
                return $false
            }
        }
        return $true
    }
    if ($Left -is [array]) {
        if ($Right -isnot [array] -or $Left.Count -ne $Right.Count) {
            return $false
        }
        for ($index = 0; $index -lt $Left.Count; $index++) {
            if (-not (Test-JsonEqual $Left[$index] $Right[$index])) {
                return $false
            }
        }
        return $true
    }
    return $Left.GetType() -eq $Right.GetType() -and $Left -ceq $Right
}

try {
    $entries = @($archive.Entries.FullName)
    $required = @(
        "extension/package.json",
        "extension/package.nls.json",
        "extension/package.nls.ja.json",
        "extension/changelog.md",
        "extension/dist/extension.js",
        "extension/resources/icon.png",
        "extension/resources/icon.svg",
        "extension/resources/skill-index.json"
    )
    foreach ($entryName in $required) {
        if ($entryName -notin $entries) {
            throw "Required VSIX entry is missing: $entryName"
        }
    }

    $unexpected = @($entries | Where-Object {
        $_ -match '^extension/(src|scripts|\.github|\.vscode|node_modules|artifacts)/' -or
        $_ -match '\.map$'
    })
    if ($unexpected.Count -gt 0) {
        throw "Unexpected development entries in VSIX: $($unexpected -join ', ')"
    }

    $manifestText = Get-ArchiveText "extension/package.json"
    $manifest = $manifestText | ConvertFrom-Json
    if ($manifest.version -ne $ExpectedVersion) {
        throw "VSIX version $($manifest.version) does not match expected version $ExpectedVersion."
    }
    $packagedManifest = $manifestText | ConvertFrom-Json -AsHashtable
    $sourceManifest = Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw -Encoding UTF8 |
        ConvertFrom-Json -AsHashtable
    if (-not (Test-JsonEqual $packagedManifest $sourceManifest)) {
        throw "VSIX manifest does not match the release source manifest."
    }

    $sourceFiles = @(
        "dist/extension.js",
        "package.nls.json",
        "package.nls.ja.json",
        "resources/icon.png",
        "resources/icon.svg",
        "resources/skill-index.json"
    )
    foreach ($relativePath in $sourceFiles) {
        $sourcePath = Join-Path $ProjectRoot ($relativePath.Replace("/", [string][System.IO.Path]::DirectorySeparatorChar))
        $entry = $archive.GetEntry("extension/$relativePath")
        $stream = $entry.Open()
        try {
            $packagedHash = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash
        } finally {
            $stream.Dispose()
        }
        $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
        if ($packagedHash -ne $sourceHash) {
            throw "VSIX entry $relativePath does not match the release source."
        }
    }

    $changelog = Get-ArchiveText "extension/changelog.md"
    if ($changelog -notmatch "(?m)^## \[$([regex]::Escape($ExpectedVersion))\]") {
        throw "Packaged changelog does not contain release $ExpectedVersion."
    }

    $inFence = $false
    $contamination = for ($index = 0; $index -lt ($changelog -split '\r?\n').Count; $index++) {
        $line = ($changelog -split '\r?\n')[$index]
        if ($line -match '^\s*```') {
            $inFence = -not $inFence
            continue
        }
        if ($inFence) {
            continue
        }
        if (
            $line -match '^\s*PS(?:\s+[^>\r\n]*)?>\s+\S' -or
            $line -match '(?i)\b(?:paste|enter)\b.{0,80}\b(?:PAT|token|password|secret)\b' -or
            $line -match '(?i)\binput (?:is|stays) hidden\b' -or
            $line -match '(?i)^\s*SAVED:\s*VSCE_PAT\b'
        ) {
            "line $($index + 1): $line"
        }
    }
    if ($contamination.Count -gt 0) {
        throw "Packaged changelog contains terminal or secret-input transcript text: $($contamination -join '; ')"
    }

    [pscustomobject]@{
        Result = "PASS"
        Version = $manifest.version
        Entries = $entries.Count
        Bytes = (Get-Item -LiteralPath $resolvedVsix).Length
        SHA256 = (Get-FileHash -LiteralPath $resolvedVsix -Algorithm SHA256).Hash
    }
} finally {
    $archive.Dispose()
}