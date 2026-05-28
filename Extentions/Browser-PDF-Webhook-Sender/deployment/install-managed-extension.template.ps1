param(
  [ValidateSet("Machine", "User")]
  [string]$Scope = "Machine",

  [switch]$ChromeOnly,
  [switch]$EdgeOnly,

  [string]$ExtensionId = "__EXTENSION_ID__",
  [string]$UpdateUrl = "__UPDATE_URL__"
)

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Set-ForceInstallEntry {
  param(
    [string]$PolicyPath,
    [string]$BrowserName
  )

  if (!(Test-Path -LiteralPath $PolicyPath)) {
    New-Item -Path $PolicyPath -Force | Out-Null
  }

  $value = "$ExtensionId;$UpdateUrl"
  $properties = Get-ItemProperty -LiteralPath $PolicyPath
  $numericProperties = $properties.PSObject.Properties |
    Where-Object { $_.Name -match '^\d+$' } |
    Sort-Object { [int]$_.Name }
  $existing = $numericProperties |
    Where-Object { "$($_.Value)".StartsWith("$ExtensionId;") } |
    Select-Object -First 1

  if ($existing) {
    New-ItemProperty -LiteralPath $PolicyPath -Name $existing.Name -Value $value -PropertyType String -Force | Out-Null
    Write-Host "$BrowserName policy updated at slot $($existing.Name)."
    return
  }

  $nextIndex = 1

  if ($numericProperties.Count -gt 0) {
    $nextIndex = ([int]($numericProperties | Select-Object -Last 1).Name) + 1
  }

  New-ItemProperty -LiteralPath $PolicyPath -Name "$nextIndex" -Value $value -PropertyType String -Force | Out-Null
  Write-Host "$BrowserName policy added at slot $nextIndex."
}

if ($Scope -eq "Machine" -and !(Test-IsAdmin)) {
  throw "Machine-scope install requires running PowerShell as Administrator."
}

if ($ExtensionId -match "__" -or $UpdateUrl -match "__") {
  throw "This installer still has template placeholders. Use the generated installer from GitHub Pages."
}

$policyRoot = if ($Scope -eq "Machine") {
  "HKLM:\SOFTWARE\Policies"
} else {
  "HKCU:\SOFTWARE\Policies"
}

$installChrome = !$EdgeOnly
$installEdge = !$ChromeOnly

if ($installChrome) {
  Set-ForceInstallEntry `
    -PolicyPath "$policyRoot\Google\Chrome\ExtensionInstallForcelist" `
    -BrowserName "Chrome"
}

if ($installEdge) {
  Set-ForceInstallEntry `
    -PolicyPath "$policyRoot\Microsoft\Edge\ExtensionInstallForcelist" `
    -BrowserName "Edge"
}

Write-Host ""
Write-Host "Managed extension install policy is configured."
Write-Host "Extension ID: $ExtensionId"
Write-Host "Update URL:   $UpdateUrl"
Write-Host ""
Write-Host "Restart Chrome/Edge or visit chrome://policy / edge://policy and reload policies."
