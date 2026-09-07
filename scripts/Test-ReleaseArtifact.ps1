[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$VsixPath,

    [Parameter(Mandatory)]
    [string]$ExpectedVersion
)

$ErrorActionPreference = "Stop"
$resolvedVsix = (Resolve-Path -LiteralPath $VsixPath).Path
$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedVsix)

function Get-ArchiveText {
    param([Parameter(Mandatory)][string]$EntryName)

    $entry = $archive.GetEntry($EntryName)
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

try {
    $entries = @($archive.Entries.FullName)
    $required = @(
        "extension/package.json",
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

    $manifest = Get-ArchiveText "extension/package.json" | ConvertFrom-Json
    if ($manifest.version -ne $ExpectedVersion) {
        throw "VSIX version $($manifest.version) does not match expected version $ExpectedVersion."
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