const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const defaultPackagePath = path.join(rootDir, "package.json");
const defaultManifestPath = path.join(rootDir, "assets", "update.json");
const defaultArtifactsPath = path.join(rootDir, "dist", "release-artifacts.json");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/prepare-update-manifest.js --base-url https://cdn.example/releases [--artifacts dist/release-artifacts.json] [--private-key file] [--public-key file] [--write]");
  console.log("");
  console.log("Prepares update metadata from release artifacts. Dry-run is default.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function isPlaceholderUrl(value) {
  return /example\.com|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(String(value || ""));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signingBody(manifest) {
  const payload = { ...(manifest || {}) };
  delete payload.signature;
  delete payload.signatureAlgorithm;
  delete payload.signatureError;
  delete payload.signatureValid;
  delete payload.signed;
  delete payload.source;
  return stableStringify(payload);
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value || "").trim().replace(/\/+$/g, "");
  if (!isHttpsUrl(baseUrl) || isPlaceholderUrl(baseUrl)) {
    throw new Error("--base-url must be a real HTTPS URL.");
  }
  return baseUrl;
}

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(filePath)} (external)`;
}

function signManifest(manifest, privateKeyPath) {
  const privateKey = fs.readFileSync(privateKeyPath, "utf8");
  const signature = crypto.sign("sha256", Buffer.from(signingBody(manifest), "utf8"), privateKey);
  return {
    ...manifest,
    signatureAlgorithm: "RSA-SHA256",
    signature: signature.toString("base64")
  };
}

function verifyManifest(manifest, publicKeyPath) {
  const publicKey = fs.readFileSync(publicKeyPath, "utf8");
  const signature = Buffer.from(String(manifest.signature || ""), "base64");
  return Boolean(manifest.signature)
    && crypto.verify("sha256", Buffer.from(signingBody(manifest), "utf8"), publicKey, signature);
}

function prepareUpdateManifest(input = {}) {
  const manifestPath = path.resolve(input.manifestPath || defaultManifestPath);
  const packagePath = path.resolve(input.packagePath || defaultPackagePath);
  const artifactsPath = path.resolve(input.artifactsPath || defaultArtifactsPath);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const write = input.write === true;
  const packageJson = readJson(packagePath);
  const manifest = readJson(manifestPath);
  const artifacts = readJson(artifactsPath);
  const installerFile = artifacts.installer && artifacts.installer.file;
  const version = artifacts.version || packageJson.version;

  if (!installerFile) throw new Error("Release artifacts are missing installer.file.");
  if (version !== packageJson.version) throw new Error("Release artifact version must match package.json version.");

  const nextManifest = {
    ...manifest,
    latest: version,
    minSupported: manifest.minSupported || version,
    downloadUrl: `${baseUrl}/${encodeURIComponent(installerFile).replace(/%20/g, "%20")}`
  };
  delete nextManifest.signature;
  delete nextManifest.signatureAlgorithm;

  const signedManifest = input.privateKeyPath
    ? signManifest(nextManifest, path.resolve(input.privateKeyPath))
    : nextManifest;

  const verified = input.publicKeyPath
    ? verifyManifest(signedManifest, path.resolve(input.publicKeyPath))
    : false;
  if (input.privateKeyPath && input.publicKeyPath && !verified) {
    throw new Error("Prepared update manifest signature could not be verified.");
  }

  if (write) writeJson(manifestPath, signedManifest);

  return {
    ok: true,
    written: write,
    signed: Boolean(signedManifest.signature),
    verified,
    manifestFile: safeRelative(manifestPath),
    artifactsFile: safeRelative(artifactsPath),
    version,
    installerFile,
    downloadUrl: signedManifest.downloadUrl,
    nextSteps: [
      "Upload the installer to the same public CDN path.",
      "Run npm run website:release after release artifacts and update metadata are ready.",
      "Run npm run release:preflight:strict before publishing."
    ]
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  try {
    const result = prepareUpdateManifest({
      baseUrl: argValue("--base-url"),
      manifestPath: argValue("--manifest", defaultManifestPath),
      packagePath: argValue("--package", defaultPackagePath),
      artifactsPath: argValue("--artifacts", defaultArtifactsPath),
      privateKeyPath: argValue("--private-key"),
      publicKeyPath: argValue("--public-key"),
      write: process.argv.includes("--write")
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  prepareUpdateManifest,
  signingBody
};
