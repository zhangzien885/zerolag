const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const websiteDir = path.join(rootDir, "website");
const releaseArtifactsPath = path.join(rootDir, "dist", "release-artifacts.json");
const releaseReportPath = path.join(rootDir, "dist", "release-candidate-report.json");
const updateManifestPath = path.join(rootDir, "assets", "update.json");
const appConfigPath = path.join(rootDir, "assets", "app-config.json");
const outputPath = path.join(websiteDir, "release.json");

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function isPlaceholderUrl(value) {
  return /example\.com|localhost|127\.0\.0\.1/i.test(String(value || ""));
}

function publicUrl(value) {
  return isHttpsUrl(value) && !isPlaceholderUrl(value) ? value : "";
}

function readinessSummary(report) {
  const checks = Array.isArray(report.readiness) ? report.readiness : [];
  return {
    ok: checks.filter((item) => item.ok).length,
    total: checks.length
  };
}

function main() {
  assertOk(fs.existsSync(releaseArtifactsPath), "Release artifacts are missing. Run `npm run release:artifacts` first.");

  const artifacts = readJson(releaseArtifactsPath);
  const report = readJson(releaseReportPath);
  const updateManifest = readJson(updateManifestPath);
  const appConfig = readJson(appConfigPath);
  const installer = artifacts.installer || {};
  const downloadUrl = publicUrl(updateManifest.downloadUrl);
  const supportUrl = publicUrl(appConfig.supportUrl);
  const websiteRelease = {
    productName: artifacts.productName || "ZeroLag",
    version: artifacts.version || "",
    channel: artifacts.channel || appConfig.releaseChannel || "",
    status: downloadUrl ? "available" : "preparing",
    downloadReady: Boolean(downloadUrl),
    downloadUrl,
    supportUrl,
    generatedAt: new Date().toISOString(),
    releaseNotes: Array.isArray(updateManifest.releaseNotes) ? updateManifest.releaseNotes : [],
    installer: {
      file: installer.file || "",
      size: installer.size || 0,
      sha256: installer.sha256 || ""
    },
    updateMetadata: {
      file: artifacts.updateMetadata && artifacts.updateMetadata.file ? artifacts.updateMetadata.file : "",
      sha256: artifacts.updateMetadata && artifacts.updateMetadata.sha256 ? artifacts.updateMetadata.sha256 : "",
      releaseDate: artifacts.updateMetadata && artifacts.updateMetadata.releaseDate ? artifacts.updateMetadata.releaseDate : ""
    },
    readiness: readinessSummary(report)
  };

  assertOk(websiteRelease.installer.sha256, "Installer checksum is missing from release artifacts.");
  fs.writeFileSync(outputPath, `${JSON.stringify(websiteRelease, null, 2)}\n`, "utf8");
  console.log("ZeroLag website release manifest published.");
  console.log(`Manifest: ${path.relative(rootDir, outputPath)}`);
  console.log(`Status: ${websiteRelease.status}`);
}

main();
