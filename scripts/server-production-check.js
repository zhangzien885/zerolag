const fs = require("fs");
const path = require("path");
const { loadServerEnvFile } = require("../server/env");
const {
  defaultPaymentProvider,
  defaultPaymentUrlTemplate,
  normalizePaymentProvider,
  paymentProviderListFromValue,
  testPaymentProviders
} = require("../server/payment-provider");
const { checkServerEnvFile } = require("./check-server-env");

const rootDir = path.join(__dirname, "..");
const strict = process.argv.includes("--strict");
const defaultServerSecret = "zerolag-dev-server-secret-change-before-production";
const defaultAdminSecret = "zerolag-dev-admin-secret-change-before-production";
const defaultPaymentWebhookSecret = "zerolag-dev-payment-webhook-secret-change-before-production";

const envFileLoad = loadServerEnvFile();

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function addIssue(issues, ok, message) {
  if (!ok) issues.push(message);
}

function addMessages(target, messages, prefix) {
  for (const message of messages || []) {
    target.push(`${prefix}: ${message}`);
  }
}

function isStrongSecret(value, defaultValue) {
  const text = String(value || "");
  return text.length >= 32 && text !== defaultValue && !/change-before-production|dev/i.test(text);
}

function isTruthyDisabled(value) {
  return String(value || "") === "1";
}

function isPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function stateSummary(state) {
  return {
    activationCodes: Object.keys(state.activationCodes || {}).length,
    orders: Object.keys(state.orders || {}).length,
    subscriptions: Object.keys(state.subscriptions || {}).length,
    tokens: Object.keys(state.tokens || {}).length,
    websiteEvents: Number(state.websiteEvents && state.websiteEvents.total || 0),
    auditEvents: Array.isArray(state.auditEvents) ? state.auditEvents.length : 0
  };
}

function inspectSqliteState(sqliteStatePath) {
  if (!fs.existsSync(sqliteStatePath)) {
    return {
      exists: false,
      readable: false,
      hasTable: false,
      hasState: false,
      summary: null,
      error: ""
    };
  }

  const sqlite = require("node:sqlite");
  let database = null;
  try {
    database = new sqlite.DatabaseSync(sqliteStatePath, { readOnly: true });
    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("state_documents");
    if (!table) {
      return {
        exists: true,
        readable: true,
        hasTable: false,
        hasState: false,
        summary: null,
        error: ""
      };
    }

    const row = database
      .prepare("SELECT value FROM state_documents WHERE key = ?")
      .get("server");
    if (!row) {
      return {
        exists: true,
        readable: true,
        hasTable: true,
        hasState: false,
        summary: null,
        error: ""
      };
    }

    const state = JSON.parse(row.value);
    return {
      exists: true,
      readable: true,
      hasTable: true,
      hasState: true,
      summary: stateSummary(state),
      error: ""
    };
  } catch (error) {
    return {
      exists: true,
      readable: false,
      hasTable: false,
      hasState: false,
      summary: null,
      error: error.message
    };
  } finally {
    if (database) database.close();
  }
}

function sqliteBackupMetadata(filePath) {
  const stats = fs.statSync(filePath);
  return {
    fileName: path.basename(filePath),
    filePath,
    modifiedAt: stats.mtime.toISOString(),
    sizeBytes: stats.size,
    ageHours: Number(((Date.now() - stats.mtime.getTime()) / (60 * 60 * 1000)).toFixed(2))
  };
}

function inspectLatestSqliteBackup(backupDir) {
  if (!fs.existsSync(backupDir)) {
    return {
      dirExists: false,
      isDirectory: false,
      totalBackups: 0,
      latest: null,
      state: null
    };
  }

  if (!fs.statSync(backupDir).isDirectory()) {
    return {
      dirExists: true,
      isDirectory: false,
      totalBackups: 0,
      latest: null,
      state: null
    };
  }

  const backups = fs.readdirSync(backupDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".sqlite"))
    .map((fileName) => sqliteBackupMetadata(path.join(backupDir, fileName)))
    .sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime());
  const latest = backups[0] || null;

  return {
    dirExists: true,
    isDirectory: true,
    totalBackups: backups.length,
    latest,
    state: latest ? inspectSqliteState(latest.filePath) : null
  };
}

function formatStateSummary(summary) {
  if (!summary) return "unavailable";
  return [
    `activationCodes=${summary.activationCodes}`,
    `orders=${summary.orders}`,
    `subscriptions=${summary.subscriptions}`,
    `tokens=${summary.tokens}`,
    `websiteEvents=${summary.websiteEvents}`,
    `auditEvents=${summary.auditEvents}`
  ].join(", ");
}

function main() {
  const issues = [];
  const warnings = [];
  const statePath = env("ZEROLAG_SERVER_STATE_PATH", path.join(rootDir, "server", "data", "server-state.json"));
  const backupDir = env("ZEROLAG_SERVER_BACKUP_DIR", path.join(path.dirname(statePath), "backups"));
  const host = env("ZEROLAG_SERVER_HOST", "127.0.0.1");
  const port = env("ZEROLAG_SERVER_PORT", "8787");
  const stateStore = normalizePaymentProvider(env("ZEROLAG_STATE_STORE", "json"));
  const sqliteStatePath = env("ZEROLAG_SQLITE_STATE_PATH", path.join(rootDir, "server", "data", "server-state.sqlite"));
  const sqliteBackupDir = env("ZEROLAG_SQLITE_BACKUP_DIR", backupDir);
  const sqliteBackupMaxAgeHours = positiveNumber(env("ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS"), 24);
  const paymentProvider = normalizePaymentProvider(env("ZEROLAG_PAYMENT_PROVIDER", defaultPaymentProvider));
  const paymentAllowedProviders = paymentProviderListFromValue(env(
    "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS",
    "manual,manual-admin,manual-signed-webhook,signed-webhook,self-test"
  ));
  const paymentUrlTemplate = env("ZEROLAG_PAYMENT_URL_TEMPLATE", defaultPaymentUrlTemplate);
  const sqliteInspection = stateStore === "sqlite" && sqliteStatePath ? inspectSqliteState(sqliteStatePath) : null;
  const sqliteBackupInspection = stateStore === "sqlite" ? inspectLatestSqliteBackup(sqliteBackupDir) : null;
  const envFileCheck = checkServerEnvFile(envFileLoad.path, {
    profile: stateStore === "sqlite" ? "sqlite" : "json",
    strict
  });
  addMessages(issues, envFileCheck.issues, "Private env file");
  addMessages(warnings, envFileCheck.warnings, "Private env file");

  addIssue(issues, isStrongSecret(env("ZEROLAG_SERVER_SECRET", defaultServerSecret), defaultServerSecret), "ZEROLAG_SERVER_SECRET must be a custom strong secret.");
  addIssue(issues, isStrongSecret(env("ZEROLAG_ADMIN_SECRET", defaultAdminSecret), defaultAdminSecret), "ZEROLAG_ADMIN_SECRET must be a custom strong secret.");
  addIssue(issues, isStrongSecret(env("ZEROLAG_PAYMENT_WEBHOOK_SECRET", defaultPaymentWebhookSecret), defaultPaymentWebhookSecret), "ZEROLAG_PAYMENT_WEBHOOK_SECRET must be a custom strong secret.");
  addIssue(issues, isPositiveNumber(port), "ZEROLAG_SERVER_PORT must be a positive number.");
  addIssue(issues, ["json", "json_file", "file", "sqlite"].includes(stateStore), "ZEROLAG_STATE_STORE must be json or sqlite.");
  addIssue(issues, paymentAllowedProviders.includes(paymentProvider), "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS must include ZEROLAG_PAYMENT_PROVIDER.");
  addIssue(
    issues,
    paymentProvider === defaultPaymentProvider || paymentUrlTemplate !== defaultPaymentUrlTemplate,
    "ZEROLAG_PAYMENT_URL_TEMPLATE must be configured for non-manual payment providers."
  );
  addIssue(issues, !isTruthyDisabled(env("ZEROLAG_RATE_LIMIT_DISABLED")), "Server rate limiting must stay enabled in production.");
  addIssue(issues, !isTruthyDisabled(env("ZEROLAG_SERVER_BACKUP_DISABLED")), "Server state backups must stay enabled in production.");
  addIssue(issues, !isTruthyDisabled(env("ZEROLAG_MAINTENANCE_DISABLED")), "Automatic maintenance must stay enabled in production.");

  if (env("ZEROLAG_TRUST_PROXY") === "1") {
    addIssue(warnings, false, "ZEROLAG_TRUST_PROXY is enabled; only use it behind a trusted reverse proxy that overwrites client IP headers.");
  }

  addIssue(warnings, host !== "127.0.0.1" && host !== "localhost", "Server host is local-only; use a reverse proxy or public bind intentionally for production.");
  addIssue(warnings, stateStore === "sqlite", "State store is still JSON file storage; SQLite is recommended before wider paid testing.");
  if (stateStore === "sqlite") {
    const sqliteExists = Boolean(sqliteInspection && sqliteInspection.exists);
    const sqliteReadable = Boolean(sqliteInspection && sqliteInspection.readable);
    const sqliteHasTable = Boolean(sqliteInspection && sqliteInspection.hasTable);
    addIssue(warnings, Boolean(sqliteStatePath), "ZEROLAG_SQLITE_STATE_PATH is not configured.");
    addIssue(issues, fs.existsSync(path.dirname(sqliteStatePath)), `SQLite state directory does not exist: ${path.dirname(sqliteStatePath)}`);
    addIssue(issues, sqliteExists, `SQLite state file does not exist: ${sqliteStatePath}`);
    addIssue(
      issues,
      !sqliteExists || sqliteReadable,
      `SQLite state file could not be read${sqliteInspection && sqliteInspection.error ? `: ${sqliteInspection.error}` : "."}`
    );
    addIssue(
      issues,
      !sqliteReadable || sqliteHasTable,
      "SQLite state file is missing the state_documents table; run the JSON migration or restore a verified backup."
    );
    addIssue(
      issues,
      !sqliteReadable || !sqliteHasTable || Boolean(sqliteInspection && sqliteInspection.hasState),
      "SQLite state file does not contain a server state document; run the JSON migration or restore a verified backup."
    );
    addIssue(warnings, sqliteBackupInspection && sqliteBackupInspection.dirExists, `SQLite backup directory does not exist yet: ${sqliteBackupDir}`);
    addIssue(warnings, !sqliteBackupInspection || !sqliteBackupInspection.dirExists || sqliteBackupInspection.isDirectory, `SQLite backup path is not a directory: ${sqliteBackupDir}`);
    addIssue(warnings, !sqliteBackupInspection || !sqliteBackupInspection.isDirectory || sqliteBackupInspection.totalBackups > 0, `SQLite backup directory has no .sqlite backup files: ${sqliteBackupDir}`);
    addIssue(
      warnings,
      !sqliteBackupInspection || !sqliteBackupInspection.latest || sqliteBackupInspection.latest.ageHours <= sqliteBackupMaxAgeHours,
      `Latest SQLite backup is older than ${sqliteBackupMaxAgeHours} hour(s).`
    );
    addIssue(
      warnings,
      !sqliteBackupInspection || !sqliteBackupInspection.state || sqliteBackupInspection.state.readable,
      `Latest SQLite backup could not be read${sqliteBackupInspection && sqliteBackupInspection.state && sqliteBackupInspection.state.error ? `: ${sqliteBackupInspection.state.error}` : "."}`
    );
    addIssue(
      warnings,
      !sqliteBackupInspection || !sqliteBackupInspection.state || !sqliteBackupInspection.state.readable || sqliteBackupInspection.state.hasTable,
      "Latest SQLite backup is missing the state_documents table."
    );
    addIssue(
      warnings,
      !sqliteBackupInspection || !sqliteBackupInspection.state || !sqliteBackupInspection.state.readable || !sqliteBackupInspection.state.hasTable || sqliteBackupInspection.state.hasState,
      "Latest SQLite backup does not contain a server state document."
    );
  }
  addIssue(warnings, paymentProvider !== defaultPaymentProvider, "Payment provider is still manual; configure ZEROLAG_PAYMENT_PROVIDER before paid release.");
  addIssue(
    warnings,
    !paymentAllowedProviders.some((provider) => testPaymentProviders.has(provider)),
    "Payment provider allowlist still includes test webhook providers; remove them before public release."
  );
  addIssue(warnings, fs.existsSync(path.dirname(statePath)), `State directory does not exist yet: ${path.dirname(statePath)}`);
  addIssue(warnings, fs.existsSync(backupDir), `Backup directory does not exist yet: ${backupDir}`);

  console.log("ZeroLag server production readiness");
  console.log(`Host: ${host}`);
  console.log(`Port: ${port}`);
  console.log(`Env file: ${envFileLoad.loaded ? envFileLoad.path : `${envFileLoad.path} (not loaded)`}`);
  console.log(`Env file summary: ${envFileCheck.summary && envFileCheck.summary.stateStore ? `stateStore=${envFileCheck.summary.stateStore}, paymentProvider=${envFileCheck.summary.paymentProvider}` : "unavailable"}`);
  console.log(`Runtime session proof: ${envFileCheck.summary && envFileCheck.summary.runtimeSessionProofAlgorithm ? `${envFileCheck.summary.runtimeSessionProofAlgorithm}, asymmetricKey=${envFileCheck.summary.runtimeSessionAsymmetricProofConfigured ? "yes" : "no"}` : "unavailable"}`);
  console.log(`State store: ${stateStore}`);
  console.log(`State: ${statePath}`);
  if (stateStore === "sqlite") console.log(`SQLite state: ${sqliteStatePath}`);
  if (stateStore === "sqlite") console.log(`SQLite summary: ${formatStateSummary(sqliteInspection && sqliteInspection.summary)}`);
  console.log(`Backup: ${backupDir}`);
  if (stateStore === "sqlite") console.log(`SQLite backup: ${sqliteBackupDir}`);
  if (stateStore === "sqlite") {
    console.log(`SQLite latest backup: ${sqliteBackupInspection && sqliteBackupInspection.latest ? sqliteBackupInspection.latest.fileName : "unavailable"}`);
    console.log(`SQLite latest backup age: ${sqliteBackupInspection && sqliteBackupInspection.latest ? `${sqliteBackupInspection.latest.ageHours}h` : "unavailable"}`);
    console.log(`SQLite latest backup summary: ${formatStateSummary(sqliteBackupInspection && sqliteBackupInspection.state && sqliteBackupInspection.state.summary)}`);
  }
  console.log(`Payment provider: ${paymentProvider}`);

  if (warnings.length) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
    if (strict) {
      console.log("\nStrict mode failed because warnings remain.");
      process.exitCode = 1;
      return;
    }
  }

  if (issues.length) {
    console.log("\nBlocking issues before production:");
    for (const issue of issues) console.log(`- ${issue}`);
    if (strict) process.exitCode = 1;
    return;
  }

  console.log("\nServer production readiness checks passed.");
}

main();
