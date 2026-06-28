const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const manifestPath = path.join(rootDir, "assets", "integrity-manifest.json");
const integritySecret = "zerolag-integrity-prototype-v1";
const protectedFiles = [
  "package.json",
  "main.js",
  "preload.js",
  "src/index.html",
  "src/splash.html",
  "src/renderer.js",
  "src/styles.css",
  "scripts/runtime-guard-core.js",
  "scripts/runtime-guard-service.js",
  "scripts/runtime-guard-service-smoke-test.js",
  "scripts/runtime-watchdog.js",
  "scripts/local-integration.js",
  "scripts/generate-icon.js",
  "scripts/package-smoke-test.js",
  "scripts/installer-smoke-test.js",
  "scripts/service-guard-smoke-test.js",
  "scripts/service-install-script-smoke-test.js",
  "scripts/task-fallback-smoke-test.js",
  "scripts/generate-release-artifacts.js",
  "scripts/generate-release-report.js",
  "scripts/release-report-smoke-test.js",
  "scripts/ci-report-artifact-smoke-test.js",
  "scripts/check-release-gate.js",
  "scripts/release-gate-smoke-test.js",
  "scripts/publish-website-release.js",
  "scripts/website-smoke-test.js",
  "scripts/website-release-publish-smoke-test.js",
  "scripts/production-check.js",
  "scripts/release-preflight.js",
  "scripts/server-production-check.js",
  "scripts/server-smoke-test.js",
  "scripts/generate-deployment-checklist.js",
  "scripts/generate-server-deployment-report.js",
  "scripts/server-deployment-report-smoke-test.js",
  "scripts/migrate-state-to-sqlite.js",
  "scripts/backup-sqlite-state.js",
  "scripts/restore-sqlite-state.js",
  "scripts/check-sqlite-backups.js",
  "scripts/check-server-env.js",
  "scripts/generate-server-secrets.js",
  "scripts/update-signing-smoke-test.js",
  "server/env.js",
  "assets/zerolag-logo.svg",
  "assets/app-config.json",
  "assets/zerolag-power-plan-template.protected.json",
  "build/service-guard.json",
  "build/install-runtime-guard-service.ps1",
  "build/uninstall-runtime-guard-service.ps1",
  "build/install-runtime-guard-task.ps1",
  "build/uninstall-runtime-guard-task.ps1"
];

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sign(files) {
  const body = JSON.stringify(files.map((item) => ({
    path: item.path,
    sha256: item.sha256
  })));

  return crypto.createHmac("sha256", integritySecret).update(body).digest("hex");
}

function buildManifest() {
  const files = protectedFiles.map((relativePath) => ({
    path: relativePath,
    sha256: sha256File(path.join(rootDir, relativePath))
  }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    files,
    signature: sign(files)
  };
}

function writeManifest() {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(buildManifest(), null, 2)}\n`, "utf8");
  console.log("Integrity manifest updated.");
}

function verifyManifest() {
  if (!fs.existsSync(manifestPath)) {
    console.error("Integrity manifest is missing.");
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expectedSignature = sign(manifest.files || []);
  if (expectedSignature !== manifest.signature) {
    console.error("Integrity manifest signature mismatch.");
    process.exitCode = 1;
    return;
  }

  for (const item of manifest.files || []) {
    const currentHash = sha256File(path.join(rootDir, item.path));
    if (currentHash !== item.sha256) {
      console.error(`Integrity mismatch: ${item.path}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log("Integrity manifest verified.");
}

if (process.argv.includes("--verify")) {
  verifyManifest();
} else {
  writeManifest();
}
