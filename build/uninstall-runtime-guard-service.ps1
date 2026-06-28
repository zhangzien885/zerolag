[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$ServiceName = "ZeroLagRuntimeGuard",
  [string]$ServiceBinary = "",
  [string]$NodeBinary = "",
  [string]$WatchdogScript = "",
  [string]$SessionPath = "$env:LOCALAPPDATA\ZeroLag\runtime-session.json",
  [switch]$CleanupOnce
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($CleanupOnce -and $ServiceBinary -and (Test-Path -LiteralPath $ServiceBinary)) {
  & $ServiceBinary "--runtime-guard-service" "--session" $SessionPath "--once"
} elseif ($CleanupOnce -and $NodeBinary -and $WatchdogScript -and (Test-Path -LiteralPath $NodeBinary) -and (Test-Path -LiteralPath $WatchdogScript)) {
  & $NodeBinary $WatchdogScript $SessionPath "--once"
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne "Stopped" -and $PSCmdlet.ShouldProcess($ServiceName, "Stop ZeroLag runtime guard Windows Service")) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  }

  if ($PSCmdlet.ShouldProcess($ServiceName, "Remove ZeroLag runtime guard Windows Service")) {
    & sc.exe delete $ServiceName
  }
}
