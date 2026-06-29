const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "prepare-release-mode.js");
const publicKeyPem = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtesttesttesttesttest",
  "testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttest",
  "testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttest",
  "testtesttesttesttesttesttesttesttesttesttesttesttesttestIDAQAB",
  "-----END PUBLIC KEY-----"
].join("\n");

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
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-release-mode-smoke-")) {
    throw new Error(`Refusing to remove unexpected temp path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function writeUnreadyFixture(configPath, packagePath, updatePath) {
  writeJson(configPath, {
    releaseMode: "development",
    websiteUrl: "https://example.com/zerolag",
    purchaseUrl: "",
    analyticsUrl: "",
    supportUrl: "",
    apiBaseUrl: "",
    updateManifestUrl: "",
    updatePublicKeyPem: "",
    runtimeSessionPublicKeyPem: "",
    allowLocalDemoLicense: false
  });
  writeJson(packagePath, {
    name: "zerolag",
    version: "1.0.0"
  });
  writeJson(updatePath, {
    latest: "0.9.0",
    downloadUrl: "https://example.com/download"
  });
}

function writeReadyFixture(configPath, packagePath, updatePath) {
  writeJson(configPath, {
    releaseMode: "development",
    websiteUrl: "https://zerolag.test",
    purchaseUrl: "https://zerolag.test/buy",
    analyticsUrl: "https://api.zerolag.test/v1/website/events",
    supportUrl: "https://zerolag.test/support",
    apiBaseUrl: "https://api.zerolag.test",
    updateManifestUrl: "https://cdn.zerolag.test/releases/latest.json",
    updatePublicKeyPem: publicKeyPem,
    runtimeSessionPublicKeyPem: publicKeyPem,
    allowLocalDemoLicense: false
  });
  writeJson(packagePath, {
    name: "zerolag",
    version: "1.0.0"
  });
  writeJson(updatePath, {
    latest: "1.0.0",
    downloadUrl: "https://cdn.zerolag.test/releases/ZeroLag-Setup-1.0.0.exe",
    signatureAlgorithm: "RSA-SHA256",
    signature: "signature-fixture"
  });
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-release-mode-smoke-"));
  const configPath = path.join(tempRoot, "app-config.json");
  const packagePath = path.join(tempRoot, "package.json");
  const updatePath = path.join(tempRoot, "update.json");

  try {
    writeUnreadyFixture(configPath, packagePath, updatePath);
    const blocked = runNode([
      scriptPath,
      "--mode",
      "production",
      "--config",
      configPath,
      "--package",
      packagePath,
      "--update",
      updatePath,
      "--write"
    ], 1);
    const blockedResult = JSON.parse(blocked.stdout);
    assertOk(blockedResult.ok === false, "Unready production mode should fail.");
    assertOk(blockedResult.written === false, "Unready production mode must not write.");
    assertOk(blockedResult.blockers.length >= 1, "Unready production mode should list blockers.");
    assertOk(readJson(configPath).releaseMode === "development", "Unready write must not mutate release mode.");

    writeReadyFixture(configPath, packagePath, updatePath);
    const dryRun = runNode([
      scriptPath,
      "--mode",
      "production",
      "--config",
      configPath,
      "--package",
      packagePath,
      "--update",
      updatePath
    ]);
    const dryRunResult = JSON.parse(dryRun.stdout);
    assertOk(dryRunResult.ok === true, "Ready dry-run should pass.");
    assertOk(dryRunResult.written === false, "Ready dry-run should not write.");
    assertOk(readJson(configPath).releaseMode === "development", "Ready dry-run must not mutate release mode.");

    const written = runNode([
      scriptPath,
      "--mode",
      "production",
      "--config",
      configPath,
      "--package",
      packagePath,
      "--update",
      updatePath,
      "--write"
    ]);
    const writtenResult = JSON.parse(written.stdout);
    assertOk(writtenResult.ok === true, "Ready write should pass.");
    assertOk(writtenResult.written === true, "Ready write should report written.");
    assertOk(readJson(configPath).releaseMode === "production", "Ready write should switch release mode.");

    runNode([
      scriptPath,
      "--mode",
      "development",
      "--config",
      configPath,
      "--package",
      packagePath,
      "--update",
      updatePath,
      "--write"
    ]);
    assertOk(readJson(configPath).releaseMode === "development", "Development write should switch back safely.");

    console.log("ZeroLag release mode smoke test passed.");
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
