const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "local-release-rehearsal.js");

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
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-release-rehearsal-smoke-")) {
    throw new Error(`Refusing to remove unexpected temp path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-release-rehearsal-smoke-"));

  try {
    const dryRun = runNode([
      scriptPath,
      "--dry-run",
      "--json",
      "--domain",
      "zerolag.example.com",
      "--output-dir",
      tempRoot
    ]);
    const result = JSON.parse(dryRun.stdout);

    assertOk(result.ok === true, "Dry-run should report ok.");
    assertOk(result.dryRun === true, "Dry-run should identify dry-run mode.");
    assertOk(result.trackedFilesRestored === true, "Dry-run should promise tracked-file restoration.");
    assertOk(result.installerName === "ZeroLag-Setup-0.1.0.exe", "Dry-run should render the configured artifact name.");
    assertOk(result.apiDomain === "api.zerolag.example.com", "Dry-run should default API placeholder domain.");
    assertOk(result.cdnDomain === "cdn.zerolag.example.com", "Dry-run should default CDN placeholder domain.");
    assertOk(Array.isArray(result.steps), "Dry-run should include planned steps.");
    assertOk(result.steps.some((step) => step.includes("test code-signing")), "Plan should include local test signing.");
    assertOk(result.steps.some((step) => step.includes("temporarily apply")), "Plan should include temporary config application.");
    assertOk(result.steps.some((step) => step.includes("restore tracked app config")), "Plan should include config restoration.");
    assertOk(!fs.existsSync(path.join(tempRoot, "summary.json")), "Dry-run must not write rehearsal output.");

    const help = runNode([scriptPath, "--help"]);
    assertOk(help.stdout.includes("--skip-build"), "Help should document skip-build mode.");
    assertOk(help.stdout.includes("--dry-run"), "Help should document dry-run mode.");

    console.log("ZeroLag local release rehearsal smoke test passed.");
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
