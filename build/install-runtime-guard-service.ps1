[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$ServiceName = "ZeroLagRuntimeGuard",
  [string]$DisplayName = "ZeroLag Runtime Guard",
  [string]$ServiceBinary = "",
  [string]$SessionPath = "$env:LOCALAPPDATA\ZeroLag\runtime-session.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ServiceBinary) {
  throw "ServiceBinary is required. Pass the installed ZeroLagGuard.exe path from the installer."
}

$resolvedBinary = Resolve-Path -LiteralPath $ServiceBinary
$binaryPath = "`"$resolvedBinary`" --session `"$SessionPath`""

if ($PSCmdlet.ShouldProcess($ServiceName, "Install visible ZeroLag runtime guard Windows Service")) {
  & sc.exe create $ServiceName "binPath= $binaryPath" "start= auto" "DisplayName= $DisplayName" "obj= NT AUTHORITY\LocalService"
  & sc.exe description $ServiceName "Restores ZeroLag runtime-only performance state after crashes, forced exits, expiry, or uninstall."
  & sc.exe failure $ServiceName "reset= 86400" "actions= restart/60000/restart/60000/""""/60000"
}
