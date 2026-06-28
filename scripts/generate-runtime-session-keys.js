const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const defaultOutputDir = path.join(rootDir, ".secrets", "runtime-session");
const defaultKeyVersion = "runtime-session-v1";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/generate-runtime-session-keys.js [--output-dir dir] [--key-version label] [--force]");
  console.log("");
  console.log("Writes private server env material and public desktop config snippets without printing private keys.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function safeKeyVersion(value) {
  const normalized = String(value || defaultKeyVersion)
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 64);
  return normalized || defaultKeyVersion;
}

function writeFileRefusingOverwrite(filePath, content, force) {
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`Refusing to overwrite existing file: ${filePath}`);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function relativePath(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, "/");
  }

  return `${path.basename(filePath)} (external)`;
}

function sha256Short(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function generateRuntimeSessionKeys(input = {}) {
  const outputDir = path.resolve(input.outputDir || defaultOutputDir);
  const force = input.force === true;
  const keyVersion = safeKeyVersion(input.keyVersion);
  const generatedAt = new Date().toISOString();
  const keypair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: {
      type: "spki",
      format: "pem"
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem"
    }
  });

  const privateKeyPem = keypair.privateKey;
  const publicKeyPem = keypair.publicKey;
  const privateKeyPath = path.join(outputDir, `${keyVersion}.private.pem`);
  const publicKeyPath = path.join(outputDir, `${keyVersion}.public.pem`);
  const serverEnvPath = path.join(outputDir, `${keyVersion}.server.env`);
  const appConfigSnippetPath = path.join(outputDir, `${keyVersion}.app-config-snippet.json`);
  const serverEnv = [
    "# ZeroLag runtime-session RSA proof configuration",
    `# Generated at ${generatedAt}`,
    "# Keep this file private. Do not commit it to Git.",
    `ZEROLAG_RUNTIME_SESSION_KEY_VERSION=${keyVersion}`,
    "ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM=RSA-SHA256",
    `ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64=${Buffer.from(privateKeyPem, "utf8").toString("base64")}`,
    ""
  ].join("\n");
  const appConfigSnippet = {
    runtimeSessionPublicKeyPem: publicKeyPem.replace(/\n/g, "\\n")
  };

  writeFileRefusingOverwrite(privateKeyPath, privateKeyPem, force);
  writeFileRefusingOverwrite(publicKeyPath, publicKeyPem, force);
  writeFileRefusingOverwrite(serverEnvPath, serverEnv, force);
  writeFileRefusingOverwrite(appConfigSnippetPath, `${JSON.stringify(appConfigSnippet, null, 2)}\n`, force);

  return {
    ok: true,
    keyVersion,
    generatedAt,
    algorithm: "RSA-SHA256",
    privateKeyPath: relativePath(privateKeyPath),
    publicKeyPath: relativePath(publicKeyPath),
    serverEnvPath: relativePath(serverEnvPath),
    appConfigSnippetPath: relativePath(appConfigSnippetPath),
    publicKeySha256: sha256Short(publicKeyPem)
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  try {
    const result = generateRuntimeSessionKeys({
      outputDir: argValue("--output-dir", defaultOutputDir),
      keyVersion: argValue("--key-version", defaultKeyVersion),
      force: process.argv.includes("--force")
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
  generateRuntimeSessionKeys
};
