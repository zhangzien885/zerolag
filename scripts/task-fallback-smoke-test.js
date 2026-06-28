const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const installScriptPath = path.join(rootDir, "build", "install-runtime-guard-task.ps1");
const uninstallScriptPath = path.join(rootDir, "build", "uninstall-runtime-guard-task.ps1");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRmTempDir(tempDir) {
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-task-fallback-smoke-")) {
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

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-task-fallback-smoke-"));

  try {
    const fakeExe = path.join(tempDir, "ZeroLag.exe");
    const guardDataDir = path.join(tempDir, "guard");
    fs.writeFileSync(fakeExe, "placeholder executable for Task Scheduler WhatIf smoke test", "utf8");

    const blocked = runPowerShell([
      "-File",
      installScriptPath,
      "-ServiceBinary",
      fakeExe,
      "-GuardDataDir",
      guardDataDir,
      "-WhatIf"
    ]);
    assertOk(blocked.status !== 0, "Task fallback install script should refuse registration unless explicitly allowed.");
    assertOk(
      `${blocked.stderr}\n${blocked.stdout}`.includes("Task Scheduler fallback registration is gated"),
      "Task fallback install script should explain why registration is blocked."
    );

    const allowedWhatIf = runPowerShell([
      "-File",
      installScriptPath,
      "-ServiceBinary",
      fakeExe,
      "-GuardDataDir",
      guardDataDir,
      "-IntervalMinutes",
      "5",
      "-AllowTaskFallbackRegistration",
      "-WhatIf"
    ]);
    assertOk(allowedWhatIf.status === 0, `Task fallback WhatIf validation failed: ${allowedWhatIf.stderr || allowedWhatIf.stdout}`);
    assertOk(!fs.existsSync(guardDataDir), "Task fallback WhatIf validation should not create the guard data directory.");

    const uninstallWhatIf = runPowerShell([
      "-File",
      uninstallScriptPath,
      "-TaskName",
      "ZeroLagRuntimeGuardFallback",
      "-WhatIf"
    ]);
    assertOk(uninstallWhatIf.status === 0, `Task fallback uninstall WhatIf failed: ${uninstallWhatIf.stderr || uninstallWhatIf.stdout}`);

    console.log("ZeroLag Task Scheduler fallback smoke test passed.");
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
