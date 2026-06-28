const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const secretFragments = [
  "zl_server_ci_report_smoke_abcdefghijklmnopqrstuvwxyz1234567890",
  "zl_admin_ci_report_smoke_abcdefghijklmnopqrstuvwxyz1234567890",
  "zl_payment_ci_report_smoke_abcdefghijklmnopqrstuvwxyz1234567890"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function npmInvocation(args) {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args]
    };
  }

  return {
    command: "npm",
    args
  };
}

function safeRmTempDir(tempDir) {
  const resolvedRoot = path.resolve(tempDir);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-ci-reports-smoke-")) {
    throw new Error(`Refusing to clean unexpected smoke-test path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function isolatedEnv(tempDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ZEROLAG_")) delete env[key];
  }
  env.ZEROLAG_ENV_FILE = path.join(tempDir, "server.env");
  return env;
}

function writePrivateEnv(tempDir) {
  const backupDir = path.join(tempDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const envPath = path.join(tempDir, "server.env");
  const lines = [
    `ZEROLAG_SERVER_SECRET=${secretFragments[0]}`,
    `ZEROLAG_ADMIN_SECRET=${secretFragments[1]}`,
    `ZEROLAG_PAYMENT_WEBHOOK_SECRET=${secretFragments[2]}`,
    "ZEROLAG_SERVER_HOST=0.0.0.0",
    "ZEROLAG_SERVER_PORT=8787",
    `ZEROLAG_SERVER_STATE_PATH=${path.join(tempDir, "server-state.json")}`,
    `ZEROLAG_SERVER_BACKUP_DIR=${backupDir}`,
    "ZEROLAG_STATE_STORE=sqlite",
    `ZEROLAG_SQLITE_STATE_PATH=${path.join(tempDir, "server-state.sqlite")}`,
    `ZEROLAG_SQLITE_BACKUP_DIR=${backupDir}`,
    "ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS=24",
    "ZEROLAG_PAYMENT_PROVIDER=wechat_pay",
    "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS=wechat_pay",
    "ZEROLAG_PAYMENT_URL_TEMPLATE=https://pay.zerolag.test/checkout/{orderId}",
    "ZEROLAG_PAYMENT_MESSAGE=Open the secure checkout page to finish payment.",
    "ZEROLAG_RATE_LIMIT_DISABLED=0",
    "ZEROLAG_SERVER_BACKUP_DISABLED=0",
    "ZEROLAG_MAINTENANCE_DISABLED=0"
  ];
  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, "utf8");
  return envPath;
}

function runNpm(args, tempDir) {
  const command = npmInvocation(args);
  const result = spawnSync(command.command, command.args, {
    cwd: rootDir,
    env: isolatedEnv(tempDir),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert(result.status === 0, `npm ${args.join(" ")} failed:\n${result.error ? result.error.message : ""}\n${result.stderr || result.stdout}`);
  return result;
}

function readText(filePath) {
  assert(fs.existsSync(filePath), `Expected report file missing: ${path.basename(filePath)}`);
  const stats = fs.statSync(filePath);
  assert(stats.isFile() && stats.size > 100, `Report file looks too small: ${path.basename(filePath)}`);
  return fs.readFileSync(filePath, "utf8");
}

function assertNoSensitiveText(text, label, tempDir) {
  const forbidden = [
    rootDir,
    rootDir.replace(/\\/g, "/"),
    tempDir,
    tempDir.replace(/\\/g, "/"),
    ...secretFragments
  ];

  for (const pattern of forbidden) {
    assert(!String(text || "").includes(pattern), `${label} leaked sensitive text: ${pattern}`);
  }
}

function assertReportPair(markdownPath, jsonPath, tempDir) {
  const markdown = readText(markdownPath);
  const jsonText = readText(jsonPath);
  assertNoSensitiveText(markdown, path.basename(markdownPath), tempDir);
  assertNoSensitiveText(jsonText, path.basename(jsonPath), tempDir);
  return JSON.parse(jsonText);
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-ci-reports-smoke-"));

  try {
    writePrivateEnv(tempDir);

    const serverReport = path.join(tempDir, "server-deployment-report.md");
    const serverReportJson = path.join(tempDir, "server-deployment-report.json");

    runNpm(["run", "server:deployment-report", "--", "--output", serverReport], tempDir);
    runNpm(["run", "server:deployment-report:json", "--", "--output", serverReportJson], tempDir);
    runNpm(["run", "release:report", "--", "--output-dir", tempDir], tempDir);

    const serverData = assertReportPair(serverReport, serverReportJson, tempDir);
    assert(serverData.snapshot.privateEnvFile.loaded === true, "Server report should load the isolated env file.");
    assert(serverData.snapshot.privateEnvFile.path === "server.env (external)", "Server report should sanitize the env file path.");
    assert(serverData.envCheck.issueCount === 0, "Server report should not have env issues with the isolated CI env.");
    assert(serverData.storage.stateStore === "sqlite", "Server report should capture the SQLite profile.");
    assert(serverData.payment.provider === "wechat_pay", "Server report should capture the configured payment provider.");

    const releaseMarkdown = path.join(tempDir, "release-candidate-report.md");
    const releaseJson = path.join(tempDir, "release-candidate-report.json");
    const releaseData = assertReportPair(releaseMarkdown, releaseJson, tempDir);
    assert(releaseData.serverDeployment.snapshot.privateEnvFile.loaded === true, "Release report should embed the loaded server env summary.");
    assert(Array.isArray(releaseData.serverDeployment.gates), "Release report should embed server deployment gates.");
    assert(releaseData.serverDeployment.envCheck.issueCount === 0, "Release report should embed the env-check result.");

    console.log("ZeroLag CI report artifact smoke test passed.");
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
