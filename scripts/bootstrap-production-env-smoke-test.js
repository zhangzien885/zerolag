const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { checkServerEnvFile } = require("./check-server-env");

const rootDir = path.join(__dirname, "..");
const bootstrapScriptPath = path.join(rootDir, "scripts", "bootstrap-production-env.js");

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
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-bootstrap-env-smoke-")) {
    throw new Error(`Refusing to remove unexpected path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function assertNoPrivateOutput(text, label) {
  [
    "PRIVATE KEY",
    "ZEROLAG_SERVER_SECRET=",
    "ZEROLAG_ADMIN_SECRET=",
    "ZEROLAG_PAYMENT_WEBHOOK_SECRET=",
    "ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64="
  ].forEach((snippet) => {
    assertOk(!String(text || "").includes(snippet), `${label} must not print private material: ${snippet}`);
  });
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-bootstrap-env-smoke-"));
  const envPath = path.join(tempRoot, "server.env");
  const runtimeKeyDir = path.join(tempRoot, "runtime-session");

  try {
    const generated = runNode([
      bootstrapScriptPath,
      "--profile",
      "sqlite",
      "--server-env-file",
      envPath,
      "--runtime-key-dir",
      runtimeKeyDir,
      "--key-version",
      "runtime-session-smoke"
    ]);
    assertNoPrivateOutput(generated.stdout, "Bootstrap stdout");
    assertNoPrivateOutput(generated.stderr, "Bootstrap stderr");

    const result = JSON.parse(generated.stdout);
    assertOk(result.ok === true, "Bootstrap should report ok.");
    assertOk(result.profile === "sqlite", "Bootstrap should use the requested SQLite profile.");
    assertOk(result.runtimeKeyVersion === "runtime-session-smoke", "Bootstrap should report the requested key version.");
    assertOk(fs.existsSync(envPath), "Bootstrap should write the server env file.");
    assertOk(fs.existsSync(path.join(runtimeKeyDir, "runtime-session-smoke.private.pem")), "Bootstrap should write the runtime private key file.");
    assertOk(fs.existsSync(path.join(runtimeKeyDir, "runtime-session-smoke.app-config-snippet.json")), "Bootstrap should write the app config public-key snippet.");

    const envText = fs.readFileSync(envPath, "utf8");
    assertOk(envText.includes("ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM=RSA-SHA256"), "Server env should use RSA runtime-session proofs.");
    assertOk(envText.includes("ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64="), "Server env should include the server-only runtime private key.");
    assertOk(envText.includes("ZEROLAG_STATE_STORE=sqlite"), "Server env should default to SQLite for production bootstrap.");

    const envCheck = checkServerEnvFile(envPath, { profile: "sqlite", strict: false });
    assertOk(envCheck.issues.length === 0, `Generated env should have no issues: ${envCheck.issues.join("; ")}`);
    assertOk(envCheck.summary.runtimeSessionProofAlgorithm === "RSA-SHA256", "Env check should detect RSA runtime-session proofs.");
    assertOk(envCheck.summary.runtimeSessionAsymmetricProofConfigured === true, "Env check should detect the runtime private key.");

    runNode([
      bootstrapScriptPath,
      "--server-env-file",
      envPath,
      "--runtime-key-dir",
      runtimeKeyDir,
      "--key-version",
      "runtime-session-smoke"
    ], 1);

    runNode([
      bootstrapScriptPath,
      "--server-env-file",
      envPath,
      "--runtime-key-dir",
      runtimeKeyDir,
      "--key-version",
      "runtime-session-smoke",
      "--force"
    ]);

    console.log("ZeroLag production env bootstrap smoke test passed.");
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
