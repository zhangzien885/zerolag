const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const asarTools = require("@electron/asar");

const rootDir = path.join(__dirname, "..");
const appDir = path.join(rootDir, "dist", "win-unpacked");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const productName = packageJson.build && packageJson.build.productName ? packageJson.build.productName : "ZeroLag";

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fileInfo(filePath) {
  assertOk(fs.existsSync(filePath), `Missing packaged file: ${path.relative(rootDir, filePath)}`);
  const stats = fs.statSync(filePath);
  assertOk(stats.isFile(), `Expected file: ${path.relative(rootDir, filePath)}`);
  assertOk(stats.size > 0, `Packaged file is empty: ${path.relative(rootDir, filePath)}`);
  return stats;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function main() {
  assertOk(fs.existsSync(appDir), "Packaged app is missing. Run `npm run pack:dir` first.");

  const exePath = path.join(appDir, `${productName}.exe`);
  const asarPath = path.join(appDir, "resources", "app.asar");
  const unpackedGuardCorePath = path.join(appDir, "resources", "app.asar.unpacked", "scripts", "runtime-guard-core.js");
  const unpackedWatchdogPath = path.join(appDir, "resources", "app.asar.unpacked", "scripts", "runtime-watchdog.js");
  const serviceGuardPath = path.join(appDir, "resources", "service-guard", "service-guard.json");
  const serviceGuardWrapperPath = path.join(appDir, "resources", "service-guard", "ZeroLag.RuntimeGuard.Service.exe");
  const serviceGuardInstallPath = path.join(appDir, "resources", "service-guard", "install-runtime-guard-service.ps1");
  const serviceGuardUninstallPath = path.join(appDir, "resources", "service-guard", "uninstall-runtime-guard-service.ps1");
  const taskFallbackInstallPath = path.join(appDir, "resources", "service-guard", "install-runtime-guard-task.ps1");
  const taskFallbackUninstallPath = path.join(appDir, "resources", "service-guard", "uninstall-runtime-guard-task.ps1");
  const serviceGuardCorePath = path.join(appDir, "resources", "service-guard", "runtime-guard-core.js");
  const serviceGuardWorkerPath = path.join(appDir, "resources", "service-guard", "runtime-guard-service.js");
  const iconPath = path.join(rootDir, "build", "icon.ico");
  const manifestPath = path.join(rootDir, "assets", "integrity-manifest.json");

  const exe = fileInfo(exePath);
  const asarStats = fileInfo(asarPath);
  const unpackedGuardCore = fileInfo(unpackedGuardCorePath);
  const unpackedWatchdog = fileInfo(unpackedWatchdogPath);
  const serviceGuard = fileInfo(serviceGuardPath);
  const serviceGuardWrapper = fileInfo(serviceGuardWrapperPath);
  fileInfo(serviceGuardInstallPath);
  fileInfo(serviceGuardUninstallPath);
  fileInfo(taskFallbackInstallPath);
  fileInfo(taskFallbackUninstallPath);
  fileInfo(serviceGuardCorePath);
  fileInfo(serviceGuardWorkerPath);
  const icon = fileInfo(iconPath);
  const manifest = JSON.parse(readText(manifestPath));
  const protectedPaths = new Set((manifest.files || []).map((item) => item.path));
  const asarFiles = new Set(asarTools.listPackage(asarPath).map((item) => item.replace(/\\/g, "/").replace(/^\/+/, "")));

  [
    "package.json",
    "main.js",
    "preload.js",
    "src/index.html",
    "src/renderer.js",
    "src/styles.css",
    "scripts/runtime-watchdog.js",
    "assets/app-config.json",
    "assets/zerolag-power-plan-template.protected.json"
  ].forEach((relativePath) => {
    assertOk(protectedPaths.has(relativePath), `Protected file missing from integrity manifest: ${relativePath}`);
  });

  [
    "package.json",
    "main.js",
    "preload.js",
    "src/index.html",
    "src/renderer.js",
    "assets/app-config.json",
    "assets/integrity-manifest.json",
    "assets/update.json",
    "assets/zerolag-power-plan-template.protected.json"
  ].forEach((relativePath) => {
    assertOk(asarFiles.has(relativePath), `Packaged app archive missing: ${relativePath}`);
  });

  const packageConfig = packageJson.build || {};
  assertOk(packageConfig.asar === true, "Packaged build must use asar.");
  const packageFiles = JSON.stringify(packageConfig.files || []);
  assertOk(!packageFiles.includes("scripts/**/*.js"), "Packaged build must not include every scripts/*.js helper.");
  assertOk(!packageFiles.includes("scripts/**"), "Packaged build must not include broad scripts/** globs.");
  [
    "scripts/runtime-guard-core.js",
    "scripts/runtime-guard-service.js",
    "scripts/runtime-watchdog.js"
  ].forEach((relativePath) => {
    assertOk(packageFiles.includes(relativePath), `Packaged build must include runtime script: ${relativePath}`);
    assertOk(asarFiles.has(relativePath), `Packaged app archive missing runtime script: ${relativePath}`);
  });
  [
    "scripts/generate-runtime-session-keys.js",
    "scripts/runtime-session-keygen-smoke-test.js",
    "scripts/generate-server-secrets.js",
    "scripts/check-server-env.js",
    "scripts/sign-update-manifest.js",
    "scripts/local-integration.js",
    "scripts/release-preflight.js",
    "scripts/server-smoke-test.js",
    "scripts/package-smoke-test.js",
    "server/env.js",
    "server/index.js",
    "server/admin-client.js",
    "server/create-activation-code.js",
    "server/self-test.js"
  ].forEach((relativePath) => {
    assertOk(!asarFiles.has(relativePath), `Packaged app archive must not include build/test helper: ${relativePath}`);
  });
  assertOk(JSON.stringify(packageConfig.asarUnpack || []).includes("runtime-guard-core"), "runtime-guard-core must stay unpacked with the watchdog.");
  assertOk(JSON.stringify(packageConfig.asarUnpack || []).includes("runtime-watchdog"), "runtime-watchdog must stay unpacked.");
  assertOk(packageConfig.win && packageConfig.win.requestedExecutionLevel === "requireAdministrator", "Packaged Windows app must request administrator execution.");
  assertOk(icon.size >= 1024, "Windows icon looks too small or invalid.");
  assertOk(sha256File(unpackedGuardCorePath) === sha256File(path.join(rootDir, "scripts", "runtime-guard-core.js")), "Unpacked runtime guard core differs from source.");
  assertOk(sha256File(unpackedWatchdogPath) === sha256File(path.join(rootDir, "scripts", "runtime-watchdog.js")), "Unpacked watchdog differs from source.");
  assertOk(sha256File(serviceGuardPath) === sha256File(path.join(rootDir, "build", "service-guard.json")), "Packaged service guard manifest differs from source.");
  assertOk(sha256File(serviceGuardWrapperPath) === sha256File(path.join(rootDir, "build", "native-service", "dist", "ZeroLag.RuntimeGuard.Service.exe")), "Packaged native service wrapper differs from source.");
  assertOk(sha256File(serviceGuardCorePath) === sha256File(path.join(rootDir, "scripts", "runtime-guard-core.js")), "Packaged service guard core differs from source.");
  assertOk(sha256File(serviceGuardWorkerPath) === sha256File(path.join(rootDir, "scripts", "runtime-guard-service.js")), "Packaged service guard worker differs from source.");

  console.log("ZeroLag package smoke test passed.");
  console.log(`Executable: ${path.relative(rootDir, exePath)} (${exe.size} bytes)`);
  console.log(`App archive: ${path.relative(rootDir, asarPath)} (${asarStats.size} bytes)`);
  console.log(`Unpacked guard core: ${path.relative(rootDir, unpackedGuardCorePath)} (${unpackedGuardCore.size} bytes)`);
  console.log(`Unpacked watchdog: ${path.relative(rootDir, unpackedWatchdogPath)} (${unpackedWatchdog.size} bytes)`);
  console.log(`Service guard resources: ${path.relative(rootDir, serviceGuardPath)} (${serviceGuard.size} bytes)`);
  console.log(`Service wrapper: ${path.relative(rootDir, serviceGuardWrapperPath)} (${serviceGuardWrapper.size} bytes)`);
  console.log(`Icon: ${path.relative(rootDir, iconPath)} (${icon.size} bytes)`);
}

main();
