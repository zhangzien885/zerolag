const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { signRuntimeSessionPayload, verifyRuntimeSessionPayload } = require("./runtime-guard-core");

const rootDir = path.join(__dirname, "..");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRmTempDir(tempDir) {
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-runtime-guard-service-smoke-")) {
    throw new Error(`Refusing to clean unexpected smoke-test path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function runService(args, env = {}) {
  return spawnSync(process.execPath, [path.join(rootDir, "scripts", "runtime-guard-service.js"), ...args], {
    cwd: rootDir,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const legacySession = {
    version: 1,
    parentPid: process.pid,
    runtimePowerPlanGuid: "11111111-1111-1111-1111-111111111111",
    originalPowerPlanGuid: "22222222-2222-2222-2222-222222222222",
    machineHash: "a".repeat(64),
    licenseSessionId: "legacy-local-session",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 1000).toISOString()
  };
  assertOk(verifyRuntimeSessionPayload({
    ...legacySession,
    signature: signRuntimeSessionPayload(legacySession)
  }), "Runtime guard should still verify legacy v1 session signatures.");

  const serverSession = {
    ...legacySession,
    version: 2,
    licenseSessionId: "rsess_server_authorized",
    runtimeSessionKeyVersion: "runtime-session-v1"
  };
  const signedServerSession = {
    ...serverSession,
    signature: signRuntimeSessionPayload(serverSession)
  };
  assertOk(verifyRuntimeSessionPayload(signedServerSession), "Runtime guard should verify server-authorized v2 session signatures.");
  assertOk(!verifyRuntimeSessionPayload({
    ...signedServerSession,
    runtimeSessionKeyVersion: "runtime-session-v2"
  }), "Runtime guard should reject tampered runtime session key versions.");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-runtime-guard-service-smoke-"));

  try {
    const sessionPath = path.join(tempDir, "runtime-session.json");
    const healthPath = path.join(tempDir, "health.json");
    const logPath = path.join(tempDir, "guard.log");

    fs.writeFileSync(sessionPath, JSON.stringify({
      version: 1,
      parentPid: 0,
      runtimePowerPlanGuid: "11111111-1111-1111-1111-111111111111",
      originalPowerPlanGuid: "22222222-2222-2222-2222-222222222222",
      signature: "tampered"
    }, null, 2), "utf8");

    const cleanup = runService([
      "--session",
      sessionPath,
      "--once",
      "--dry-run",
      "--health-file",
      healthPath,
      "--log-file",
      logPath
    ]);
    assertOk(cleanup.status === 0, `Service worker cleanup failed: ${cleanup.stderr || cleanup.stdout}`);
    assertOk(!fs.existsSync(sessionPath), "Dry-run service worker should remove invalid session files.");
    assertOk(fs.existsSync(healthPath), "Service worker should write health state.");
    assertOk(fs.existsSync(logPath), "Service worker should append a supportable log event.");

    const health = readJson(healthPath);
    assertOk(health.serviceName === "ZeroLagRuntimeGuard", "Health state should include the service name.");
    assertOk(health.action === "cleanup", "Health state should record cleanup.");
    assertOk(health.reason === "invalid-signature", "Health state should record the cleanup reason.");
    assertOk(health.sessionFile === "runtime-session.json", "Health state should not expose an absolute session path.");
    assertOk(health.dryRun === true, "Smoke test must run without executing system cleanup commands.");

    const logText = fs.readFileSync(logPath, "utf8");
    assertOk(logText.includes("\"action\":\"cleanup\""), "Service worker log should include the cleanup action.");
    assertOk(!logText.includes(tempDir), "Service worker log should not expose temporary absolute paths.");

    const idleHealthPath = path.join(tempDir, "idle-health.json");
    const idle = runService([
      "--session",
      path.join(tempDir, "missing-session.json"),
      "--once",
      "--dry-run",
      "--health-file",
      idleHealthPath
    ]);
    assertOk(idle.status === 0, `Service worker idle run failed: ${idle.stderr || idle.stdout}`);
    assertOk(readJson(idleHealthPath).action === "idle", "Missing session should be reported as idle.");

    console.log("ZeroLag runtime guard service smoke test passed.");
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
