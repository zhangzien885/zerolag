const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadServerEnvFile } = require("../server/env");

const rootDir = path.join(__dirname, "..");
const defaultJsonStatePath = path.join(rootDir, "server", "data", "server-state.json");
const defaultSqliteStatePath = path.join(rootDir, "server", "data", "server-state.sqlite");
const defaultBackupDir = path.join(rootDir, "server", "data", "backups");

loadServerEnvFile();

function usage() {
  console.log("Usage:");
  console.log("  node scripts/sqlite-storage-status.js [--json-state file] [--sqlite file] [--backup-dir folder] [--max-age-hours n] [--strict]");
  console.log("");
  console.log("Prints a read-only SQLite storage readiness summary and safe next commands.");
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

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(filePath)} (external)`;
}

function fileMetadata(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      path: safeRelative(filePath)
    };
  }

  const stats = fs.statSync(filePath);
  return {
    exists: true,
    path: safeRelative(filePath),
    isDirectory: stats.isDirectory(),
    sizeBytes: stats.isFile() ? stats.size : 0,
    modifiedAt: stats.mtime.toISOString(),
    ageHours: Number(((Date.now() - stats.mtime.getTime()) / (60 * 60 * 1000)).toFixed(2))
  };
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

function inspectSqliteDocument(filePath) {
  const metadata = fileMetadata(filePath);
  if (!metadata.exists) {
    return {
      ...metadata,
      ok: false,
      message: "SQLite state file is missing."
    };
  }

  if (metadata.isDirectory) {
    return {
      ...metadata,
      ok: false,
      message: "SQLite state path is a directory."
    };
  }

  const sqlite = require("node:sqlite");
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

function listBackups(backupDir) {
  if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) return [];
  return fs.readdirSync(backupDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".sqlite"))
    .map((fileName) => path.join(backupDir, fileName))
    .map((filePath) => ({
      ...fileMetadata(filePath),
      filePath
    }))
    .sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime());
}

function publicBackupMetadata(metadata) {
  if (!metadata) return null;
  const { filePath, ...publicMetadata } = metadata;
  return publicMetadata;
}

function buildNextSteps(result) {
  if (!result.sqlite.ok) {
    return [
      `Run npm run server:migrate-sqlite -- --input ${result.jsonState.path} --output ${result.sqlite.path}`,
      "Run npm run server:sqlite-status again before switching production traffic.",
      "Keep server/data/*.sqlite and backup folders outside Git."
    ];
  }

  if (!result.backup.latest || result.backup.issues.length) {
    return [
      `Run npm run server:backup-sqlite -- --input ${result.sqlite.path}`,
      `Run npm run server:check-sqlite-backups -- --dir ${result.backup.dir}`,
      "Store a copy of fresh backups outside the application folder before paid testing."
    ];
  }

  return [
    "SQLite state and latest backup are readable.",
    "Run npm run server:deployment-report:strict for final deployment review.",
    "Document the restore command before accepting paid users."
  ];
}

function sqliteStorageStatus(input = {}) {
  const jsonPath = path.resolve(input.jsonStatePath || process.env.ZEROLAG_SERVER_STATE_PATH || defaultJsonStatePath);
  const sqlitePath = path.resolve(input.sqlitePath || process.env.ZEROLAG_SQLITE_STATE_PATH || defaultSqliteStatePath);
  const backupDir = path.resolve(input.backupDir || process.env.ZEROLAG_SQLITE_BACKUP_DIR || process.env.ZEROLAG_SERVER_BACKUP_DIR || defaultBackupDir);
  const maxAgeHours = positiveNumber(input.maxAgeHours ?? process.env.ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS ?? "24", 24);
  const issues = [];
  const warnings = [];

  const jsonState = fileMetadata(jsonPath);
  const sqlite = inspectSqliteDocument(sqlitePath);
  if (!sqlite.ok) issues.push(`SQLite state is not ready: ${sqlite.message}`);

  const backupDirMetadata = fileMetadata(backupDir);
  if (!backupDirMetadata.exists) {
    issues.push("SQLite backup directory is missing.");
  } else if (!backupDirMetadata.isDirectory) {
    issues.push("SQLite backup path is not a directory.");
  }

  const backups = listBackups(backupDir);
  const latest = backups[0] || null;
  let latestCheck = null;
  const backupIssues = [];

  if (!latest) {
    backupIssues.push("No SQLite backup files found.");
  } else {
    latestCheck = inspectSqliteDocument(latest.filePath);
    if (!latestCheck.ok) backupIssues.push(`Latest SQLite backup is unreadable: ${latestCheck.message}`);
    if (latest.ageHours > maxAgeHours) {
      backupIssues.push(`Latest SQLite backup is ${latest.ageHours} hour(s) old, exceeding ${maxAgeHours}.`);
    }
  }

  backupIssues.forEach((issue) => issues.push(issue));
  if (jsonState.exists && sqlite.ok) warnings.push("Legacy JSON state still exists; keep it only as a private migration fallback.");

  const result = {
    ok: issues.length === 0,
    strict: input.strict === true,
    jsonState,
    sqlite,
    backup: {
      dir: safeRelative(backupDir),
      dirExists: backupDirMetadata.exists && backupDirMetadata.isDirectory === true,
      totalBackups: backups.length,
      maxAgeHours,
      latest: publicBackupMetadata(latest),
      latestCheck,
      issues: backupIssues
    },
    issues,
    warnings
  };

  result.nextSteps = buildNextSteps(result);
  return result;
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const result = sqliteStorageStatus({
    jsonStatePath: argValue("--json-state", process.env.ZEROLAG_SERVER_STATE_PATH || defaultJsonStatePath),
    sqlitePath: argValue("--sqlite", process.env.ZEROLAG_SQLITE_STATE_PATH || defaultSqliteStatePath),
    backupDir: argValue("--backup-dir", process.env.ZEROLAG_SQLITE_BACKUP_DIR || process.env.ZEROLAG_SERVER_BACKUP_DIR || defaultBackupDir),
    maxAgeHours: argValue("--max-age-hours", process.env.ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS || "24"),
    strict: process.argv.includes("--strict")
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && result.strict) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  sqliteStorageStatus
};
