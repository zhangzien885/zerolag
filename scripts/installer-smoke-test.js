const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const productName = packageJson.build && packageJson.build.productName ? packageJson.build.productName : "ZeroLag";
const version = packageJson.version || "0.0.0";

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function relative(filePath) {
  return path.relative(rootDir, filePath);
}

function fileInfo(filePath, minBytes) {
  assertOk(fs.existsSync(filePath), `Missing installer artifact: ${relative(filePath)}`);
  const stats = fs.statSync(filePath);
  assertOk(stats.isFile(), `Expected installer artifact file: ${relative(filePath)}`);
  assertOk(stats.size >= minBytes, `Installer artifact looks too small: ${relative(filePath)}`);
  return stats;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function findInstaller() {
  if (!fs.existsSync(distDir)) return null;

  const expectedName = `${productName} Setup ${version}.exe`;
  const expectedPath = path.join(distDir, expectedName);
  if (fs.existsSync(expectedPath)) return expectedPath;

  const lowerProductName = productName.toLowerCase();
  return fs.readdirSync(distDir)
    .filter((name) => name.toLowerCase().endsWith(".exe"))
    .filter((name) => name.toLowerCase().includes(lowerProductName))
    .map((name) => path.join(distDir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || null;
}

function assertInstallerConfig() {
  const build = packageJson.build || {};
  const nsis = build.nsis || {};
  const targets = build.win && Array.isArray(build.win.target) ? build.win.target : [];
  const hasNsisTarget = targets.some((target) => {
    if (typeof target === "string") return target === "nsis";
    return target && target.target === "nsis";
  });

  assertOk(build.asar === true, "Installer build must keep app files inside asar.");
  assertOk(hasNsisTarget, "Installer build must target Windows NSIS.");
  assertOk(build.win && build.win.requestedExecutionLevel === "requireAdministrator", "Windows installer must request administrator execution.");
  assertOk(nsis.perMachine === true, "NSIS installer must install per-machine for the formal build.");
  assertOk(nsis.allowElevation === true, "NSIS installer must allow elevation.");
  assertOk(nsis.deleteAppDataOnUninstall === false, "NSIS uninstaller must not delete user app data by default.");
}

function main() {
  assertInstallerConfig();
  assertOk(fs.existsSync(distDir), "Installer output is missing. Run `npm run dist:win` first.");

  const installerPath = findInstaller();
  assertOk(installerPath, "NSIS installer .exe is missing. Run `npm run dist:win` first.");

  const installer = fileInfo(installerPath, 1024 * 1024);
  const blockmapPath = `${installerPath}.blockmap`;
  const blockmap = fileInfo(blockmapPath, 128);
  const latestPath = path.join(distDir, "latest.yml");
  const latest = fileInfo(latestPath, 64);
  const latestText = fs.readFileSync(latestPath, "utf8");

  assertOk(latestText.includes(path.basename(installerPath)), "latest.yml does not reference the installer executable.");
  assertOk(latestText.includes(version), "latest.yml does not include the package version.");
  assertOk(/sha512:/i.test(latestText), "latest.yml is missing sha512 metadata.");
  assertOk(/releaseDate:/i.test(latestText), "latest.yml is missing releaseDate metadata.");

  console.log("ZeroLag installer smoke test passed.");
  console.log(`Installer: ${relative(installerPath)} (${installer.size} bytes)`);
  console.log(`Blockmap: ${relative(blockmapPath)} (${blockmap.size} bytes)`);
  console.log(`Update metadata: ${relative(latestPath)} (${latest.size} bytes)`);
  console.log(`Installer sha256: ${sha256File(installerPath).slice(0, 16)}...`);
}

main();
