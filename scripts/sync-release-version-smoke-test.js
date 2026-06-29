const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "sync-release-version.js");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-release-version-smoke-")) {
    throw new Error(`Refusing to remove unexpected temp path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-release-version-smoke-"));
  const packagePath = path.join(tempRoot, "package.json");
  const updatePath = path.join(tempRoot, "update.json");

  try {
    writeJson(packagePath, {
      name: "zerolag",
      version: "0.1.0",
      description: "fixture"
    });
    writeJson(updatePath, {
      latest: "0.1.1",
      minSupported: "0.1.0",
      force: false,
      releaseNotes: ["Keep me"]
    });

    const mismatch = runNode([scriptPath, "--package", packagePath, "--update", updatePath], 1);
    const mismatchResult = JSON.parse(mismatch.stdout);
    assertOk(mismatchResult.ok === false, "Dry-run mismatch should report not ok.");
    assertOk(mismatchResult.changes.updateLatest === true, "Dry-run should report update latest mismatch.");
    assertOk(readJson(packagePath).version === "0.1.0", "Dry-run must not mutate package.json.");
    assertOk(readJson(updatePath).latest === "0.1.1", "Dry-run must not mutate update manifest.");

    const written = runNode([
      scriptPath,
      "--version",
      "1.2.3",
      "--min-supported",
      "1.0.0",
      "--package",
      packagePath,
      "--update",
      updatePath,
      "--write"
    ]);
    const writtenResult = JSON.parse(written.stdout);
    const packageJson = readJson(packagePath);
    const updateManifest = readJson(updatePath);
    assertOk(writtenResult.ok === true, "Write mode should report ok.");
    assertOk(writtenResult.written === true, "Write mode should report written.");
    assertOk(packageJson.version === "1.2.3", "Write mode should update package version.");
    assertOk(updateManifest.latest === "1.2.3", "Write mode should update manifest latest.");
    assertOk(updateManifest.minSupported === "1.0.0", "Write mode should update minimum supported version.");
    assertOk(updateManifest.releaseNotes[0] === "Keep me", "Write mode should preserve release notes.");
    assertOk(updateManifest.force === false, "Write mode should preserve update policy fields.");

    const aligned = runNode([scriptPath, "--package", packagePath, "--update", updatePath]);
    const alignedResult = JSON.parse(aligned.stdout);
    assertOk(alignedResult.ok === true, "Aligned dry-run should pass.");
    assertOk(alignedResult.changes.packageVersion === false, "Aligned dry-run should report no package change.");
    assertOk(alignedResult.changes.updateLatest === false, "Aligned dry-run should report no manifest latest change.");

    runNode([scriptPath, "--version", "1.2", "--package", packagePath, "--update", updatePath], 1);

    console.log("ZeroLag release version sync smoke test passed.");
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
