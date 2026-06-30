const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { createDeploymentPack } = require("./prepare-server-deployment-pack");

const rootDir = path.join(__dirname, "..");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRmTempDir(tempDir) {
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-server-pack-smoke-")) {
    throw new Error(`Refusing to clean unexpected deployment-pack smoke path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertExists(filePath, label) {
  assertOk(fs.existsSync(filePath), `${label} is missing: ${filePath}`);
}

function assertNotExists(filePath, label) {
  assertOk(!fs.existsSync(filePath), `${label} should not be included: ${filePath}`);
}

function runNodeCheck(packRoot, relativePath) {
  const result = spawnSync(process.execPath, ["--check", path.join(packRoot, relativePath)], {
    cwd: packRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assertOk(result.status === 0, `node --check failed for ${relativePath}: ${result.stderr || result.stdout}`);
}

function runPackCommand(packRoot, args) {
  return spawnSync(process.execPath, args, {
    cwd: packRoot,
    env: {
      ...process.env,
      ZEROLAG_ENV_FILE: path.join(packRoot, ".secrets", "missing-server.env")
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function assertNoSecrets(text, label) {
  const forbidden = [
    "zl_server_",
    "zl_admin_",
    "zl_payment_",
    "ZEROLAG_SERVER_SECRET=zl_",
    "ZEROLAG_ADMIN_SECRET=zl_",
    "ZEROLAG_PAYMENT_WEBHOOK_SECRET=zl_"
  ];

  for (const pattern of forbidden) {
    assertOk(!String(text || "").includes(pattern), `${label} leaked generated secret pattern: ${pattern}`);
  }
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-server-pack-smoke-"));
  const packRoot = path.join(tempRoot, "pack");

  try {
    const result = createDeploymentPack({ outputPath: packRoot });
    assertOk(result.fileCount > 20, "Deployment pack should contain the server runtime and ops files.");

    const expectedFiles = [
      "README.md",
      ".env.example",
      "manifest.json",
      "package.json",
      "assets/app-config.json",
      "assets/update.json",
      "server/index.js",
      "server/env.js",
      "server/payment-provider.js",
      "server/state-store.js",
      "server/admin-client.js",
      "scripts/server-production-check.js",
      "scripts/server-smoke-test.js",
      "scripts/payment-loop-smoke-test.js",
      "scripts/bootstrap-production-env.js",
      "scripts/generate-server-secrets.js",
      "ops/start-server.ps1",
      "ops/check-server.ps1",
      "reverse-proxy/caddy/Caddyfile.example",
      "reverse-proxy/nginx/zerolag-api.conf.example",
      "docs/release-checklist.md"
    ];

    for (const relativePath of expectedFiles) {
      assertExists(path.join(packRoot, relativePath), relativePath);
    }

    const forbiddenFiles = [
      "main.js",
      "preload.js",
      "src/index.html",
      "node_modules",
      ".secrets/server.env",
      "scripts/runtime-watchdog.js"
    ];

    for (const relativePath of forbiddenFiles) {
      assertNotExists(path.join(packRoot, relativePath), relativePath);
    }

    const packageJson = JSON.parse(readText(path.join(packRoot, "package.json")));
    assertOk(packageJson.scripts["server:start"], "Deployment package should include server:start.");
    assertOk(packageJson.scripts["server:payment-loop"], "Deployment package should include server:payment-loop.");
    assertOk(packageJson.scripts["server:deployment-report"], "Deployment package should include server deployment reports.");
    assertOk(!packageJson.devDependencies, "Deployment package should not ship desktop devDependencies.");

    const readme = readText(path.join(packRoot, "README.md"));
    assertOk(readme.includes("ZeroLag Server Deployment Pack"), "Deployment README title is missing.");
    assertOk(readme.includes("npm run server:bootstrap -- --profile sqlite"), "Deployment README should explain private env bootstrap.");
    assertOk(readme.includes("npm run server:payment-loop"), "Deployment README should include payment-loop verification.");
    assertNoSecrets(readme, "Deployment README");

    const envExample = readText(path.join(packRoot, ".env.example"));
    assertOk(envExample.includes("replace-with-generated-server-secret"), "Env example should use placeholders.");
    assertOk(envExample.includes("ZEROLAG_STATE_STORE=sqlite"), "Env example should default to SQLite.");
    assertNoSecrets(envExample, "Env example");

    const manifest = JSON.parse(readText(path.join(packRoot, "manifest.json")));
    assertOk(manifest.type === "server-deployment-pack", "Manifest should identify the deployment pack.");
    assertOk(Array.isArray(manifest.files) && manifest.files.length === result.fileCount, "Manifest should include every generated file.");
    assertOk(manifest.files.some((file) => file.path === "server/index.js"), "Manifest should include server/index.js.");
    assertOk(manifest.files.some((file) => file.path === "server/payment-provider.js"), "Manifest should include server/payment-provider.js.");
    assertOk(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), "Manifest entries should include SHA256 hashes.");

    runNodeCheck(packRoot, "server/index.js");
    runNodeCheck(packRoot, "server/payment-provider.js");
    runNodeCheck(packRoot, "scripts/server-smoke-test.js");
    runNodeCheck(packRoot, "scripts/payment-loop-smoke-test.js");

    const paymentLoop = runPackCommand(packRoot, ["scripts/payment-loop-smoke-test.js"]);
    assertOk(paymentLoop.status === 0, `Deployment pack payment loop failed: ${paymentLoop.stderr || paymentLoop.stdout}`);
    assertOk(paymentLoop.stdout.includes("ZeroLag production payment loop passed."), "Deployment pack payment loop did not report success.");

    console.log("ZeroLag server deployment pack smoke test passed.");
  } finally {
    safeRmTempDir(tempRoot);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
