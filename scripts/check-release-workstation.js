const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { inspectSigningEnv } = require("./check-code-signing-env");
const { defaultServerEnvPath } = require("../server/env");

const rootDir = path.join(__dirname, "..");
const strict = process.argv.includes("--strict");
const jsonOutput = process.argv.includes("--json");
const noGit = process.argv.includes("--no-git");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/check-release-workstation.js [--strict] [--json] [--no-git]");
  console.log("");
  console.log("Checks whether this workstation is ready to build and sign a paid ZeroLag release without printing secrets.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function relativePath(filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(rootDir, resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(resolved)} (external)`;
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function isPlaceholderUrl(value) {
  return /example\.com|localhost|127\.0\.0\.1/i.test(String(value || ""));
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim().split(/\r?\n/)[0] || "";
}

function dotnetMajor(version) {
  const match = String(version || "").match(/^(\d+)\./);
  return match ? Number(match[1]) : 0;
}

function npmVersion() {
  const direct = commandVersion(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]);
  if (direct) return direct;
  if (process.env.npm_execpath) return `available via ${path.basename(process.env.npm_execpath)}`;
  const userAgent = String(process.env.npm_config_user_agent || "").split(" ")[0];
  return userAgent.startsWith("npm/") ? userAgent.slice(4) : "";
}

function gitStatus() {
  if (noGit) {
    return {
      checked: false,
      clean: true,
      detail: "skipped"
    };
  }

  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== 0) {
    return {
      checked: true,
      clean: false,
      detail: "git status failed"
    };
  }

  const dirtyLines = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  return {
    checked: true,
    clean: dirtyLines.length === 0,
    detail: dirtyLines.length ? `${dirtyLines.length} changed file(s)` : "clean"
  };
}

function addCheck(checks, id, label, ok, detail, nextStep, severity = "blocking") {
  checks.push({
    id,
    label,
    ok: Boolean(ok),
    severity,
    detail,
    nextStep
  });
}

function collectReleaseWorkstationStatus(input = {}) {
  const packageJsonPath = path.resolve(input.packageJsonPath || argValue("--package-json", path.join(rootDir, "package.json")));
  const appConfigPath = path.resolve(input.appConfigPath || argValue("--app-config", path.join(rootDir, "assets", "app-config.json")));
  const updateManifestPath = path.resolve(input.updateManifestPath || argValue("--update-manifest", path.join(rootDir, "assets", "update.json")));
  const serviceGuardPath = path.resolve(input.serviceGuardPath || argValue("--service-guard", path.join(rootDir, "build", "service-guard.json")));
  const envPath = path.resolve(input.envPath || argValue("--env-file", defaultServerEnvPath));
  const packageJson = readJson(packageJsonPath);
  const appConfig = readJson(appConfigPath);
  const updateManifest = readJson(updateManifestPath);
  const serviceGuard = readJson(serviceGuardPath);
  const wrapperOutput = path.resolve(input.wrapperOutput || argValue(
    "--wrapper-output",
    path.join(rootDir, serviceGuard.nativeServiceWrapperOutput || "build/native-service/dist/ZeroLag.RuntimeGuard.Service.exe")
  ));
  const nodeVersion = commandVersion(process.execPath, ["--version"]);
  const detectedNpmVersion = npmVersion();
  const dotnetVersion = commandVersion("dotnet", ["--version"]);
  const signing = inspectSigningEnv();
  const git = gitStatus();
  const checks = [];
  const urlFields = ["websiteUrl", "purchaseUrl", "analyticsUrl", "supportUrl", "apiBaseUrl", "updateManifestUrl"];
  const configuredUrls = urlFields.filter((field) => isHttpsUrl(appConfig[field]) && !isPlaceholderUrl(appConfig[field]));

  addCheck(
    checks,
    "node",
    "Node.js runtime",
    Boolean(nodeVersion),
    nodeVersion || "missing",
    "Install Node.js before running release scripts."
  );
  addCheck(
    checks,
    "npm",
    "npm runtime",
    Boolean(detectedNpmVersion),
    detectedNpmVersion || "missing",
    "Install npm before running package and release commands."
  );
  addCheck(
    checks,
    "dotnet",
    ".NET 8 SDK",
    Boolean(dotnetVersion) && dotnetMajor(dotnetVersion) >= 8,
    dotnetVersion || "missing",
    "Install .NET 8 SDK, then run npm run guard:wrapper:build."
  );
  addCheck(
    checks,
    "native-wrapper-output",
    "Native service wrapper exe",
    exists(wrapperOutput),
    relativePath(wrapperOutput),
    "Run npm run guard:wrapper:build on a Windows build machine with .NET 8 SDK."
  );
  addCheck(
    checks,
    "native-wrapper-status",
    "Native wrapper status",
    serviceGuard.nativeServiceWrapperStatus === "implemented",
    serviceGuard.nativeServiceWrapperStatus || "missing",
    "After the wrapper exe is built, packaged, and privately validated, mark build/service-guard.json nativeServiceWrapperStatus as implemented."
  );
  addCheck(
    checks,
    "code-signing",
    "Windows code signing",
    signing.ok,
    `certificate=${signing.certificateSource}; password=${signing.passwordConfigured ? "configured" : "missing"}`,
    "Configure CSC_LINK and CSC_KEY_PASSWORD, or the equivalent Windows signing env variables, outside the repository."
  );
  addCheck(
    checks,
    "release-mode",
    "Production release mode",
    appConfig.releaseMode === "production",
    appConfig.releaseMode || "missing",
    "Run npm run production:mode -- --mode production --write after URLs, public keys, and update metadata are ready."
  );
  addCheck(
    checks,
    "production-urls",
    "Production HTTPS URLs",
    configuredUrls.length === urlFields.length,
    `${configuredUrls.length}/${urlFields.length} configured`,
    "Run npm run production:config -- --domain your-domain.example --write, then review assets/app-config.json."
  );
  addCheck(
    checks,
    "runtime-public-key",
    "Runtime public key",
    Boolean(appConfig.runtimeSessionPublicKeyPem),
    appConfig.runtimeSessionPublicKeyPem ? "configured" : "missing",
    "Apply the runtime public-key snippet with npm run app-config:snippet -- --snippet <snippet.json> --write."
  );
  addCheck(
    checks,
    "update-public-key",
    "Update public key",
    Boolean(appConfig.updatePublicKeyPem),
    appConfig.updatePublicKeyPem ? "configured" : "missing",
    "Generate update signing keys, then apply the public-key snippet with npm run app-config:snippet."
  );
  addCheck(
    checks,
    "update-manifest",
    "Signed update manifest",
    updateManifest.latest === packageJson.version && updateManifest.signatureAlgorithm === "RSA-SHA256" && Boolean(updateManifest.signature),
    `latest=${updateManifest.latest || "missing"}; package=${packageJson.version || "missing"}; signed=${Boolean(updateManifest.signature)}`,
    "Run npm run release:version, npm run update:prepare, and npm run update:sign before release."
  );
  addCheck(
    checks,
    "server-env",
    "Private server env",
    exists(envPath),
    exists(envPath) ? relativePath(envPath) : "missing",
    "Run npm run server:provision-local locally, then configure the real production server env privately."
  );
  addCheck(
    checks,
    "git-clean",
    "Git working tree",
    git.clean,
    git.detail,
    "Commit or stash all changes before building a release.",
    git.checked ? "blocking" : "info"
  );

  const blocking = checks.filter((check) => check.severity !== "info" && !check.ok);
  return {
    ok: blocking.length === 0,
    strict,
    generatedAt: new Date().toISOString(),
    files: {
      packageJson: relativePath(packageJsonPath),
      appConfig: relativePath(appConfigPath),
      updateManifest: relativePath(updateManifestPath),
      serviceGuard: relativePath(serviceGuardPath),
      privateEnv: exists(envPath) ? relativePath(envPath) : "missing",
      nativeWrapperOutput: relativePath(wrapperOutput)
    },
    checks,
    blockingCount: blocking.length,
    nextCommands: checks
      .filter((check) => !check.ok && check.nextStep)
      .map((check) => check.nextStep)
      .filter((item, index, list) => list.indexOf(item) === index)
  };
}

function printHuman(result) {
  console.log("ZeroLag release workstation readiness");
  console.log(`Ready: ${result.ok ? "yes" : "no"}`);
  console.log(`Strict: ${strict ? "yes" : "no"}`);

  for (const check of result.checks) {
    const marker = check.ok ? "OK" : (check.severity === "info" ? "INFO" : "MISSING");
    console.log(`- ${marker}: ${check.label} - ${check.detail}`);
  }

  if (result.nextCommands.length) {
    console.log("\nNext steps:");
    for (const command of result.nextCommands) console.log(`- ${command}`);
  }

  if (!result.ok && strict) process.exitCode = 1;
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const result = collectReleaseWorkstationStatus();
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok && strict) process.exitCode = 1;
    return;
  }

  printHuman(result);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectReleaseWorkstationStatus
};
