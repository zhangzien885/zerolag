const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { signingBody } = require("./prepare-update-manifest");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "prepare-update-manifest.js");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runNode(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== expectedStatus) {
    throw new Error([
      `Command failed: node ${args.join(" ")}`,
      `Expected exit: ${expectedStatus}`,
      `Actual exit: ${result.status}`,
      result.stdout.trim(),
      result.stderr.trim()
    ].filter(Boolean).join("\n"));
  }

  return result;
}

function safeRemoveTemp(tempRoot) {
  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-update-manifest-smoke-")) {
    throw new Error(`Refusing to remove unexpected temp path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function generateKeypair(privateKeyPath, publicKeyPath) {
  const keypair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  fs.writeFileSync(privateKeyPath, keypair.privateKey, "utf8");
  fs.writeFileSync(publicKeyPath, keypair.publicKey, "utf8");
}

function verifyManifest(manifest, publicKeyPath) {
  return crypto.verify(
    "sha256",
    Buffer.from(signingBody(manifest), "utf8"),
    fs.readFileSync(publicKeyPath, "utf8"),
    Buffer.from(manifest.signature, "base64")
  );
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-update-manifest-smoke-"));
  const packagePath = path.join(tempRoot, "package.json");
  const manifestPath = path.join(tempRoot, "update.json");
  const artifactsPath = path.join(tempRoot, "release-artifacts.json");
  const privateKeyPath = path.join(tempRoot, "update-private.pem");
  const publicKeyPath = path.join(tempRoot, "update-public.pem");

  try {
    writeJson(packagePath, { version: "1.2.3" });
    writeJson(manifestPath, {
      latest: "0.1.0",
      minSupported: "1.0.0",
      force: false,
      releaseNotes: ["Keep public note"],
      downloadUrl: "https://example.com/old.exe"
    });
    writeJson(artifactsPath, {
      version: "1.2.3",
      installer: {
        file: "ZeroLag Setup 1.2.3.exe",
        sha256: "a".repeat(64)
      }
    });
    generateKeypair(privateKeyPath, publicKeyPath);

    const dryRun = runNode([
      scriptPath,
      "--base-url",
      "https://cdn.zerolag.gg/releases",
      "--manifest",
      manifestPath,
      "--package",
      packagePath,
      "--artifacts",
      artifactsPath,
      "--private-key",
      privateKeyPath,
      "--public-key",
      publicKeyPath
    ]);
    const dryRunResult = JSON.parse(dryRun.stdout);
    assertOk(dryRunResult.written === false, "Dry-run should not write.");
    assertOk(dryRunResult.signed === true, "Dry-run should prepare a signed manifest when private key is provided.");
    assertOk(dryRunResult.verified === true, "Dry-run should verify the prepared signature.");
    assertOk(readJson(manifestPath).latest === "0.1.0", "Dry-run must not mutate manifest.");

    const written = runNode([
      scriptPath,
      "--base-url",
      "https://cdn.zerolag.gg/releases",
      "--manifest",
      manifestPath,
      "--package",
      packagePath,
      "--artifacts",
      artifactsPath,
      "--private-key",
      privateKeyPath,
      "--public-key",
      publicKeyPath,
      "--write"
    ]);
    const writtenResult = JSON.parse(written.stdout);
    const manifest = readJson(manifestPath);
    assertOk(writtenResult.written === true, "Write mode should report written.");
    assertOk(manifest.latest === "1.2.3", "Write mode should sync latest version.");
    assertOk(manifest.minSupported === "1.0.0", "Write mode should preserve minSupported.");
    assertOk(manifest.downloadUrl === "https://cdn.zerolag.gg/releases/ZeroLag%20Setup%201.2.3.exe", "Write mode should set encoded installer URL.");
    assertOk(manifest.releaseNotes[0] === "Keep public note", "Write mode should preserve release notes.");
    assertOk(manifest.signatureAlgorithm === "RSA-SHA256", "Write mode should sign manifest.");
    assertOk(verifyManifest(manifest, publicKeyPath), "Written manifest signature should verify.");

    runNode([
      scriptPath,
      "--base-url",
      "https://example.com/releases",
      "--manifest",
      manifestPath,
      "--package",
      packagePath,
      "--artifacts",
      artifactsPath
    ], 1);
    const placeholder = runNode([
      scriptPath,
      "--base-url",
      "https://example.com/releases",
      "--manifest",
      manifestPath,
      "--package",
      packagePath,
      "--artifacts",
      artifactsPath,
      "--allow-placeholder"
    ]);
    const placeholderResult = JSON.parse(placeholder.stdout);
    assertOk(placeholderResult.downloadUrl === "https://example.com/releases/ZeroLag%20Setup%201.2.3.exe", "Explicit placeholder mode should build a placeholder download URL.");
    assertOk(placeholderResult.nextSteps.some((step) => step.includes("Replace placeholder update URLs")), "Explicit placeholder mode should warn about replacement.");

    runNode([
      scriptPath,
      "--base-url",
      "https://cdn.zerolag.test/releases",
      "--manifest",
      manifestPath,
      "--package",
      packagePath,
      "--artifacts",
      artifactsPath
    ], 1);

    writeJson(artifactsPath, { version: "9.9.9", installer: { file: "ZeroLag Setup 9.9.9.exe" } });
    runNode([
      scriptPath,
      "--base-url",
      "https://cdn.zerolag.gg/releases",
      "--manifest",
      manifestPath,
      "--package",
      packagePath,
      "--artifacts",
      artifactsPath
    ], 1);

    console.log("ZeroLag update manifest preparation smoke test passed.");
  } finally {
    safeRemoveTemp(tempRoot);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
