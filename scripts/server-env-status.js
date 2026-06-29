const fs = require("fs");
const path = require("path");
const { defaultServerEnvPath } = require("../server/env");
const { checkServerEnvFile } = require("./check-server-env");

const rootDir = path.join(__dirname, "..");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/server-env-status.js [--file .secrets/server.env] [--profile any|json|sqlite] [--strict]");
  console.log("");
  console.log("Prints a redacted private server env readiness summary and next commands.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normalizeProfile(value) {
  const text = String(value || "").trim().toLowerCase();
  return ["json", "sqlite"].includes(text) ? text : "any";
}

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(filePath)} (external)`;
}

function summarizeCheck(result) {
  const summary = result.summary || {};
  return {
    exists: fs.existsSync(result.filePath),
    ok: result.ok,
    profile: result.profile,
    keyCount: result.keyCount,
    stateStore: summary.stateStore || "",
    sqliteConfigured: Boolean(summary.sqliteConfigured),
    paymentProvider: summary.paymentProvider || "",
    runtimeSessionProofAlgorithm: summary.runtimeSessionProofAlgorithm || "",
    runtimeSessionAsymmetricProofConfigured: Boolean(summary.runtimeSessionAsymmetricProofConfigured),
    rateLimitEnabled: Boolean(summary.rateLimitEnabled),
    backupsEnabled: Boolean(summary.backupsEnabled),
    maintenanceEnabled: Boolean(summary.maintenanceEnabled),
    issueCount: result.issues.length,
    warningCount: result.warnings.length
  };
}

function nextSteps(result, profile) {
  if (!fs.existsSync(result.filePath)) {
    return [
      `Run npm run server:bootstrap -- --profile ${profile === "any" ? "sqlite" : profile}`,
      "Keep .secrets/server.env private and outside Git.",
      "Run npm run server:env-status after bootstrap finishes."
    ];
  }

  if (result.issues.length) {
    return [
      "Open the private env file locally and replace missing or invalid values.",
      `Run npm run server:env-check -- --file ${safeRelative(result.filePath)} --profile ${profile}`,
      "Run npm run server:check:strict before paid testing."
    ];
  }

  if (result.warnings.length) {
    return [
      "Resolve remaining warnings before paid public release.",
      "Prefer SQLite storage and RSA-SHA256 runtime-session proofs before wider paid testing.",
      "Run npm run server:deployment-report:strict when server deployment is expected to be ready."
    ];
  }

  return [
    "Server env is ready for the selected profile.",
    "Run npm run server:smoke before exposing the service.",
    "Run npm run server:deployment-report:strict for final release review."
  ];
}

function serverEnvStatus(input = {}) {
  const profile = normalizeProfile(input.profile || "any");
  const filePath = path.resolve(input.filePath || defaultServerEnvPath);
  const strict = input.strict === true;
  const check = checkServerEnvFile(filePath, { profile, strict });

  return {
    ok: check.ok,
    strict,
    file: safeRelative(filePath),
    summary: summarizeCheck(check),
    issues: check.issues,
    warnings: check.warnings,
    nextSteps: nextSteps(check, profile)
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const result = serverEnvStatus({
    filePath: argValue("--file", process.env.ZEROLAG_ENV_FILE || defaultServerEnvPath),
    profile: argValue("--profile", "any"),
    strict: process.argv.includes("--strict")
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && result.strict) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  serverEnvStatus
};
