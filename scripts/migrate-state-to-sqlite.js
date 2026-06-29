const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadServerEnvFile } = require("../server/env");
const { loadState } = require("../server");
const { createSqliteStateStore } = require("../server/state-store");

const rootDir = path.join(__dirname, "..");
const defaultJsonStatePath = path.join(rootDir, "server", "data", "server-state.json");
const defaultSqliteStatePath = path.join(rootDir, "server", "data", "server-state.sqlite");

loadServerEnvFile();

function usage() {
  console.log("Usage:");
  console.log("  node scripts/migrate-state-to-sqlite.js [--input file] [--output file] [--force] [--allow-empty] [--dry-run]");
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

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const inputFile = path.resolve(argValue("--input", process.env.ZEROLAG_SERVER_STATE_PATH || defaultJsonStatePath));
  const outputFile = path.resolve(argValue("--output", process.env.ZEROLAG_SQLITE_STATE_PATH || defaultSqliteStatePath));
  const force = process.argv.includes("--force");
  const allowEmpty = process.argv.includes("--allow-empty");
  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(inputFile) && !allowEmpty) {
    console.log(JSON.stringify({
      ok: false,
      message: "Input JSON state file does not exist. Use --allow-empty to create an empty SQLite state.",
      inputFile
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (fs.existsSync(outputFile) && !force && !dryRun) {
    console.log(JSON.stringify({
      ok: false,
      message: "Output SQLite state file already exists. Use --force to update it.",
      outputFile
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const state = loadState({
    statePath: inputFile,
    storage: {
      kind: "json"
    }
  });
  const stateSha256 = sha256Json(state);
  const summary = stateSummary(state);

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      inputFile,
      outputFile,
      stateSha256,
      summary
    }, null, 2));
    return;
  }

  const store = createSqliteStateStore(outputFile);
  try {
    store.saveState(state);
    const migratedState = store.loadState();
    const migratedSha256 = sha256Json(migratedState);
    if (migratedSha256 !== stateSha256) {
      console.log(JSON.stringify({
        ok: false,
        message: "Migrated SQLite state did not match the source JSON state.",
        inputFile,
        outputFile,
        sourceSha256: stateSha256,
        migratedSha256
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify({
      ok: true,
      inputFile,
      outputFile,
      stateSha256,
      summary
    }, null, 2));
  } finally {
    store.close();
  }
}

main();
