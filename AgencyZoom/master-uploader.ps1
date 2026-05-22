param(
  [string]$CommitMessage = "Update AgencyZoom scripts",
  [string]$Remote = "origin",
  [string]$Branch = "main",
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
    $rawUrl = "https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/$name"
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
