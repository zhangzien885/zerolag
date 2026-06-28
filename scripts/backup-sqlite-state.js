const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadServerEnvFile } = require("../server/env");
const { createSqliteStateStore } = require("../server/state-store");

const rootDir = path.join(__dirname, "..");
const defaultSqliteStatePath = path.join(rootDir, "server", "data", "server-state.sqlite");
const defaultBackupDir = path.join(rootDir, "server", "data", "backups");

loadServerEnvFile();

function usage() {
  console.log("Usage:");
  console.log("  node scripts/backup-sqlite-state.js [--input file] [--output file] [--force] [--allow-empty] [--dry-run]");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stateSummary(state) {
  return {
    activationCodes: Object.keys(state.activationCodes || {}).length,
    orders: Object.keys(state.orders || {}).length,
    paymentEvents: Object.keys(state.paymentEvents || {}).length,
    subscriptions: Object.keys(state.subscriptions || {}).length,
    tokens: Object.keys(state.tokens || {}).length,
    websiteEvents: Number(state.websiteEvents && state.websiteEvents.total || 0),
    auditEvents: Array.isArray(state.auditEvents) ? state.auditEvents.length : 0
  };
}

function timestampForFileName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function defaultOutputPath(stateSha256) {
  const backupDir = process.env.ZEROLAG_SQLITE_BACKUP_DIR || process.env.ZEROLAG_SERVER_BACKUP_DIR || defaultBackupDir;
  return path.join(
    backupDir,
    `server-state-sqlite-${timestampForFileName()}-${stateSha256.slice(0, 12)}.sqlite`
  );
}

function printFailure(message, extra = {}) {
  console.log(JSON.stringify({
    ok: false,
    message,
    ...extra
  }, null, 2));
  process.exitCode = 1;
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const inputFile = path.resolve(argValue("--input", process.env.ZEROLAG_SQLITE_STATE_PATH || defaultSqliteStatePath));
  const outputArg = argValue("--output");
  const force = process.argv.includes("--force");
  const allowEmpty = process.argv.includes("--allow-empty");
  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(inputFile)) {
    printFailure("Input SQLite state file does not exist.", { inputFile });
    return;
  }

  const sourceStore = createSqliteStateStore(inputFile);
  try {
    const loadedState = sourceStore.loadState();
    if (!loadedState && !allowEmpty) {
      printFailure("Input SQLite state is empty. Use --allow-empty to export an empty state document.", { inputFile });
      return;
    }

    const state = loadedState || {};
    const stateSha256 = sha256Json(state);
    const outputFile = path.resolve(outputArg || defaultOutputPath(stateSha256));
    const summary = stateSummary(state);

    if (fs.existsSync(outputFile) && !force && !dryRun) {
      printFailure("Output SQLite backup already exists. Use --force to update it.", { outputFile });
      return;
    }

    if (dryRun) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        inputFile,
        outputFile,
        stateSha256,
        summary
      }, null, 2));
      return;
    }

    const backupStore = createSqliteStateStore(outputFile);
    try {
      backupStore.saveState(state);
      const restoredState = backupStore.loadState();
      const restoredSha256 = sha256Json(restoredState);
      if (restoredSha256 !== stateSha256) {
        printFailure("SQLite backup state did not match the source SQLite state.", {
          inputFile,
          outputFile,
          sourceSha256: stateSha256,
          backupSha256: restoredSha256
        });
        return;
      }

      console.log(JSON.stringify({
        ok: true,
        inputFile,
        outputFile,
        stateSha256,
        summary
      }, null, 2));
    } finally {
      backupStore.close();
    }
  } finally {
    sourceStore.close();
  }
}

main();
