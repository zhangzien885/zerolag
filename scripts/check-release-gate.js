const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const defaultOutputDir = path.join(rootDir, "dist");

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function usage() {
  console.log("Usage:");
  console.log("  node scripts/check-release-gate.js [--output-dir path] [--no-generate]");
}

function runReleaseReport(outputDir) {
  const result = spawnSync(process.execPath, [
    path.join(rootDir, "scripts", "generate-release-report.js"),
    "--output-dir",
    outputDir
  ], {
    cwd: rootDir,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== 0) {
    throw new Error(`Release report generation failed: ${result.stderr || result.stdout}`);
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Release candidate report is missing: ${path.basename(filePath)}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectFailures(report) {
  const failures = [];

  if (report.git && report.git.dirty) {
    failures.push("Git working tree is dirty; commit or stash changes before cutting a release.");
  }

  for (const item of report.readiness || []) {
    if (!item.ok) failures.push(`Desktop release: ${item.name} - ${item.nextStep || "not ready"}`);
  }

  const packageAudit = report.packageAudit || {};
  if (packageAudit.packagingPolicyReady !== true) {
    failures.push("Package audit: packaging policy must be runtime-only and avoid broad scripts globs.");
  }

  const forbiddenHelpersPresent = Array.isArray(packageAudit.forbiddenHelpersPresent)
    ? packageAudit.forbiddenHelpersPresent
    : [];
  for (const helper of forbiddenHelpersPresent) {
    failures.push(`Package audit: forbidden helper is present in the customer package - ${helper}`);
  }

  const serverDeployment = report.serverDeployment || {};
  const serverGates = Array.isArray(serverDeployment.gates) ? serverDeployment.gates : [];
  if (!serverGates.length) {
    failures.push("Server deployment: gate report is missing.");
  }

  for (const gate of serverGates) {
    if (!gate.ok) failures.push(`Server deployment: ${gate.label} - ${gate.detail || "not ready"}`);
  }

  if (serverGates.length && serverDeployment.ready !== true) {
    failures.push(`Server deployment strict gate is not ready: ${serverDeployment.strictFailureSummary || "unknown"}`);
  }

  return failures;
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const outputDir = path.resolve(argValue("--output-dir", defaultOutputDir));
  if (!process.argv.includes("--no-generate")) runReleaseReport(outputDir);

  const reportPath = path.join(outputDir, "release-candidate-report.json");
  const report = readJson(reportPath);
  const failures = collectFailures(report);

  if (failures.length) {
    console.log("ZeroLag release gate failed.");
    for (const failure of failures) console.log(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("ZeroLag release gate passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
