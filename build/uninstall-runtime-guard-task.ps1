[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$TaskName = "ZeroLagRuntimeGuardFallback",
  [string]$ServiceBinary = "",
  [string]$SessionPath = "$env:LOCALAPPDATA\ZeroLag\runtime-session.json",
  [switch]$CleanupOnce
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($CleanupOnce -and $ServiceBinary -and (Test-Path -LiteralPath $ServiceBinary)) {
  & $ServiceBinary "--runtime-guard-service" "--session" $SessionPath "--once"
}

$taskNames = @("$TaskName-Logon", "$TaskName-Periodic")
foreach ($name in $taskNames) {
  if ($PSCmdlet.ShouldProcess($name, "Remove ZeroLag runtime guard fallback task")) {
    & schtasks.exe /Delete /TN $name /F
  }
}
