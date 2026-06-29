const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { createSqliteStateStore } = require("../server/state-store");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "sqlite-storage-status.js");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function runNode(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== expectedStatus) {
    throw new Error([
      `Command failed: node ${args.join(" ")}`,
      `Expected exit: ${expectedStatus}`,
      `Actual exit: ${result.status}`,
      result.stdout.trim(),
      result.stderr.trim()
    ].filter(Boolean).join("\n"));
  }

  return result;
}

function safeRemoveTemp(tempRoot) {
  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-sqlite-status-smoke-")) {
    throw new Error(`Refusing to remove unexpected temp path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function writeSqliteState(filePath) {
  const store = createSqliteStateStore(filePath);
  try {
    store.saveState({
      activationCodes: { "code-1": { status: "issued" } },
      orders: { "order-1": { status: "paid" } },
      paymentEvents: {},
      subscriptions: { "sub-1": { status: "active" } },
      tokens: {},
      websiteEvents: { total: 3 },
      auditEvents: [{ type: "smoke" }]
    });
  } finally {
    store.close();
  }
}

function assertNoSensitivePaths(text, tempRoot) {
  assertOk(!String(text || "").includes(tempRoot), "Status output should not expose full temporary paths.");
  assertOk(!String(text || "").includes("\\server-state.sqlite"), "Status output should prefer safe relative paths.");
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-sqlite-status-smoke-"));
  const jsonPath = path.join(tempRoot, "server-state.json");
  const sqlitePath = path.join(tempRoot, "server-state.sqlite");
  const backupDir = path.join(tempRoot, "backups");
  const backupPath = path.join(backupDir, "server-state-sqlite-smoke.sqlite");

  try {
    fs.writeFileSync(jsonPath, JSON.stringify({ activationCodes: {}, orders: {} }, null, 2), "utf8");

    const missing = runNode([
      scriptPath,
      "--json-state", jsonPath,
      "--sqlite", sqlitePath,
      "--backup-dir", backupDir,
      "--strict"
    ], 1);
    const missingResult = JSON.parse(missing.stdout);
    assertOk(missingResult.ok === false, "Missing SQLite state should not be ready.");
    assertOk(missingResult.nextSteps.some((step) => step.includes("server:migrate-sqlite")), "Missing state should suggest migration.");
    assertNoSensitivePaths(missing.stdout, tempRoot);

    writeSqliteState(sqlitePath);
    const noBackup = runNode([
      scriptPath,
      "--json-state", jsonPath,
      "--sqlite", sqlitePath,
      "--backup-dir", backupDir
    ]);
    const noBackupResult = JSON.parse(noBackup.stdout);
    assertOk(noBackupResult.ok === false, "SQLite without backup should not be ready.");
    assertOk(noBackupResult.sqlite.ok === true, "SQLite state should be readable.");
    assertOk(noBackupResult.nextSteps.some((step) => step.includes("server:backup-sqlite")), "Missing backup should suggest backup.");
    assertNoSensitivePaths(noBackup.stdout, tempRoot);

    fs.mkdirSync(backupDir, { recursive: true });
    writeSqliteState(backupPath);
    const ready = runNode([
      scriptPath,
      "--json-state", jsonPath,
      "--sqlite", sqlitePath,
      "--backup-dir", backupDir,
      "--max-age-hours", "24",
      "--strict"
    ]);
    const readyResult = JSON.parse(ready.stdout);
    assertOk(readyResult.ok === true, "SQLite with a readable fresh backup should be ready.");
    assertOk(readyResult.backup.totalBackups === 1, "Status should count one backup.");
    assertOk(readyResult.backup.latestCheck.ok === true, "Latest backup should be inspected.");
    assertNoSensitivePaths(ready.stdout, tempRoot);

    console.log("ZeroLag SQLite storage status smoke test passed.");
  } finally {
    safeRemoveTemp(tempRoot);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
