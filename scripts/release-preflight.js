const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const strict = process.argv.includes("--strict");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function readTextIfExists(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function isPlaceholderUrl(value) {
  return /example\.com|localhost|127\.0\.0\.1/i.test(String(value || ""));
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(value || ""));
}

function hasStrongCodeSigningSignal() {
  return Boolean(
    process.env.CSC_LINK
      || process.env.WIN_CSC_LINK
      || process.env.WINDOWS_CODESIGN_CERT
      || process.env.ZEROLAG_CODESIGN_CERT
  );
}

function addIssue(issues, ok, message) {
  if (!ok) issues.push(message);
}

function addReleaseGate(issues, warnings, ok, message) {
  if (ok) return;
  if (strict) issues.push(message);
  else warnings.push(message);
}

function hasScript(packageJson, scriptName) {
  return Boolean(packageJson.scripts && packageJson.scripts[scriptName]);
}

function hasWindowsNsisTarget(build) {
  const targets = build && build.win && build.win.target;
  if (!Array.isArray(targets)) return false;
  return targets.some((target) => {
    if (typeof target === "string") return target === "nsis";
    return target && target.target === "nsis";
  });
}

function main() {
  const issues = [];
  const warnings = [];

  addIssue(issues, fileExists("package.json"), "package.json is missing.");
  addIssue(issues, fileExists("package-lock.json"), "package-lock.json is missing; releases should be reproducible with npm ci.");
  addIssue(issues, fileExists("main.js"), "main.js is missing.");
  addIssue(issues, fileExists("assets/app-config.json"), "assets/app-config.json is missing.");
  addIssue(issues, fileExists("assets/update.json"), "assets/update.json is missing.");
  addIssue(issues, fileExists("assets/integrity-manifest.json"), "assets/integrity-manifest.json is missing.");
  addIssue(issues, fileExists(".github/workflows/ci.yml"), ".github/workflows/ci.yml is missing.");

  if (issues.length) {
    printResult({ issues, warnings, packageJson: {}, appConfig: {} });
    return;
  }

  const packageJson = readJson(path.join(rootDir, "package.json"));
  const appConfig = readJson(path.join(rootDir, "assets", "app-config.json"));
  const updateManifest = readJson(path.join(rootDir, "assets", "update.json"));
  const gitignore = readTextIfExists(".gitignore");
  const ciWorkflow = readTextIfExists(".github/workflows/ci.yml");

  ["check", "ci", "icon:generate", "pack:dir", "package:smoke", "package:verify", "installer:smoke", "installer:verify", "release:artifacts", "release:report", "website:release", "website:smoke", "website:release:smoke", "release:verify", "release:build", "dist:win", "production:check", "server:check", "server:smoke", "server:test", "server:migrate-sqlite", "server:backup-sqlite", "server:restore-sqlite", "deploy:checklist", "integrity:verify", "update:sign", "update:smoke"].forEach((scriptName) => {
    addIssue(issues, hasScript(packageJson, scriptName), `package.json script is missing: ${scriptName}`);
  });

  const build = packageJson.build || {};
  addIssue(issues, ciWorkflow.includes("npm run ci"), "GitHub CI workflow must run npm run ci.");
  addIssue(issues, gitignore.includes(".secrets/"), ".gitignore must keep .secrets/ out of Git.");
  addIssue(issues, gitignore.includes("dist/"), ".gitignore must keep dist/ build outputs out of Git.");
  addIssue(issues, gitignore.includes("out/"), ".gitignore must keep out/ build outputs out of Git.");
  addIssue(issues, gitignore.includes("server/data/*.sqlite"), ".gitignore must keep SQLite server state out of Git.");
  addIssue(issues, isSemver(packageJson.version), "package.json version must be semantic, for example 1.0.0.");
  addIssue(issues, Boolean(packageJson.author), "package.json author must be set for packaged builds.");
  addIssue(issues, Boolean(build.appId), "Installer packaging config must define build.appId.");
  addIssue(issues, Boolean(build.productName), "Installer packaging config must define build.productName.");
  addIssue(issues, Array.isArray(build.files) && build.files.length > 0, "Installer packaging config must define build.files.");
  addIssue(issues, hasWindowsNsisTarget(build), "Installer packaging config must target Windows NSIS.");
  addIssue(issues, build.win && build.win.requestedExecutionLevel === "requireAdministrator", "Windows package must request administrator execution.");

  addReleaseGate(issues, warnings, packageJson.version !== "0.1.0", "Release version is still 0.1.0.");
  addReleaseGate(issues, warnings, !/prototype/i.test(packageJson.description || ""), "package.json description still says prototype.");
  addReleaseGate(issues, warnings, appConfig.releaseMode === "production", "app-config releaseMode must be production before a paid release.");
  addReleaseGate(issues, warnings, appConfig.allowLocalDemoLicense === false, "Local demo license must be disabled before a paid release.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.websiteUrl) && !isPlaceholderUrl(appConfig.websiteUrl), "Production websiteUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.purchaseUrl) && !isPlaceholderUrl(appConfig.purchaseUrl), "Production purchaseUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.analyticsUrl) && !isPlaceholderUrl(appConfig.analyticsUrl), "Production analyticsUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.supportUrl) && !isPlaceholderUrl(appConfig.supportUrl), "Production supportUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.apiBaseUrl) && !isPlaceholderUrl(appConfig.apiBaseUrl), "Production apiBaseUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.updateManifestUrl) && !isPlaceholderUrl(appConfig.updateManifestUrl), "Production updateManifestUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, Boolean(appConfig.updatePublicKeyPem), "Production updatePublicKeyPem must be configured.");
  addReleaseGate(issues, warnings, updateManifest.latest === packageJson.version, "Update manifest latest version must match package.json version before release.");
  addReleaseGate(issues, warnings, isHttpsUrl(updateManifest.downloadUrl) && !isPlaceholderUrl(updateManifest.downloadUrl), "Update manifest downloadUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, updateManifest.signatureAlgorithm === "RSA-SHA256" && Boolean(updateManifest.signature), "Update manifest must be signed before release.");
  addReleaseGate(issues, warnings, Boolean(packageJson.devDependencies && packageJson.devDependencies["electron-builder"]), "electron-builder is not installed yet.");
  addReleaseGate(issues, warnings, build.asar === true, "Installer packaging should keep app files inside an asar archive.");
  addReleaseGate(issues, warnings, JSON.stringify(build.asarUnpack || []).includes("runtime-watchdog"), "Runtime watchdog must stay unpacked for packaged cleanup execution.");
  addReleaseGate(issues, warnings, fileExists("build/icon.ico"), "Final Windows icon is not configured at build/icon.ico.");
  addReleaseGate(issues, warnings, hasStrongCodeSigningSignal(), "Windows code-signing certificate environment is not configured in this shell.");

  printResult({ issues, warnings, packageJson, appConfig });
}

function printResult({ issues, warnings, packageJson, appConfig }) {
  console.log("ZeroLag release preflight");
  console.log(`Version: ${packageJson.version || "unknown"}`);
  console.log(`Mode: ${appConfig.releaseMode || "unknown"}`);
  console.log(`Strict: ${strict ? "yes" : "no"}`);

  if (warnings.length) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (issues.length) {
    console.log("\nBlocking issues:");
    for (const issue of issues) console.log(`- ${issue}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nRelease preflight passed with ${warnings.length} warning(s).`);
}

main();
