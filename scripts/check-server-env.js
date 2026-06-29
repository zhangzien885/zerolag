const fs = require("fs");
const path = require("path");
const { defaultServerEnvPath, parseEnvLine } = require("../server/env");

const defaultServerSecret = "zerolag-dev-server-secret-change-before-production";
const defaultAdminSecret = "zerolag-dev-admin-secret-change-before-production";
const defaultPaymentWebhookSecret = "zerolag-dev-payment-webhook-secret-change-before-production";
const defaultPaymentProvider = "manual";
const defaultPaymentUrlTemplate = "zerolag://pay/{orderId}";
const testPaymentProviders = new Set(["self-test", "manual-signed-webhook", "signed-webhook"]);
const providerCredentialKeys = {
  wechat_pay: [
    "ZEROLAG_WECHAT_PAY_MCH_ID",
    "ZEROLAG_WECHAT_PAY_APP_ID",
    "ZEROLAG_WECHAT_PAY_API_V3_KEY",
    "ZEROLAG_WECHAT_PAY_SERIAL_NO",
    "ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH"
  ],
  alipay: [
    "ZEROLAG_ALIPAY_APP_ID",
    "ZEROLAG_ALIPAY_PRIVATE_KEY_PATH",
    "ZEROLAG_ALIPAY_PUBLIC_KEY_PATH"
  ]
};

function usage() {
  console.log("Usage:");
  console.log("  node scripts/check-server-env.js [--file path] [--profile any|json|sqlite] [--strict]");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normalizeProfile(value) {
  const text = String(value || "").trim().toLowerCase();
  return ["json", "sqlite"].includes(text) ? text : "any";
}

function normalizeStoreKind(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

function normalizePaymentProvider(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

function normalizeRuntimeSessionProofAlgorithm(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function paymentProviderList(value) {
  return String(value || "")
    .split(",")
    .map(normalizePaymentProvider)
    .filter(Boolean);
}

function isStrongSecret(value, defaultValue) {
  const text = String(value || "");
  return text.length >= 32 && text !== defaultValue && !/change-before-production|dev/i.test(text);
}

function isPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function isDisabled(value) {
  return String(value || "") === "1";
}

function isSafeKeyVersion(value) {
  return /^[a-zA-Z0-9_.-]{3,64}$/.test(String(value || "").trim());
}

function decodePrivateKeyText(entries) {
  const pem = value(entries, "ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_PEM", "").trim();
  if (pem) return pem.replace(/\\n/g, "\n");

  const encoded = value(entries, "ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64", "").trim();
  if (!encoded) return "";

  try {
    return Buffer.from(encoded, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

function looksLikePrivateKey(value) {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(String(value || ""));
}

function readEnvFile(filePath) {
  const entries = new Map();
  const duplicateKeys = [];
  const invalidLines = [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const entry = parseEnvLine(line);
    if (!entry) {
      invalidLines.push(index + 1);
      return;
    }

    if (entries.has(entry.key)) duplicateKeys.push(entry.key);
    entries.set(entry.key, entry.value);
  });

  return {
    entries,
    duplicateKeys: Array.from(new Set(duplicateKeys)),
    invalidLines
  };
}

function value(entries, key, fallback = "") {
  return entries.has(key) ? entries.get(key) : fallback;
}

function addIssue(issues, ok, message) {
  if (!ok) issues.push(message);
}

function inspect(entries, profile) {
  const issues = [];
  const warnings = [];
  const stateStore = normalizeStoreKind(value(entries, "ZEROLAG_STATE_STORE", "json"));
  const paymentProvider = normalizePaymentProvider(value(entries, "ZEROLAG_PAYMENT_PROVIDER", defaultPaymentProvider));
  const paymentAllowedProviders = paymentProviderList(value(entries, "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS", ""));
  const paymentUrlTemplate = value(entries, "ZEROLAG_PAYMENT_URL_TEMPLATE", "");
  const paymentCredentialKeys = providerCredentialKeys[paymentProvider] || [];
  const missingPaymentCredentialKeys = paymentCredentialKeys.filter((key) => !String(value(entries, key, "")).trim());
  const runtimeSessionKeyVersion = value(entries, "ZEROLAG_RUNTIME_SESSION_KEY_VERSION", "");
  const runtimeSessionProofAlgorithm = normalizeRuntimeSessionProofAlgorithm(value(entries, "ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM", ""));
  const runtimeSessionPrivateKeyText = decodePrivateKeyText(entries);
  const runtimeSessionAsymmetricProofConfigured = Boolean(runtimeSessionPrivateKeyText);
  const required = [
    "ZEROLAG_SERVER_SECRET",
    "ZEROLAG_ADMIN_SECRET",
    "ZEROLAG_PAYMENT_WEBHOOK_SECRET",
    "ZEROLAG_RUNTIME_SESSION_KEY_VERSION",
    "ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM",
    "ZEROLAG_SERVER_HOST",
    "ZEROLAG_SERVER_PORT",
    "ZEROLAG_STATE_STORE",
    "ZEROLAG_SERVER_STATE_PATH",
    "ZEROLAG_SERVER_BACKUP_DIR",
    "ZEROLAG_PAYMENT_PROVIDER",
    "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS",
    "ZEROLAG_PAYMENT_URL_TEMPLATE",
    "ZEROLAG_RATE_LIMIT_DISABLED",
    "ZEROLAG_SERVER_BACKUP_DISABLED",
    "ZEROLAG_MAINTENANCE_DISABLED"
  ];

  if (stateStore === "sqlite" || profile === "sqlite") {
    required.push(
      "ZEROLAG_SQLITE_STATE_PATH",
      "ZEROLAG_SQLITE_BACKUP_DIR",
      "ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS"
    );
  }

  const missingKeys = required.filter((key) => !entries.has(key) || !String(entries.get(key)).trim());
  addIssue(issues, missingKeys.length === 0, `Missing required env keys: ${missingKeys.join(", ")}`);
  addIssue(issues, ["json", "json_file", "file", "sqlite"].includes(stateStore), "ZEROLAG_STATE_STORE must be json or sqlite.");
  addIssue(issues, profile !== "sqlite" || stateStore === "sqlite", "Expected SQLite profile but ZEROLAG_STATE_STORE is not sqlite.");
  addIssue(issues, profile !== "json" || ["json", "json_file", "file"].includes(stateStore), "Expected JSON profile but ZEROLAG_STATE_STORE is not json.");
  addIssue(issues, isPositiveNumber(value(entries, "ZEROLAG_SERVER_PORT")), "ZEROLAG_SERVER_PORT must be a positive number.");
  addIssue(issues, isStrongSecret(value(entries, "ZEROLAG_SERVER_SECRET"), defaultServerSecret), "ZEROLAG_SERVER_SECRET must be a custom strong secret.");
  addIssue(issues, isStrongSecret(value(entries, "ZEROLAG_ADMIN_SECRET"), defaultAdminSecret), "ZEROLAG_ADMIN_SECRET must be a custom strong secret.");
  addIssue(issues, isStrongSecret(value(entries, "ZEROLAG_PAYMENT_WEBHOOK_SECRET"), defaultPaymentWebhookSecret), "ZEROLAG_PAYMENT_WEBHOOK_SECRET must be a custom strong secret.");
  addIssue(issues, isSafeKeyVersion(runtimeSessionKeyVersion), "ZEROLAG_RUNTIME_SESSION_KEY_VERSION must be 3-64 safe characters.");
  addIssue(issues, ["HMAC-SHA256", "RSA-SHA256"].includes(runtimeSessionProofAlgorithm), "ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM must be HMAC-SHA256 or RSA-SHA256.");
  addIssue(
    issues,
    runtimeSessionProofAlgorithm !== "RSA-SHA256" || runtimeSessionAsymmetricProofConfigured,
    "ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_PEM or ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64 is required when runtime session proof algorithm is RSA-SHA256."
  );
  addIssue(
    issues,
    runtimeSessionProofAlgorithm !== "RSA-SHA256" || looksLikePrivateKey(runtimeSessionPrivateKeyText),
    "Runtime session RSA private key must be a PEM private key."
  );
  addIssue(issues, !isDisabled(value(entries, "ZEROLAG_RATE_LIMIT_DISABLED")), "ZEROLAG_RATE_LIMIT_DISABLED must not be 1.");
  addIssue(issues, !isDisabled(value(entries, "ZEROLAG_SERVER_BACKUP_DISABLED")), "ZEROLAG_SERVER_BACKUP_DISABLED must not be 1.");
  addIssue(issues, !isDisabled(value(entries, "ZEROLAG_MAINTENANCE_DISABLED")), "ZEROLAG_MAINTENANCE_DISABLED must not be 1.");
  addIssue(issues, paymentAllowedProviders.includes(paymentProvider), "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS must include ZEROLAG_PAYMENT_PROVIDER.");
  addIssue(
    issues,
    missingPaymentCredentialKeys.length === 0,
    `Missing ${paymentProvider} payment credential keys: ${missingPaymentCredentialKeys.join(", ")}`
  );

  addIssue(warnings, paymentProvider !== defaultPaymentProvider, "Payment provider is still manual.");
  addIssue(warnings, paymentUrlTemplate && paymentUrlTemplate !== defaultPaymentUrlTemplate, "Payment URL template is still the local placeholder.");
  addIssue(warnings, runtimeSessionProofAlgorithm !== "HMAC-SHA256", "Runtime session proof algorithm is still HMAC-SHA256; RSA-SHA256 is recommended before paid public release.");
  addIssue(
    warnings,
    !paymentAllowedProviders.some((provider) => testPaymentProviders.has(provider)),
    "Payment provider allowlist still includes test webhook providers."
  );
  addIssue(warnings, value(entries, "ZEROLAG_TRUST_PROXY", "0") !== "1", "ZEROLAG_TRUST_PROXY is enabled; only use it behind a trusted reverse proxy.");

  if (stateStore === "sqlite") {
    addIssue(warnings, isPositiveNumber(value(entries, "ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS", "24")), "ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS should be a positive number.");
  }

  return {
    issues,
    warnings,
    missingKeys,
    summary: {
      stateStore,
      sqliteConfigured: stateStore === "sqlite" && entries.has("ZEROLAG_SQLITE_STATE_PATH"),
      paymentProvider,
      paymentAllowedProviderCount: paymentAllowedProviders.length,
      paymentCredentialKeysRequired: paymentCredentialKeys.length,
      paymentCredentialKeysConfigured: paymentCredentialKeys.length - missingPaymentCredentialKeys.length,
      paymentProviderCredentialsConfigured: paymentCredentialKeys.length === 0 || missingPaymentCredentialKeys.length === 0,
      runtimeSessionKeyVersion,
      runtimeSessionProofAlgorithm,
      runtimeSessionAsymmetricProofConfigured,
      rateLimitEnabled: !isDisabled(value(entries, "ZEROLAG_RATE_LIMIT_DISABLED")),
      backupsEnabled: !isDisabled(value(entries, "ZEROLAG_SERVER_BACKUP_DISABLED")),
      maintenanceEnabled: !isDisabled(value(entries, "ZEROLAG_MAINTENANCE_DISABLED"))
    }
  };
}

function checkServerEnvFile(filePath, input = {}) {
  const strict = input.strict === true;
  const profile = normalizeProfile(input.profile || "any");
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      strict,
      profile,
      filePath,
      keyCount: 0,
      duplicateKeys: [],
      invalidLines: [],
      missingKeys: [],
      warnings: [],
      issues: [`Env file does not exist: ${filePath}`],
      summary: {}
    };
  }

  if (!fs.statSync(filePath).isFile()) {
    return {
      ok: false,
      strict,
      profile,
      filePath,
      keyCount: 0,
      duplicateKeys: [],
      invalidLines: [],
      missingKeys: [],
      warnings: [],
      issues: [`Env path is not a file: ${filePath}`],
      summary: {}
    };
  }

  const parsed = readEnvFile(filePath);
  const inspected = inspect(parsed.entries, profile);
  const issues = [...inspected.issues];
  if (parsed.duplicateKeys.length) issues.push(`Duplicate env keys: ${parsed.duplicateKeys.join(", ")}`);
  if (parsed.invalidLines.length) issues.push(`Invalid env lines: ${parsed.invalidLines.join(", ")}`);

  return {
    ok: issues.length === 0 && (!strict || inspected.warnings.length === 0),
    strict,
    profile,
    filePath,
    keyCount: parsed.entries.size,
    duplicateKeys: parsed.duplicateKeys,
    invalidLines: parsed.invalidLines,
    missingKeys: inspected.missingKeys,
    warnings: inspected.warnings,
    issues,
    summary: inspected.summary
  };
}

function printResult(result, strict) {
  console.log(JSON.stringify(result, null, 2));
  if (result.issues.length || (strict && result.warnings.length)) process.exitCode = 1;
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const strict = process.argv.includes("--strict");
  const profile = normalizeProfile(argValue("--profile", "any"));
  const filePath = path.resolve(argValue("--file", process.env.ZEROLAG_ENV_FILE || defaultServerEnvPath));
  printResult(checkServerEnvFile(filePath, { profile, strict }), strict);
}

if (require.main === module) {
  main();
}

module.exports = {
  checkServerEnvFile
};
