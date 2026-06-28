const fs = require("fs");
const path = require("path");
const { loadServerEnvFile } = require("../server/env");
const { checkServerEnvFile } = require("./check-server-env");

const rootDir = path.join(__dirname, "..");
const defaultOutputPath = path.join(rootDir, "docs", "server-deployment-report.generated.md");
const defaultJsonOutputPath = path.join(rootDir, "docs", "server-deployment-report.generated.json");
const defaultPaymentProvider = "manual";
const defaultPaymentUrlTemplate = "zerolag://pay/{orderId}";
const testPaymentProviders = new Set(["self-test", "manual-signed-webhook", "signed-webhook"]);

function usage() {
  console.log("Usage:");
  console.log("  node scripts/generate-server-deployment-report.js [--output path] [--stdout] [--strict] [--json]");
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

function normalizeRuntimeSessionProofAlgorithm(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "HMAC-SHA256";
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

function urlStatus(label, value) {
  return {
    label,
    url: value || "",
    ready: isProductionUrl(value)
  };
}

function gateLine(label, ok, detail) {
  return `- ${ok ? "[x]" : "[ ]"} ${label}${detail ? ` - ${detail}` : ""}`;
}

function strictFailureSummary(gates) {
  return gates
    .filter((gate) => !gate.ok)
    .map((gate) => gate.label)
    .join(", ");
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
  const runtimeSessionKeyVersion = env("ZEROLAG_RUNTIME_SESSION_KEY_VERSION", "runtime-session-v1");
  const runtimeSessionProofAlgorithm = normalizeRuntimeSessionProofAlgorithm(env("ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM", "HMAC-SHA256"));
  const runtimeSessionAsymmetricProofConfigured = Boolean(
    env("ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_PEM")
    || env("ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64")
  );
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
  const runtimeGuardsReady = rateLimitEnabled && backupsEnabled && maintenanceEnabled;
  const publicEndpoints = [
    urlStatus("website", appConfig.websiteUrl),
    urlStatus("purchase", appConfig.purchaseUrl),
    urlStatus("apiBase", appConfig.apiBaseUrl),
    urlStatus("updateManifest", appConfig.updateManifestUrl),
    urlStatus("support", appConfig.supportUrl)
  ];
  const gates = [
    {
      label: "Private env file passes validation",
      ok: envReady,
      detail: `${envCheck.issues.length} issue(s), ${envCheck.warnings.length} warning(s)`
    },
    {
      label: "SQLite storage and backup paths are configured",
      ok: storageReady,
      detail: `stateStore=${stateStore}`
    },
    {
      label: "Payment provider is no longer local manual mode",
      ok: paymentProviderReady,
      detail: `provider=${paymentProvider}`
    },
    {
      label: "Payment provider allowlist excludes test webhook providers",
      ok: paymentAllowlistReady,
      detail: `${paymentAllowedProviders.length} provider(s)`
    },
    {
      label: "Checkout URL template is configured",
      ok: checkoutReady,
      detail: checkoutReady ? "ready" : "placeholder or missing"
    },
    {
      label: "Public website, purchase, API, update, and support URLs are production HTTPS",
      ok: publicLinksReady,
      detail: publicLinksReady ? "ready" : "one or more URLs are missing/placeholders"
    },
    {
      label: "Rate limit, backup, and maintenance guards are enabled",
      ok: runtimeGuardsReady,
      detail: runtimeGuardsReady ? "enabled" : "one or more guards disabled"
    }
  ];
  const reportReady = gates.every((gate) => gate.ok);
  const generatedAt = new Date().toISOString();
  const data = {
    generatedAt,
    ready: reportReady,
    strictFailureSummary: strictFailureSummary(gates),
    snapshot: {
      appVersion: packageJson.version,
      appMode: appConfig.releaseMode || "",
      releaseChannel: appConfig.releaseChannel || "",
      updateManifestLatest: updateManifest.latest || "",
      privateEnvFile: {
        path: pathLabel(envFileLoad.path),
        loaded: envFileLoad.loaded,
        profile: envProfile,
        keyCount: envCheck.keyCount
      }
    },
    gates: gates.map((gate) => ({
      label: gate.label,
      ok: gate.ok,
      detail: gate.detail
    })),
    envCheck: {
      ok: envCheck.issues.length === 0,
      issueCount: envCheck.issues.length,
      warningCount: envCheck.warnings.length,
      issues: envCheck.issues.map((message) => sanitizeMessage(message, envFileLoad.path)),
      warnings: envCheck.warnings.map((message) => sanitizeMessage(message, envFileLoad.path)),
      summary: {
        stateStore: envCheck.summary.stateStore || stateStore,
        sqliteConfigured: Boolean(envCheck.summary.sqliteConfigured),
        paymentProvider: envCheck.summary.paymentProvider || paymentProvider,
        paymentAllowedProviderCount: envCheck.summary.paymentAllowedProviderCount || paymentAllowedProviders.length,
        runtimeSessionKeyVersion: envCheck.summary.runtimeSessionKeyVersion || runtimeSessionKeyVersion,
        runtimeSessionProofAlgorithm: envCheck.summary.runtimeSessionProofAlgorithm || runtimeSessionProofAlgorithm,
        runtimeSessionAsymmetricProofConfigured: envCheck.summary.runtimeSessionAsymmetricProofConfigured === undefined
          ? runtimeSessionAsymmetricProofConfigured
          : Boolean(envCheck.summary.runtimeSessionAsymmetricProofConfigured),
        rateLimitEnabled: Boolean(envCheck.summary.rateLimitEnabled),
        backupsEnabled: Boolean(envCheck.summary.backupsEnabled),
        maintenanceEnabled: Boolean(envCheck.summary.maintenanceEnabled)
      }
    },
    storage: {
      stateStore,
      sqliteStatePathConfigured: Boolean(sqliteStatePath),
      sqliteBackupDirConfigured: Boolean(sqliteBackupDir),
      sqliteBackupMaxAgeHours: Number(backupMaxAgeHours) || 0
    },
    payment: {
      provider: paymentProvider,
      allowedProviderCount: paymentAllowedProviders.length,
      selectedProviderAllowlisted: paymentAllowedProviders.includes(paymentProvider),
      testWebhookProvidersRemoved: !paymentAllowedProviders.some((provider) => testPaymentProviders.has(provider)),
      checkoutUrlTemplateConfigured: checkoutReady,
      messageConfigured: Boolean(paymentMessage)
    },
    runtimeGuards: {
      rateLimitEnabled,
      backupsEnabled,
      maintenanceEnabled,
      runtimeSessionKeyVersion,
      runtimeSessionProofAlgorithm,
      runtimeSessionAsymmetricProofConfigured
    },
    publicEndpoints
  };

  const content = `# ZeroLag Server Deployment Report

Generated by \`npm run server:deployment-report\`.
This report is designed for private deployment review and never prints secret values.

## Snapshot

- Generated at: ${code(generatedAt)}
- Report JSON: ${code("npm run server:deployment-report:json")}
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

## Strict Gate Details

${gates.map((gate) => gateLine(gate.label, gate.ok, gate.detail)).join("\n")}

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
- Runtime session key version: ${code(runtimeSessionKeyVersion)}
- Runtime session proof algorithm: ${code(runtimeSessionProofAlgorithm)}
- Runtime session asymmetric proof configured: ${code(yesNo(runtimeSessionAsymmetricProofConfigured))}

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
npm run server:deployment-report:strict
npm run server:env-check -- --profile sqlite --strict
npm run server:check:strict
npm run server:smoke
npm run release:preflight:strict
npm run ci
\`\`\`
`;

  return {
    content,
    data,
    gates,
    ready: reportReady
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const outputArg = argValue("--output");
  const json = process.argv.includes("--json");
  const outputPath = outputArg ? path.resolve(outputArg) : (json ? defaultJsonOutputPath : defaultOutputPath);
  const strict = process.argv.includes("--strict");
  const report = buildReport();
  const outputContent = json ? `${JSON.stringify(report.data, null, 2)}\n` : report.content;

  if (process.argv.includes("--stdout")) {
    process.stdout.write(outputContent);
  } else {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, outputContent, "utf8");
    console.log(`${json ? "Server deployment JSON report" : "Server deployment report"} written: ${outputPath}`);
  }

  if (strict && !report.ready) {
    console.error(`Server deployment report strict gate failed: ${strictFailureSummary(report.gates)}`);
    process.exitCode = 1;
  }
}

main();
