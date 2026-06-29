const fs = require("fs");
const os = require("os");
const path = require("path");
const { provisionLocalServerEnvironment } = require("./provision-local-server-environment");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRmTempDir(tempDir) {
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-provision-smoke-")) {
    throw new Error(`Refusing to clean unexpected provision smoke path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function assertNoSecrets(text, label) {
  const forbidden = [
    "zl_server_",
    "zl_admin_",
    "zl_payment_",
    "ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64="
  ];

  for (const pattern of forbidden) {
    assertOk(!String(text || "").includes(pattern), `${label} leaked private material: ${pattern}`);
  }
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-provision-smoke-"));

  try {
    const envPath = path.join(tempDir, ".secrets", "server.env");
    const runtimeKeyDir = path.join(tempDir, ".secrets", "runtime-session");
    const deploymentPackPath = path.join(tempDir, "deployment-pack");
    const first = provisionLocalServerEnvironment({
      envPath,
      runtimeKeyDir,
      deploymentPackPath,
      baseDir: tempDir
    });

    assertOk(first.ok === true, "Provision result should be ok.");
    assertOk(first.publicLaunchReady === false, "Provisioned local environment should still require public launch configuration.");
    assertOk(first.envCreated === true, "First provision should create the env file.");
    assertOk(fs.existsSync(envPath), "Private env file should be created.");
    assertOk(fs.existsSync(path.join(tempDir, "server", "data", "server-state.sqlite")), "SQLite state should be initialized.");
    assertOk(fs.existsSync(path.join(tempDir, "server", "data", "backups")), "SQLite backup directory should be initialized.");
    assertOk(
      fs.readdirSync(path.join(tempDir, "server", "data", "backups")).some((fileName) => fileName.endsWith(".sqlite")),
      "Provision should write a SQLite backup file."
    );
    assertOk(first.deploymentPack && first.deploymentPack.fileCount > 20, "Provision should generate a deployment pack.");
    assertOk(fs.existsSync(path.join(deploymentPackPath, "manifest.json")), "Deployment pack manifest should exist.");
    assertOk(first.remainingLaunchItems.some((item) => item.includes("payment")), "Provision should explain that real payment configuration is still required.");

    const resultJson = JSON.stringify(first, null, 2);
    assertNoSecrets(resultJson, "Provision result");

    const existingEnvText = fs.readFileSync(envPath, "utf8");
    const second = provisionLocalServerEnvironment({
      envPath,
      runtimeKeyDir,
      deploymentPackPath,
      baseDir: tempDir
    });
    assertOk(second.envCreated === false, "Second provision should reuse the existing env file.");
    assertOk(fs.readFileSync(envPath, "utf8") === existingEnvText, "Second provision should not overwrite the env file.");

    console.log("ZeroLag local server provisioning smoke test passed.");
  } finally {
    safeRmTempDir(tempDir);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
