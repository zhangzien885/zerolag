const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { addActivationCode, createAppServer, loadState, saveState, signPaymentWebhook } = require("./index");
const { createSqliteStateStore } = require("./state-store");

function requestJson(port, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const request = require("http").request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: body ? "POST" : "GET",
      headers: {
        ...headers,
        ...(payload ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
        } : {})
      }
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        try {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: raw ? JSON.parse(raw) : null
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function registerSelfTestAccount(port, identifier, provider = "email") {
  const response = await requestJson(port, "/v1/accounts/register", {
    provider,
    identifier
  });
  assert(response.statusCode === 201 || response.statusCode === 200, "Self-test account registration failed.");
  assert(response.body && response.body.ok && /^acctok_/.test(response.body.token || ""), "Self-test account token missing.");
  return response;
}

function requestRaw(port, pathname, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = require("http").request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "POST",
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        try {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: raw ? JSON.parse(raw) : null
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function requestOptions(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = require("http").request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "OPTIONS",
      headers
    }, (response) => {
      response.resume();
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers
        });
      });
    });

    request.on("error", reject);
    request.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function nestedWebsiteEventCount(dailyEvents, eventName) {
  return Object.values(dailyEvents || {})
    .reduce((total, events) => total + Number(events && events[eventName] || 0), 0);
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runAdminClient(port, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "admin-client.js"), ...args], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        ZEROLAG_ADMIN_API_BASE_URL: `http://127.0.0.1:${port}`,
        ZEROLAG_ADMIN_SECRET: options.adminSecret || "self-test-admin",
        ZEROLAG_PAYMENT_WEBHOOK_SECRET: options.paymentWebhookSecret || "self-test-payment"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function runNodeScript(relativePath, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "..", relativePath), ...args], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        ...(options.env || {})
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function cloneJson(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function createMemoryStateStore(initialState = null) {
  let current = cloneJson(initialState);

  return {
    kind: "memory-test",
    loadState() {
      return cloneJson(current);
    },
    saveState(state) {
      current = cloneJson(state);
    },
    listBackups() {
      return [];
    }
  };
}

function runtimeSessionProofBodyFromResponse(body, deviceHash) {
  return JSON.stringify({
    subscriptionId: body.subscriptionId || "",
    deviceHash,
    expiresAt: body.expiresAt || "",
    sessionId: body.sessionId || "",
    keyVersion: body.runtimeSessionKeyVersion || "runtime-session-v1",
    revision: Number(body.runtimeSessionRevision || 0)
  });
}

function verifyRsaRuntimeSessionProof(body, deviceHash, publicKeyPem) {
  const proof = String(body.runtimeSessionProof || "");
  const signature = proof.startsWith("rsa-sha256=") ? proof.slice("rsa-sha256=".length) : "";
  if (!signature) return false;

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(runtimeSessionProofBodyFromResponse(body, deviceHash));
  verifier.end();
  return verifier.verify(publicKeyPem, Buffer.from(signature, "base64url"));
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-server-test-"));
  const options = {
    statePath: path.join(tempDir, "server-state.json"),
    serverSecret: "self-test-secret",
    adminSecret: "self-test-admin",
    paymentWebhookSecret: "self-test-payment"
  };
  const code = "ZL-PRO-SELF-TEST";
  const adminCode = "ZL-PRO-ADMIN-TEST";
  const revokeCode = "ZL-PRO-REVOKE-TEST";
  const cleanupCode = "ZL-PRO-CLEANUP-TEST";
  const deviceHash = crypto.createHash("sha256").update("device-a").digest("hex");
  const otherDeviceHash = crypto.createHash("sha256").update("device-b").digest("hex");
  const revokeDeviceHash = crypto.createHash("sha256").update("device-c").digest("hex");
  const cleanupDeviceHash = crypto.createHash("sha256").update("device-d").digest("hex");

  addActivationCode(code, { durationDays: 30, maxUses: 1 }, options);
  const server = createAppServer(options);
  const port = await listen(server);

  try {
    const health = await requestJson(port, "/health");
    assert(health.statusCode === 200 && health.body.ok, "Health check failed.");

    const versionedHealth = await requestJson(port, "/v1/health");
    assert(versionedHealth.statusCode === 200 && versionedHealth.body.ok, "Versioned health check failed.");

    const deniedReadiness = await requestJson(port, "/v1/admin/readiness");
    assert(deniedReadiness.statusCode === 401, "Readiness endpoint should require admin secret.");

    const readiness = await requestJson(port, "/v1/admin/readiness", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(readiness.statusCode === 200 && readiness.body.ok, "Readiness endpoint failed.");
    assert(readiness.body.state.summary.activationCodes.total >= 1, "Readiness should include state summary.");
    assert(readiness.body.secrets.adminSecret === "custom", "Readiness should report custom admin secret.");
    assert(readiness.body.maintenance.enabled === true, "Readiness should include maintenance status.");
    assert(readiness.body.payment.provider === "manual", "Readiness should include payment provider status.");
    assert(readiness.body.runtimeSession.keyVersion === "runtime-session-v1", "Readiness should include runtime session key version.");
    assert(readiness.body.runtimeSession.proofAlgorithm === "HMAC-SHA256", "Readiness should include runtime session proof algorithm.");
    assert(readiness.body.runtimeSession.asymmetricProofConfigured === false, "Readiness should report whether asymmetric runtime proof is configured.");
    assert(readiness.body.storage.kind === "json-file", "Readiness should report default JSON file storage.");
    assert(
      readiness.body.warnings.includes("PAYMENT_PROVIDER_MANUAL"),
      "Readiness should warn when payment provider is still manual."
    );

    const memoryCode = "ZL-PRO-MEMORY-TEST";
    const memoryStore = createMemoryStateStore();
    const memoryOptions = {
      stateStore: memoryStore,
      serverSecret: "memory-store-secret",
      adminSecret: "memory-store-admin",
      paymentWebhookSecret: "memory-store-payment"
    };
    addActivationCode(memoryCode, { durationDays: 30, maxUses: 1 }, memoryOptions);
    const memoryState = loadState(memoryOptions);
    assert(Object.keys(memoryState.activationCodes).length === 1, "Custom state store should load saved state.");
    memoryState.version = 1;
    saveState(memoryState, memoryOptions);
    const memoryServer = createAppServer(memoryOptions);
    const memoryPort = await listen(memoryServer);
    try {
      const memoryReadiness = await requestJson(memoryPort, "/v1/admin/readiness", null, {
        "X-ZeroLag-Admin-Secret": "memory-store-admin"
      });
      assert(memoryReadiness.statusCode === 200, "Custom state store readiness failed.");
      assert(memoryReadiness.body.storage.kind === "memory-test", "Readiness should report custom state store kind.");
      const memoryActivated = await requestJson(memoryPort, "/v1/licenses/activate", {
        activationCode: memoryCode,
        deviceHash,
        appVersion: "0.1.0",
        channel: "memory-store"
      });
      assert(memoryActivated.statusCode === 200 && memoryActivated.body.active, "Custom state store activation failed.");
    } finally {
      await new Promise((resolve) => {
        memoryServer.close(resolve);
      });
    }

    const rsaCode = "ZL-PRO-RSA-TEST";
    const rsaDeviceHash = crypto.createHash("sha256").update("device-rsa").digest("hex");
    const rsaKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaPrivateKeyPem = rsaKeys.privateKey.export({ type: "pkcs8", format: "pem" });
    const rsaPublicKeyPem = rsaKeys.publicKey.export({ type: "spki", format: "pem" });
    const rsaOptions = {
      stateStore: createMemoryStateStore(),
      serverSecret: "rsa-store-secret",
      adminSecret: "rsa-store-admin",
      paymentWebhookSecret: "rsa-store-payment",
      runtimeSession: {
        proofAlgorithm: "RSA-SHA256",
        privateKeyPem: rsaPrivateKeyPem
      }
    };
    addActivationCode(rsaCode, { durationDays: 30, maxUses: 1 }, rsaOptions);
    const rsaServer = createAppServer(rsaOptions);
    const rsaPort = await listen(rsaServer);
    try {
      const rsaReadiness = await requestJson(rsaPort, "/v1/admin/readiness", null, {
        "X-ZeroLag-Admin-Secret": "rsa-store-admin"
      });
      assert(rsaReadiness.statusCode === 200, "RSA runtime proof readiness failed.");
      assert(rsaReadiness.body.runtimeSession.proofAlgorithm === "RSA-SHA256", "Readiness should report RSA runtime proof algorithm.");
      assert(rsaReadiness.body.runtimeSession.asymmetricProofConfigured === true, "Readiness should report configured RSA runtime proof key.");
      const rsaActivated = await requestJson(rsaPort, "/v1/licenses/activate", {
        activationCode: rsaCode,
        deviceHash: rsaDeviceHash,
        appVersion: "0.1.0",
        channel: "rsa-store"
      });
      assert(rsaActivated.statusCode === 200 && rsaActivated.body.active, "RSA runtime proof activation failed.");
      assert(rsaActivated.body.runtimeSessionProofAlgorithm === "RSA-SHA256", "Activation should return RSA runtime proof algorithm.");
      assert(/^rsa-sha256=[A-Za-z0-9_-]+$/i.test(rsaActivated.body.runtimeSessionProof || ""), "Activation should return an RSA runtime session proof.");
      assert(verifyRsaRuntimeSessionProof(rsaActivated.body, rsaDeviceHash, rsaPublicKeyPem), "RSA runtime session proof should verify with the public key.");
    } finally {
      await new Promise((resolve) => {
        rsaServer.close(resolve);
      });
    }

    const sqliteTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-sqlite-store-test-"));
    const sqliteStore = createSqliteStateStore(path.join(sqliteTempDir, "server-state.sqlite"));
    const sqliteCode = "ZL-PRO-SQLITE-TEST";
    const sqliteOptions = {
      stateStore: sqliteStore,
      serverSecret: "sqlite-store-secret",
      adminSecret: "sqlite-store-admin",
      paymentWebhookSecret: "sqlite-store-payment"
    };
    try {
      addActivationCode(sqliteCode, { durationDays: 30, maxUses: 1 }, sqliteOptions);
      const sqliteState = loadState(sqliteOptions);
      assert(Object.keys(sqliteState.activationCodes).length === 1, "SQLite state store should load saved state.");
      const sqliteServer = createAppServer(sqliteOptions);
      const sqlitePort = await listen(sqliteServer);
      try {
        const sqliteReadiness = await requestJson(sqlitePort, "/v1/admin/readiness", null, {
          "X-ZeroLag-Admin-Secret": "sqlite-store-admin"
        });
        assert(sqliteReadiness.statusCode === 200, "SQLite state store readiness failed.");
        assert(sqliteReadiness.body.storage.kind === "sqlite", "Readiness should report SQLite state store kind.");
        const sqliteActivated = await requestJson(sqlitePort, "/v1/licenses/activate", {
          activationCode: sqliteCode,
          deviceHash,
          appVersion: "0.1.0",
          channel: "sqlite-store"
        });
        assert(sqliteActivated.statusCode === 200 && sqliteActivated.body.active, "SQLite state store activation failed.");
      } finally {
        await new Promise((resolve) => {
          sqliteServer.close(resolve);
        });
      }
    } finally {
      sqliteStore.close();
      fs.rmSync(sqliteTempDir, { recursive: true, force: true });
    }

    const envTemplate = await runNodeScript("scripts/generate-server-secrets.js");
    assert(envTemplate.status === 0, `Server env template command failed: ${envTemplate.stderr || envTemplate.stdout}`);
    assert(envTemplate.stdout.includes("# Profile: json"), "Default server env template should use the JSON profile.");
    assert(envTemplate.stdout.includes("ZEROLAG_RUNTIME_SESSION_KEY_VERSION=runtime-session-v1"), "Server env template should include runtime session key version.");
    assert(envTemplate.stdout.includes("ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM=HMAC-SHA256"), "Server env template should include runtime session proof algorithm.");
    assert(envTemplate.stdout.includes("ZEROLAG_PAYMENT_ALLOWED_PROVIDERS=manual,manual-admin"), "Server env template should use a safer payment allowlist.");
    assert(envTemplate.stdout.includes("# ZEROLAG_WECHAT_PAY_MCH_ID="), "Server env template should document WeChat Pay merchant fields.");
    assert(envTemplate.stdout.includes("# ZEROLAG_ALIPAY_APP_ID="), "Server env template should document Alipay merchant fields.");
    assert(envTemplate.stdout.includes("# ZEROLAG_STATE_STORE=sqlite"), "Default server env template should document SQLite opt-in.");
    const sqliteEnvPath = path.join(tempDir, "sqlite-server.env");
    const sqliteEnvTemplate = await runNodeScript("scripts/generate-server-secrets.js", [
      "--profile",
      "sqlite",
      "--write",
      sqliteEnvPath
    ]);
    assert(sqliteEnvTemplate.status === 0, `SQLite server env template write failed: ${sqliteEnvTemplate.stderr || sqliteEnvTemplate.stdout}`);
    const sqliteEnvFile = fs.readFileSync(sqliteEnvPath, "utf8");
    assert(sqliteEnvFile.includes("# Profile: sqlite"), "SQLite server env template should record its profile.");
    assert(sqliteEnvFile.includes("ZEROLAG_STATE_STORE=sqlite"), "SQLite server env template should activate SQLite storage.");
    assert(sqliteEnvFile.includes("ZEROLAG_RUNTIME_SESSION_KEY_VERSION=runtime-session-v1"), "SQLite server env template should include runtime session key version.");
    assert(sqliteEnvFile.includes("ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM=HMAC-SHA256"), "SQLite server env template should include runtime session proof algorithm.");
    assert(sqliteEnvFile.includes("ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS=24"), "SQLite server env template should include backup freshness settings.");
    const sqliteEnvCheck = await runNodeScript("scripts/check-server-env.js", [
      "--file",
      sqliteEnvPath,
      "--profile",
      "sqlite"
    ]);
    assert(sqliteEnvCheck.status === 0, `SQLite server env check should pass: ${sqliteEnvCheck.stderr || sqliteEnvCheck.stdout}`);
    const sqliteEnvCheckBody = JSON.parse(sqliteEnvCheck.stdout);
    assert(sqliteEnvCheckBody.ok === true, "SQLite server env check should return ok.");
    assert(sqliteEnvCheckBody.summary.stateStore === "sqlite", "SQLite server env check should report sqlite storage.");
    assert(sqliteEnvCheckBody.summary.runtimeSessionKeyVersion === "runtime-session-v1", "SQLite server env check should report runtime session key version.");
    assert(sqliteEnvCheckBody.summary.runtimeSessionProofAlgorithm === "HMAC-SHA256", "SQLite server env check should report runtime session proof algorithm.");
    assert(sqliteEnvCheckBody.summary.runtimeSessionAsymmetricProofConfigured === false, "SQLite server env check should report asymmetric runtime proof status.");
    assert(sqliteEnvCheckBody.summary.paymentProviderCredentialsConfigured === true, "SQLite server env check should report payment credential readiness for manual mode.");
    assert(!sqliteEnvCheck.stdout.includes("zl_server_"), "Server env check must not print generated secret values.");
    const deploymentReportPath = path.join(tempDir, "server-deployment-report.md");
    const deploymentReport = await runNodeScript("scripts/generate-server-deployment-report.js", [
      "--output",
      deploymentReportPath
    ], {
      env: {
        ZEROLAG_ENV_FILE: sqliteEnvPath
      }
    });
    assert(deploymentReport.status === 0, `Server deployment report command failed: ${deploymentReport.stderr || deploymentReport.stdout}`);
    assert(fs.existsSync(deploymentReportPath), "Server deployment report should write a Markdown file.");
    const deploymentReportBody = fs.readFileSync(deploymentReportPath, "utf8");
    assert(deploymentReportBody.includes("ZeroLag Server Deployment Report"), "Server deployment report should include its title.");
    assert(deploymentReportBody.includes("State store from env: `sqlite`"), "Server deployment report should summarize env storage.");
    assert(deploymentReportBody.includes("Payment provider from env:"), "Server deployment report should summarize payment readiness.");
    assert(deploymentReportBody.includes("Runtime session key version: `runtime-session-v1`"), "Server deployment report should summarize runtime session key version.");
    assert(deploymentReportBody.includes("Runtime session proof algorithm: `HMAC-SHA256`"), "Server deployment report should summarize runtime session proof algorithm.");
    assert(deploymentReportBody.includes("Runtime session asymmetric proof configured: `no`"), "Server deployment report should summarize asymmetric runtime proof status.");
    assert(!deploymentReportBody.includes("zl_server_"), "Server deployment report must not expose generated secret values.");
    const deploymentReportJson = await runNodeScript("scripts/generate-server-deployment-report.js", [
      "--json",
      "--stdout"
    ], {
      env: {
        ZEROLAG_ENV_FILE: sqliteEnvPath
      }
    });
    assert(deploymentReportJson.status === 0, `Server deployment JSON report command failed: ${deploymentReportJson.stderr || deploymentReportJson.stdout}`);
    const deploymentReportJsonBody = JSON.parse(deploymentReportJson.stdout);
    assert(deploymentReportJsonBody.ready === false, "Server deployment JSON report should expose the readiness boolean.");
    assert(deploymentReportJsonBody.snapshot.privateEnvFile.loaded === true, "Server deployment JSON report should show the private env file loaded.");
    assert(deploymentReportJsonBody.storage.stateStore === "sqlite", "Server deployment JSON report should summarize storage.");
    assert(deploymentReportJsonBody.runtimeGuards.runtimeSessionKeyVersion === "runtime-session-v1", "Server deployment JSON report should summarize runtime session key version.");
    assert(deploymentReportJsonBody.runtimeGuards.runtimeSessionProofAlgorithm === "HMAC-SHA256", "Server deployment JSON report should summarize runtime session proof algorithm.");
    assert(deploymentReportJsonBody.runtimeGuards.runtimeSessionAsymmetricProofConfigured === false, "Server deployment JSON report should summarize asymmetric runtime proof status.");
    assert(Array.isArray(deploymentReportJsonBody.gates) && deploymentReportJsonBody.gates.length >= 1, "Server deployment JSON report should include gate results.");
    assert(!deploymentReportJson.stdout.includes("zl_server_"), "Server deployment JSON report must not expose generated secret values.");
    const strictDeploymentReportPath = path.join(tempDir, "server-deployment-report-strict.md");
    const strictDeploymentReport = await runNodeScript("scripts/generate-server-deployment-report.js", [
      "--strict",
      "--output",
      strictDeploymentReportPath
    ], {
      env: {
        ZEROLAG_ENV_FILE: sqliteEnvPath
      }
    });
    assert(strictDeploymentReport.status === 1, "Strict server deployment report should fail while production URLs are not configured.");
    assert(fs.existsSync(strictDeploymentReportPath), "Strict server deployment report should still write a Markdown file.");
    assert(strictDeploymentReport.stderr.includes("strict gate failed"), "Strict server deployment report should explain that a gate failed.");
    assert(!fs.readFileSync(strictDeploymentReportPath, "utf8").includes("zl_server_"), "Strict server deployment report must not expose generated secret values.");
    const refusedEnvOverwrite = await runNodeScript("scripts/generate-server-secrets.js", [
      "--write",
      sqliteEnvPath
    ]);
    assert(refusedEnvOverwrite.status === 1, "Server env template write should refuse to overwrite without --force.");
    const badEnvPath = path.join(tempDir, "bad-server.env");
    fs.writeFileSync(badEnvPath, [
      "ZEROLAG_SERVER_SECRET=dev",
      "ZEROLAG_ADMIN_SECRET=dev",
      "ZEROLAG_PAYMENT_WEBHOOK_SECRET=dev",
      "ZEROLAG_SERVER_PORT=not-a-port",
      "ZEROLAG_STATE_STORE=sqlite",
      "ZEROLAG_RATE_LIMIT_DISABLED=1"
    ].join("\n"), "utf8");
    const badEnvCheck = await runNodeScript("scripts/check-server-env.js", [
      "--file",
      badEnvPath,
      "--profile",
      "sqlite"
    ]);
    assert(badEnvCheck.status === 1, "Server env check should fail for missing keys, weak secrets, and unsafe switches.");
    const badEnvCheckBody = JSON.parse(badEnvCheck.stdout);
    assert(badEnvCheckBody.issues.length >= 1, "Bad server env check should report issues.");

    const migrationTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-sqlite-migration-test-"));
    try {
      const migrationJsonPath = path.join(migrationTempDir, "source-state.json");
      const migrationSqlitePath = path.join(migrationTempDir, "target-state.sqlite");
      const migrationBackupDir = path.join(migrationTempDir, "sqlite-backups");
      fs.copyFileSync(options.statePath, migrationJsonPath);
      const migration = await runNodeScript("scripts/migrate-state-to-sqlite.js", [
        "--input",
        migrationJsonPath,
        "--output",
        migrationSqlitePath
      ]);
      assert(migration.status === 0, `SQLite migration command failed: ${migration.stderr || migration.stdout}`);
      const migrationBody = JSON.parse(migration.stdout);
      assert(migrationBody.ok === true, "SQLite migration command should return ok.");
      assert(fs.existsSync(migrationSqlitePath), "SQLite migration command should create the output file.");
      const migratedStore = createSqliteStateStore(migrationSqlitePath);
      try {
        const migratedState = migratedStore.loadState();
        assert(Object.keys(migratedState.activationCodes || {}).length >= 1, "Migrated SQLite state should include activation codes.");
      } finally {
        migratedStore.close();
      }
      const refusedOverwrite = await runNodeScript("scripts/migrate-state-to-sqlite.js", [
        "--input",
        migrationJsonPath,
        "--output",
        migrationSqlitePath
      ]);
      assert(refusedOverwrite.status === 1, "SQLite migration should refuse to overwrite existing output without --force.");
      const backupSqlitePath = path.join(migrationBackupDir, "backup-state.sqlite");
      const backup = await runNodeScript("scripts/backup-sqlite-state.js", [
        "--input",
        migrationSqlitePath,
        "--output",
        backupSqlitePath
      ]);
      assert(backup.status === 0, `SQLite backup command failed: ${backup.stderr || backup.stdout}`);
      const backupBody = JSON.parse(backup.stdout);
      assert(backupBody.ok === true, "SQLite backup command should return ok.");
      assert(fs.existsSync(backupSqlitePath), "SQLite backup command should create the output file.");
      const backupStore = createSqliteStateStore(backupSqlitePath);
      try {
        const backupState = backupStore.loadState();
        assert(Object.keys(backupState.activationCodes || {}).length >= 1, "Backed-up SQLite state should include activation codes.");
      } finally {
        backupStore.close();
      }
      const refusedBackupOverwrite = await runNodeScript("scripts/backup-sqlite-state.js", [
        "--input",
        migrationSqlitePath,
        "--output",
        backupSqlitePath
      ]);
      assert(refusedBackupOverwrite.status === 1, "SQLite backup should refuse to overwrite existing output without --force.");
      const backupCheck = await runNodeScript("scripts/check-sqlite-backups.js", [
        "--dir",
        migrationBackupDir,
        "--min-count",
        "1",
        "--max-age-hours",
        "1"
      ]);
      assert(backupCheck.status === 0, `SQLite backup check command failed: ${backupCheck.stderr || backupCheck.stdout}`);
      const backupCheckBody = JSON.parse(backupCheck.stdout);
      assert(backupCheckBody.ok === true, "SQLite backup check should return ok.");
      assert(backupCheckBody.latest.fileName === "backup-state.sqlite", "SQLite backup check should inspect the newest backup.");
      assert(backupCheckBody.checks[0].summary.activationCodes >= 1, "SQLite backup check should include safe summary counts.");
      const corruptBackupPath = path.join(migrationBackupDir, "corrupt-state.sqlite");
      fs.writeFileSync(corruptBackupPath, "not a sqlite database", "utf8");
      const corruptBackupCheck = await runNodeScript("scripts/check-sqlite-backups.js", [
        "--dir",
        migrationBackupDir,
        "--all"
      ]);
      assert(corruptBackupCheck.status === 1, "SQLite backup check should fail when any checked backup is corrupt.");
      assert(corruptBackupCheck.stdout.includes("corrupt-state.sqlite"), "SQLite backup check should identify the corrupt backup file.");
      fs.unlinkSync(corruptBackupPath);
      const restoredSqlitePath = path.join(migrationTempDir, "restored-state.sqlite");
      const restore = await runNodeScript("scripts/restore-sqlite-state.js", [
        "--input",
        backupSqlitePath,
        "--output",
        restoredSqlitePath
      ]);
      assert(restore.status === 0, `SQLite restore command failed: ${restore.stderr || restore.stdout}`);
      const restoreBody = JSON.parse(restore.stdout);
      assert(restoreBody.ok === true, "SQLite restore command should return ok.");
      assert(fs.existsSync(restoredSqlitePath), "SQLite restore command should create the output file.");
      const restoredStore = createSqliteStateStore(restoredSqlitePath);
      try {
        const restoredState = restoredStore.loadState();
        assert(Object.keys(restoredState.activationCodes || {}).length >= 1, "Restored SQLite state should include activation codes.");
      } finally {
        restoredStore.close();
      }
      const refusedRestoreOverwrite = await runNodeScript("scripts/restore-sqlite-state.js", [
        "--input",
        backupSqlitePath,
        "--output",
        restoredSqlitePath
      ]);
      assert(refusedRestoreOverwrite.status === 1, "SQLite restore should refuse to overwrite existing output without --force.");
      const sqliteCheckEnv = {
        ZEROLAG_SERVER_SECRET: "self-test-server-secret-12345678901234567890",
        ZEROLAG_ADMIN_SECRET: "self-test-admin-secret-123456789012345678901",
        ZEROLAG_PAYMENT_WEBHOOK_SECRET: "self-test-payment-secret-12345678901234567",
        ZEROLAG_RUNTIME_SESSION_KEY_VERSION: "runtime-session-v1",
        ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM: "RSA-SHA256",
        ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64: Buffer.from(rsaPrivateKeyPem).toString("base64"),
        ZEROLAG_SERVER_HOST: "0.0.0.0",
        ZEROLAG_SERVER_PORT: "8787",
        ZEROLAG_SERVER_STATE_PATH: migrationJsonPath,
        ZEROLAG_SERVER_BACKUP_DIR: migrationTempDir,
        ZEROLAG_STATE_STORE: "sqlite",
        ZEROLAG_SQLITE_STATE_PATH: restoredSqlitePath,
        ZEROLAG_SQLITE_BACKUP_DIR: migrationBackupDir,
        ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS: "1",
        ZEROLAG_PAYMENT_PROVIDER: "wechat_pay",
        ZEROLAG_PAYMENT_ALLOWED_PROVIDERS: "wechat_pay",
        ZEROLAG_PAYMENT_URL_TEMPLATE: "https://pay.zerolag.test/checkout/{orderId}",
        ZEROLAG_PAYMENT_MESSAGE: "Open the secure checkout page to finish payment.",
        ZEROLAG_WECHAT_PAY_MCH_ID: "1900000001",
        ZEROLAG_WECHAT_PAY_APP_ID: "wx0000000000000001",
        ZEROLAG_WECHAT_PAY_API_V3_KEY: "self_test_wechat_api_v3_key_32_chars",
        ZEROLAG_WECHAT_PAY_SERIAL_NO: "SELFTESTWECHATSERIAL001",
        ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH: "private-wechat-key.pem",
        ZEROLAG_RATE_LIMIT_DISABLED: "0",
        ZEROLAG_SERVER_BACKUP_DISABLED: "0",
        ZEROLAG_MAINTENANCE_DISABLED: "0"
      };
      const sqliteCheckEnvPath = path.join(migrationTempDir, "sqlite-check.env");
      fs.writeFileSync(
        sqliteCheckEnvPath,
        `${Object.entries(sqliteCheckEnv).map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
        "utf8"
      );
      sqliteCheckEnv.ZEROLAG_ENV_FILE = sqliteCheckEnvPath;
      const sqliteProductionCheck = await runNodeScript("scripts/server-production-check.js", ["--strict"], {
        env: sqliteCheckEnv
      });
      assert(sqliteProductionCheck.status === 0, `SQLite production check should pass: ${sqliteProductionCheck.stderr || sqliteProductionCheck.stdout}`);
      assert(sqliteProductionCheck.stdout.includes("Env file summary: stateStore=sqlite"), "SQLite production check should include the private env file summary.");
      assert(sqliteProductionCheck.stdout.includes("SQLite summary: activationCodes="), "SQLite production check should print a safe state summary.");
      assert(sqliteProductionCheck.stdout.includes("SQLite latest backup: backup-state.sqlite"), "SQLite production check should include the latest backup file.");
      assert(sqliteProductionCheck.stdout.includes("SQLite latest backup summary: activationCodes="), "SQLite production check should print a safe latest-backup summary.");
      const missingSqliteBackupDir = path.join(migrationTempDir, "missing-sqlite-backups");
      const missingSqliteBackupCheck = await runNodeScript("scripts/server-production-check.js", ["--strict"], {
        env: {
          ...sqliteCheckEnv,
          ZEROLAG_SQLITE_BACKUP_DIR: missingSqliteBackupDir
        }
      });
      assert(missingSqliteBackupCheck.status === 1, "SQLite production check should fail when the SQLite backup directory is missing.");
      assert(missingSqliteBackupCheck.stdout.includes("SQLite backup directory does not exist"), "Missing SQLite backup check should explain the blocking warning.");
      const missingSqlitePath = path.join(migrationTempDir, "missing-state.sqlite");
      const missingSqliteProductionCheck = await runNodeScript("scripts/server-production-check.js", ["--strict"], {
        env: {
          ...sqliteCheckEnv,
          ZEROLAG_SQLITE_STATE_PATH: missingSqlitePath
        }
      });
      assert(missingSqliteProductionCheck.status === 1, "SQLite production check should fail when the SQLite state file is missing.");
      assert(missingSqliteProductionCheck.stdout.includes("SQLite state file does not exist"), "Missing SQLite check should explain the blocking issue.");
      assert(!fs.existsSync(missingSqlitePath), "SQLite production check must not create a missing SQLite file.");
      const smokeExternalSqlitePath = path.join(migrationTempDir, "smoke-should-not-touch.sqlite");
      const isolatedSqliteSmoke = await runNodeScript("scripts/server-smoke-test.js", [], {
        env: {
          ...sqliteCheckEnv,
          ZEROLAG_SQLITE_STATE_PATH: smokeExternalSqlitePath
        }
      });
      assert(isolatedSqliteSmoke.status === 0, `Isolated SQLite smoke test should pass: ${isolatedSqliteSmoke.stderr || isolatedSqliteSmoke.stdout}`);
      assert(isolatedSqliteSmoke.stdout.includes("Mode: isolated-sqlite"), "SQLite smoke test should use an isolated temporary SQLite state by default.");
      assert(!fs.existsSync(smokeExternalSqlitePath), "Default SQLite smoke test must not create or mutate the configured live SQLite path.");
    } finally {
      fs.rmSync(migrationTempDir, { recursive: true, force: true });
    }

    const websitePreflight = await requestOptions(port, "/v1/website/events", {
      Origin: "https://zerolag.app",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    });
    assert(websitePreflight.statusCode === 204, "Website analytics preflight should be accepted.");
    assert(websitePreflight.headers["access-control-allow-origin"] === "*", "Website analytics preflight should allow public website origins.");
    assert(
      String(websitePreflight.headers["access-control-allow-methods"] || "").includes("POST"),
      "Website analytics preflight should allow POST."
    );
    assert(
      String(websitePreflight.headers["access-control-allow-headers"] || "").includes("content-type"),
      "Website analytics preflight should allow content-type."
    );

    const websiteReleaseView = await requestJson(port, "/v1/website/events", {
      product: "ZeroLag",
      event: "release_view",
      detail: {
        version: "0.1.0",
        channel: "alpha",
        status: "available"
      }
    });
    assert(websiteReleaseView.statusCode === 202 && websiteReleaseView.body.accepted, "Website release view event should be accepted.");

    const websiteDownloadEvent = await requestJson(port, "/v1/website/events", {
      product: "ZeroLag",
      event: "download_click",
      detail: {
        version: "0.1.0",
        channel: "alpha",
        status: "available",
        target: "downloadPrimary"
      }
    });
    assert(websiteDownloadEvent.statusCode === 202 && websiteDownloadEvent.body.accepted, "Website download event should be accepted.");
    assert(websiteDownloadEvent.headers["access-control-allow-origin"] === "*", "Website analytics POST should include CORS headers.");

    const websitePurchaseEvent = await requestJson(port, "/v1/website/events", {
      product: "ZeroLag",
      event: "purchase_click",
      detail: {
        version: "0.1.0",
        channel: "alpha",
        status: "available",
        target: "pricingPurchase"
      }
    });
    assert(websitePurchaseEvent.statusCode === 202 && websitePurchaseEvent.body.total === 3, "Website purchase event should update aggregate total.");

    const rejectedWebsiteEvent = await requestJson(port, "/v1/website/events", {
      product: "ZeroLag",
      event: "not_allowed",
      detail: {
        version: "0.1.0"
      }
    });
    assert(rejectedWebsiteEvent.statusCode === 400, "Unknown website events should be rejected.");

    const websiteSummary = await requestJson(port, "/v1/admin/summary", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(websiteSummary.statusCode === 200, "Admin summary with website events failed.");
    assert(websiteSummary.body.summary.websiteEvents.total === 3, "Admin summary should expose website event total.");
    assert(websiteSummary.body.summary.websiteEvents.events.release_view === 1, "Admin summary should aggregate release views.");
    assert(websiteSummary.body.summary.websiteEvents.events.download_click === 1, "Admin summary should aggregate download clicks.");
    assert(websiteSummary.body.summary.websiteEvents.events.purchase_click === 1, "Admin summary should aggregate purchase clicks.");
    assert(websiteSummary.body.summary.websiteEvents.versions["0.1.0"] === 3, "Admin summary should aggregate website event versions.");
    assert(websiteSummary.body.summary.websiteEvents.statuses.available === 3, "Admin summary should aggregate website event release status.");
    assert(
      nestedWebsiteEventCount(websiteSummary.body.summary.websiteEvents.dailyEvents, "release_view") === 1,
      "Admin summary should expose daily release views."
    );
    assert(
      nestedWebsiteEventCount(websiteSummary.body.summary.websiteEvents.dailyEvents, "download_click") === 1,
      "Admin summary should expose daily download clicks."
    );
    assert(
      nestedWebsiteEventCount(websiteSummary.body.summary.websiteEvents.dailyEvents, "purchase_click") === 1,
      "Admin summary should expose daily purchase clicks."
    );
    assert(
      !JSON.stringify(loadState(options).websiteEvents).includes("downloadPrimary"),
      "Website analytics state must not store raw CTA targets."
    );
    const adminAnalytics = await runAdminClient(port, ["analytics"]);
    assert(adminAnalytics.status === 0, `Admin analytics command failed: ${adminAnalytics.stderr || adminAnalytics.stdout}`);
    const adminAnalyticsBody = JSON.parse(adminAnalytics.stdout);
    assert(adminAnalyticsBody.websiteEvents.total === 3, "Admin analytics command should expose website event total.");
    assert(adminAnalyticsBody.websiteEvents.events.release_view === 1, "Admin analytics command should expose release views.");
    assert(adminAnalyticsBody.websiteEvents.events.download_click === 1, "Admin analytics command should expose download clicks.");
    assert(adminAnalyticsBody.websiteEvents.events.purchase_click === 1, "Admin analytics command should expose purchase clicks.");
    assert(
      nestedWebsiteEventCount(adminAnalyticsBody.websiteEvents.dailyEvents, "download_click") === 1,
      "Admin analytics command should expose daily download clicks."
    );
    const adminAnalyticsFunnel = await runAdminClient(port, ["analytics-funnel"]);
    assert(adminAnalyticsFunnel.status === 0, `Admin analytics funnel command failed: ${adminAnalyticsFunnel.stderr || adminAnalyticsFunnel.stdout}`);
    const adminAnalyticsFunnelBody = JSON.parse(adminAnalyticsFunnel.stdout);
    assert(adminAnalyticsFunnelBody.funnel.releaseViews === 1, "Admin analytics funnel should expose release views.");
    assert(adminAnalyticsFunnelBody.funnel.downloads === 1, "Admin analytics funnel should expose downloads.");
    assert(adminAnalyticsFunnelBody.funnel.purchases === 1, "Admin analytics funnel should expose purchases.");
    assert(adminAnalyticsFunnelBody.funnel.downloadRatePct === 100, "Admin analytics funnel should calculate download rate.");
    assert(adminAnalyticsFunnelBody.funnel.purchasePerDownloadPct === 100, "Admin analytics funnel should calculate purchase per download rate.");
    assert(adminAnalyticsFunnelBody.latestDay.date, "Admin analytics funnel should expose a latest day.");
    assert(adminAnalyticsFunnelBody.latestDay.funnel.downloads === 1, "Admin analytics funnel should expose latest-day downloads.");
    const analyticsCsvPath = path.join(tempDir, "website-analytics.csv");
    const adminAnalyticsCsv = await runAdminClient(port, ["analytics-csv", analyticsCsvPath]);
    assert(adminAnalyticsCsv.status === 0, `Admin analytics CSV command failed: ${adminAnalyticsCsv.stderr || adminAnalyticsCsv.stdout}`);
    assert(fs.existsSync(analyticsCsvPath), "Admin analytics CSV command should write a CSV file.");
    const analyticsCsv = fs.readFileSync(analyticsCsvPath, "utf8");
    assert(analyticsCsv.startsWith("metric,key,count,updatedAt\n"), "Admin analytics CSV should include a stable header.");
    assert(analyticsCsv.includes("event,download_click,1,"), "Admin analytics CSV should include download clicks.");
    assert(analyticsCsv.includes("event,purchase_click,1,"), "Admin analytics CSV should include purchase clicks.");
    assert(analyticsCsv.includes("day_event,"), "Admin analytics CSV should include daily event rows.");
    assert(analyticsCsv.includes(":download_click,1,"), "Admin analytics CSV should include daily download clicks.");
    const analyticsReportPath = path.join(tempDir, "website-analytics.html");
    const adminAnalyticsReport = await runAdminClient(port, ["analytics-report", analyticsReportPath]);
    assert(adminAnalyticsReport.status === 0, `Admin analytics report command failed: ${adminAnalyticsReport.stderr || adminAnalyticsReport.stdout}`);
    assert(fs.existsSync(analyticsReportPath), "Admin analytics report command should write an HTML file.");
    const analyticsReport = fs.readFileSync(analyticsReportPath, "utf8");
    assert(analyticsReport.includes("ZeroLag Website Analytics Report"), "Admin analytics report should include a stable title.");
    assert(analyticsReport.includes("Daily trend"), "Admin analytics report should include daily trend output.");
    assert(analyticsReport.includes("Download clicks"), "Admin analytics report should include download clicks.");
    assert(!analyticsReport.includes("downloadPrimary"), "Admin analytics report must not expose raw CTA targets.");

    for (let index = 0; index < 80; index += 1) {
      const noisyWebsiteEvent = await requestJson(port, "/v1/website/events", {
        product: "ZeroLag",
        event: "cta_click",
        detail: {
          version: `noise-version-${index}`,
          channel: `noise-channel-${index}`,
          status: `noise-status-${index}`
        }
      });
      assert(noisyWebsiteEvent.statusCode === 202, "Noisy website event should still be accepted.");
    }

    const cappedWebsiteSummary = await requestJson(port, "/v1/admin/summary", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(cappedWebsiteSummary.body.summary.websiteEvents.total === 83, "Website analytics should keep total event count.");
    assert(Object.keys(cappedWebsiteSummary.body.summary.websiteEvents.versions).length <= 64, "Website analytics versions must stay capped.");
    assert(Object.keys(cappedWebsiteSummary.body.summary.websiteEvents.channels).length <= 64, "Website analytics channels must stay capped.");
    assert(Object.keys(cappedWebsiteSummary.body.summary.websiteEvents.statuses).length <= 64, "Website analytics statuses must stay capped.");
    assert(Object.keys(cappedWebsiteSummary.body.summary.websiteEvents.dailyEvents).length <= 90, "Website analytics daily event buckets must stay capped.");
    assert(
      nestedWebsiteEventCount(cappedWebsiteSummary.body.summary.websiteEvents.dailyEvents, "cta_click") === 80,
      "Website analytics should keep daily CTA event totals."
    );

    const paymentTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-payment-config-test-"));
    const paymentOptions = {
      statePath: path.join(paymentTempDir, "server-state.json"),
      serverSecret: "payment-config-secret",
      adminSecret: "payment-config-admin",
      paymentWebhookSecret: "payment-config-webhook",
      payment: {
        provider: "wechat_pay",
        allowedProviders: ["wechat_pay"],
        urlTemplate: "https://pay.example/checkout/{orderId}?amount={amountCents}&currency={currency}",
        message: "Open the configured checkout provider."
      }
    };
    const paymentServer = createAppServer(paymentOptions);
    const paymentPort = await listen(paymentServer);
    try {
      const paymentAccount = await registerSelfTestAccount(paymentPort, "payment-config@example.com");
      const configuredOrder = await requestJson(paymentPort, "/v1/orders/create", {
        plan: "ZeroLag Pro Monthly",
        channel: "payment-config",
        accountToken: paymentAccount.body.token
      });
      assert(configuredOrder.statusCode === 201, "Configured payment order creation failed.");
      assert(configuredOrder.body.payment.provider === "wechat_pay", "Configured payment provider should be returned.");
      assert(configuredOrder.body.payment.paymentUrl.includes("https://pay.example/checkout/"), "Configured payment URL should use the template.");
      assert(configuredOrder.body.payment.paymentUrl.includes("amount=3000"), "Configured payment URL should include amount.");

      const blockedProviderBody = JSON.stringify({
        type: "payment.succeeded",
        eventId: "evt_payment_config_blocked",
        orderId: configuredOrder.body.order.orderId,
        provider: "self-test",
        providerTradeId: "trade_payment_config_blocked"
      });
      const blockedProvider = await requestRaw(paymentPort, "/v1/payments/webhook", blockedProviderBody, {
        "Content-Type": "application/json",
        "X-ZeroLag-Signature": signPaymentWebhook("payment-config-webhook", blockedProviderBody)
      });
      assert(blockedProvider.statusCode === 400, "Configured payment server should reject providers outside the allowlist.");

      const acceptedProviderBody = JSON.stringify({
        type: "payment.succeeded",
        eventId: "evt_payment_config_paid",
        orderId: configuredOrder.body.order.orderId,
        provider: "wechat_pay",
        providerTradeId: "trade_payment_config_paid"
      });
      const acceptedProvider = await requestRaw(paymentPort, "/v1/payments/webhook", acceptedProviderBody, {
        "Content-Type": "application/json",
        "X-ZeroLag-Signature": signPaymentWebhook("payment-config-webhook", acceptedProviderBody)
      });
      assert(acceptedProvider.statusCode === 200 && acceptedProvider.body.order.status === "paid", "Configured payment provider webhook should complete orders.");
    } finally {
      paymentServer.close();
      fs.rmSync(paymentTempDir, { recursive: true, force: true });
    }

    const autoTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-auto-maintenance-test-"));
    const autoOptions = {
      statePath: path.join(autoTempDir, "server-state.json"),
      serverSecret: "auto-maintenance-secret",
      adminSecret: "auto-maintenance-admin",
      paymentWebhookSecret: "auto-maintenance-payment",
      maintenance: {
        intervalMs: 50
      }
    };
    const autoCode = "ZL-PRO-AUTO-CLEANUP";
    const autoDeviceHash = crypto.createHash("sha256").update("auto-device").digest("hex");
    addActivationCode(autoCode, { durationDays: 30, maxUses: 1 }, autoOptions);
    const autoServer = createAppServer(autoOptions);
    const autoPort = await listen(autoServer);
    try {
      const autoActivated = await requestJson(autoPort, "/v1/licenses/activate", {
        activationCode: autoCode,
        deviceHash: autoDeviceHash,
        appVersion: "0.1.0",
        channel: "auto-maintenance"
      });
      assert(autoActivated.statusCode === 200 && autoActivated.body.active, "Auto-maintenance activation failed.");

      const autoState = loadState(autoOptions);
      autoState.subscriptions[autoActivated.body.subscriptionId].status = "active";
      autoState.subscriptions[autoActivated.body.subscriptionId].expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
      fs.writeFileSync(autoOptions.statePath, `${JSON.stringify(autoState, null, 2)}\n`, "utf8");
      await sleep(180);

      const autoCleanedState = loadState(autoOptions);
      assert(autoCleanedState.subscriptions[autoActivated.body.subscriptionId].status === "expired", "Automatic maintenance should expire stale subscriptions.");
      assert(
        !Object.values(autoCleanedState.tokens || {}).some((token) => token.subscriptionId === autoActivated.body.subscriptionId),
        "Automatic maintenance should remove stale tokens."
      );
    } finally {
      await new Promise((resolve) => {
        autoServer.close(resolve);
      });
      fs.rmSync(autoTempDir, { recursive: true, force: true });
    }

    const rateTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-rate-limit-test-"));
    const rateServer = createAppServer({
      statePath: path.join(rateTempDir, "server-state.json"),
      serverSecret: "rate-limit-test-secret",
      adminSecret: "rate-limit-test-admin",
      paymentWebhookSecret: "rate-limit-test-payment",
      rateLimit: {
        namespace: "self-test-rate-limit",
        windowMs: 60 * 1000,
        max: 1
      }
    });
    const ratePort = await listen(rateServer);
    try {
      const rateAccount = await registerSelfTestAccount(ratePort, "rate-limit@example.com");
      const firstLimitedOrder = await requestJson(ratePort, "/v1/orders/create", {
        plan: "ZeroLag Pro Monthly",
        channel: "rate-limit-test",
        accountToken: rateAccount.body.token
      });
      assert(firstLimitedOrder.statusCode === 201, "First limited request should pass.");

      const blockedLimitedOrder = await requestJson(ratePort, "/v1/orders/create", {
        plan: "ZeroLag Pro Monthly",
        channel: "rate-limit-test",
        accountToken: rateAccount.body.token
      }, {
        "X-Forwarded-For": "203.0.113.10"
      });
      assert(blockedLimitedOrder.statusCode === 429, "Repeated limited request should be blocked.");
      assert(Boolean(blockedLimitedOrder.body.message), "Rate limit response should include a message.");
    } finally {
      rateServer.close();
      fs.rmSync(rateTempDir, { recursive: true, force: true });
    }

    const deniedAdmin = await requestJson(port, "/v1/admin/activation-codes", {
      code: adminCode
    });
    assert(deniedAdmin.statusCode === 401, "Admin endpoint should reject missing secret.");

    const createdByAdmin = await requestJson(port, "/v1/admin/activation-codes", {
      code: adminCode,
      durationDays: 30,
      maxUses: 1
    }, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(createdByAdmin.statusCode === 201 && createdByAdmin.body.code === adminCode, "Admin code creation failed.");

    const summaryBefore = await requestJson(port, "/v1/admin/summary", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(summaryBefore.statusCode === 200 && summaryBefore.body.summary.activationCodes.total >= 2, "Admin summary failed.");

    const rejectedGuestOrder = await requestJson(port, "/v1/orders/create", {
      plan: "ZeroLag Pro Monthly",
      channel: "guest-purchase"
    });
    assert(rejectedGuestOrder.statusCode === 401, "Order creation should require a signed-in account.");

    const registeredAccount = await requestJson(port, "/v1/accounts/register", {
      provider: "email",
      identifier: " Player@Example.COM "
    });
    assert(registeredAccount.statusCode === 201 && registeredAccount.body.ok, "Account registration failed.");
    assert(registeredAccount.body.account.provider === "email", "Account provider was not preserved.");
    assert(!JSON.stringify(registeredAccount.body).includes("Player@Example.COM"), "Account response must not expose the raw identifier.");
    assert(/^acctok_/.test(registeredAccount.body.token || ""), "Account registration should issue an account token.");

    const createdOrder = await requestJson(port, "/v1/orders/create", {
      plan: "ZeroLag Pro Monthly",
      channel: "test",
      accountToken: registeredAccount.body.token
    });
    assert(createdOrder.statusCode === 201 && createdOrder.body.order.status === "pending", "Order creation failed.");
    assert(createdOrder.body.order.accountLinked === true, "Order creation should bind the order to the signed-in account.");
    assert(createdOrder.body.order.accountProvider === "email", "Order creation should report the account provider.");
    assert(!("deviceHash" in createdOrder.body.order), "Order creation must not expose or require a device hash.");
    assert(createdOrder.body.payment.provider === "manual", "Order creation should expose the configured payment provider.");
    assert(createdOrder.body.payment.paymentUrl.includes(createdOrder.body.order.orderId), "Order payment URL should include the order id.");

    const orderStatusBefore = await requestJson(port, `/v1/orders/${createdOrder.body.order.orderId}`, null, {
      Authorization: `Bearer ${registeredAccount.body.token}`
    });
    assert(orderStatusBefore.statusCode === 200 && !orderStatusBefore.body.order.activationCode, "Pending order should not expose a code.");

    const anonymousOrderStatus = await requestJson(port, `/v1/orders/${createdOrder.body.order.orderId}`);
    assert(anonymousOrderStatus.statusCode === 403, "Order status should require the owning signed-in account.");

    const adminOrders = await requestJson(port, "/v1/admin/orders", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(adminOrders.statusCode === 200 && adminOrders.body.orders.length === 1, "Admin order list failed.");

    const badWebhookBody = JSON.stringify({
      type: "payment.succeeded",
      eventId: "evt_bad_signature",
      orderId: createdOrder.body.order.orderId,
      provider: "self-test",
      providerTradeId: "trade_bad_signature"
    });
    const rejectedWebhook = await requestRaw(port, "/v1/payments/webhook", badWebhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": "sha256=bad"
    });
    assert(rejectedWebhook.statusCode === 401, "Payment webhook should reject invalid signatures.");
    const disabledProviderWebhookBody = JSON.stringify({
      type: "payment.succeeded",
      eventId: "evt_disabled_provider",
      orderId: createdOrder.body.order.orderId,
      provider: "not_enabled",
      providerTradeId: "trade_disabled_provider"
    });
    const rejectedProviderWebhook = await requestRaw(port, "/v1/payments/webhook", disabledProviderWebhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": signPaymentWebhook("self-test-payment", disabledProviderWebhookBody)
    });
    assert(rejectedProviderWebhook.statusCode === 400, "Payment webhook should reject disabled providers.");

    const webhookBody = JSON.stringify({
      type: "payment.succeeded",
      eventId: "evt_self_test_paid",
      orderId: createdOrder.body.order.orderId,
      provider: "self-test",
      providerTradeId: "trade_self_test"
    });
    const completedOrder = await requestRaw(port, "/v1/payments/webhook", webhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": signPaymentWebhook("self-test-payment", webhookBody)
    });
    assert(completedOrder.statusCode === 200 && completedOrder.body.order.status === "paid", "Order completion failed.");
    assert(Boolean(completedOrder.body.order.activationCode), "Paid order should receive an activation code.");

    const repeatedWebhook = await requestRaw(port, "/v1/payments/webhook", webhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": signPaymentWebhook("self-test-payment", webhookBody)
    });
    assert(repeatedWebhook.statusCode === 200, "Repeated webhook should be idempotent.");
    assert(
      repeatedWebhook.body.order.activationCode === completedOrder.body.order.activationCode,
      "Repeated webhook should return the original activation code."
    );

    const orderStatusAfter = await requestJson(port, `/v1/orders/${createdOrder.body.order.orderId}`, null, {
      Authorization: `Bearer ${registeredAccount.body.token}`
    });
    assert(orderStatusAfter.body.order.activationCode === completedOrder.body.order.activationCode, "Paid order status should return activation code.");

    const activated = await requestJson(port, "/v1/licenses/activate", {
      activationCode: completedOrder.body.order.activationCode,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test",
      accountToken: registeredAccount.body.token
    });
    assert(activated.statusCode === 200 && activated.body.active, "Activation failed.");
    assert(Boolean(activated.body.token), "Activation did not return a token.");
    assert(activated.body.accountLinked === true, "Activation should bind membership to the registered account.");
    assert(activated.body.accountProvider === "email", "Activation should report the bound account provider.");
    assert(/^rsess_/.test(activated.body.sessionId || ""), "Activation should return a server-issued runtime session id.");
    assert(activated.body.runtimeSessionKeyVersion === "runtime-session-v1", "Activation should return the runtime session key version.");
    assert(activated.body.runtimeSessionRevision === 1, "Activation should start runtime session revision tracking.");
    assert(/^sha256=[a-f0-9]{64}$/i.test(activated.body.runtimeSessionProof || ""), "Activation should return a server-issued runtime session proof.");
    assert(activated.body.runtimeSessionProofAlgorithm === "HMAC-SHA256", "Activation should return the runtime session proof algorithm.");
    const firstExpiresAt = new Date(activated.body.expiresAt).getTime();

    const accountProfile = await requestJson(port, "/v1/accounts/me", null, {
      Authorization: `Bearer ${registeredAccount.body.token}`
    });
    assert(accountProfile.statusCode === 200 && accountProfile.body.memberships.length === 1, "Account profile should include the linked membership.");

    const reboundAccount = await requestJson(port, "/v1/accounts/bind-membership", {
      accountToken: registeredAccount.body.token,
      licenseToken: activated.body.token,
      subscriptionId: activated.body.subscriptionId,
      deviceHash
    });
    assert(reboundAccount.statusCode === 200 && reboundAccount.body.memberships.length === 1, "Account membership binding should be idempotent.");

    const secondAccount = await requestJson(port, "/v1/accounts/register", {
      provider: "qq",
      identifier: "100200300"
    });
    assert(secondAccount.statusCode === 201 && secondAccount.body.ok, "Second account registration failed.");

    const crossAccountOrderStatus = await requestJson(port, `/v1/orders/${createdOrder.body.order.orderId}`, null, {
      Authorization: `Bearer ${secondAccount.body.token}`
    });
    assert(crossAccountOrderStatus.statusCode === 403, "Order status should reject another signed-in account.");

    const crossAccountBind = await requestJson(port, "/v1/accounts/bind-membership", {
      accountToken: secondAccount.body.token,
      licenseToken: activated.body.token,
      subscriptionId: activated.body.subscriptionId,
      deviceHash
    });
    assert(
      crossAccountBind.statusCode === 403,
      "A membership bound to one account must not be transferable to another account."
    );

    const loggedOutValidation = await requestJson(port, "/v1/licenses/validate", {
      token: activated.body.token,
      subscriptionId: activated.body.subscriptionId,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test",
      requireAccountBinding: true
    });
    assert(
      loggedOutValidation.statusCode === 401 && loggedOutValidation.body.active === false,
      "Validation should require the logged-in account when account binding is enforced."
    );

    const crossAccountValidation = await requestJson(port, "/v1/licenses/validate", {
      token: activated.body.token,
      subscriptionId: activated.body.subscriptionId,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test",
      accountToken: secondAccount.body.token,
      requireAccountBinding: true
    });
    assert(
      crossAccountValidation.statusCode === 403 && crossAccountValidation.body.active === false,
      "Validation should reject a membership bound to another account."
    );

    const validated = await requestJson(port, "/v1/licenses/validate", {
      token: activated.body.token,
      subscriptionId: activated.body.subscriptionId,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test",
      accountToken: registeredAccount.body.token,
      requireAccountBinding: true
    });
    assert(validated.statusCode === 200 && validated.body.active, "Validation failed.");
    assert(validated.body.token !== activated.body.token, "Validation should rotate token.");
    assert(/^rsess_/.test(validated.body.sessionId || ""), "Validation should return a server-issued runtime session id.");
    assert(validated.body.sessionId !== activated.body.sessionId, "Validation should rotate the runtime session id.");
    assert(validated.body.runtimeSessionRevision === activated.body.runtimeSessionRevision + 1, "Validation should increment runtime session revision.");
    assert(validated.body.runtimeSessionKeyVersion === activated.body.runtimeSessionKeyVersion, "Validation should keep the configured runtime session key version.");
    assert(validated.body.runtimeSessionProof !== activated.body.runtimeSessionProof, "Validation should rotate the runtime session proof.");

    const portableSession = await requestJson(port, "/v1/accounts/activate-membership", {
      accountToken: registeredAccount.body.token,
      deviceHash: otherDeviceHash,
      appVersion: "0.1.0",
      channel: "portable-device"
    });
    assert(portableSession.statusCode === 200 && portableSession.body.active, "Account membership should activate on another device.");
    assert(portableSession.body.subscriptionId === activated.body.subscriptionId, "Portable account membership should reuse the same subscription.");
    assert(portableSession.body.token !== validated.body.token, "Portable device sessions should receive their own token.");

    const portableValidation = await requestJson(port, "/v1/licenses/validate", {
      token: portableSession.body.token,
      subscriptionId: portableSession.body.subscriptionId,
      deviceHash: otherDeviceHash,
      appVersion: "0.1.0",
      channel: "portable-device",
      accountToken: registeredAccount.body.token,
      requireAccountBinding: true
    });
    assert(portableValidation.statusCode === 200 && portableValidation.body.active, "Another device should validate with its own account-issued token.");

    const copiedTokenValidation = await requestJson(port, "/v1/licenses/validate", {
      token: validated.body.token,
      subscriptionId: validated.body.subscriptionId,
      deviceHash: otherDeviceHash,
      appVersion: "0.1.0",
      channel: "copied-token",
      accountToken: registeredAccount.body.token,
      requireAccountBinding: true
    });
    assert(copiedTokenValidation.statusCode === 403, "Copied device tokens must not work on another device.");

    const renewalOrder = await requestJson(port, "/v1/orders/create", {
      plan: "ZeroLag Pro Monthly",
      channel: "test-renewal",
      accountToken: registeredAccount.body.token
    });
    assert(renewalOrder.statusCode === 201 && renewalOrder.body.order.status === "pending", "Renewal order creation failed.");

    const renewalWebhookBody = JSON.stringify({
      type: "payment.succeeded",
      eventId: "evt_self_test_renewal_paid",
      orderId: renewalOrder.body.order.orderId,
      provider: "self-test",
      providerTradeId: "trade_self_test_renewal"
    });
    const completedRenewalOrder = await requestRaw(port, "/v1/payments/webhook", renewalWebhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": signPaymentWebhook("self-test-payment", renewalWebhookBody)
    });
    assert(completedRenewalOrder.statusCode === 200 && completedRenewalOrder.body.order.status === "paid", "Renewal order completion failed.");

    const renewed = await requestJson(port, "/v1/licenses/activate", {
      activationCode: completedRenewalOrder.body.order.activationCode,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test-renewal",
      accountToken: registeredAccount.body.token
    });
    assert(renewed.statusCode === 200 && renewed.body.active, "Renewal activation failed.");
    assert(renewed.body.subscriptionId === activated.body.subscriptionId, "Renewal should extend the existing subscription.");
    assert(renewed.body.sessionId !== validated.body.sessionId, "Renewal should rotate the runtime session id.");
    assert(renewed.body.runtimeSessionRevision > validated.body.runtimeSessionRevision, "Renewal should advance runtime session revision.");
    assert(renewed.body.runtimeSessionProof !== validated.body.runtimeSessionProof, "Renewal should rotate the runtime session proof.");
    assert(
      new Date(renewed.body.expiresAt).getTime() >= firstExpiresAt + 29 * 24 * 60 * 60 * 1000,
      "Renewal should extend the subscription expiry."
    );

    const adminSubscriptions = await requestJson(port, "/v1/admin/subscriptions", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(adminSubscriptions.statusCode === 200, "Admin subscription list failed.");
    assert(adminSubscriptions.body.subscriptions.length === 1, "Admin subscription list should show one renewed subscription.");
    assert(adminSubscriptions.body.subscriptions[0].subscriptionId === activated.body.subscriptionId, "Admin subscription list should include the active subscription.");
    assert(adminSubscriptions.body.subscriptions[0].activationCount === 2, "Renewed subscription should show two activation links.");
    assert(adminSubscriptions.body.subscriptions[0].runtimeSessionRevision === renewed.body.runtimeSessionRevision, "Admin subscription list should show runtime session revision.");
    assert(adminSubscriptions.body.subscriptions[0].runtimeSessionKeyVersion === "runtime-session-v1", "Admin subscription list should show runtime key version.");
    assert(!JSON.stringify(adminSubscriptions.body.subscriptions[0]).includes(renewed.body.sessionId), "Admin subscription list must not expose raw runtime session ids.");
    assert(!JSON.stringify(adminSubscriptions.body.subscriptions[0]).includes(renewed.body.runtimeSessionProof), "Admin subscription list must not expose runtime session proofs.");

    const adminSubscriptionDetail = await requestJson(port, `/v1/admin/subscriptions/${activated.body.subscriptionId}`, null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(adminSubscriptionDetail.statusCode === 200, "Admin subscription detail failed.");
    assert(adminSubscriptionDetail.body.orders.length === 2, "Admin subscription detail should include linked paid orders.");
    const adminOpsSummary = await runAdminClient(port, ["ops-summary"]);
    assert(adminOpsSummary.status === 0, `Admin ops summary command failed: ${adminOpsSummary.stderr || adminOpsSummary.stdout}`);
    const adminOpsSummaryBody = JSON.parse(adminOpsSummary.stdout);
    assert(adminOpsSummaryBody.orders.paid === 2, "Admin ops summary should include paid order count.");
    assert(adminOpsSummaryBody.orders.grossRevenueCents === 6000, "Admin ops summary should include gross paid revenue.");
    assert(adminOpsSummaryBody.subscriptions.active === 1, "Admin ops summary should include active membership count.");
    assert(adminOpsSummaryBody.subscriptions.renewed === 1, "Admin ops summary should include renewed membership count.");
    assert(!JSON.stringify(adminOpsSummaryBody).includes(completedOrder.body.order.activationCode), "Admin ops summary must not expose activation codes.");
    const opsCsvPath = path.join(tempDir, "operations.csv");
    const adminOpsCsv = await runAdminClient(port, ["ops-csv", opsCsvPath]);
    assert(adminOpsCsv.status === 0, `Admin ops CSV command failed: ${adminOpsCsv.stderr || adminOpsCsv.stdout}`);
    assert(fs.existsSync(opsCsvPath), "Admin ops CSV command should write a CSV file.");
    const opsCsv = fs.readFileSync(opsCsvPath, "utf8");
    assert(opsCsv.startsWith("recordType,id,status,plan,amountCents,currency"), "Admin ops CSV should include a stable header.");
    assert(opsCsv.includes("order,"), "Admin ops CSV should include order rows.");
    assert(opsCsv.includes("subscription,"), "Admin ops CSV should include subscription rows.");
    assert(!opsCsv.includes(completedOrder.body.order.activationCode), "Admin ops CSV must not expose activation codes.");

    const blocked = await requestJson(port, "/v1/licenses/validate", {
      token: validated.body.token,
      subscriptionId: validated.body.subscriptionId,
      deviceHash: otherDeviceHash,
      appVersion: "0.1.0",
      channel: "test"
    });
    assert(blocked.statusCode === 403 && blocked.body.active === false, "Device mismatch should be blocked.");

    const summaryPaid = await requestJson(port, "/v1/admin/summary", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(summaryPaid.body.summary.subscriptions.active === 1, "Admin summary should show active subscription.");
    assert(summaryPaid.body.summary.orders.paid === 2, "Admin summary should show paid orders.");

    const refundWebhookBody = JSON.stringify({
      type: "payment.refunded",
      eventId: "evt_self_test_refunded",
      orderId: createdOrder.body.order.orderId,
      provider: "self-test",
      refundTradeId: "refund_self_test"
    });
    const refundedOrder = await requestRaw(port, "/v1/payments/webhook", refundWebhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": signPaymentWebhook("self-test-payment", refundWebhookBody)
    });
    assert(refundedOrder.statusCode === 200 && refundedOrder.body.order.status === "refunded", "Refund webhook failed.");
    assert(Boolean(refundedOrder.body.order.refundedAt), "Refunded order should include refundedAt.");

    const orderStatusRefunded = await requestJson(port, `/v1/orders/${createdOrder.body.order.orderId}`, null, {
      Authorization: `Bearer ${registeredAccount.body.token}`
    });
    assert(orderStatusRefunded.body.order.status === "refunded", "Refunded order status should be visible.");
    assert(!orderStatusRefunded.body.order.activationCode, "Refunded order should not expose activation code.");

    const revokedValidation = await requestJson(port, "/v1/licenses/validate", {
      token: validated.body.token,
      subscriptionId: validated.body.subscriptionId,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test"
    });
    assert(revokedValidation.statusCode === 403 && revokedValidation.body.active === false, "Refund should revoke membership access.");

    const summaryRefunded = await requestJson(port, "/v1/admin/summary", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(summaryRefunded.body.summary.subscriptions.active === 0, "Refund should remove active subscription count.");
    assert(summaryRefunded.body.summary.subscriptions.revoked === 1, "Refund should show revoked subscription count.");
    assert(summaryRefunded.body.summary.orders.refunded === 1, "Admin summary should show refunded order.");

    const createdRevokeCode = await requestJson(port, "/v1/admin/activation-codes", {
      code: revokeCode,
      durationDays: 30,
      maxUses: 1
    }, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(createdRevokeCode.statusCode === 201 && createdRevokeCode.body.code === revokeCode, "Admin revoke-test code creation failed.");

    const revokable = await requestJson(port, "/v1/licenses/activate", {
      activationCode: revokeCode,
      deviceHash: revokeDeviceHash,
      appVersion: "0.1.0",
      channel: "test-revoke"
    });
    assert(revokable.statusCode === 200 && revokable.body.active, "Revokable activation failed.");

    const activeSubscriptions = await requestJson(port, "/v1/admin/subscriptions?status=active", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(
      activeSubscriptions.body.subscriptions.some((subscription) => subscription.subscriptionId === revokable.body.subscriptionId),
      "Active subscription filter should include revokable subscription."
    );

    const manuallyRevoked = await requestJson(port, "/v1/admin/subscriptions/revoke", {
      subscriptionId: revokable.body.subscriptionId,
      reason: "support_revoke"
    }, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(manuallyRevoked.statusCode === 200, "Admin subscription revoke failed.");
    assert(manuallyRevoked.body.subscription.status === "revoked", "Admin revoke should mark subscription revoked.");

    const manuallyRevokedValidation = await requestJson(port, "/v1/licenses/validate", {
      token: revokable.body.token,
      subscriptionId: revokable.body.subscriptionId,
      deviceHash: revokeDeviceHash,
      appVersion: "0.1.0",
      channel: "test-revoke"
    });
    assert(manuallyRevokedValidation.statusCode === 403 && manuallyRevokedValidation.body.active === false, "Admin revoke should invalidate token.");

    const createdCleanupCode = await requestJson(port, "/v1/admin/activation-codes", {
      code: cleanupCode,
      durationDays: 30,
      maxUses: 1
    }, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(createdCleanupCode.statusCode === 201 && createdCleanupCode.body.code === cleanupCode, "Admin cleanup-test code creation failed.");

    const cleanupTarget = await requestJson(port, "/v1/licenses/activate", {
      activationCode: cleanupCode,
      deviceHash: cleanupDeviceHash,
      appVersion: "0.1.0",
      channel: "test-cleanup"
    });
    assert(cleanupTarget.statusCode === 200 && cleanupTarget.body.active, "Cleanup-test activation failed.");

    const staleState = loadState(options);
    staleState.subscriptions[cleanupTarget.body.subscriptionId].status = "active";
    staleState.subscriptions[cleanupTarget.body.subscriptionId].expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
    fs.writeFileSync(options.statePath, `${JSON.stringify(staleState, null, 2)}\n`, "utf8");

    const cleanup = await requestJson(port, "/v1/admin/maintenance/cleanup", {}, {
      "X-ZeroLag-Admin-Secret": "self-test-admin",
      "X-ZeroLag-Admin-Actor": "self-test"
    });
    assert(cleanup.statusCode === 200 && cleanup.body.ok, "Maintenance cleanup failed.");
    assert(cleanup.body.cleanup.expiredSubscriptions >= 1, "Cleanup should expire stale subscriptions.");
    assert(cleanup.body.cleanup.removedTokens >= 1, "Cleanup should remove stale tokens.");

    const cleanedState = loadState(options);
    assert(cleanedState.subscriptions[cleanupTarget.body.subscriptionId].status === "expired", "Cleanup should mark subscription expired.");
    assert(
      !Object.values(cleanedState.tokens || {}).some((token) => token.subscriptionId === cleanupTarget.body.subscriptionId),
      "Cleanup should remove tokens for expired subscription."
    );

    const auditEvents = await requestJson(port, "/v1/admin/audit-events?limit=200", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(auditEvents.statusCode === 200, "Admin audit events failed.");
    const auditTypes = new Set(auditEvents.body.events.map((event) => event.type));
    assert(auditTypes.has("activation_code.created"), "Audit log should include admin activation-code creation.");
    assert(auditTypes.has("order.created"), "Audit log should include order creation.");
    assert(auditTypes.has("payment.succeeded"), "Audit log should include successful payment.");
    assert(auditTypes.has("license.activated"), "Audit log should include license activation.");
    assert(auditTypes.has("license.renewed"), "Audit log should include license renewal.");
    assert(auditTypes.has("payment.refunded"), "Audit log should include refund.");
    assert(auditTypes.has("subscription.revoked"), "Audit log should include manual subscription revoke.");
    assert(auditTypes.has("maintenance.cleanup"), "Audit log should include maintenance cleanup.");
    assert(
      !JSON.stringify(auditEvents.body.events).includes(completedOrder.body.order.activationCode),
      "Audit log should not expose activation codes."
    );

    const renewalAuditEvents = await requestJson(port, "/v1/admin/audit-events?limit=10&type=license.renewed", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(renewalAuditEvents.statusCode === 200, "Filtered audit events failed.");
    assert(renewalAuditEvents.body.events.length === 1, "Filtered audit events should return renewal event.");

    const stateExport = await requestJson(port, "/v1/admin/export", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(stateExport.statusCode === 200 && stateExport.body.ok, "Admin state export failed.");
    assert(stateExport.body.stateSha256 && stateExport.body.state.orders, "Admin state export should include state and checksum.");
    assert(stateExport.body.summary.orders.total >= 2, "Admin state export should include a useful summary.");

    const backupDir = path.join(tempDir, "backups");
    const backupFiles = fs.readdirSync(backupDir).filter((fileName) => fileName.endsWith(".json"));
    assert(backupFiles.length > 0, "State saves should create rolling backups.");

    const stateBeforeCorruption = fs.readFileSync(options.statePath, "utf8");
    fs.writeFileSync(options.statePath, "{ broken json", "utf8");
    const recoveredState = loadState(options);
    assert(Object.keys(recoveredState.orders || {}).length > 0, "Corrupted state should recover from the latest backup.");
    fs.writeFileSync(options.statePath, stateBeforeCorruption, "utf8");

    console.log("ZeroLag server self-test passed.");
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
