const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const manifestPath = path.join(rootDir, "build", "service-guard.json");
const installScriptPath = path.join(rootDir, "build", "install-runtime-guard-service.ps1");
const uninstallScriptPath = path.join(rootDir, "build", "uninstall-runtime-guard-service.ps1");
const mainJsPath = path.join(rootDir, "main.js");
const packageJsonPath = path.join(rootDir, "package.json");
const requiredAllowedActions = [
  "verify signed runtime session",
  "detect missing desktop heartbeat",
  "restore original power plan",
  "delete ZeroLag runtime power plans",
  "remove stale runtime session file",
  "run one cleanup pass during uninstall"
];
const requiredCleanupTriggers = [
  "desktop force kill",
  "desktop crash",
  "windows restart",
  "subscription expiry",
  "integrity failure",
  "server authorization failure",
  "uninstall"
];
const requiredProhibitedBehaviors = [
  "hide service from Windows service tools",
  "block Task Manager",
  "kill user processes",
  "delete user files",
  "disable antivirus",
  "disable firewall",
  "disable Windows Security"
];
const forbiddenInstallerText = [
  "taskkill",
  "Set-MpPreference",
  "DisableRealtimeMonitoring",
  "netsh advfirewall set allprofiles state off",
  "Remove-Item -Recurse",
  "reg add"
];

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  assertOk(fs.existsSync(filePath), `Missing file: ${path.relative(rootDir, filePath)}`);
  return fs.readFileSync(filePath, "utf8");
}

function includesAll(values, required, label) {
  const set = new Set(values || []);
  for (const item of required) {
    assertOk(set.has(item), `${label} missing: ${item}`);
  }
}

function assertNoForbiddenText(text, label) {
  const lower = text.toLowerCase();
  for (const pattern of forbiddenInstallerText) {
    assertOk(!lower.includes(pattern.toLowerCase()), `${label} contains forbidden operation: ${pattern}`);
  }
}

function extraResourceTargets(packageJson) {
  return (packageJson.build && Array.isArray(packageJson.build.extraResources) ? packageJson.build.extraResources : [])
    .map((item) => `${item.from || ""}->${item.to || ""}`);
}

function main() {
  const manifest = readJson(manifestPath);
  const installScript = readText(installScriptPath);
  const uninstallScript = readText(uninstallScriptPath);
  const mainJs = readText(mainJsPath);
  const packageJson = readJson(packageJsonPath);
  const packageText = readText(packageJsonPath);
  const targets = extraResourceTargets(packageJson).join("\n");

  assertOk(manifest.version === 1, "Service guard manifest version must be 1.");
  assertOk(manifest.serviceName === "ZeroLagRuntimeGuard", "Unexpected service name.");
  assertOk(manifest.displayName === "ZeroLag Runtime Guard", "Unexpected service display name.");
  assertOk(manifest.visibleInWindowsServices === true, "Service guard must stay visible in Windows service tools.");
  assertOk(manifest.account === "NT AUTHORITY\\LocalService", "Service guard should use the LocalService account.");
  assertOk(manifest.startupType === "Automatic", "Service guard should start automatically after install.");
  assertOk(manifest.serviceBinary === "ZeroLag.exe", "Manifest should use the installed ZeroLag executable for worker mode.");
  assertOk(manifest.serviceBinaryStatus === "electron-worker-mode", "Manifest should mark the Electron worker-mode service entry.");
  assertOk(manifest.nativeServiceWrapperStatus === "planned", "Manifest should keep the native service wrapper status explicit.");
  assertOk(manifest.serviceWorker === "service-guard/runtime-guard-service.js", "Manifest service worker path is wrong.");
  assertOk(manifest.serviceCore === "service-guard/runtime-guard-core.js", "Manifest service core path is wrong.");
  assertOk(manifest.installScript === "build/install-runtime-guard-service.ps1", "Manifest install script path is wrong.");
  assertOk(manifest.uninstallScript === "build/uninstall-runtime-guard-service.ps1", "Manifest uninstall script path is wrong.");
  assertOk(manifest.taskSchedulerFallback && manifest.taskSchedulerFallback.enabledWhenServiceInstallFails === true, "Task Scheduler fallback must be documented.");
  includesAll(manifest.allowedActions, requiredAllowedActions, "allowedActions");
  includesAll(manifest.cleanupTriggers, requiredCleanupTriggers, "cleanupTriggers");
  includesAll(manifest.prohibitedBehaviors, requiredProhibitedBehaviors, "prohibitedBehaviors");

  assertOk(installScript.includes("sc.exe create"), "Install script must create a Windows Service.");
  assertOk(installScript.includes("--runtime-guard-service"), "Install script must start ZeroLag in runtime guard service mode.");
  assertOk(installScript.includes("ProgramData\\ZeroLag\\guard"), "Install script must write guard health/log state under ProgramData.");
  assertOk(installScript.includes("NT AUTHORITY\\LocalService"), "Install script must configure LocalService.");
  assertOk(installScript.includes("start= auto"), "Install script must configure automatic startup.");
  assertOk(installScript.includes("SupportsShouldProcess"), "Install script must support WhatIf/Confirm semantics.");
  assertOk(uninstallScript.includes("Stop-Service"), "Uninstall script must stop the service.");
  assertOk(uninstallScript.includes("sc.exe delete"), "Uninstall script must remove the service registration.");
  assertOk(uninstallScript.includes("--runtime-guard-service"), "Uninstall script must use the runtime guard service mode for cleanup.");
  assertOk(uninstallScript.includes("--once"), "Uninstall script must offer one cleanup pass before removal.");
  assertNoForbiddenText(installScript, "Install script");
  assertNoForbiddenText(uninstallScript, "Uninstall script");

  assertOk(targets.includes("build/service-guard.json->service-guard/service-guard.json"), "Service guard manifest must be packaged as an extra resource.");
  assertOk(targets.includes("build/install-runtime-guard-service.ps1->service-guard/install-runtime-guard-service.ps1"), "Install script must be packaged as an extra resource.");
  assertOk(targets.includes("build/uninstall-runtime-guard-service.ps1->service-guard/uninstall-runtime-guard-service.ps1"), "Uninstall script must be packaged as an extra resource.");
  assertOk(targets.includes("scripts/runtime-guard-core.js->service-guard/runtime-guard-core.js"), "Runtime guard core must be packaged as an extra resource.");
  assertOk(targets.includes("scripts/runtime-guard-service.js->service-guard/runtime-guard-service.js"), "Runtime guard service worker must be packaged as an extra resource.");
  assertOk(packageJson.scripts && packageJson.scripts["guard:service:smoke"], "guard:service:smoke script is missing.");
  assertOk(packageJson.scripts && packageJson.scripts["guard:runtime:smoke"], "guard:runtime:smoke script is missing.");
  assertOk((packageJson.scripts.ci || "").includes("npm run guard:service:smoke"), "npm run ci must include guard:service:smoke.");
  assertOk((packageJson.scripts.ci || "").includes("npm run guard:runtime:smoke"), "npm run ci must include guard:runtime:smoke.");
  assertOk((packageJson.scripts.check || "").includes("scripts/service-guard-smoke-test.js"), "npm run check must syntax-check service-guard-smoke-test.js.");
  assertOk((packageJson.scripts.check || "").includes("scripts/runtime-guard-service.js"), "npm run check must syntax-check runtime-guard-service.js.");
  assertOk(JSON.stringify(packageJson.build.asarUnpack || []).includes("runtime-guard-core"), "runtime-guard-core must be unpacked for watchdog execution.");
  assertOk(JSON.stringify(packageJson.build.asarUnpack || []).includes("runtime-watchdog"), "runtime-watchdog must be unpacked for cleanup execution.");
  assertOk(mainJs.includes("--runtime-guard-service"), "main.js must expose the runtime guard service mode.");
  assertOk(mainJs.includes("runRuntimeGuardService"), "main.js must call the runtime guard service worker.");
  assertOk(mainJs.indexOf("runtimeGuardServiceMode") < mainJs.indexOf("app.whenReady"), "Runtime guard service mode must be selected before normal app startup.");
  assertNoForbiddenText(packageText, "package.json");

  console.log("ZeroLag service guard smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
