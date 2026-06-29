const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildEnvFile } = require("./generate-server-secrets");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "server-env-status.js");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
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
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-server-env-status-smoke-")) {
    throw new Error(`Refusing to remove unexpected temp path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function assertNoSecrets(text, label) {
  [
    "zl_server_",
    "zl_admin_",
    "zl_payment_",
    "ZEROLAG_SERVER_SECRET=",
    "ZEROLAG_ADMIN_SECRET=",
    "ZEROLAG_PAYMENT_WEBHOOK_SECRET="
  ].forEach((snippet) => {
    assertOk(!String(text || "").includes(snippet), `${label} leaked private env value: ${snippet}`);
  });
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-server-env-status-smoke-"));
  const missingPath = path.join(tempRoot, "missing.env");
  const envPath = path.join(tempRoot, "server.env");

  try {
    const missing = runNode([scriptPath, "--file", missingPath, "--profile", "sqlite"]);
    const missingResult = JSON.parse(missing.stdout);
    assertOk(missingResult.ok === false, "Missing env should not be ready.");
    assertOk(missingResult.summary.exists === false, "Missing env should report exists=false.");
    assertOk(missingResult.nextSteps.some((step) => step.includes("server:bootstrap")), "Missing env should suggest bootstrap.");
    assertNoSecrets(missing.stdout, "Missing-env output");

    fs.writeFileSync(envPath, buildEnvFile("sqlite"), "utf8");
    const ready = runNode([scriptPath, "--file", envPath, "--profile", "sqlite"]);
    const readyResult = JSON.parse(ready.stdout);
    assertOk(readyResult.ok === true, "Generated env should pass non-strict status when only warnings remain.");
    assertOk(readyResult.summary.exists === true, "Existing env should report exists=true.");
    assertOk(readyResult.summary.stateStore === "sqlite", "Existing env should report sqlite state.");
    assertOk(readyResult.summary.issueCount === 0, "Generated env should have no blocking issues.");
    assertOk(readyResult.summary.warningCount >= 1, "Generated env should keep paid-release warnings visible.");
    assertNoSecrets(ready.stdout, "Existing-env output");

    const strict = runNode([scriptPath, "--file", envPath, "--profile", "sqlite", "--strict"], 1);
    const strictResult = JSON.parse(strict.stdout);
    assertOk(strictResult.strict === true, "Strict output should record strict mode.");
    assertOk(strictResult.ok === false, "Strict mode should fail while warnings remain.");
    assertNoSecrets(strict.stdout, "Strict-env output");

    console.log("ZeroLag server env status smoke test passed.");
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
