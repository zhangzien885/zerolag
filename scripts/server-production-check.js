const fs = require("fs");
const path = require("path");
const { loadServerEnvFile } = require("../server/env");

const rootDir = path.join(__dirname, "..");
const strict = process.argv.includes("--strict");
const defaultServerSecret = "zerolag-dev-server-secret-change-before-production";
const defaultAdminSecret = "zerolag-dev-admin-secret-change-before-production";
const defaultPaymentWebhookSecret = "zerolag-dev-payment-webhook-secret-change-before-production";
const defaultPaymentProvider = "manual";
const defaultPaymentUrlTemplate = "zerolag://pay/{orderId}";

loadServerEnvFile();

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function addIssue(issues, ok, message) {
  if (!ok) issues.push(message);
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

function normalizePaymentProvider(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

function paymentProviderList(value) {
  return String(value || "")
    .split(",")
    .map(normalizePaymentProvider)
    .filter(Boolean);
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
  const paymentProvider = normalizePaymentProvider(env("ZEROLAG_PAYMENT_PROVIDER", defaultPaymentProvider));
  const paymentAllowedProviders = paymentProviderList(env(
    "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS",
    "manual,manual-admin,manual-signed-webhook,signed-webhook,self-test"
  ));
  const paymentUrlTemplate = env("ZEROLAG_PAYMENT_URL_TEMPLATE", defaultPaymentUrlTemplate);

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
    addIssue(warnings, Boolean(sqliteStatePath), "ZEROLAG_SQLITE_STATE_PATH is not configured.");
  }
  addIssue(warnings, paymentProvider !== defaultPaymentProvider, "Payment provider is still manual; configure ZEROLAG_PAYMENT_PROVIDER before paid release.");
  addIssue(
    warnings,
    !paymentAllowedProviders.some((provider) => ["self-test", "manual-signed-webhook", "signed-webhook"].includes(provider)),
    "Payment provider allowlist still includes test webhook providers; remove them before public release."
  );
  addIssue(warnings, fs.existsSync(path.dirname(statePath)), `State directory does not exist yet: ${path.dirname(statePath)}`);
  addIssue(warnings, fs.existsSync(backupDir), `Backup directory does not exist yet: ${backupDir}`);

  console.log("ZeroLag server production readiness");
  console.log(`Host: ${host}`);
  console.log(`Port: ${port}`);
  console.log(`State store: ${stateStore}`);
  console.log(`State: ${statePath}`);
  if (stateStore === "sqlite") console.log(`SQLite state: ${sqliteStatePath}`);
  console.log(`Backup: ${backupDir}`);
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
