const fs = require("fs");
const path = require("path");
const { isRealHttpsUrl } = require("./release-url-policy");

const rootDir = path.join(__dirname, "..");
const defaultConfigPath = path.join(rootDir, "assets", "app-config.json");
const defaultPackagePath = path.join(rootDir, "package.json");
const defaultUpdatePath = path.join(rootDir, "assets", "update.json");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/prepare-release-mode.js --mode production [--write]");
  console.log("  node scripts/prepare-release-mode.js --mode development [--write]");
  console.log("");
  console.log("Safely checks or switches app-config releaseMode.");
  console.log("Production mode can be written only after required public release fields are ready.");
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

function normalizePem(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function isPublicKeyPem(value) {
  return /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/m.test(normalizePem(value));
}

function addBlocker(blockers, ok, message) {
  if (!ok) blockers.push(message);
}

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(filePath)} (external)`;
}

function productionBlockers(appConfig, packageJson, updateManifest) {
  const blockers = [];
  addBlocker(blockers, appConfig.allowLocalDemoLicense === false, "allowLocalDemoLicense must be false.");
  [
    ["websiteUrl", appConfig.websiteUrl],
    ["purchaseUrl", appConfig.purchaseUrl],
    ["analyticsUrl", appConfig.analyticsUrl],
    ["supportUrl", appConfig.supportUrl],
    ["apiBaseUrl", appConfig.apiBaseUrl],
    ["updateManifestUrl", appConfig.updateManifestUrl]
  ].forEach(([label, value]) => {
    addBlocker(blockers, isRealHttpsUrl(value), `${label} must be a real HTTPS URL.`);
  });
  addBlocker(blockers, isPublicKeyPem(appConfig.updatePublicKeyPem), "updatePublicKeyPem must be configured with a PEM public key.");
  addBlocker(blockers, isPublicKeyPem(appConfig.runtimeSessionPublicKeyPem), "runtimeSessionPublicKeyPem must be configured with a PEM public key.");
  addBlocker(blockers, updateManifest.latest === packageJson.version, "assets/update.json latest must match package.json version.");
  addBlocker(blockers, isRealHttpsUrl(updateManifest.downloadUrl), "Update manifest downloadUrl must be a real HTTPS URL.");
  addBlocker(blockers, updateManifest.signatureAlgorithm === "RSA-SHA256" && Boolean(updateManifest.signature), "Update manifest must be signed.");
  return blockers;
}

function prepareReleaseMode(input = {}) {
  const mode = String(input.mode || "production").trim().toLowerCase();
  if (!["production", "development"].includes(mode)) {
    throw new Error("Release mode must be production or development.");
  }

  const configPath = path.resolve(input.configPath || defaultConfigPath);
  const packagePath = path.resolve(input.packagePath || defaultPackagePath);
  const updatePath = path.resolve(input.updatePath || defaultUpdatePath);
  const write = input.write === true;
  const appConfig = readJson(configPath);
  const packageJson = readJson(packagePath);
  const updateManifest = readJson(updatePath);
  const blockers = mode === "production" ? productionBlockers(appConfig, packageJson, updateManifest) : [];

  if (write && blockers.length) {
    return {
      ok: false,
      written: false,
      mode,
      currentMode: appConfig.releaseMode || "",
      blockers,
      appConfigFile: safeRelative(configPath),
      nextSteps: [
        "Run npm run production:config -- --domain your-domain.example --write after real domains are ready.",
        "Fill updatePublicKeyPem and runtimeSessionPublicKeyPem with public keys only.",
        "Run npm run release:version, npm run update:sign, then retry production mode."
      ]
    };
  }

  if (write) {
    writeJson(configPath, { ...appConfig, releaseMode: mode });
  }

  return {
    ok: blockers.length === 0,
    written: write,
    mode,
    currentMode: appConfig.releaseMode || "",
    blockers,
    appConfigFile: safeRelative(configPath),
    nextSteps: blockers.length
      ? [
        "Resolve blockers before writing production mode.",
        "Run npm run release:preflight after updating config."
      ]
      : [
        "Run npm run release:preflight:strict before publishing the installer.",
        "Run npm run release:gate after installer artifacts and server deployment are ready."
      ]
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  try {
    const result = prepareReleaseMode({
      mode: argValue("--mode", "production"),
      configPath: argValue("--config", defaultConfigPath),
      packagePath: argValue("--package", defaultPackagePath),
      updatePath: argValue("--update", defaultUpdatePath),
      write: process.argv.includes("--write")
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  prepareReleaseMode,
  productionBlockers
};
