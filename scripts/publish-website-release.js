const fs = require("fs");
const path = require("path");
const { isRealHttpsUrl } = require("./release-url-policy");

const rootDir = path.join(__dirname, "..");
const websiteDir = path.join(rootDir, "website");
const releaseArtifactsPath = process.env.ZEROLAG_RELEASE_ARTIFACTS_PATH || path.join(rootDir, "dist", "release-artifacts.json");
const releaseReportPath = process.env.ZEROLAG_RELEASE_REPORT_PATH || path.join(rootDir, "dist", "release-candidate-report.json");
const updateManifestPath = process.env.ZEROLAG_UPDATE_MANIFEST_PATH || path.join(rootDir, "assets", "update.json");
const appConfigPath = process.env.ZEROLAG_APP_CONFIG_PATH || path.join(rootDir, "assets", "app-config.json");
const outputPath = process.env.ZEROLAG_WEBSITE_RELEASE_PATH || path.join(websiteDir, "release.json");

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function publicUrl(value) {
  return isRealHttpsUrl(value) ? value : "";
}

function readinessSummary(report) {
  const checks = Array.isArray(report.readiness) ? report.readiness : [];
  return {
    ok: checks.filter((item) => item.ok).length,
    total: checks.length
  };
}

function publicReleaseNotes(notes) {
  if (!Array.isArray(notes)) return [];
  const forbiddenPublicTerms = [
    "subscription control",
    "protection strategy",
    "permanent config",
    "watchdog",
    "task scheduler",
    "windows service",
    "anti-crack",
    "reverse engineering",
    "private key",
    "server env",
    "forbidden helper",
    "\u53cd\u7834\u89e3",
    "\u6c38\u4e45\u7559\u5b58",
    "\u8ba2\u9605\u63a7\u5236",
    "\u4fdd\u62a4\u7b56\u7565",
    "\u5f3a\u6740\u515c\u5e95",
    "\u79c1\u94a5",
    "\u670d\u52a1\u7aef\u73af\u5883"
  ];

  function isPublicSafe(note) {
    const lowered = String(note || "").toLowerCase();
    return !forbiddenPublicTerms.some((term) => lowered.includes(term.toLowerCase()));
  }

  return notes
    .filter((note) => typeof note === "string")
    .map((note) => note.trim())
    .filter(Boolean)
    .filter(isPublicSafe)
    .slice(0, 6)
    .map((note) => (note.length > 160 ? `${note.slice(0, 157)}...` : note));
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
  const purchaseUrl = publicUrl(appConfig.purchaseUrl);
  const analyticsUrl = publicUrl(appConfig.analyticsUrl);
  const websiteRelease = {
    productName: artifacts.productName || "ZeroLag",
    version: artifacts.version || "",
    channel: artifacts.channel || appConfig.releaseChannel || "",
    status: downloadUrl ? "available" : "preparing",
    downloadReady: Boolean(downloadUrl),
    downloadUrl,
    supportUrl,
    purchaseUrl,
    analyticsUrl,
    generatedAt: new Date().toISOString(),
    releaseNotes: publicReleaseNotes(updateManifest.releaseNotes),
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
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(websiteRelease, null, 2)}\n`, "utf8");
  console.log("ZeroLag website release manifest published.");
  console.log(`Manifest: ${path.relative(rootDir, outputPath)}`);
  console.log(`Status: ${websiteRelease.status}`);
}

main();
