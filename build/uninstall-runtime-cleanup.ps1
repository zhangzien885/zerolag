[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$ServiceBinary = "",
  [string]$SessionPath = "$env:LOCALAPPDATA\ZeroLag\runtime-session.json",
  [string]$GuardResourceDir = $PSScriptRoot,
  [switch]$CleanupOnce
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-ZeroLagGuardScript {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][string]$Label,
    [string[]]$Arguments = @()
  )

  if (-not (Test-Path -LiteralPath $ScriptPath)) {
    Write-Warning "ZeroLag $Label script was not found: $ScriptPath"
    return
  }

  $effectiveArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ScriptPath) + $Arguments
  if ($WhatIfPreference) {
    $effectiveArguments += "-WhatIf"
  }

  if ($PSCmdlet.ShouldProcess($Label, "Run ZeroLag uninstall cleanup step")) {
    & powershell.exe @effectiveArguments
    if ($LASTEXITCODE -ne 0) {
      throw "ZeroLag $Label cleanup step failed with exit code $LASTEXITCODE."
    }
  }
}

$resolvedGuardDir = Resolve-Path -LiteralPath $GuardResourceDir -ErrorAction SilentlyContinue
if (-not $resolvedGuardDir) {
  throw "ZeroLag guard resource directory does not exist: $GuardResourceDir"
}

$taskUninstallScript = Join-Path $resolvedGuardDir "uninstall-runtime-guard-task.ps1"
$serviceUninstallScript = Join-Path $resolvedGuardDir "uninstall-runtime-guard-service.ps1"

$sharedArguments = @("-SessionPath", $SessionPath)
if ($ServiceBinary) {
  $sharedArguments += @("-ServiceBinary", $ServiceBinary)
}

Invoke-ZeroLagGuardScript `
  -ScriptPath $taskUninstallScript `
  -Label "Task Scheduler fallback removal" `
  -Arguments $sharedArguments

$serviceArguments = $sharedArguments
if ($CleanupOnce) {
  $serviceArguments += "-CleanupOnce"
}

Invoke-ZeroLagGuardScript `
  -ScriptPath $serviceUninstallScript `
  -Label "Windows Service removal" `
  -Arguments $serviceArguments
