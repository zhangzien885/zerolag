const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadServerEnvFile } = require("../server/env");

const rootDir = path.join(__dirname, "..");
const defaultBackupDir = path.join(rootDir, "server", "data", "backups");

loadServerEnvFile();

function usage() {
  console.log("Usage:");
  console.log("  node scripts/check-sqlite-backups.js [--dir folder] [--all] [--min-count n] [--max-age-hours n]");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function positiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
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

function backupMetadata(filePath) {
  const stats = fs.statSync(filePath);
  return {
    fileName: path.basename(filePath),
    filePath,
    modifiedAt: stats.mtime.toISOString(),
    sizeBytes: stats.size,
    ageHours: Number(((Date.now() - stats.mtime.getTime()) / (60 * 60 * 1000)).toFixed(2))
  };
}

function inspectBackup(filePath) {
  const sqlite = require("node:sqlite");
  const metadata = backupMetadata(filePath);
  let database = null;

  try {
    database = new sqlite.DatabaseSync(filePath, { readOnly: true });
    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("state_documents");
    if (!table) {
      return {
        ...metadata,
        ok: false,
        message: "Missing state_documents table."
      };
    }

    const row = database
      .prepare("SELECT value FROM state_documents WHERE key = ?")
      .get("server");
    if (!row) {
      return {
        ...metadata,
        ok: false,
        message: "Missing server state document."
      };
    }

    const state = JSON.parse(row.value);
    return {
      ...metadata,
      ok: true,
      stateSha256: sha256Json(state),
      summary: stateSummary(state)
    };
  } catch (error) {
    return {
      ...metadata,
      ok: false,
      message: error.message
    };
  } finally {
    if (database) database.close();
  }
}

function listSqliteBackups(backupDir) {
  return fs.readdirSync(backupDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".sqlite"))
    .map((fileName) => path.join(backupDir, fileName))
    .map(backupMetadata)
    .sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime());
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const backupDir = path.resolve(argValue(
    "--dir",
    process.env.ZEROLAG_SQLITE_BACKUP_DIR || process.env.ZEROLAG_SERVER_BACKUP_DIR || defaultBackupDir
  ));
  const checkAll = process.argv.includes("--all");
  const minCount = Math.max(1, Math.floor(positiveNumber(argValue("--min-count", "1"), 1)));
  const maxAgeArg = argValue("--max-age-hours");
  const maxAgeHours = maxAgeArg ? positiveNumber(maxAgeArg, 0) : null;
  const issues = [];

  if (!fs.existsSync(backupDir)) {
    printResult({
      ok: false,
      backupDir,
      totalBackups: 0,
      checkedBackups: 0,
      latest: null,
      checks: [],
      issues: [`SQLite backup directory does not exist: ${backupDir}`]
    });
    return;
  }

  if (!fs.statSync(backupDir).isDirectory()) {
    printResult({
      ok: false,
      backupDir,
      totalBackups: 0,
      checkedBackups: 0,
      latest: null,
      checks: [],
      issues: [`SQLite backup path is not a directory: ${backupDir}`]
    });
    return;
  }

  const backups = listSqliteBackups(backupDir);
  if (backups.length < minCount) {
    issues.push(`Expected at least ${minCount} SQLite backup file(s), found ${backups.length}.`);
  }

  const latest = backups[0] || null;
  if (latest && maxAgeHours !== null && latest.ageHours > maxAgeHours) {
    issues.push(`Latest SQLite backup is ${latest.ageHours} hour(s) old, exceeding ${maxAgeHours}.`);
  }

  const targets = (checkAll ? backups : backups.slice(0, 1)).map((backup) => backup.filePath);
  const checks = targets.map(inspectBackup);
  for (const check of checks) {
    if (!check.ok) issues.push(`${check.fileName}: ${check.message}`);
  }

  printResult({
    ok: issues.length === 0,
    backupDir,
    totalBackups: backups.length,
    checkedBackups: checks.length,
    latest,
    checks,
    issues
  });
}

main();
