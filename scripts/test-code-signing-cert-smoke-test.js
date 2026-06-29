const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { generateTestCodeSigningCert } = require("./generate-test-code-signing-cert");
const { inspectSigningEnv } = require("./check-code-signing-env");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "generate-test-code-signing-cert.js");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRmTempDir(tempDir) {
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-test-codesign-smoke-")) {
    throw new Error(`Refusing to clean unexpected smoke-test path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  [
    "CSC_LINK",
    "WIN_CSC_LINK",
    "WINDOWS_CODESIGN_CERT",
    "ZEROLAG_CODESIGN_CERT",
    "CSC_KEY_PASSWORD",
    "WIN_CSC_KEY_PASSWORD",
    "WINDOWS_CODESIGN_PASSWORD",
    "ZEROLAG_CODESIGN_PASSWORD",
    "ZEROLAG_CODESIGN_PROFILE",
    "ZEROLAG_CODESIGN_ENV_FILE"
  ].forEach((key) => delete env[key]);
  return { ...env, ...extra };
}

function assertNoSensitiveText(text, label, tempDir) {
  const forbidden = [
    tempDir,
    tempDir.replace(/\\/g, "/"),
    "fixture-password",
    "CSC_KEY_PASSWORD="
  ];

  for (const pattern of forbidden) {
    assertOk(!String(text || "").includes(pattern), `${label} leaked sensitive text: ${pattern}`);
  }
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-test-codesign-smoke-"));

  try {
    const dryRun = generateTestCodeSigningCert({
      outputDir: tempDir,
      dryRun: true
    });
    assertOk(dryRun.ok === true && dryRun.dryRun === true, "Dry-run should return a safe ok result.");
    assertOk(dryRun.profile === "test", "Dry-run should mark test profile.");
    assertOk(!fs.existsSync(path.join(tempDir, "zerolag-test-codesign.pfx")), "Dry-run should not write a PFX file.");

    const dryRunCli = spawnSync(process.execPath, [scriptPath, "--dry-run", "--json", "--output-dir", tempDir], {
      cwd: rootDir,
      env: cleanEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assertOk(dryRunCli.status === 0, `Dry-run CLI failed: ${dryRunCli.stderr || dryRunCli.stdout}`);
    assertNoSensitiveText(dryRunCli.stdout, "Dry-run CLI stdout", tempDir);

    const pfxPath = path.join(tempDir, "fixture-test.pfx");
    const envPath = path.join(tempDir, "test-signing.env");
    fs.writeFileSync(pfxPath, "fake pfx", "utf8");
    fs.writeFileSync(envPath, [
      `CSC_LINK=${pfxPath}`,
      "CSC_KEY_PASSWORD=fixture-password",
      "ZEROLAG_CODESIGN_PROFILE=test",
      ""
    ].join("\n"), "utf8");

    const loaded = inspectSigningEnv(cleanEnv({
      ZEROLAG_CODESIGN_ENV_FILE: envPath
    }));
    assertOk(loaded.ok === true, "Signing env should load from the private env file.");
    assertOk(loaded.productionReady === false, "Test certificate should not be marked production ready.");
    assertOk(loaded.profile === "test", "Loaded profile should be test.");
    assertOk(loaded.certificateSource === "external-file", "Loaded certificate path should be redacted.");
    assertOk(loaded.envFileLoaded === true, "Signing env file should be reported as loaded.");

    const missing = inspectSigningEnv(cleanEnv({
      ZEROLAG_CODESIGN_ENV_FILE: path.join(tempDir, "missing.env")
    }));
    assertOk(missing.ok === false, "Missing env should not pass.");

    console.log("ZeroLag test code-signing certificate smoke test passed.");
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
