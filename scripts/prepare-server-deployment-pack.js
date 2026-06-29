const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const defaultOutputPath = path.join(rootDir, "dist", "server-deployment");

const copiedFiles = [
  "assets/app-config.json",
  "assets/update.json",
  "server/admin-client.js",
  "server/create-activation-code.js",
  "server/env.js",
  "server/index.js",
  "server/README.md",
  "server/state-store.js",
  "scripts/apply-app-config-snippet.js",
  "scripts/backup-sqlite-state.js",
  "scripts/bootstrap-production-env.js",
  "scripts/check-code-signing-env.js",
  "scripts/check-server-env.js",
  "scripts/check-sqlite-backups.js",
  "scripts/generate-deployment-checklist.js",
  "scripts/generate-runtime-session-keys.js",
  "scripts/generate-server-deployment-report.js",
  "scripts/generate-server-secrets.js",
  "scripts/migrate-state-to-sqlite.js",
  "scripts/payment-loop-smoke-test.js",
  "scripts/server-production-check.js",
  "scripts/server-smoke-test.js",
  "scripts/sign-update-manifest.js",
  "scripts/sqlite-storage-status.js",
  "scripts/restore-sqlite-state.js",
  "docs/release-checklist.md",
  "docs/server-api-contract.md",
  "docs/state-storage-contract.md"
];

function usage() {
  console.log("Usage:");
  console.log("  node scripts/prepare-server-deployment-pack.js [--output path] [--force]");
  console.log("");
  console.log("Creates a deployable ZeroLag server-only package without secrets or desktop app files.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return normalizeSlash(relative);
  return `${path.basename(filePath)} (external)`;
}

function assertSafeCleanTarget(outputPath) {
  const resolved = path.resolve(outputPath);
  const distRoot = path.resolve(rootDir, "dist");
  const tempRoot = path.resolve(os.tmpdir());
  const underDist = resolved.startsWith(`${distRoot}${path.sep}`);
  const underTemp = resolved.startsWith(`${tempRoot}${path.sep}`);
  if (!underDist && !underTemp) {
    throw new Error(`Refusing to clean deployment output outside dist or temp: ${resolved}`);
  }
}

function prepareOutputDir(outputPath, force) {
  const resolved = path.resolve(outputPath);
  if (fs.existsSync(resolved)) {
    if (!force) {
      throw new Error(`Refusing to overwrite existing deployment pack: ${resolved}. Pass --force to replace it.`);
    }

    assertSafeCleanTarget(resolved);
    fs.rmSync(resolved, { recursive: true, force: true });
  }

  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function copyRelativeFile(relativePath, outputRoot) {
  const source = path.join(rootDir, relativePath);
  const target = path.join(outputRoot, relativePath);
  if (!fs.existsSync(source)) {
    throw new Error(`Deployment pack source file is missing: ${relativePath}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function writeText(outputRoot, relativePath, content) {
  const target = path.join(outputRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function deploymentPackageJson() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  return {
    name: "zerolag-server-deployment",
    version: packageJson.version,
    private: true,
    description: "ZeroLag production license server deployment package.",
    type: "commonjs",
    main: "server/index.js",
    engines: {
      node: ">=22"
    },
    scripts: {
      "server:start": "node server/index.js",
      "server:check": "node scripts/server-production-check.js",
      "server:check:strict": "node scripts/server-production-check.js --strict",
      "server:env-check": "node scripts/check-server-env.js",
      "server:env-check:strict": "node scripts/check-server-env.js --profile sqlite --strict",
      "server:smoke": "node scripts/server-smoke-test.js",
      "server:payment-loop": "node scripts/payment-loop-smoke-test.js",
      "server:secrets": "node scripts/generate-server-secrets.js",
      "server:bootstrap": "node scripts/bootstrap-production-env.js",
      "server:create-code": "node server/create-activation-code.js",
      "server:admin": "node server/admin-client.js",
      "server:deployment-report": "node scripts/generate-server-deployment-report.js",
      "server:deployment-report:json": "node scripts/generate-server-deployment-report.js --json",
      "server:deployment-report:strict": "node scripts/generate-server-deployment-report.js --strict",
      "deploy:checklist": "node scripts/generate-deployment-checklist.js",
      "server:migrate-sqlite": "node scripts/migrate-state-to-sqlite.js",
      "server:backup-sqlite": "node scripts/backup-sqlite-state.js",
      "server:restore-sqlite": "node scripts/restore-sqlite-state.js",
      "server:check-sqlite-backups": "node scripts/check-sqlite-backups.js",
      "server:sqlite-status": "node scripts/sqlite-storage-status.js",
      "update:sign": "node scripts/sign-update-manifest.js",
      "app-config:snippet": "node scripts/apply-app-config-snippet.js"
    }
  };
}

function envExample() {
  return `# ZeroLag server environment example
# Copy to .secrets/server.env, then replace every placeholder.
# Keep the real file private. Do not commit it or upload it to the website.

ZEROLAG_SERVER_SECRET=replace-with-generated-server-secret
ZEROLAG_ADMIN_SECRET=replace-with-generated-admin-secret
ZEROLAG_PAYMENT_WEBHOOK_SECRET=replace-with-generated-payment-webhook-secret

ZEROLAG_SERVER_HOST=127.0.0.1
ZEROLAG_SERVER_PORT=8787

ZEROLAG_STATE_STORE=sqlite
ZEROLAG_SQLITE_STATE_PATH=server/data/server-state.sqlite
ZEROLAG_SQLITE_BACKUP_DIR=server/data/backups
ZEROLAG_SQLITE_BACKUP_MAX_AGE_HOURS=24
ZEROLAG_SERVER_STATE_PATH=server/data/server-state.json
ZEROLAG_SERVER_BACKUP_DIR=server/data/backups

ZEROLAG_RUNTIME_SESSION_KEY_VERSION=runtime-session-v1
ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM=RSA-SHA256
ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64=replace-with-server-only-private-key

# Choose one real provider after merchant approval.
ZEROLAG_PAYMENT_PROVIDER=wechat_pay
ZEROLAG_PAYMENT_ALLOWED_PROVIDERS=wechat_pay
ZEROLAG_PAYMENT_URL_TEMPLATE=https://pay.your-domain.example/checkout/{orderId}?amount={amountCents}&currency={currency}
ZEROLAG_PAYMENT_MESSAGE=Open the secure checkout page to finish payment.

# WeChat Pay placeholders.
ZEROLAG_WECHAT_PAY_MCH_ID=
ZEROLAG_WECHAT_PAY_APP_ID=
ZEROLAG_WECHAT_PAY_API_V3_KEY=
ZEROLAG_WECHAT_PAY_SERIAL_NO=
ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH=

# Alipay placeholders.
ZEROLAG_ALIPAY_APP_ID=
ZEROLAG_ALIPAY_PRIVATE_KEY_PATH=
ZEROLAG_ALIPAY_PUBLIC_KEY_PATH=

ZEROLAG_RATE_LIMIT_DISABLED=0
ZEROLAG_SERVER_BACKUP_DISABLED=0
ZEROLAG_MAINTENANCE_DISABLED=0
ZEROLAG_TRUST_PROXY=0
`;
}

function startServerPowerShell() {
  return `param(
  [string]$EnvFile = ".secrets/server.env"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$EnvPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $Root $EnvFile }

if (-not (Test-Path -LiteralPath $EnvPath)) {
  throw "Missing private env file: $EnvPath"
}

$env:ZEROLAG_ENV_FILE = (Resolve-Path -LiteralPath $EnvPath).Path
node (Join-Path $Root "server/index.js")
`;
}

function checkServerPowerShell() {
  return `param(
  [string]$EnvFile = ".secrets/server.env"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$EnvPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $Root $EnvFile }

if (-not (Test-Path -LiteralPath $EnvPath)) {
  throw "Missing private env file: $EnvPath"
}

$env:ZEROLAG_ENV_FILE = (Resolve-Path -LiteralPath $EnvPath).Path
node (Join-Path $Root "scripts/check-server-env.js") --profile sqlite --strict
node (Join-Path $Root "scripts/server-production-check.js") --strict
node (Join-Path $Root "scripts/server-smoke-test.js")
node (Join-Path $Root "scripts/payment-loop-smoke-test.js")
`;
}

function caddyExample() {
  return `# Replace api.your-domain.example before use.
api.your-domain.example {
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
`;
}

function nginxExample() {
  return `# Replace api.your-domain.example and certificate settings before use.
server {
  listen 443 ssl http2;
  server_name api.your-domain.example;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
`;
}

function readme(version) {
  return `# ZeroLag Server Deployment Pack

This folder contains the server-only files needed to run the ZeroLag account, membership, order, payment-webhook, update-manifest, and website analytics API.

It intentionally does not include desktop Electron files, node_modules, private secrets, local state, build outputs, certificates, or merchant keys.

## First Server Setup

1. Install Node.js 22 or newer on the server.
2. Copy this folder to a private server directory.
3. Generate the private environment and runtime-session RSA key:

\`\`\`powershell
npm run server:bootstrap -- --profile sqlite
\`\`\`

4. Edit \`.secrets/server.env\` and replace payment placeholders with real WeChat Pay, Alipay, or provider settings.
5. Configure real HTTPS reverse proxy using \`reverse-proxy/caddy/Caddyfile.example\` or \`reverse-proxy/nginx/zerolag-api.conf.example\`.
6. Run the server checks:

\`\`\`powershell
npm run server:env-check:strict
npm run server:check:strict
npm run server:smoke
npm run server:payment-loop
\`\`\`

7. Start the API:

\`\`\`powershell
.\ops\start-server.ps1
\`\`\`

## Payment Go-Live Check

\`npm run server:payment-loop\` is isolated. It verifies ZeroLag's own paid flow without touching live state: account login, order creation, signed payment success webhook, membership activation, validation, signed refund webhook, and membership revocation.

After connecting a real payment provider, keep provider webhooks pointed at:

\`\`\`text
POST https://api.your-domain.example/v1/payments/webhook
\`\`\`

The provider callback must include \`X-ZeroLag-Signature\` using \`ZEROLAG_PAYMENT_WEBHOOK_SECRET\` until a provider-native adapter replaces the neutral signed webhook.

## Operational Commands

\`\`\`powershell
npm run server:deployment-report
npm run server:deployment-report:json
npm run deploy:checklist
npm run server:backup-sqlite -- --input server/data/server-state.sqlite --output server/data/backups/server-state-backup.sqlite
npm run server:check-sqlite-backups -- --dir server/data/backups --max-age-hours 24
\`\`\`

## Safety Notes

- Keep \`.secrets/server.env\`, SQLite databases, backups, certificates, and merchant private keys outside Git.
- Keep the API behind HTTPS before pointing desktop clients to it.
- Use \`ZEROLAG_TRUST_PROXY=1\` only when the reverse proxy overwrites client IP headers safely.
- Review \`docs/release-checklist.md\` before a paid public release.

Pack version: ${version}
`;
}

function listFiles(outputRoot) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(normalizeSlash(path.relative(outputRoot, fullPath)));
      }
    }
  };

  walk(outputRoot);
  return files.sort();
}

function writeManifest(outputRoot, input) {
  const files = listFiles(outputRoot)
    .filter((file) => file !== "manifest.json")
    .map((file) => ({
      path: file,
      sha256: sha256File(path.join(outputRoot, file)),
      sizeBytes: fs.statSync(path.join(outputRoot, file)).size
    }));

  const manifest = {
    product: "ZeroLag",
    type: "server-deployment-pack",
    version: input.version,
    generatedAt: new Date().toISOString(),
    source: safeRelative(rootDir),
    files
  };
  writeText(outputRoot, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function createDeploymentPack(input = {}) {
  const outputRoot = prepareOutputDir(input.outputPath || defaultOutputPath, input.force === true);
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

  for (const relativePath of copiedFiles) {
    copyRelativeFile(relativePath, outputRoot);
  }

  writeText(outputRoot, "package.json", `${JSON.stringify(deploymentPackageJson(), null, 2)}\n`);
  writeText(outputRoot, ".env.example", envExample());
  writeText(outputRoot, "ops/start-server.ps1", startServerPowerShell());
  writeText(outputRoot, "ops/check-server.ps1", checkServerPowerShell());
  writeText(outputRoot, "reverse-proxy/caddy/Caddyfile.example", caddyExample());
  writeText(outputRoot, "reverse-proxy/nginx/zerolag-api.conf.example", nginxExample());
  writeText(outputRoot, "README.md", readme(packageJson.version));
  const manifest = writeManifest(outputRoot, { version: packageJson.version });

  return {
    output: outputRoot,
    fileCount: manifest.files.length,
    version: packageJson.version
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  try {
    const result = createDeploymentPack({
      outputPath: argValue("--output", defaultOutputPath),
      force: process.argv.includes("--force")
    });
    console.log(`ZeroLag server deployment pack written: ${result.output}`);
    console.log(`Version: ${result.version}`);
    console.log(`Files: ${result.fileCount}`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createDeploymentPack
};
