const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const defaultOutputPath = path.join(rootDir, ".secrets", "server.env");

function randomSecret(label) {
  return `zl_${label}_${crypto.randomBytes(48).toString("base64url")}`;
}

function parseArgs(argv) {
  const args = {
    force: false,
    profile: "json",
    write: false,
    outputPath: defaultOutputPath
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      args.help = true;
      continue;
    }

    if (arg === "--force") {
      args.force = true;
      continue;
    }

    if (arg === "--sqlite") {
      args.profile = "sqlite";
      continue;
    }

    if (arg === "--profile") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        args.profile = String(next).trim().toLowerCase();
        index += 1;
      }
      continue;
    }

    if (arg === "--write") {
      args.write = true;
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        args.outputPath = path.resolve(next);
        index += 1;
      }
    }
  }

  return args;
}

function usage() {
  console.log("Usage:");
  console.log("  node scripts/generate-server-secrets.js [--profile json|sqlite] [--sqlite] [--write [file]] [--force]");
}

function normalizeProfile(value) {
  return value === "sqlite" ? "sqlite" : "json";
}

function stateStorageLines(profile) {
  if (profile === "sqlite") {
    return [
      "ZEROLAG_STATE_STORE=sqlite",
      "ZEROLAG_SQLITE_STATE_PATH=server/data/server-state.sqlite",
      "ZEROLAG_SQLITE_BACKUP_DIR=server/data/backups",
      "ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS=24",
      "ZEROLAG_SERVER_STATE_PATH=server/data/server-state.json",
      "ZEROLAG_SERVER_BACKUP_DIR=server/data/backups"
    ];
  }

  return [
    "ZEROLAG_STATE_STORE=json",
    "ZEROLAG_SERVER_STATE_PATH=server/data/server-state.json",
    "ZEROLAG_SERVER_BACKUP_DIR=server/data/backups",
    "",
    "# Uncomment this block after running the JSON-to-SQLite migration for wider paid testing.",
    "# ZEROLAG_STATE_STORE=sqlite",
    "# ZEROLAG_SQLITE_STATE_PATH=server/data/server-state.sqlite",
    "# ZEROLAG_SQLITE_BACKUP_DIR=server/data/backups",
    "# ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS=24"
  ];
}

function buildEnvFile(inputProfile = "json") {
  const profile = normalizeProfile(inputProfile);
  const generatedAt = new Date().toISOString();
  return [
    "# ZeroLag server production environment",
    `# Generated at ${generatedAt}`,
    `# Profile: ${profile}`,
    "# Keep this file private. Do not commit it to Git.",
    "",
    `ZEROLAG_SERVER_SECRET=${randomSecret("server")}`,
    `ZEROLAG_ADMIN_SECRET=${randomSecret("admin")}`,
    `ZEROLAG_PAYMENT_WEBHOOK_SECRET=${randomSecret("payment")}`,
    "ZEROLAG_RUNTIME_SESSION_KEY_VERSION=runtime-session-v1",
    "ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM=HMAC-SHA256",
    "# For paid public release, prefer RSA-SHA256 and keep the private key only on the server.",
    "# ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64=",
    "# ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_PEM=",
    "",
    "ZEROLAG_SERVER_HOST=127.0.0.1",
    "ZEROLAG_SERVER_PORT=8787",
    "",
    "# State storage",
    ...stateStorageLines(profile),
    "",
    "# Payment provider placeholders. Replace these before a paid public release.",
    "ZEROLAG_PAYMENT_PROVIDER=manual",
    "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS=manual,manual-admin",
    "ZEROLAG_PAYMENT_URL_TEMPLATE=zerolag://pay/{orderId}",
    "ZEROLAG_PAYMENT_MESSAGE=Manual payment confirmation is required.",
    "",
    "# WeChat Pay production placeholders. Uncomment and fill after merchant approval.",
    "# ZEROLAG_WECHAT_PAY_MCH_ID=",
    "# ZEROLAG_WECHAT_PAY_APP_ID=",
    "# ZEROLAG_WECHAT_PAY_API_V3_KEY=",
    "# ZEROLAG_WECHAT_PAY_SERIAL_NO=",
    "# ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH=",
    "",
    "# Alipay production placeholders. Uncomment and fill after merchant approval.",
    "# ZEROLAG_ALIPAY_APP_ID=",
    "# ZEROLAG_ALIPAY_PRIVATE_KEY_PATH=",
    "# ZEROLAG_ALIPAY_PUBLIC_KEY_PATH=",
    "",
    "# Leave these unset or set to 0 for production safety.",
    "ZEROLAG_RATE_LIMIT_DISABLED=0",
    "ZEROLAG_SERVER_BACKUP_DISABLED=0",
    "ZEROLAG_MAINTENANCE_DISABLED=0",
    "ZEROLAG_TRUST_PROXY=0",
    ""
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const envFile = buildEnvFile(args.profile);

  if (args.write) {
    if (fs.existsSync(args.outputPath) && !args.force) {
      console.error(`Refusing to overwrite existing file: ${args.outputPath}`);
      console.error("Pass --force if you intentionally want to replace it.");
      process.exitCode = 1;
      return;
    }

    fs.mkdirSync(path.dirname(args.outputPath), { recursive: true });
    fs.writeFileSync(args.outputPath, envFile, "utf8");
    console.log(`Wrote private server env file: ${args.outputPath}`);
    console.log(`Profile: ${normalizeProfile(args.profile)}`);
    console.log("Run `npm run server:check:strict` with these variables loaded before deployment.");
    return;
  }

  console.log(envFile);
  console.log("Tip: run `npm run server:secrets -- --write` to save this under .secrets/server.env.");
  console.log("Tip: add `--profile sqlite` after migration when preparing wider paid testing.");
}

if (require.main === module) {
  main();
}

module.exports = {
  buildEnvFile,
  normalizeProfile,
  randomSecret
};
