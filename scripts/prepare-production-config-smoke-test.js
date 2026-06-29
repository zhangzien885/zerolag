const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "prepare-production-config.js");

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
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-production-config-smoke-")) {
    throw new Error(`Refusing to remove unexpected temp path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-production-config-smoke-"));
  const configPath = path.join(tempRoot, "app-config.json");
  const updatePath = path.join(tempRoot, "update.json");

  try {
    writeJson(configPath, {
      releaseMode: "development",
      releaseChannel: "alpha",
      websiteUrl: "https://example.com/zerolag",
      allowLocalDemoLicense: true,
      updatePublicKeyPem: "",
      runtimeSessionPublicKeyPem: ""
    });
    writeJson(updatePath, {
      latest: "1.2.3",
      downloadUrl: "https://example.com/zerolag/download"
    });

    const dryRun = runNode([
      scriptPath,
      "--domain",
      "zerolag.test",
      "--config",
      configPath,
      "--update",
      updatePath
    ]);
    const dryRunResult = JSON.parse(dryRun.stdout);
    assertOk(dryRunResult.written === false, "Dry-run should not write files.");
    assertOk(readJson(configPath).releaseMode === "development", "Dry-run must not mutate app config.");
    assertOk(dryRunResult.appConfigPatch.websiteUrl === "https://zerolag.test", "Dry-run should build website URL.");
    assertOk(dryRunResult.appConfigPatch.apiBaseUrl === "https://api.zerolag.test", "Dry-run should default API subdomain.");
    assertOk(dryRunResult.updatePatch.downloadUrl === "https://cdn.zerolag.test/releases/ZeroLag-Setup-{version}.exe", "Dry-run should default CDN download URL.");

    const written = runNode([
      scriptPath,
      "--domain",
      "zerolag.test",
      "--api-domain",
      "api-pay.zerolag.test",
      "--cdn-domain",
      "download.zerolag.test",
      "--installer-name",
      "ZeroLag-Setup-1.2.3.exe",
      "--config",
      configPath,
      "--update",
      updatePath,
      "--write"
    ]);
    const writtenResult = JSON.parse(written.stdout);
    const appConfig = readJson(configPath);
    const updateManifest = readJson(updatePath);
    assertOk(writtenResult.written === true, "Write mode should report written.");
    assertOk(appConfig.releaseMode === "production", "Write mode should switch release mode to production.");
    assertOk(appConfig.allowLocalDemoLicense === false, "Write mode should disable local demo license.");
    assertOk(appConfig.purchaseUrl === "https://zerolag.test/buy", "Write mode should set purchase URL.");
    assertOk(appConfig.supportUrl === "https://zerolag.test/support", "Write mode should set support URL.");
    assertOk(appConfig.analyticsUrl === "https://api-pay.zerolag.test/v1/website/events", "Write mode should set analytics endpoint.");
    assertOk(appConfig.apiBaseUrl === "https://api-pay.zerolag.test", "Write mode should set API base URL.");
    assertOk(appConfig.updateManifestUrl === "https://download.zerolag.test/releases/latest.json", "Write mode should set update manifest URL.");
    assertOk(updateManifest.downloadUrl === "https://download.zerolag.test/releases/ZeroLag-Setup-1.2.3.exe", "Write mode should set installer download URL.");
    assertOk(appConfig.updatePublicKeyPem === "", "Write mode must preserve key fields for later secure fill.");

    runNode([scriptPath, "--domain", "example.com", "--config", configPath, "--update", updatePath], 1);
    runNode([scriptPath, "--domain", "localhost", "--config", configPath, "--update", updatePath], 1);

    console.log("ZeroLag production config smoke test passed.");
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
