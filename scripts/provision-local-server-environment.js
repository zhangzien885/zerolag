const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { defaultServerEnvPath, parseEnvLine } = require("../server/env");
const { createSqliteStateStore } = require("../server/state-store");
const { loadState, saveState } = require("../server");
const { bootstrapProductionEnv } = require("./bootstrap-production-env");
const { checkServerEnvFile } = require("./check-server-env");
const { createDeploymentPack } = require("./prepare-server-deployment-pack");

const rootDir = path.join(__dirname, "..");
const defaultRuntimeKeyDir = path.join(rootDir, ".secrets", "runtime-session");
const defaultDeploymentPackPath = path.join(rootDir, "dist", "server-deployment");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/provision-local-server-environment.js [--env-file path] [--runtime-key-dir path] [--deployment-pack path] [--force] [--skip-pack]");
  console.log("");
  console.log("Prepares a local production-like ZeroLag server environment without printing private secrets.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(filePath)} (external)`;
}

function readEnvEntries(envPath) {
  const entries = new Map();
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (entry) entries.set(entry.key, entry.value);
  }
  return entries;
}

function envValue(entries, key, fallback = "") {
  return entries.has(key) ? entries.get(key) : fallback;
}

function resolveFromBase(baseDir, value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(baseDir, raw);
}

function timestampForFileName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stateSummary(state) {
  return {
    activationCodes: Object.keys(state.activationCodes || {}).length,
    accounts: Object.keys(state.accounts || {}).length,
    orders: Object.keys(state.orders || {}).length,
    paymentEvents: Object.keys(state.paymentEvents || {}).length,
    subscriptions: Object.keys(state.subscriptions || {}).length,
    tokens: Object.keys(state.tokens || {}).length,
    websiteEvents: Number(state.websiteEvents && state.websiteEvents.total || 0),
    auditEvents: Array.isArray(state.auditEvents) ? state.auditEvents.length : 0
  };
}

function ensureSqliteState(sqlitePath) {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const store = createSqliteStateStore(sqlitePath);
  try {
    const state = loadState({ stateStore: store });
    saveState(state, { stateStore: store });
    return {
      path: sqlitePath,
      summary: stateSummary(state),
      stateSha256: sha256Json(state)
    };
  } finally {
    store.close();
  }
}

function backupSqliteState(sqlitePath, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const sourceStore = createSqliteStateStore(sqlitePath);
  try {
    const state = sourceStore.loadState() || {};
    const stateSha256 = sha256Json(state);
    const backupPath = path.join(
      backupDir,
      `server-state-sqlite-provision-${timestampForFileName()}-${stateSha256.slice(0, 12)}.sqlite`
    );
    const backupStore = createSqliteStateStore(backupPath);
    try {
      backupStore.saveState(state);
      const restored = backupStore.loadState() || {};
      const restoredSha256 = sha256Json(restored);
      if (restoredSha256 !== stateSha256) {
        throw new Error("Provisioned SQLite backup did not match the source state.");
      }
    } finally {
      backupStore.close();
    }

    return {
      path: backupPath,
      stateSha256,
      summary: stateSummary(state)
    };
  } finally {
    sourceStore.close();
  }
}

function remainingLaunchItems(envCheckStrict) {
  const items = [
    "Replace manual payment placeholders with real WeChat Pay, Alipay, or provider credentials.",
    "Configure real HTTPS website, purchase, API, support, analytics, and update manifest URLs.",
    "Apply the generated runtime-session public key snippet to assets/app-config.json.",
    "Generate and sign the public update manifest before publishing installers.",
    "Configure Windows code signing before building the public installer."
  ];

  if (envCheckStrict.warnings.length) {
    items.push("Resolve strict server env warnings before paid public release.");
  }

  return items;
}

function provisionLocalServerEnvironment(input = {}) {
  const envPath = path.resolve(input.envPath || defaultServerEnvPath);
  const runtimeKeyDir = path.resolve(input.runtimeKeyDir || defaultRuntimeKeyDir);
  const deploymentPackPath = path.resolve(input.deploymentPackPath || defaultDeploymentPackPath);
  const baseDir = path.resolve(input.baseDir || rootDir);
  const force = input.force === true;
  const skipPack = input.skipPack === true;
  const envExistedBefore = fs.existsSync(envPath);
  let bootstrap = null;

  if (!envExistedBefore || force) {
    bootstrap = bootstrapProductionEnv({
      profile: "sqlite",
      envPath,
      runtimeKeyDir,
      keyVersion: "runtime-session-v1",
      force
    });
  }

  if (!fs.existsSync(envPath)) {
    throw new Error(`Private server env file was not created: ${envPath}`);
  }

  const entries = readEnvEntries(envPath);
  const stateStore = String(envValue(entries, "ZEROLAG_STATE_STORE", "")).trim().toLowerCase();
  if (stateStore !== "sqlite") {
    throw new Error("Local server provisioning expects ZEROLAG_STATE_STORE=sqlite. Back up the env file and rerun with --force if you want to regenerate it.");
  }

  const sqlitePath = resolveFromBase(baseDir, envValue(entries, "ZEROLAG_SQLITE_STATE_PATH"), path.join("server", "data", "server-state.sqlite"));
  const backupDir = resolveFromBase(baseDir, envValue(entries, "ZEROLAG_SQLITE_BACKUP_DIR"), path.join("server", "data", "backups"));
  const sqlite = ensureSqliteState(sqlitePath);
  const backup = backupSqliteState(sqlitePath, backupDir);
  const envCheck = checkServerEnvFile(envPath, { profile: "sqlite", strict: false });
  const envCheckStrict = checkServerEnvFile(envPath, { profile: "sqlite", strict: true });
  const deploymentPack = skipPack ? null : createDeploymentPack({
    outputPath: deploymentPackPath,
    force: true
  });

  return {
    ok: envCheck.issues.length === 0 && Boolean(sqlite.path) && Boolean(backup.path),
    publicLaunchReady: envCheckStrict.ok,
    envFile: safeRelative(envPath),
    envCreated: !envExistedBefore || force,
    runtimeKeyDir: safeRelative(runtimeKeyDir),
    sqlite: {
      path: safeRelative(sqlite.path),
      summary: sqlite.summary
    },
    backup: {
      path: safeRelative(backup.path),
      summary: backup.summary
    },
    deploymentPack: deploymentPack ? {
      path: safeRelative(deploymentPack.output),
      fileCount: deploymentPack.fileCount
    } : null,
    envIssues: envCheck.issues.length,
    envWarnings: envCheck.warnings.length,
    strictWarnings: envCheckStrict.warnings.length,
    remainingLaunchItems: remainingLaunchItems(envCheckStrict),
    bootstrap: bootstrap ? {
      profile: bootstrap.profile,
      envWarnings: bootstrap.envWarnings,
      runtimeKeyVersion: bootstrap.runtimeKeyVersion
    } : null
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  try {
    const result = provisionLocalServerEnvironment({
      envPath: argValue("--env-file", defaultServerEnvPath),
      runtimeKeyDir: argValue("--runtime-key-dir", defaultRuntimeKeyDir),
      deploymentPackPath: argValue("--deployment-pack", defaultDeploymentPackPath),
      force: process.argv.includes("--force"),
      skipPack: process.argv.includes("--skip-pack")
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  provisionLocalServerEnvironment
};
