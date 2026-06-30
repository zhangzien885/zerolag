const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const appConfigPath = path.join(rootDir, "assets", "app-config.json");
const appConfig = fs.existsSync(appConfigPath) ? JSON.parse(fs.readFileSync(appConfigPath, "utf8")) : {};
const productName = packageJson.build && packageJson.build.productName ? packageJson.build.productName : "ZeroLag";
const version = packageJson.version || "0.0.0";

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function relative(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function artifactInfo(filePath) {
  assertOk(fs.existsSync(filePath), `Missing release artifact: ${relative(filePath)}`);
  const stats = fs.statSync(filePath);
  assertOk(stats.isFile(), `Expected release artifact file: ${relative(filePath)}`);
  assertOk(stats.size > 0, `Release artifact is empty: ${relative(filePath)}`);

  return {
    file: path.basename(filePath),
    path: relative(filePath),
    size: stats.size,
    sha256: sha256File(filePath),
    updatedAt: stats.mtime.toISOString()
  };
}

function renderArtifactName(template, ext = "exe") {
  return String(template || "")
    .replace(/\$\{productName\}/g, productName)
    .replace(/\$\{version\}/g, version)
    .replace(/\$\{ext\}/g, ext);
}

function findInstaller(latestMetadata = {}) {
  if (!fs.existsSync(distDir)) return null;

  const latestInstallerName = latestMetadata.path ? path.basename(latestMetadata.path) : "";
  const configuredArtifactName = packageJson.build && packageJson.build.artifactName
    ? renderArtifactName(packageJson.build.artifactName, "exe")
    : "";
  const expectedNames = [
    latestInstallerName,
    configuredArtifactName,
    `${productName} Setup ${version}.exe`
  ].filter(Boolean);

  for (const expectedName of expectedNames) {
    const expectedPath = path.join(distDir, expectedName);
    if (fs.existsSync(expectedPath)) return expectedPath;
  }

  const lowerProductName = productName.toLowerCase();
  return fs.readdirSync(distDir)
    .filter((name) => name.toLowerCase().endsWith(".exe"))
    .filter((name) => name.toLowerCase().includes(lowerProductName))
    .map((name) => path.join(distDir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || null;
}

function readElectronBuilderMetadata(filePath) {
  const metadata = {};
  const text = fs.readFileSync(filePath, "utf8");

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    metadata[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }

  return metadata;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeChecksums(filePath, artifacts) {
  const lines = artifacts.map((artifact) => `${artifact.sha256}  ${artifact.file}`);
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  assertOk(fs.existsSync(distDir), "Release output is missing. Run `npm run dist:win` first.");

  const latestPath = path.join(distDir, "latest.yml");
  const latest = artifactInfo(latestPath);
  const latestMetadata = readElectronBuilderMetadata(latestPath);
  const installerPath = findInstaller(latestMetadata);
  assertOk(installerPath, "NSIS installer .exe is missing. Run `npm run dist:win` first.");

  const blockmapPath = `${installerPath}.blockmap`;
  const installer = artifactInfo(installerPath);
  const blockmap = artifactInfo(blockmapPath);
  const artifacts = [installer, blockmap, latest];
  const manifest = {
    productName,
    version,
    channel: appConfig.releaseChannel || "unknown",
    generatedAt: new Date().toISOString(),
    installer,
    updateMetadata: {
      file: latest.file,
      path: latest.path,
      size: latest.size,
      sha256: latest.sha256,
      updatedAt: latest.updatedAt,
      version: latestMetadata.version || "",
      installerPath: latestMetadata.path || "",
      releaseDate: latestMetadata.releaseDate || ""
    },
    files: artifacts
  };
  const manifestPath = path.join(distDir, "release-artifacts.json");
  const checksumsPath = path.join(distDir, "checksums.txt");

  assertOk(!latestMetadata.version || latestMetadata.version === version, "latest.yml version does not match package.json.");
  assertOk(!latestMetadata.path || latestMetadata.path === installer.file, "latest.yml path does not match the installer file.");

  writeJson(manifestPath, manifest);
  writeChecksums(checksumsPath, artifacts);

  console.log("ZeroLag release artifacts generated.");
  console.log(`Manifest: ${relative(manifestPath)}`);
  console.log(`Checksums: ${relative(checksumsPath)}`);
  console.log(`Installer: ${installer.file} (${installer.size} bytes)`);
}

main();
