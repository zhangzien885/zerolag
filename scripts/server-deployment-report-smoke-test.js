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
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-deployment-report-smoke-")) {
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

function runReport(args, tempDir) {
  return spawnSync(process.execPath, [path.join(rootDir, "scripts", "generate-server-deployment-report.js"), ...args], {
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-deployment-report-smoke-"));

  try {
    const markdownPath = path.join(tempDir, "server-deployment-report.md");
    const markdown = runReport(["--output", markdownPath], tempDir);
    assert(markdown.status === 0, `Markdown report failed: ${markdown.stderr || markdown.stdout}`);
    assert(fs.existsSync(markdownPath), "Markdown report was not written.");
    const markdownBody = fs.readFileSync(markdownPath, "utf8");
    assert(markdownBody.includes("ZeroLag Server Deployment Report"), "Markdown report should include the report title.");
    assert(markdownBody.includes("Strict Gate Details"), "Markdown report should include gate details.");
    assert(markdownBody.includes("Env file does not exist: missing-server.env (external)"), "Markdown report should sanitize external env paths.");
    assertNoSensitiveText(markdownBody, "Markdown report");

    const jsonPath = path.join(tempDir, "server-deployment-report.json");
    const json = runReport(["--json", "--output", jsonPath], tempDir);
    assert(json.status === 0, `JSON report failed: ${json.stderr || json.stdout}`);
    assert(fs.existsSync(jsonPath), "JSON report was not written.");
    const jsonBody = fs.readFileSync(jsonPath, "utf8");
    assertNoSensitiveText(jsonBody, "JSON report");
    const data = JSON.parse(jsonBody);
    assert(data.ready === false, "JSON report should expose a false readiness state for the isolated dev smoke config.");
    assert(data.snapshot.privateEnvFile.path === "missing-server.env (external)", "JSON report should sanitize the env file path.");
    assert(Array.isArray(data.gates) && data.gates.length >= 1, "JSON report should include gate results.");
    assert(data.gates.some((gate) => gate.ok === false), "JSON report should include failed gates for the isolated dev smoke config.");

    const stdoutJson = runReport(["--json", "--stdout"], tempDir);
    assert(stdoutJson.status === 0, `JSON stdout report failed: ${stdoutJson.stderr || stdoutJson.stdout}`);
    assertNoSensitiveText(stdoutJson.stdout, "JSON stdout report");
    assert(JSON.parse(stdoutJson.stdout).snapshot.privateEnvFile.loaded === false, "JSON stdout report should be parseable.");

    const strictPath = path.join(tempDir, "server-deployment-report-strict.md");
    const strict = runReport(["--strict", "--output", strictPath], tempDir);
    assert(strict.status === 1, "Strict report should fail for the isolated dev smoke config.");
    assert(fs.existsSync(strictPath), "Strict report should still write Markdown output.");
    assert(strict.stderr.includes("strict gate failed"), "Strict report should explain that the gate failed.");
    assertNoSensitiveText(fs.readFileSync(strictPath, "utf8"), "Strict report");

    console.log("ZeroLag server deployment report smoke test passed.");
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
