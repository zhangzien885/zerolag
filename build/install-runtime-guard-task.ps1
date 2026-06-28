[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$TaskName = "ZeroLagRuntimeGuardFallback",
  [string]$ServiceBinary = "",
  [string]$SessionPath = "$env:LOCALAPPDATA\ZeroLag\runtime-session.json",
  [string]$GuardDataDir = "$env:ProgramData\ZeroLag\guard",
  [int]$IntervalMinutes = 5,
  [switch]$AllowTaskFallbackRegistration
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ServiceBinary) {
  throw "ServiceBinary is required. Pass the installed ZeroLag.exe path from the installer."
}

if (-not $AllowTaskFallbackRegistration) {
  throw "Task Scheduler fallback registration is gated. Pass -AllowTaskFallbackRegistration only for private validation or after service installation fails."
}

if ($IntervalMinutes -lt 1) {
  throw "IntervalMinutes must be 1 or greater."
}

$resolvedBinary = Resolve-Path -LiteralPath $ServiceBinary
if ($WhatIfPreference) {
  $resolvedGuardDataDirPath = [System.IO.Path]::GetFullPath($GuardDataDir)
} else {
  New-Item -ItemType Directory -Force -Path $GuardDataDir | Out-Null
  $resolvedGuardDataDirPath = (Resolve-Path -LiteralPath $GuardDataDir).Path
}

$healthFile = Join-Path $resolvedGuardDataDirPath "task-health.json"
$logFile = Join-Path $resolvedGuardDataDirPath "task-events.log"
$taskCommand = "`"$resolvedBinary`" --runtime-guard-service --once --session `"$SessionPath`" --health-file `"$healthFile`" --log-file `"$logFile`""
$logonTaskName = "$TaskName-Logon"
$periodicTaskName = "$TaskName-Periodic"

if ($PSCmdlet.ShouldProcess($logonTaskName, "Create visible ZeroLag runtime guard logon fallback task")) {
  & schtasks.exe /Create /TN $logonTaskName /SC ONLOGON /TR $taskCommand /RL HIGHEST /F
}

if ($PSCmdlet.ShouldProcess($periodicTaskName, "Create visible ZeroLag runtime guard periodic fallback task")) {
  & schtasks.exe /Create /TN $periodicTaskName /SC MINUTE /MO $IntervalMinutes /TR $taskCommand /RL HIGHEST /F
}
