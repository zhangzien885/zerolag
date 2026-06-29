const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const defaultConfigPath = path.join(rootDir, "assets", "app-config.json");
const defaultUpdatePath = path.join(rootDir, "assets", "update.json");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/prepare-production-config.js --domain zerolag.example [--api-domain api.zerolag.example] [--cdn-domain cdn.zerolag.example] [--write]");
  console.log("");
  console.log("Builds production HTTPS URL settings for desktop config and update metadata.");
  console.log("Dry-run is default; pass --write to update the target JSON files.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stripProtocol(value) {
  return String(value || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

function normalizeHost(value, label) {
  const host = stripProtocol(value).toLowerCase();
  if (!host) throw new Error(`${label} is required.`);
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host)) {
    throw new Error(`${label} must be a domain name, for example zerolag.example.`);
  }
  if (/example\.com|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(host)) {
    throw new Error(`${label} must not use a placeholder or local-only domain.`);
  }
  return host;
}

function httpsUrl(host, suffix = "") {
  return `https://${host}${suffix}`;
}

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(filePath)} (external)`;
}

function buildProductionUrls(input) {
  const domain = normalizeHost(input.domain, "domain");
  const apiDomain = normalizeHost(input.apiDomain || `api.${domain}`, "api-domain");
  const cdnDomain = normalizeHost(input.cdnDomain || `cdn.${domain}`, "cdn-domain");
  const installerName = input.installerName || "ZeroLag-Setup-{version}.exe";

  return {
    websiteUrl: httpsUrl(domain),
    purchaseUrl: httpsUrl(domain, "/buy"),
    supportUrl: httpsUrl(domain, "/support"),
    analyticsUrl: httpsUrl(apiDomain, "/v1/website/events"),
    apiBaseUrl: httpsUrl(apiDomain),
    updateManifestUrl: httpsUrl(cdnDomain, "/releases/latest.json"),
    downloadUrl: httpsUrl(cdnDomain, `/releases/${installerName}`)
  };
}

function prepareProductionConfig(input = {}) {
  const urls = buildProductionUrls(input);
  const configPath = path.resolve(input.configPath || defaultConfigPath);
  const updatePath = path.resolve(input.updatePath || defaultUpdatePath);
  const write = input.write === true;
  const appConfig = readJson(configPath);
  const updateManifest = readJson(updatePath);

  const appConfigPatch = {
    releaseMode: "production",
    websiteUrl: urls.websiteUrl,
    purchaseUrl: urls.purchaseUrl,
    analyticsUrl: urls.analyticsUrl,
    apiBaseUrl: urls.apiBaseUrl,
    updateManifestUrl: urls.updateManifestUrl,
    supportUrl: urls.supportUrl,
    allowLocalDemoLicense: false
  };
  const updatePatch = {
    downloadUrl: urls.downloadUrl
  };

  if (write) {
    writeJson(configPath, { ...appConfig, ...appConfigPatch });
    writeJson(updatePath, { ...updateManifest, ...updatePatch });
  }

  return {
    written: write,
    appConfigFile: safeRelative(configPath),
    updateManifestFile: safeRelative(updatePath),
    appConfigPatch,
    updatePatch,
    nextSteps: [
      "Fill updatePublicKeyPem and runtimeSessionPublicKeyPem before signing a paid release.",
      "Run npm run update:sign after the real installer download URL is final.",
      "Run npm run release:preflight:strict before publishing the installer."
    ]
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  try {
    const result = prepareProductionConfig({
      domain: argValue("--domain"),
      apiDomain: argValue("--api-domain"),
      cdnDomain: argValue("--cdn-domain"),
      installerName: argValue("--installer-name", "ZeroLag-Setup-{version}.exe"),
      configPath: argValue("--config", defaultConfigPath),
      updatePath: argValue("--update", defaultUpdatePath),
      write: process.argv.includes("--write")
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildProductionUrls,
  prepareProductionConfig
};
