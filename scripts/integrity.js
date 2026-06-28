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
  "scripts/runtime-watchdog.js",
  "scripts/local-integration.js",
  "scripts/generate-icon.js",
  "scripts/production-check.js",
  "scripts/release-preflight.js",
  "scripts/server-production-check.js",
  "scripts/server-smoke-test.js",
  "scripts/generate-server-secrets.js",
  "scripts/update-signing-smoke-test.js",
  "server/env.js",
  "assets/zerolag-logo.svg",
  "assets/app-config.json",
  "assets/zerolag-power-plan-template.protected.json"
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
