const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const installScriptPath = path.join(rootDir, "build", "install-runtime-guard-service.ps1");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRmTempDir(tempDir) {
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-service-install-smoke-")) {
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-service-install-smoke-"));

  try {
    const fakeExe = path.join(tempDir, "ZeroLag.exe");
    const fakeWrapper = path.join(tempDir, "ZeroLag.RuntimeGuard.Service.exe");
    const guardDataDir = path.join(tempDir, "guard");
    fs.writeFileSync(fakeExe, "placeholder executable for WhatIf smoke test", "utf8");
    fs.writeFileSync(fakeWrapper, "placeholder native service wrapper for WhatIf smoke test", "utf8");

    const blocked = runPowerShell([
      "-File",
      installScriptPath,
      "-ServiceBinary",
      fakeExe,
      "-GuardDataDir",
      guardDataDir,
      "-WhatIf"
    ]);
    assertOk(blocked.status !== 0, "Install script should refuse Electron worker registration unless explicitly allowed.");
    assertOk(
      `${blocked.stderr}\n${blocked.stdout}`.includes("Native Windows Service wrapper binary is missing"),
      "Install script should explain why registration is blocked."
    );

    const wrapperWhatIf = runPowerShell([
      "-File",
      installScriptPath,
      "-ServiceBinary",
      fakeExe,
      "-WrapperBinary",
      fakeWrapper,
      "-GuardDataDir",
      guardDataDir,
      "-WhatIf"
    ]);
    assertOk(wrapperWhatIf.status === 0, `Install script wrapper WhatIf validation failed: ${wrapperWhatIf.stderr || wrapperWhatIf.stdout}`);
    assertOk(!fs.existsSync(guardDataDir), "Install script wrapper WhatIf validation should not create the guard data directory.");

    const allowedWhatIf = runPowerShell([
      "-File",
      installScriptPath,
      "-ServiceBinary",
      fakeExe,
      "-GuardDataDir",
      guardDataDir,
      "-AllowElectronWorkerService",
      "-WhatIf"
    ]);
    assertOk(allowedWhatIf.status === 0, `Install script WhatIf validation failed: ${allowedWhatIf.stderr || allowedWhatIf.stdout}`);
    assertOk(!fs.existsSync(guardDataDir), "Install script WhatIf validation should not create the guard data directory.");

    console.log("ZeroLag service install script smoke test passed.");
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
