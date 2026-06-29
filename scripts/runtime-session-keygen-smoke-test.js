const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { checkServerEnvFile } = require("./check-server-env");

const rootDir = path.join(__dirname, "..");
const keygenScriptPath = path.join(rootDir, "scripts", "generate-runtime-session-keys.js");

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
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-runtime-keygen-smoke-")) {
    throw new Error(`Refusing to remove unexpected path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function main() {
  assertOk(fs.existsSync(keygenScriptPath), "Runtime session keygen script is missing.");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-runtime-keygen-smoke-"));
  const outputDir = path.join(tempRoot, "runtime-session");
  const keyVersion = "runtime-session-smoke";

  try {
    const generated = runNode([
      keygenScriptPath,
      "--output-dir",
      outputDir,
      "--key-version",
      keyVersion
    ]);
    const result = JSON.parse(generated.stdout);
    assertOk(result.ok === true, "Keygen command should report ok.");
    assertOk(result.keyVersion === keyVersion, "Keygen command should report the requested key version.");
    assertOk(result.algorithm === "RSA-SHA256", "Keygen command should report RSA-SHA256.");
    assertOk(!generated.stdout.includes("PRIVATE KEY"), "Keygen stdout must not print the private key.");
    assertOk(!generated.stdout.includes("ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64"), "Keygen stdout must not print private env values.");

    const privateKeyPath = path.join(outputDir, `${keyVersion}.private.pem`);
    const publicKeyPath = path.join(outputDir, `${keyVersion}.public.pem`);
    const serverEnvPath = path.join(outputDir, `${keyVersion}.server.env`);
    const appConfigSnippetPath = path.join(outputDir, `${keyVersion}.app-config-snippet.json`);
    assertOk(fs.readFileSync(privateKeyPath, "utf8").includes("PRIVATE KEY"), "Private key file should contain PEM private key material.");
    assertOk(fs.readFileSync(publicKeyPath, "utf8").includes("PUBLIC KEY"), "Public key file should contain PEM public key material.");
    assertOk(fs.readFileSync(serverEnvPath, "utf8").includes("ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM=RSA-SHA256"), "Server env should enable RSA runtime-session proofs.");

    const appSnippet = JSON.parse(fs.readFileSync(appConfigSnippetPath, "utf8"));
    assertOk(String(appSnippet.runtimeSessionPublicKeyPem || "").includes("BEGIN PUBLIC KEY"), "App config snippet should contain the public key only.");
    assertOk(!JSON.stringify(appSnippet).includes("PRIVATE KEY"), "App config snippet must not contain private key material.");

    const fullEnvPath = path.join(tempRoot, "full-server.env");
    fs.writeFileSync(fullEnvPath, [
      "ZEROLAG_SERVER_SECRET=zl_server_runtime_keygen_smoke_abcdefghijklmnopqrstuvwxyz1234567890",
      "ZEROLAG_ADMIN_SECRET=zl_admin_runtime_keygen_smoke_abcdefghijklmnopqrstuvwxyz1234567890",
      "ZEROLAG_PAYMENT_WEBHOOK_SECRET=zl_payment_runtime_keygen_smoke_abcdefghijklmnopqrstuvwxyz1234567890",
      fs.readFileSync(serverEnvPath, "utf8").trim(),
      "ZEROLAG_SERVER_HOST=0.0.0.0",
      "ZEROLAG_SERVER_PORT=8787",
      `ZEROLAG_SERVER_STATE_PATH=${path.join(tempRoot, "server-state.json")}`,
      `ZEROLAG_SERVER_BACKUP_DIR=${path.join(tempRoot, "backups")}`,
      "ZEROLAG_STATE_STORE=json",
      "ZEROLAG_PAYMENT_PROVIDER=wechat_pay",
      "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS=wechat_pay",
      "ZEROLAG_PAYMENT_URL_TEMPLATE=https://pay.zerolag.test/checkout/{orderId}",
      "ZEROLAG_PAYMENT_MESSAGE=Open the secure checkout page to finish payment.",
      "ZEROLAG_WECHAT_PAY_MCH_ID=1900000001",
      "ZEROLAG_WECHAT_PAY_APP_ID=wx0000000000000001",
      "ZEROLAG_WECHAT_PAY_API_V3_KEY=runtime_keygen_wechat_api_v3_key_32",
      "ZEROLAG_WECHAT_PAY_SERIAL_NO=RUNTIMEKEYGENSERIAL001",
      "ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH=private-wechat-key.pem",
      "ZEROLAG_RATE_LIMIT_DISABLED=0",
      "ZEROLAG_SERVER_BACKUP_DISABLED=0",
      "ZEROLAG_MAINTENANCE_DISABLED=0",
      ""
    ].join("\n"), "utf8");
    const envCheck = checkServerEnvFile(fullEnvPath, { profile: "json", strict: false });
    assertOk(envCheck.ok === true, `Generated runtime-session env should pass env check: ${envCheck.issues.join("; ")}`);
    assertOk(envCheck.summary.runtimeSessionProofAlgorithm === "RSA-SHA256", "Env check should detect RSA runtime-session proof algorithm.");
    assertOk(envCheck.summary.runtimeSessionAsymmetricProofConfigured === true, "Env check should detect configured RSA private key.");

    runNode([
      keygenScriptPath,
      "--output-dir",
      outputDir,
      "--key-version",
      keyVersion
    ], 1);

    runNode([
      keygenScriptPath,
      "--output-dir",
      outputDir,
      "--key-version",
      keyVersion,
      "--force"
    ]);

    console.log("ZeroLag runtime session keygen smoke test passed.");
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
