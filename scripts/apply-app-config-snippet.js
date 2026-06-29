const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const defaultConfigPath = path.join(rootDir, "assets", "app-config.json");
const allowedKeys = new Set(["updatePublicKeyPem", "runtimeSessionPublicKeyPem"]);

function usage() {
  console.log("Usage:");
  console.log("  node scripts/apply-app-config-snippet.js --snippet file [--config assets/app-config.json] [--write]");
  console.log("");
  console.log("Safely applies public-key app-config snippets. Dry-run is default.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizePem(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function isPublicKeyPem(value) {
  return /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/m.test(normalizePem(value));
}

function containsPrivateKey(value) {
  return /PRIVATE KEY/i.test(String(value || ""));
}

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(filePath)} (external)`;
}

function sanitizeSnippet(snippet) {
  const patch = {};
  const rejectedKeys = [];

  for (const [key, value] of Object.entries(snippet || {})) {
    if (!allowedKeys.has(key)) {
      rejectedKeys.push(key);
      continue;
    }

    if (containsPrivateKey(value)) {
      throw new Error(`${key} appears to contain private key material.`);
    }

    if (!isPublicKeyPem(value)) {
      throw new Error(`${key} must be a PEM public key.`);
    }

    patch[key] = normalizePem(value).replace(/\n/g, "\\n");
  }

  if (!Object.keys(patch).length) {
    throw new Error("Snippet does not contain any supported app-config public key fields.");
  }

  return { patch, rejectedKeys };
}

function applyAppConfigSnippet(input = {}) {
  const snippetPath = path.resolve(input.snippetPath || "");
  if (!input.snippetPath) throw new Error("--snippet is required.");
  const configPath = path.resolve(input.configPath || defaultConfigPath);
  const write = input.write === true;
  const config = readJson(configPath);
  const snippet = readJson(snippetPath);
  const { patch, rejectedKeys } = sanitizeSnippet(snippet);
  const changes = Object.fromEntries(Object.keys(patch).map((key) => [key, config[key] !== patch[key]]));

  if (write) {
    writeJson(configPath, { ...config, ...patch });
  }

  return {
    ok: true,
    written: write,
    configFile: safeRelative(configPath),
    snippetFile: safeRelative(snippetPath),
    appliedKeys: Object.keys(patch),
    rejectedKeys,
    changes,
    nextSteps: [
      "Run npm run production:check after applying public-key snippets.",
      "Keep private keys and server env files outside Git."
    ]
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  try {
    const result = applyAppConfigSnippet({
      snippetPath: argValue("--snippet"),
      configPath: argValue("--config", defaultConfigPath),
      write: process.argv.includes("--write")
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  applyAppConfigSnippet,
  sanitizeSnippet
};
