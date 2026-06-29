const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const hookPath = path.join(rootDir, "build", "installer-guard.nsh");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(text, pattern, message) {
  assertOk(text.includes(pattern), message);
}

function assertNoForbiddenText(text) {
  [
    "taskkill",
    "Set-MpPreference",
    "DisableRealtimeMonitoring",
    "netsh advfirewall set allprofiles state off",
    "Remove-Item -Recurse",
    "reg add",
    "Hidden"
  ].forEach((pattern) => {
    assertOk(!text.includes(pattern), `Installer guard hook must not contain forbidden behavior: ${pattern}`);
  });
}

function main() {
  assertOk(fs.existsSync(hookPath), "Installer guard hook is missing.");
  const hook = fs.readFileSync(hookPath, "utf8");
  const nsis = packageJson.build && packageJson.build.nsis || {};

  assertOk(nsis.include === "build/installer-guard.nsh", "NSIS config must include the installer guard hook.");
  assertIncludes(hook, "!macro customInstall", "Installer guard hook must expose customInstall.");
  assertIncludes(hook, "!macro customUnInstall", "Installer guard hook must expose customUnInstall.");
  assertIncludes(hook, "ZEROLAG_ENABLE_GUARD_REGISTRATION", "Installer guard hook must stay gated behind an explicit build define.");
  assertIncludes(hook, "install-runtime-guard-service.ps1", "Installer guard hook must attempt service installation first.");
  assertIncludes(hook, "install-runtime-guard-task.ps1", "Installer guard hook must fall back to Task Scheduler registration.");
  assertIncludes(hook, "uninstall-runtime-cleanup.ps1", "Installer guard hook must coordinate runtime restore and guard removal during uninstall.");
  assertIncludes(hook, "-WrapperBinary", "Service registration must pass the native wrapper binary path.");
  assertIncludes(hook, "ZeroLag.RuntimeGuard.Service.exe", "Service registration must use the native wrapper executable.");
  assertOk(!hook.includes("-AllowElectronWorkerService"), "Installer hook must not enable Electron worker-mode service registration by default.");
  assertIncludes(hook, "-AllowTaskFallbackRegistration", "Task fallback registration must require the explicit private validation switch.");
  assertOk(
    hook.indexOf("install-runtime-guard-service.ps1") < hook.indexOf("install-runtime-guard-task.ps1"),
    "Installer guard hook must try service registration before task fallback registration."
  );
  assertOk(
    hook.indexOf("uninstall-runtime-cleanup.ps1") > hook.indexOf("!macro customUnInstall"),
    "Installer guard hook must run uninstall cleanup from customUnInstall."
  );
  assertNoForbiddenText(hook);

  console.log("ZeroLag installer guard hook smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
