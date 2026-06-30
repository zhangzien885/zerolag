const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "release-status.js");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeRemoveTemp(tempRoot) {
  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-release-status-smoke-")) {
    throw new Error(`Refusing to remove unexpected temp path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function isolatedEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ZEROLAG_") || key.startsWith("CSC") || key.includes("CODESIGN")) delete env[key];
  }
  return { ...env, ...extra };
}

function runStatus(args, env = isolatedEnv(), expectedStatus = 0) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    env,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== expectedStatus) {
    throw new Error([
      `Command failed: node ${[scriptPath, ...args].join(" ")}`,
      `Expected exit: ${expectedStatus}`,
      `Actual exit: ${result.status}`,
      result.stdout.trim(),
      result.stderr.trim()
    ].filter(Boolean).join("\n"));
  }

  return result;
}

function assertNoSecrets(text, label) {
  const serverSecretKey = ["ZEROLAG", "SERVER", "SECRET"].join("_");
  const adminSecretKey = ["ZEROLAG", "ADMIN", "SECRET"].join("_");
  const webhookSecretKey = ["ZEROLAG", "PAYMENT", "WEBHOOK", "SECRET"].join("_");
  const forbidden = [
    "server-secret-visible",
    "admin-secret-visible",
    "webhook-secret-visible",
    `${serverSecretKey}=`,
    `${adminSecretKey}=`,
    `${webhookSecretKey}=`
  ];

  for (const value of forbidden) {
    assertOk(!String(text || "").includes(value), `${label} leaked secret text: ${value}`);
  }
}

function fakePrivateKey() {
  return [
    ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
    "fixture-private-key",
    ["-----END", "PRIVATE KEY-----"].join(" ")
  ].join("\\n");
}

function writeReadyEnv(filePath) {
  const serverSecretKey = ["ZEROLAG", "SERVER", "SECRET"].join("_");
  const adminSecretKey = ["ZEROLAG", "ADMIN", "SECRET"].join("_");
  const webhookSecretKey = ["ZEROLAG", "PAYMENT", "WEBHOOK", "SECRET"].join("_");
  const lines = [
    `${serverSecretKey}=${"server-secret-visible".replace("visible", "hidden")}${"x".repeat(40)}`,
    `${adminSecretKey}=${"admin-secret-visible".replace("visible", "hidden")}${"x".repeat(40)}`,
    `${webhookSecretKey}=${"webhook-secret-visible".replace("visible", "hidden")}${"x".repeat(40)}`,
    "ZEROLAG_RUNTIME_SESSION_KEY_VERSION=runtime-v1",
    "ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM=RSA-SHA256",
    `ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_PEM=${fakePrivateKey()}`,
    "ZEROLAG_SERVER_HOST=0.0.0.0",
    "ZEROLAG_SERVER_PORT=8787",
    "ZEROLAG_STATE_STORE=sqlite",
    "ZEROLAG_SERVER_STATE_PATH=server/data/server-state.json",
    "ZEROLAG_SERVER_BACKUP_DIR=server/data/backups",
    "ZEROLAG_SQLITE_STATE_PATH=server/data/server-state.sqlite",
    "ZEROLAG_SQLITE_BACKUP_DIR=server/data/backups",
    "ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS=24",
    "ZEROLAG_PAYMENT_PROVIDER=wechat_pay",
    "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS=wechat_pay",
    "ZEROLAG_PAYMENT_URL_TEMPLATE=https://pay.zerolag.test/orders/{orderId}",
    "ZEROLAG_WECHAT_PAY_MCH_ID=1234567890",
    "ZEROLAG_WECHAT_PAY_APP_ID=wx1234567890",
    `ZEROLAG_WECHAT_PAY_API_V3_KEY=${"x".repeat(32)}`,
    "ZEROLAG_WECHAT_PAY_SERIAL_NO=ABCDEF123456",
    "ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH=C:\\\\private\\\\wechat-pay.pem",
    "ZEROLAG_RATE_LIMIT_DISABLED=0",
    "ZEROLAG_SERVER_BACKUP_DISABLED=0",
    "ZEROLAG_MAINTENANCE_DISABLED=0",
    ""
  ];
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function commonArgs(paths) {
  return [
    "--json",
    "--no-git",
    "--package-json",
    paths.packageJson,
    "--app-config",
    paths.appConfig,
    "--update-manifest",
    paths.updateManifest,
    "--release-artifacts",
    paths.releaseArtifacts,
    "--website-release",
    paths.websiteRelease,
    "--service-guard",
    paths.serviceGuard,
    "--server-env",
    paths.serverEnv,
    "--wrapper-output",
    paths.wrapperOutput,
    "--dotnet-version",
    "8.0.422"
  ];
}

function paths(tempRoot) {
  return {
    packageJson: path.join(tempRoot, "package.json"),
    appConfig: path.join(tempRoot, "app-config.json"),
    updateManifest: path.join(tempRoot, "update.json"),
    releaseArtifacts: path.join(tempRoot, "release-artifacts.json"),
    websiteRelease: path.join(tempRoot, "release.json"),
    serviceGuard: path.join(tempRoot, "service-guard.json"),
    serverEnv: path.join(tempRoot, "server.env"),
    wrapperOutput: path.join(tempRoot, "ZeroLag.RuntimeGuard.Service.exe"),
    cert: path.join(tempRoot, "codesign.pfx")
  };
}

function writeDevFixture(paths) {
  writeJson(paths.packageJson, { version: "0.1.0", scripts: {} });
  writeJson(paths.appConfig, {
    releaseMode: "development",
    websiteUrl: "https://example.com/zerolag",
    allowLocalDemoLicense: false
  });
  writeJson(paths.updateManifest, {
    latest: "0.1.1",
    downloadUrl: "https://example.com/zerolag/download"
  });
  writeJson(paths.releaseArtifacts, {});
  writeJson(paths.websiteRelease, { status: "preparing", downloadReady: false });
  writeJson(paths.serviceGuard, {});
}

function writeReadyFixture(paths) {
  writeJson(paths.packageJson, {
    version: "1.2.3",
    scripts: {
      ci: "npm run check",
      "release:rehearsal": "node scripts/local-release-rehearsal.js",
      "release:preflight:strict": "node scripts/release-preflight.js --strict",
      "server:deployment-report:strict": "node scripts/generate-server-deployment-report.js --strict",
      "server:payment-loop:smoke": "node scripts/payment-loop-smoke-test.js"
    }
  });
  writeJson(paths.appConfig, {
    releaseMode: "production",
    websiteUrl: "https://zerolag.test",
    purchaseUrl: "https://zerolag.test/buy",
    analyticsUrl: "https://api.zerolag.test/v1/website/events",
    supportUrl: "https://zerolag.test/support",
    apiBaseUrl: "https://api.zerolag.test",
    updateManifestUrl: "https://cdn.zerolag.test/releases/latest.json",
    updatePublicKeyPem: "-----BEGIN PUBLIC KEY-----\\nfixture\\n-----END PUBLIC KEY-----",
    runtimeSessionPublicKeyPem: "-----BEGIN PUBLIC KEY-----\\nfixture\\n-----END PUBLIC KEY-----",
    allowLocalDemoLicense: false
  });
  writeJson(paths.updateManifest, {
    latest: "1.2.3",
    downloadUrl: "https://cdn.zerolag.test/releases/ZeroLag-Setup-1.2.3.exe",
    signatureAlgorithm: "RSA-SHA256",
    signature: "fixture-signature"
  });
  writeJson(paths.releaseArtifacts, {
    installer: {
      file: "ZeroLag-Setup-1.2.3.exe",
      size: 123456,
      sha256: "a".repeat(64)
    }
  });
  writeJson(paths.websiteRelease, {
    status: "available",
    downloadReady: true
  });
  writeJson(paths.serviceGuard, {
    nativeServiceWrapperStatus: "implemented"
  });
  fs.writeFileSync(paths.wrapperOutput, "fixture wrapper", "utf8");
  fs.writeFileSync(paths.cert, "fixture cert", "utf8");
  writeReadyEnv(paths.serverEnv);
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-release-status-smoke-"));
  const fixturePaths = paths(tempRoot);

  try {
    writeDevFixture(fixturePaths);
    const dev = runStatus(commonArgs(fixturePaths));
    assertNoSecrets(dev.stdout, "Dev status JSON");
    assertNoSecrets(dev.stderr, "Dev status stderr");
    const devStatus = JSON.parse(dev.stdout);
    assertOk(devStatus.publicReleaseReady === false, "Development fixture should not be public-release ready.");
    assertOk(devStatus.summary.blockerCount > 0, "Development fixture should list blockers.");
    assertOk(devStatus.nextSteps.some((step) => step.includes("production:config")), "Development fixture should suggest URL configuration.");

    writeReadyFixture(fixturePaths);
    const readyEnv = isolatedEnv({
      CSC_LINK: fixturePaths.cert,
      CSC_KEY_PASSWORD: "fixture-password",
      ZEROLAG_CODESIGN_PROFILE: "production"
    });
    const ready = runStatus(commonArgs(fixturePaths), readyEnv);
    assertNoSecrets(ready.stdout, "Ready status JSON");
    assertNoSecrets(ready.stderr, "Ready status stderr");
    const readyStatus = JSON.parse(ready.stdout);
    assertOk(readyStatus.localRehearsalReady === true, "Ready fixture should be local-rehearsal ready.");
    assertOk(readyStatus.publicReleaseReady === true, "Ready fixture should be public-release ready.");
    assertOk(readyStatus.summary.blockerCount === 0, "Ready fixture should have no blockers.");
    assertOk(readyStatus.groups.some((entry) => entry.id === "payment" && entry.ready), "Payment group should be ready.");

    const human = runStatus(commonArgs(fixturePaths).filter((arg) => arg !== "--json"), readyEnv);
    assertOk(human.stdout.includes("ZeroLag 正式版状态面板"), "Human output should include the dashboard title.");
    assertOk(human.stdout.includes("正式上线"), "Human output should include public release summary.");
    assertNoSecrets(human.stdout, "Human status output");

    console.log("ZeroLag release status smoke test passed.");
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
