const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadServerEnvFile } = require("../server/env");
const { createSqliteStateStore } = require("../server/state-store");

const rootDir = path.join(__dirname, "..");
const defaultSqliteStatePath = path.join(rootDir, "server", "data", "server-state.sqlite");

loadServerEnvFile();

function usage() {
  console.log("Usage:");
  console.log("  node scripts/restore-sqlite-state.js --input backup.sqlite [--output file] [--force] [--allow-empty] [--dry-run]");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stateSummary(state) {
  return {
    activationCodes: Object.keys(state.activationCodes || {}).length,
    orders: Object.keys(state.orders || {}).length,
    paymentEvents: Object.keys(state.paymentEvents || {}).length,
    subscriptions: Object.keys(state.subscriptions || {}).length,
    tokens: Object.keys(state.tokens || {}).length,
    websiteEvents: Number(state.websiteEvents && state.websiteEvents.total || 0),
    auditEvents: Array.isArray(state.auditEvents) ? state.auditEvents.length : 0
  };
}

function sameFilePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function printFailure(message, extra = {}) {
  console.log(JSON.stringify({
    ok: false,
    message,
    ...extra
  }, null, 2));
  process.exitCode = 1;
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const inputArg = argValue("--input");
  const outputArg = argValue("--output");
  const force = process.argv.includes("--force");
  const allowEmpty = process.argv.includes("--allow-empty");
  const dryRun = process.argv.includes("--dry-run");

  if (!inputArg) {
    printFailure("Input SQLite backup file is required. Pass --input backup.sqlite.");
    return;
  }

  const inputFile = path.resolve(inputArg);
  const outputFile = path.resolve(outputArg || process.env.ZEROLAG_SQLITE_STATE_PATH || defaultSqliteStatePath);

  if (!fs.existsSync(inputFile)) {
    printFailure("Input SQLite backup file does not exist.", { inputFile });
    return;
  }

  if (sameFilePath(inputFile, outputFile)) {
    printFailure("Input and output SQLite files must be different.", { inputFile, outputFile });
    return;
  }

  const targetExists = fs.existsSync(outputFile);
  if (targetExists && !force && !dryRun) {
    printFailure("Output SQLite state already exists. Use --force to restore into it.", { outputFile });
    return;
  }

  const sourceStore = createSqliteStateStore(inputFile);
  try {
    const loadedState = sourceStore.loadState();
    if (!loadedState && !allowEmpty) {
      printFailure("Input SQLite backup is empty. Use --allow-empty to restore an empty state document.", { inputFile });
      return;
    }

    const state = loadedState || {};
    const stateSha256 = sha256Json(state);
    const summary = stateSummary(state);

    if (dryRun) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        inputFile,
        outputFile,
        targetExists,
        forceRequired: targetExists,
        stateSha256,
        summary
      }, null, 2));
      return;
    }

    const targetStore = createSqliteStateStore(outputFile);
    try {
      targetStore.saveState(state);
      const restoredState = targetStore.loadState();
      const restoredSha256 = sha256Json(restoredState);
      if (restoredSha256 !== stateSha256) {
        printFailure("Restored SQLite state did not match the input backup state.", {
          inputFile,
          outputFile,
          sourceSha256: stateSha256,
          restoredSha256
        });
        return;
      }

      console.log(JSON.stringify({
        ok: true,
        inputFile,
        outputFile,
        targetExisted: targetExists,
        stateSha256,
        summary
      }, null, 2));
    } finally {
      targetStore.close();
    }
  } finally {
    sourceStore.close();
  }
}

main();
