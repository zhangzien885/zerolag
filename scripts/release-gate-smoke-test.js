const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRmTempDir(tempDir) {
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-release-gate-smoke-")) {
    throw new Error(`Refusing to clean unexpected smoke-test path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function isolatedEnv(tempDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ZEROLAG_")) delete env[key];
  }
  env.ZEROLAG_ENV_FILE = path.join(tempDir, "missing-server.env");
  return env;
}

function assertNoSensitiveText(text, label) {
  const forbidden = [
    rootDir,
    rootDir.replace(/\\/g, "/"),
    "zl_server_",
    "ZEROLAG_SERVER_SECRET",
    "ZEROLAG_ADMIN_SECRET",
    "ZEROLAG_PAYMENT_WEBHOOK_SECRET"
  ];

  for (const pattern of forbidden) {
    assert(!String(text || "").includes(pattern), `${label} leaked sensitive text: ${pattern}`);
  }
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-release-gate-smoke-"));

  try {
    const result = spawnSync(process.execPath, [
      path.join(rootDir, "scripts", "check-release-gate.js"),
      "--output-dir",
      tempDir
    ], {
      cwd: rootDir,
      env: isolatedEnv(tempDir),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    assert(result.status === 1, "Release gate should fail for the isolated development smoke config.");
    assert(result.stdout.includes("ZeroLag release gate failed."), "Release gate should print a clear failure header.");
    assert(result.stdout.includes("Desktop release:"), "Release gate should include desktop readiness failures.");
    assert(result.stdout.includes("Server deployment:"), "Release gate should include server deployment failures.");
    assertNoSensitiveText(result.stdout, "Release gate stdout");
    assertNoSensitiveText(result.stderr, "Release gate stderr");

    const reportPath = path.join(tempDir, "release-candidate-report.json");
    assert(fs.existsSync(reportPath), "Release gate should generate the candidate report before failing.");
    const reportBody = fs.readFileSync(reportPath, "utf8");
    const report = JSON.parse(reportBody);
    assert(report.serverDeployment && Array.isArray(report.serverDeployment.gates), "Generated report should include server deployment gates.");
    assert(report.serverDeployment.ready === false, "Smoke release gate should expose an unready server deployment.");
    assertNoSensitiveText(reportBody, "Release gate report JSON");

    console.log("ZeroLag release gate smoke test passed.");
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
