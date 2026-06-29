const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const cleanupScriptPath = path.join(rootDir, "build", "uninstall-runtime-cleanup.ps1");
const installerHookPath = path.join(rootDir, "build", "installer-guard.nsh");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRmTempDir(tempDir) {
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-uninstall-cleanup-smoke-")) {
    throw new Error(`Refusing to clean unexpected smoke-test path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function runPowerShell(args) {
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function assertNoForbiddenText(text, label) {
  [
    "taskkill",
    "Set-MpPreference",
    "DisableRealtimeMonitoring",
    "netsh advfirewall set allprofiles state off",
    "Remove-Item -Recurse",
    "reg add",
    "Hidden"
  ].forEach((pattern) => {
    assertOk(!text.includes(pattern), `${label} must not contain forbidden behavior: ${pattern}`);
  });
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-uninstall-cleanup-smoke-"));

  try {
    assertOk(fs.existsSync(cleanupScriptPath), "Uninstall cleanup script is missing.");
    const cleanupScript = fs.readFileSync(cleanupScriptPath, "utf8");
    const installerHook = fs.readFileSync(installerHookPath, "utf8");
    const extraResources = JSON.stringify(packageJson.build && packageJson.build.extraResources || []);

    assertOk(cleanupScript.includes("uninstall-runtime-guard-task.ps1"), "Cleanup script must remove Task Scheduler fallback.");
    assertOk(cleanupScript.includes("uninstall-runtime-guard-service.ps1"), "Cleanup script must remove Windows Service guard.");
    assertOk(cleanupScript.indexOf("uninstall-runtime-guard-task.ps1") < cleanupScript.indexOf("uninstall-runtime-guard-service.ps1"), "Cleanup script must remove task fallback before service.");
    assertOk(cleanupScript.includes("-CleanupOnce"), "Cleanup script must support one runtime cleanup pass.");
    assertOk(installerHook.includes("uninstall-runtime-cleanup.ps1"), "Installer uninstall hook must call the cleanup coordinator.");
    assertOk(!installerHook.includes("uninstall-runtime-guard-task.ps1\" -ServiceBinary"), "Installer hook should not duplicate task cleanup command.");
    assertOk(!installerHook.includes("uninstall-runtime-guard-service.ps1\" -ServiceBinary"), "Installer hook should not duplicate service cleanup command.");
    assertOk(extraResources.includes("uninstall-runtime-cleanup.ps1"), "Cleanup coordinator must be packaged as an extra resource.");
    assertNoForbiddenText(cleanupScript, "Uninstall cleanup script");

    const fakeGuardDir = path.join(tempDir, "guard");
    const fakeSessionPath = path.join(tempDir, "runtime-session.json");
    fs.mkdirSync(fakeGuardDir, { recursive: true });

    const whatIf = runPowerShell([
      "-File",
      cleanupScriptPath,
      "-GuardResourceDir",
      fakeGuardDir,
      "-SessionPath",
      fakeSessionPath,
      "-WhatIf"
    ]);
    assertOk(whatIf.status === 0, `Uninstall cleanup WhatIf should tolerate missing child scripts: ${whatIf.stderr || whatIf.stdout}`);
    assertOk(!fs.existsSync(fakeSessionPath), "Uninstall cleanup WhatIf should not create or mutate session files.");

    console.log("ZeroLag uninstall cleanup smoke test passed.");
  } finally {
    safeRmTempDir(tempDir);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
