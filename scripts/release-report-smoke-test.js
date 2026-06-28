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
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-release-report-smoke-")) {
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

function runReleaseReport(tempDir) {
  return spawnSync(process.execPath, [
    path.join(rootDir, "scripts", "generate-release-report.js"),
    "--output-dir",
    tempDir
  ], {
    cwd: rootDir,
    env: isolatedEnv(tempDir),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-release-report-smoke-"));

  try {
    const result = runReleaseReport(tempDir);
    assert(result.status === 0, `Release report command failed: ${result.stderr || result.stdout}`);

    const jsonPath = path.join(tempDir, "release-candidate-report.json");
    const markdownPath = path.join(tempDir, "release-candidate-report.md");
    assert(fs.existsSync(jsonPath), "Release report JSON was not written.");
    assert(fs.existsSync(markdownPath), "Release report Markdown was not written.");

    const jsonBody = fs.readFileSync(jsonPath, "utf8");
    const markdownBody = fs.readFileSync(markdownPath, "utf8");
    const report = JSON.parse(jsonBody);

    assert(report.productName === "ZeroLag", "Release report should include the product name.");
    assert(report.serverDeployment && Array.isArray(report.serverDeployment.gates), "Release report should include server deployment gates.");
    assert(report.serverDeployment.gates.length >= 1, "Release report should include at least one server deployment gate.");
    assert(report.serverDeployment.snapshot.privateEnvFile.path === "missing-server.env (external)", "Release report should sanitize the smoke env path.");
    assert(markdownBody.includes("## Server Deployment Gates"), "Release report Markdown should render server deployment gates.");
    assert(markdownBody.includes("Server deployment strict gate is not ready"), "Release report Markdown should include strict-gate status.");
    assert(markdownBody.includes("npm run server:deployment-report:strict"), "Release report Markdown should include the strict server gate command.");
    assertNoSensitiveText(jsonBody, "Release report JSON");
    assertNoSensitiveText(markdownBody, "Release report Markdown");

    console.log("ZeroLag release report smoke test passed.");
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
