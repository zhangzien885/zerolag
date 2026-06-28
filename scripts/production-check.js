const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const configPath = path.join(rootDir, "assets", "app-config.json");
const strict = process.argv.includes("--strict");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function isPlaceholderUrl(value) {
  return /example\.com|localhost|127\.0\.0\.1/i.test(String(value || ""));
}

function normalizePem(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function isPublicKeyPem(value) {
  return /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/m.test(normalizePem(value));
}

function addIssue(issues, ok, message) {
  if (!ok) issues.push(message);
}

function main() {
  const issues = [];
  const warnings = [];

  if (!fs.existsSync(configPath)) {
    issues.push("assets/app-config.json is missing.");
  }

  const config = fs.existsSync(configPath) ? readJson(configPath) : {};
  const packageJson = readJson(path.join(rootDir, "package.json"));
  const productionMode = config.releaseMode === "production";

  addIssue(warnings, packageJson.version !== "0.1.0", "package.json version is still 0.1.0.");
  addIssue(warnings, productionMode, "app-config releaseMode is not production yet.");
  addIssue(issues, !productionMode || isHttpsUrl(config.websiteUrl), "Production websiteUrl must be HTTPS.");
  addIssue(issues, !productionMode || !isPlaceholderUrl(config.websiteUrl), "Production websiteUrl must not use a placeholder domain.");
  addIssue(issues, !productionMode || isHttpsUrl(config.purchaseUrl), "Production purchaseUrl must be HTTPS.");
  addIssue(issues, !productionMode || !isPlaceholderUrl(config.purchaseUrl), "Production purchaseUrl must not use a placeholder domain.");
  addIssue(issues, !productionMode || isHttpsUrl(config.supportUrl), "Production supportUrl must be HTTPS.");
  addIssue(issues, !productionMode || !isPlaceholderUrl(config.supportUrl), "Production supportUrl must not use a placeholder domain.");
  addIssue(issues, !productionMode || isHttpsUrl(config.apiBaseUrl), "Production apiBaseUrl must be HTTPS.");
  addIssue(issues, !productionMode || isHttpsUrl(config.updateManifestUrl), "Production updateManifestUrl must be HTTPS.");
  addIssue(issues, !productionMode || Boolean(config.updatePublicKeyPem), "Production updatePublicKeyPem is required for signed update metadata.");
  addIssue(issues, !productionMode || isPublicKeyPem(config.updatePublicKeyPem), "Production updatePublicKeyPem must be a PEM public key.");
  addIssue(issues, !productionMode || config.allowLocalDemoLicense === false, "Production must disable local demo license activation.");

  console.log("ZeroLag production readiness");
  console.log(`Mode: ${config.releaseMode || "development"}`);
  console.log(`Channel: ${config.releaseChannel || "unknown"}`);

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
    console.log("\nBlocking issues:");
    for (const issue of issues) console.log(`- ${issue}`);
    if (strict || productionMode) process.exitCode = 1;
    return;
  }

  console.log("\nProduction readiness checks passed.");
}

main();
