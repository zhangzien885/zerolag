const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "check-release-workstation.js");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRmTempDir(tempDir) {
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-workstation-smoke-")) {
    throw new Error(`Refusing to clean unexpected smoke-test path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixturePaths(tempDir) {
  return {
    packageJson: path.join(tempDir, "package.json"),
    appConfig: path.join(tempDir, "app-config.json"),
    updateManifest: path.join(tempDir, "update.json"),
    serviceGuard: path.join(tempDir, "service-guard.json"),
    envFile: path.join(tempDir, "server.env"),
    wrapperOutput: path.join(tempDir, "ZeroLag.RuntimeGuard.Service.exe"),
    certFile: path.join(tempDir, "codesign-fixture.pfx")
  };
}

function writeReadyFixture(tempDir) {
  const paths = fixturePaths(tempDir);
  writeJson(paths.packageJson, {
    version: "1.2.3",
    scripts: {}
  });
  writeJson(paths.appConfig, {
    releaseMode: "production",
    websiteUrl: "https://zerolag.example/download",
    purchaseUrl: "https://zerolag.example/buy",
    analyticsUrl: "https://zerolag.example/api/analytics",
    supportUrl: "https://zerolag.example/support",
    apiBaseUrl: "https://api.zerolag.example",
    updateManifestUrl: "https://cdn.zerolag.example/update.json",
    runtimeSessionPublicKeyPem: "-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----",
    updatePublicKeyPem: "-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----"
  });
  writeJson(paths.updateManifest, {
    latest: "1.2.3",
    downloadUrl: "https://cdn.zerolag.example/ZeroLag-1.2.3.exe",
    signatureAlgorithm: "RSA-SHA256",
    signature: "fixture-signature"
  });
  writeJson(paths.serviceGuard, {
    nativeServiceWrapperStatus: "implemented",
    nativeServiceWrapperOutput: paths.wrapperOutput
  });
  fs.writeFileSync(paths.envFile, "ZEROLAG_SERVER_SECRET=zl_server_should_not_leak\n", "utf8");
  fs.writeFileSync(paths.wrapperOutput, "placeholder native wrapper", "utf8");
  fs.writeFileSync(paths.certFile, "placeholder pfx", "utf8");
  return paths;
}

function runWorkstation(args, env) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function isolatedEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ZEROLAG_") || key.includes("CSC") || key.includes("CODESIGN")) delete env[key];
  }
  return {
    ...env,
    ...extra
  };
}

function assertNoSensitiveText(text, label, tempDir) {
  const forbidden = [
    tempDir,
    tempDir.replace(/\\/g, "/"),
    "zl_server_should_not_leak",
    "ZEROLAG_SERVER_SECRET",
    "fixture-password"
  ];

  for (const pattern of forbidden) {
    assertOk(!String(text || "").includes(pattern), `${label} leaked sensitive text: ${pattern}`);
  }
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-workstation-smoke-"));

  try {
    const paths = writeReadyFixture(tempDir);
    const commonPathArgs = [
      "--no-git",
      "--package-json",
      paths.packageJson,
      "--app-config",
      paths.appConfig,
      "--update-manifest",
      paths.updateManifest,
      "--service-guard",
      paths.serviceGuard,
      "--env-file",
      paths.envFile,
      "--wrapper-output",
      paths.wrapperOutput
    ];

    const readyish = runWorkstation(["--json", ...commonPathArgs], isolatedEnv({
      CSC_LINK: paths.certFile,
      CSC_KEY_PASSWORD: "fixture-password"
    }));
    assertOk(readyish.status === 0, `Workstation check should not fail without --strict: ${readyish.stderr || readyish.stdout}`);
    assertNoSensitiveText(readyish.stdout, "Workstation JSON stdout", tempDir);
    assertNoSensitiveText(readyish.stderr, "Workstation JSON stderr", tempDir);

    const readyishJson = JSON.parse(readyish.stdout);
    assertOk(Array.isArray(readyishJson.checks), "Workstation JSON should include checks.");
    assertOk(readyishJson.files.privateEnv === "server.env (external)", "Workstation JSON should redact external env paths.");
    assertOk(readyishJson.checks.some((check) => check.id === "code-signing" && check.ok), "Fixture signing env should pass.");
    assertOk(readyishJson.checks.some((check) => check.id === "native-wrapper-output" && check.ok), "Fixture wrapper output should pass.");

    fs.rmSync(paths.wrapperOutput, { force: true });
    const strictMissing = runWorkstation(["--strict", ...commonPathArgs], isolatedEnv());
    assertOk(strictMissing.status === 1, "Strict workstation check should fail when release prerequisites are missing.");
    assertOk(strictMissing.stdout.includes("ZeroLag release workstation readiness"), "Strict human output should include the readiness header.");
    assertOk(strictMissing.stdout.includes("Native service wrapper exe"), "Strict human output should include wrapper readiness.");
    assertOk(strictMissing.stdout.includes("Windows code signing"), "Strict human output should include code signing readiness.");
    assertNoSensitiveText(strictMissing.stdout, "Strict workstation stdout", tempDir);
    assertNoSensitiveText(strictMissing.stderr, "Strict workstation stderr", tempDir);

    console.log("ZeroLag release workstation smoke test passed.");
  } finally {
    safeRmTempDir(tempDir);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
