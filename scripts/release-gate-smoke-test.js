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

function writePassingReport(tempDir) {
  const reportPath = path.join(tempDir, "release-candidate-report.json");
  const report = {
    generatedAt: new Date().toISOString(),
    git: {
      dirty: false
    },
    readiness: [
      {
        name: "Release mode",
        ok: true,
        nextStep: "Ready"
      },
      {
        name: "Installer artifacts",
        ok: true,
        nextStep: "Ready"
      }
    ],
    packageAudit: {
      packagingPolicyReady: true,
      forbiddenHelpersPresent: []
    },
    serverDeployment: {
      ready: true,
      strictFailureSummary: "",
      gates: [
        {
          label: "Private env file passes validation",
          ok: true,
          detail: "0 issue(s), 0 warning(s)"
        },
        {
          label: "Rate limit, backup, and maintenance guards are enabled",
          ok: true,
          detail: "enabled"
        }
      ]
    }
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

function writeForbiddenHelperReport(tempDir) {
  const reportPath = writePassingReport(tempDir);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.packageAudit = {
    packagingPolicyReady: true,
    forbiddenHelpersPresent: ["scripts/generate-runtime-session-keys.js"]
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
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

    writePassingReport(tempDir);
    const passing = spawnSync(process.execPath, [
      path.join(rootDir, "scripts", "check-release-gate.js"),
      "--no-generate",
      "--output-dir",
      tempDir
    ], {
      cwd: rootDir,
      env: isolatedEnv(tempDir),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    assert(passing.status === 0, `Release gate should pass for a ready fixture: ${passing.stderr || passing.stdout}`);
    assert(passing.stdout.includes("ZeroLag release gate passed."), "Release gate should print a clear passing header.");
    assertNoSensitiveText(passing.stdout, "Passing release gate stdout");
    assertNoSensitiveText(passing.stderr, "Passing release gate stderr");

    writeForbiddenHelperReport(tempDir);
    const forbiddenHelper = spawnSync(process.execPath, [
      path.join(rootDir, "scripts", "check-release-gate.js"),
      "--no-generate",
      "--output-dir",
      tempDir
    ], {
      cwd: rootDir,
      env: isolatedEnv(tempDir),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    assert(forbiddenHelper.status === 1, "Release gate should fail when the package audit finds a forbidden helper.");
    assert(forbiddenHelper.stdout.includes("Package audit:"), "Release gate should explain package audit failures.");
    assert(forbiddenHelper.stdout.includes("scripts/generate-runtime-session-keys.js"), "Release gate should name the forbidden helper.");
    assertNoSensitiveText(forbiddenHelper.stdout, "Forbidden-helper release gate stdout");
    assertNoSensitiveText(forbiddenHelper.stderr, "Forbidden-helper release gate stderr");

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
