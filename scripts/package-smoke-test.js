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
  const unpackedWatchdogPath = path.join(appDir, "resources", "app.asar.unpacked", "scripts", "runtime-watchdog.js");
  const serviceGuardPath = path.join(appDir, "resources", "service-guard", "service-guard.json");
  const serviceGuardInstallPath = path.join(appDir, "resources", "service-guard", "install-runtime-guard-service.ps1");
  const serviceGuardUninstallPath = path.join(appDir, "resources", "service-guard", "uninstall-runtime-guard-service.ps1");
  const iconPath = path.join(rootDir, "build", "icon.ico");
  const manifestPath = path.join(rootDir, "assets", "integrity-manifest.json");

  const exe = fileInfo(exePath);
  const asarStats = fileInfo(asarPath);
  const unpackedWatchdog = fileInfo(unpackedWatchdogPath);
  const serviceGuard = fileInfo(serviceGuardPath);
  fileInfo(serviceGuardInstallPath);
  fileInfo(serviceGuardUninstallPath);
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
  assertOk(JSON.stringify(packageConfig.asarUnpack || []).includes("runtime-watchdog"), "runtime-watchdog must stay unpacked.");
  assertOk(packageConfig.win && packageConfig.win.requestedExecutionLevel === "requireAdministrator", "Packaged Windows app must request administrator execution.");
  assertOk(icon.size >= 1024, "Windows icon looks too small or invalid.");
  assertOk(sha256File(unpackedWatchdogPath) === sha256File(path.join(rootDir, "scripts", "runtime-watchdog.js")), "Unpacked watchdog differs from source.");
  assertOk(sha256File(serviceGuardPath) === sha256File(path.join(rootDir, "build", "service-guard.json")), "Packaged service guard manifest differs from source.");

  console.log("ZeroLag package smoke test passed.");
  console.log(`Executable: ${path.relative(rootDir, exePath)} (${exe.size} bytes)`);
  console.log(`App archive: ${path.relative(rootDir, asarPath)} (${asarStats.size} bytes)`);
  console.log(`Unpacked watchdog: ${path.relative(rootDir, unpackedWatchdogPath)} (${unpackedWatchdog.size} bytes)`);
  console.log(`Service guard resources: ${path.relative(rootDir, serviceGuardPath)} (${serviceGuard.size} bytes)`);
  console.log(`Icon: ${path.relative(rootDir, iconPath)} (${icon.size} bytes)`);
}

main();
