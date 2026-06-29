[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$ServiceName = "ZeroLagRuntimeGuard",
  [string]$DisplayName = "ZeroLag Runtime Guard",
  [string]$ServiceBinary = "",
  [string]$WrapperBinary = "",
  [string]$SessionPath = "$env:LOCALAPPDATA\ZeroLag\runtime-session.json",
  [string]$GuardDataDir = "$env:ProgramData\ZeroLag\guard",
  [switch]$AllowElectronWorkerService
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ServiceBinary) {
  throw "ServiceBinary is required. Pass the installed ZeroLag.exe path from the installer."
}

$resolvedBinary = Resolve-Path -LiteralPath $ServiceBinary
$resolvedWrapper = $null
if ($WrapperBinary -and (Test-Path -LiteralPath $WrapperBinary)) {
  $resolvedWrapper = Resolve-Path -LiteralPath $WrapperBinary
}

if (-not $resolvedWrapper -and -not $AllowElectronWorkerService) {
  throw "Native Windows Service wrapper binary is missing. Run npm run guard:wrapper:build and package ZeroLag.RuntimeGuard.Service.exe, or pass -AllowElectronWorkerService only for private validation of the Electron worker-mode service entry."
}

if ($WhatIfPreference) {
  $resolvedGuardDataDirPath = [System.IO.Path]::GetFullPath($GuardDataDir)
} else {
  New-Item -ItemType Directory -Force -Path $GuardDataDir | Out-Null
  $resolvedGuardDataDirPath = (Resolve-Path -LiteralPath $GuardDataDir).Path
}
$healthFile = Join-Path $resolvedGuardDataDirPath "health.json"
$logFile = Join-Path $resolvedGuardDataDirPath "events.log"

if ($resolvedWrapper) {
  $binaryPath = "`"$resolvedWrapper`" --worker-binary `"$resolvedBinary`" --session `"$SessionPath`" --health-file `"$healthFile`" --log-file `"$logFile`""
} else {
  $binaryPath = "`"$resolvedBinary`" --runtime-guard-service --session `"$SessionPath`" --health-file `"$healthFile`" --log-file `"$logFile`""
}

if ($PSCmdlet.ShouldProcess($ServiceName, "Install visible ZeroLag runtime guard Windows Service")) {
  & sc.exe create $ServiceName "binPath= $binaryPath" "start= auto" "DisplayName= $DisplayName" "obj= NT AUTHORITY\LocalService"
  & sc.exe description $ServiceName "Restores ZeroLag runtime-only performance state after crashes, forced exits, expiry, or uninstall."
  & sc.exe failure $ServiceName "reset= 86400" "actions= restart/60000/restart/60000/""""/60000"
}
