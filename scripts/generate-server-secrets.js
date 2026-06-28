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
    write: false,
    outputPath: defaultOutputPath
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      args.force = true;
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

function buildEnvFile() {
  const generatedAt = new Date().toISOString();
  return [
    "# ZeroLag server production environment",
    `# Generated at ${generatedAt}`,
    "# Keep this file private. Do not commit it to Git.",
    "",
    `ZEROLAG_SERVER_SECRET=${randomSecret("server")}`,
    `ZEROLAG_ADMIN_SECRET=${randomSecret("admin")}`,
    `ZEROLAG_PAYMENT_WEBHOOK_SECRET=${randomSecret("payment")}`,
    "",
    "ZEROLAG_SERVER_HOST=127.0.0.1",
    "ZEROLAG_SERVER_PORT=8787",
    "ZEROLAG_SERVER_STATE_PATH=server/data/server-state.json",
    "ZEROLAG_SERVER_BACKUP_DIR=server/data/backups",
    "",
    "# Leave these unset or set to 0 for production safety.",
    "ZEROLAG_RATE_LIMIT_DISABLED=0",
    "ZEROLAG_SERVER_BACKUP_DISABLED=0",
    "ZEROLAG_MAINTENANCE_DISABLED=0",
    ""
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = buildEnvFile();

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
    console.log("Run `npm run server:check:strict` with these variables loaded before deployment.");
    return;
  }

  console.log(envFile);
  console.log("Tip: run `npm run server:secrets -- --write` to save this under .secrets/server.env.");
}

main();
