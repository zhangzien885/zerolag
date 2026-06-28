const fs = require("fs");
const path = require("path");
const { loadServerEnvFile } = require("../server/env");
const { checkServerEnvFile } = require("./check-server-env");

const rootDir = path.join(__dirname, "..");
const defaultOutputPath = path.join(rootDir, "docs", "server-deployment-report.generated.md");
const defaultPaymentProvider = "manual";
const defaultPaymentUrlTemplate = "zerolag://pay/{orderId}";
const testPaymentProviders = new Set(["self-test", "manual-signed-webhook", "signed-webhook"]);

function usage() {
  console.log("Usage:");
  console.log("  node scripts/generate-server-deployment-report.js [--output path] [--stdout]");
}

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function normalizeKind(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

function paymentProviderList(value) {
  return String(value || "")
    .split(",")
    .map(normalizeKind)
    .filter(Boolean);
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function isPlaceholderUrl(value) {
  return /example\.com|localhost|127\.0\.0\.1/i.test(String(value || ""));
}

function isProductionUrl(value) {
  return isHttpsUrl(value) && !isPlaceholderUrl(value);
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function code(value) {
  const displayValue = value === undefined || value === null || value === "" ? "missing" : value;
  return `\`${String(displayValue).replace(/`/g, "'")}\``;
}

function status(ok, ready = "ready", todo = "needs attention") {
  return ok ? ready : todo;
}

function pathLabel(filePath) {
  if (!filePath) return "missing";
  const resolved = path.resolve(filePath);
  const relative = path.relative(rootDir, resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, "/");
  }
  return `${path.basename(resolved)} (external)`;
}

function sanitizeMessage(message, filePath) {
  return String(message || "")
    .replaceAll(String(filePath || ""), pathLabel(filePath))
    .replaceAll(String(filePath || "").replace(/\\/g, "/"), pathLabel(filePath))
    .replaceAll(rootDir, ".")
    .replaceAll(rootDir.replace(/\\/g, "/"), ".");
}

function listMessages(messages, filePath, fallback) {
  if (!messages || messages.length === 0) return `- ${fallback}`;
  return messages.map((message) => `- ${sanitizeMessage(message, filePath)}`).join("\n");
}

function urlLine(label, value) {
  return `- ${label}: ${code(value || "missing")} (${status(isProductionUrl(value), "production URL", "not production-ready")})`;
}

function buildReport() {
  const envFileLoad = loadServerEnvFile();
  const packageJson = readJson("package.json");
  const appConfig = readJson("assets/app-config.json");
  const updateManifest = readJson("assets/update.json");
  const stateStore = normalizeKind(env("ZEROLAG_STATE_STORE", "json"));
  const envProfile = stateStore === "sqlite" ? "sqlite" : "json";
  const envCheck = checkServerEnvFile(envFileLoad.path, { profile: envProfile, strict: false });
  const paymentProvider = normalizeKind(env("ZEROLAG_PAYMENT_PROVIDER", defaultPaymentProvider));
  const paymentAllowedProviders = paymentProviderList(env(
    "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS",
    "manual,manual-admin,manual-signed-webhook,signed-webhook,self-test"
  ));
  const paymentUrlTemplate = env("ZEROLAG_PAYMENT_URL_TEMPLATE", defaultPaymentUrlTemplate);
  const paymentMessage = env("ZEROLAG_PAYMENT_MESSAGE", "");
  const sqliteStatePath = env("ZEROLAG_SQLITE_STATE_PATH", "");
  const sqliteBackupDir = env("ZEROLAG_SQLITE_BACKUP_DIR", "");
  const backupMaxAgeHours = env("ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS", "24");
  const rateLimitEnabled = env("ZEROLAG_RATE_LIMIT_DISABLED") !== "1";
  const backupsEnabled = env("ZEROLAG_SERVER_BACKUP_DISABLED") !== "1";
  const maintenanceEnabled = env("ZEROLAG_MAINTENANCE_DISABLED") !== "1";
  const paymentProviderReady = paymentProvider !== defaultPaymentProvider;
  const paymentAllowlistReady = paymentAllowedProviders.includes(paymentProvider)
    && !paymentAllowedProviders.some((provider) => testPaymentProviders.has(provider));
  const checkoutReady = Boolean(paymentUrlTemplate) && paymentUrlTemplate !== defaultPaymentUrlTemplate;
  const storageReady = stateStore === "sqlite" && Boolean(sqliteStatePath) && Boolean(sqliteBackupDir);
  const envReady = envCheck.issues.length === 0;
  const publicLinksReady = [
    appConfig.websiteUrl,
    appConfig.purchaseUrl,
    appConfig.apiBaseUrl,
    appConfig.updateManifestUrl,
    appConfig.supportUrl
  ].every(isProductionUrl);
  const reportReady = envReady && storageReady && paymentProviderReady && paymentAllowlistReady && checkoutReady && publicLinksReady;

  return `# ZeroLag Server Deployment Report

Generated by \`npm run server:deployment-report\`.
This report is designed for private deployment review and never prints secret values.

## Snapshot

- Generated at: ${code(new Date().toISOString())}
- App version: ${code(packageJson.version)}
- App mode: ${code(appConfig.releaseMode || "missing")}
- Release channel: ${code(appConfig.releaseChannel || "missing")}
- Update manifest latest: ${code(updateManifest.latest || "missing")}
- Private env file: ${code(`${pathLabel(envFileLoad.path)}${envFileLoad.loaded ? "" : " (not loaded)"}`)}
- Overall server deployment state: ${code(status(reportReady, "ready for final strict gates", "needs configuration"))}

## Readiness Summary

- Env check: ${code(`${envCheck.issues.length} issue(s), ${envCheck.warnings.length} warning(s)`)}
- Storage: ${code(status(storageReady, "SQLite configured with backups", "SQLite/backups not fully configured"))}
- Payment: ${code(status(paymentProviderReady && paymentAllowlistReady && checkoutReady, "provider configured", "provider setup incomplete"))}
- Public links: ${code(status(publicLinksReady, "production URLs configured", "production URLs incomplete"))}
- Runtime safety: ${code(status(rateLimitEnabled && backupsEnabled && maintenanceEnabled, "guards enabled", "guard settings need review"))}

## Env Check

- Profile: ${code(envProfile)}
- Loaded key count: ${code(envCheck.keyCount)}
- State store from env: ${code(envCheck.summary.stateStore || stateStore)}
- Payment provider from env: ${code(envCheck.summary.paymentProvider || paymentProvider)}

### Blocking Issues

${listMessages(envCheck.issues, envFileLoad.path, "No blocking env issues detected.")}

### Warnings

${listMessages(envCheck.warnings, envFileLoad.path, "No env warnings detected.")}

## Storage And Backup

- State store: ${code(stateStore)}
- SQLite state path configured: ${code(yesNo(Boolean(sqliteStatePath)))}
- SQLite backup directory configured: ${code(yesNo(Boolean(sqliteBackupDir)))}
- SQLite backup max age: ${code(`${backupMaxAgeHours} hour(s)`)}
- Rate limiting enabled: ${code(yesNo(rateLimitEnabled))}
- State backups enabled: ${code(yesNo(backupsEnabled))}
- Automatic maintenance enabled: ${code(yesNo(maintenanceEnabled))}

## Payment And Membership

- Payment provider: ${code(paymentProvider)}
- Allowed provider count: ${code(paymentAllowedProviders.length)}
- Selected provider is allowlisted: ${code(yesNo(paymentAllowedProviders.includes(paymentProvider)))}
- Test webhook providers removed: ${code(yesNo(!paymentAllowedProviders.some((provider) => testPaymentProviders.has(provider))))}
- Checkout URL template configured: ${code(yesNo(checkoutReady))}
- Payment message configured: ${code(yesNo(Boolean(paymentMessage)))}

## Public Endpoints

${urlLine("Website", appConfig.websiteUrl)}
${urlLine("Purchase", appConfig.purchaseUrl)}
${urlLine("API base", appConfig.apiBaseUrl)}
${urlLine("Update manifest", appConfig.updateManifestUrl)}
${urlLine("Support", appConfig.supportUrl)}

## Final Private Commands

\`\`\`powershell
npm run server:deployment-report
npm run server:env-check -- --profile sqlite --strict
npm run server:check:strict
npm run server:smoke
npm run release:preflight:strict
npm run ci
\`\`\`
`;
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const outputArg = argValue("--output");
  const outputPath = outputArg ? path.resolve(outputArg) : defaultOutputPath;
  const content = buildReport();

  if (process.argv.includes("--stdout")) {
    process.stdout.write(content);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  console.log(`Server deployment report written: ${outputPath}`);
}

main();
