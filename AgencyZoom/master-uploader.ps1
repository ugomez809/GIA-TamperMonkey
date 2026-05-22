param(
  [string]$CommitMessage = "Update AgencyZoom scripts",
  [string]$Remote = "origin",
  [string]$Branch = "main",
  [switch]$SkipVersionBump,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  & git @Args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Test-AgencyZoomUserScriptUrls {
  param(
    [Parameter(Mandatory = $true)]
    [string]$AgencyZoomPath
  )

  $missing = @()
  $userScripts = Get-ChildItem -LiteralPath $AgencyZoomPath -File -Filter "*.user.js"
  foreach ($script in $userScripts) {
    $name = $script.Name
    $rawUrl = "https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/$name"
    $content = Get-Content -Raw -LiteralPath $script.FullName

    if ($content -notmatch [regex]::Escape("// @updateURL    $rawUrl") -or
        $content -notmatch [regex]::Escape("// @downloadURL  $rawUrl")) {
      $missing += $name
    }
  }

  if ($missing.Count -gt 0) {
    throw "These AgencyZoom userscripts need matching @updateURL and @downloadURL metadata: $($missing -join ', ')"
  }
}

function Convert-ToRepoPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
  $pathFull = [System.IO.Path]::GetFullPath($Path)
  $rootUri = New-Object System.Uri($rootFull)
  $pathUri = New-Object System.Uri($pathFull)
  $relative = [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString())
  return $relative -replace "\\", "/"
}

function Get-UserScriptVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  $match = [regex]::Match($Content, "(?m)^//\s*@version\s+([^\s]+)\s*$")
  if (-not $match.Success) {
    return ""
  }

  return $match.Groups[1].Value.Trim()
}

function Get-NextVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  $parts = $Version -split "\."
  if ($parts.Count -eq 0 -or $parts[-1] -notmatch "^\d+$") {
    return "$Version.1"
  }

  $parts[-1] = ([int]$parts[-1] + 1).ToString()
  return $parts -join "."
}

function Get-HeadContent {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath
  )

  $oldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git show "HEAD:$RepoPath" 2>$null
    if ($LASTEXITCODE -ne 0) {
      return ""
    }
  }
  catch {
    return ""
  }
  finally {
    $ErrorActionPreference = $oldErrorActionPreference
  }

  return ($output -join "`n")
}

function Normalize-ContentForCompare {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  return ($Content -replace "\r\n?", "`n").TrimEnd()
}

function Set-UserScriptVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$OldVersion,
    [Parameter(Mandatory = $true)]
    [string]$NewVersion
  )

  $content = Get-Content -Raw -LiteralPath $Path
  $content = [regex]::Replace(
    $content,
    "(?m)^//\s*@version\s+[^\s]+.*$",
    "// @version      $NewVersion",
    1
  )
  $content = [regex]::Replace(
    $content,
    "const\s+VERSION\s*=\s*(['""])" + [regex]::Escape($OldVersion) + "\1\s*;",
    "const VERSION = `${1}$NewVersion`${1};",
    1
  )
  $content = [regex]::Replace(
    $content,
    "const\s+LOADER_VERSION\s*=\s*(['""])" + [regex]::Escape($OldVersion) + "\1\s*;",
    "const LOADER_VERSION = `${1}$NewVersion`${1};",
    1
  )

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $content, $utf8NoBom)
}

function Update-ChangedAgencyZoomUserScriptVersions {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$AgencyZoomPath
  )

  $userScripts = Get-ChildItem -LiteralPath $AgencyZoomPath -File -Filter "*.user.js"
  foreach ($script in $userScripts) {
    $repoPath = Convert-ToRepoPath -Root $RepoRoot -Path $script.FullName
    $content = Get-Content -Raw -LiteralPath $script.FullName
    $currentVersion = Get-UserScriptVersion -Content $content
    if (-not $currentVersion) {
      throw "$repoPath is missing a Tampermonkey @version value."
    }

    $headContent = Get-HeadContent -RepoPath $repoPath
    if (-not $headContent) {
      Write-Host "New script keeps initial version ${currentVersion}: $repoPath"
      continue
    }

    if ((Normalize-ContentForCompare -Content $headContent) -eq (Normalize-ContentForCompare -Content $content)) {
      continue
    }

    $headVersion = Get-UserScriptVersion -Content $headContent
    if ($headVersion -and $headVersion -ne $currentVersion) {
      Write-Host "Version already changed $headVersion -> ${currentVersion}: $repoPath"
      continue
    }

    $nextVersion = Get-NextVersion -Version $currentVersion
    Set-UserScriptVersion -Path $script.FullName -OldVersion $currentVersion -NewVersion $nextVersion
    Write-Host "Bumped version $currentVersion -> ${nextVersion}: $repoPath"
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (& git -C $scriptDir rev-parse --show-toplevel).Trim()
if (-not $repoRoot) {
  throw "Could not find the Git repository root."
}

$agencyZoomPath = Join-Path $repoRoot "AgencyZoom"
if (-not (Test-Path -LiteralPath $agencyZoomPath)) {
  throw "AgencyZoom folder was not found at $agencyZoomPath"
}

Push-Location $repoRoot
try {
  Write-Host "Repository: $repoRoot"
  if (-not $SkipVersionBump) {
    Write-Host "Checking AgencyZoom userscript versions..."
    Update-ChangedAgencyZoomUserScriptVersions -RepoRoot $repoRoot -AgencyZoomPath $agencyZoomPath
  }

  Write-Host "Checking AgencyZoom Tampermonkey update URLs..."
  Test-AgencyZoomUserScriptUrls -AgencyZoomPath $agencyZoomPath

  Write-Host "Staging AgencyZoom folder only..."
  Invoke-Git @("add", "--", "AgencyZoom")

  $staged = (& git diff --cached --name-only).Trim()
  if (-not $staged) {
    Write-Host "No staged AgencyZoom changes to upload."
    return
  }

  Write-Host "Staged files:"
  $staged -split "`n" | ForEach-Object { Write-Host " - $_" }

  Write-Host "Creating commit..."
  Invoke-Git @("commit", "-m", $CommitMessage)

  Write-Host "Rebasing on $Remote/$Branch..."
  Invoke-Git @("pull", "--rebase", $Remote, $Branch)

  if ($NoPush) {
    Write-Host "NoPush was set; commit created but not pushed."
    return
  }

  Write-Host "Pushing to $Remote/$Branch..."
  Invoke-Git @("push", $Remote, $Branch)
  Write-Host "AgencyZoom upload complete."
}
finally {
  Pop-Location
}
