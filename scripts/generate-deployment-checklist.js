const fs = require("fs");
const path = require("path");
const { loadServerEnvFile } = require("../server/env");

const rootDir = path.join(__dirname, "..");
const defaultOutputPath = path.join(rootDir, "docs", "deployment-checklist.generated.md");
const defaultServerSecret = "zerolag-dev-server-secret-change-before-production";
const defaultAdminSecret = "zerolag-dev-admin-secret-change-before-production";
const defaultPaymentWebhookSecret = "zerolag-dev-payment-webhook-secret-change-before-production";
const defaultPaymentProvider = "manual";
const defaultPaymentUrlTemplate = "zerolag://pay/{orderId}";
const testPaymentProviders = new Set(["self-test", "manual-signed-webhook", "signed-webhook"]);

loadServerEnvFile();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
}

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function isPlaceholderUrl(value) {
  return /example\.com|localhost|127\.0\.0\.1/i.test(String(value || ""));
}

function isRealHttpsUrl(value) {
  return isHttpsUrl(value) && !isPlaceholderUrl(value);
}

function isStrongSecret(value, defaultValue) {
  const text = String(value || "");
  return text.length >= 32 && text !== defaultValue && !/change-before-production|dev/i.test(text);
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

function checkbox(done, label, detail = "") {
  return `- [${done ? "x" : " "}] ${label}${detail ? ` - ${detail}` : ""}`;
}

function statusText(done, good = "ready", bad = "todo") {
  return done ? good : bad;
}

function code(value) {
  return `\`${String(value || "")}\``;
}

function buildChecklist() {
  const packageJson = readJson("package.json");
  const appConfig = readJson("assets/app-config.json");
  const updateManifest = readJson("assets/update.json");
  const serverSecretReady = isStrongSecret(env("ZEROLAG_SERVER_SECRET", defaultServerSecret), defaultServerSecret);
  const adminSecretReady = isStrongSecret(env("ZEROLAG_ADMIN_SECRET", defaultAdminSecret), defaultAdminSecret);
  const paymentSecretReady = isStrongSecret(env("ZEROLAG_PAYMENT_WEBHOOK_SECRET", defaultPaymentWebhookSecret), defaultPaymentWebhookSecret);
  const stateStore = normalizePaymentProvider(env("ZEROLAG_STATE_STORE", "json"));
  const sqliteStatePath = env("ZEROLAG_SQLITE_STATE_PATH", "");
  const paymentProvider = normalizePaymentProvider(env("ZEROLAG_PAYMENT_PROVIDER", defaultPaymentProvider));
  const paymentAllowedProviders = paymentProviderList(env(
    "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS",
    "manual,manual-admin,manual-signed-webhook,signed-webhook,self-test"
  ));
  const paymentUrlTemplate = env("ZEROLAG_PAYMENT_URL_TEMPLATE", defaultPaymentUrlTemplate);
  const statePath = env("ZEROLAG_SERVER_STATE_PATH", "");
  const backupDir = env("ZEROLAG_SERVER_BACKUP_DIR", "");
  const signingReady = Boolean(
    process.env.CSC_LINK
      || process.env.WIN_CSC_LINK
      || process.env.WINDOWS_CODESIGN_CERT
      || process.env.ZEROLAG_CODESIGN_CERT
  );

  const appItems = [
    checkbox(appConfig.releaseMode === "production", "Desktop release mode is production", `current: ${code(appConfig.releaseMode || "missing")}`),
    checkbox(appConfig.allowLocalDemoLicense === false, "Local demo activation is disabled"),
    checkbox(isRealHttpsUrl(appConfig.websiteUrl), "Production website URL is real HTTPS", `current: ${code(appConfig.websiteUrl || "missing")}`),
    checkbox(isRealHttpsUrl(appConfig.purchaseUrl), "Purchase URL is real HTTPS", `current: ${code(appConfig.purchaseUrl || "missing")}`),
    checkbox(isRealHttpsUrl(appConfig.analyticsUrl), "Website analytics URL is real HTTPS", `current: ${code(appConfig.analyticsUrl || "missing")}`),
    checkbox(isRealHttpsUrl(appConfig.supportUrl), "Support URL is real HTTPS", `current: ${code(appConfig.supportUrl || "missing")}`),
    checkbox(isRealHttpsUrl(appConfig.apiBaseUrl), "API base URL is real HTTPS", `current: ${code(appConfig.apiBaseUrl || "missing")}`),
    checkbox(isRealHttpsUrl(appConfig.updateManifestUrl), "Update manifest URL is real HTTPS", `current: ${code(appConfig.updateManifestUrl || "missing")}`),
    checkbox(Boolean(appConfig.updatePublicKeyPem), "Update public key is configured")
  ];

  const serverItems = [
    checkbox(serverSecretReady, "Server secret is strong", statusText(serverSecretReady, "custom secret detected", "missing/default")),
    checkbox(adminSecretReady, "Admin secret is strong", statusText(adminSecretReady, "custom secret detected", "missing/default")),
    checkbox(paymentSecretReady, "Payment webhook secret is strong", statusText(paymentSecretReady, "custom secret detected", "missing/default")),
    checkbox(Boolean(statePath), "Durable server state path is configured", statePath ? "configured" : "missing"),
    checkbox(Boolean(backupDir), "Durable backup directory is configured", backupDir ? "configured" : "missing"),
    checkbox(stateStore === "sqlite", "SQLite state store is selected for wider paid testing", `current: ${code(stateStore)}`),
    checkbox(stateStore !== "sqlite" || Boolean(sqliteStatePath), "SQLite state path is configured", stateStore === "sqlite" ? statusText(Boolean(sqliteStatePath), "configured", "missing") : "not using SQLite"),
    checkbox(env("ZEROLAG_RATE_LIMIT_DISABLED") !== "1", "Server rate limiting is enabled"),
    checkbox(env("ZEROLAG_SERVER_BACKUP_DISABLED") !== "1", "Server state backups are enabled"),
    checkbox(env("ZEROLAG_MAINTENANCE_DISABLED") !== "1", "Automatic maintenance is enabled")
  ];

  const paymentItems = [
    checkbox(paymentProvider !== defaultPaymentProvider, "Real payment provider is selected", `current: ${code(paymentProvider)}`),
    checkbox(paymentAllowedProviders.includes(paymentProvider), "Provider allowlist includes the selected provider"),
    checkbox(!paymentAllowedProviders.some((provider) => testPaymentProviders.has(provider)), "Provider allowlist excludes test webhook providers"),
    checkbox(paymentUrlTemplate !== defaultPaymentUrlTemplate, "Checkout URL template is configured", `current: ${code(paymentUrlTemplate)}`),
    checkbox(Boolean(env("ZEROLAG_PAYMENT_MESSAGE")), "Payment message is configured")
  ];

  const releaseItems = [
    checkbox(packageJson.version !== "0.1.0", "Release version is no longer 0.1.0", `current: ${code(packageJson.version)}`),
    checkbox(!/prototype/i.test(packageJson.description || ""), "Package description no longer says prototype"),
    checkbox(updateManifest.latest === packageJson.version, "Update manifest version matches package version", `${code(updateManifest.latest)} vs ${code(packageJson.version)}`),
    checkbox(isRealHttpsUrl(updateManifest.downloadUrl), "Update manifest download URL is real HTTPS", `current: ${code(updateManifest.downloadUrl || "missing")}`),
    checkbox(updateManifest.signatureAlgorithm === "RSA-SHA256" && Boolean(updateManifest.signature), "Update manifest is signed"),
    checkbox(signingReady, "Windows code-signing certificate is configured")
  ];

  return `# ZeroLag Deployment Checklist

Generated by \`npm run deploy:checklist\`. This file is safe to commit because it never prints secret values.

## Current Snapshot

- App version: ${code(packageJson.version)}
- App mode: ${code(appConfig.releaseMode || "missing")}
- Release channel: ${code(appConfig.releaseChannel || "missing")}
- Payment provider: ${code(paymentProvider)}
- State store: ${code(stateStore)}
- Update manifest latest: ${code(updateManifest.latest || "missing")}

## 1. Desktop Client

${appItems.join("\n")}

## 2. Server Environment

${serverItems.join("\n")}

## 3. Payment Provider

${paymentItems.join("\n")}

## 4. Release Package And Update Metadata

${releaseItems.join("\n")}

## 5. Final Commands

Run these in order before a paid public release:

\`\`\`powershell
npm run deploy:checklist
npm run server:deployment-report
npm run server:secrets -- --profile sqlite --write
npm run server:env-check -- --profile sqlite
npm run server:migrate-sqlite -- --input <json-state> --output <sqlite-state>
npm run server:backup-sqlite -- --input <sqlite-state> --output <sqlite-backup>
npm run server:check-sqlite-backups -- --dir <sqlite-backup-dir> --max-age-hours 24
npm run production:check:strict
npm run server:check:strict
npm run server:smoke
npm run release:preflight:strict
npm run ci
npm run release:build
\`\`\`

## 6. Emergency SQLite Restore

Only run this during private recovery after stopping the production server:

\`\`\`powershell
npm run server:restore-sqlite -- --input <sqlite-backup> --output <sqlite-state> --force
\`\`\`

## Notes

- Keep \`.secrets/server.env\` private and out of Git.
- Use \`--force\` with \`server:secrets\` only when intentionally replacing a private env file.
- Default \`server:smoke\` uses isolated state; use \`-- --live-state\` only during planned private maintenance.
- Do not upload private analytics or operations CSV exports to the public website.
- Replace the JSON state store with a real database before broad public traffic.
`;
}

function main() {
  const outputArg = argValue("--output");
  const outputPath = outputArg ? path.resolve(outputArg) : defaultOutputPath;
  const content = buildChecklist();

  if (process.argv.includes("--stdout")) {
    process.stdout.write(content);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  console.log(`Deployment checklist written: ${outputPath}`);
}

main();
