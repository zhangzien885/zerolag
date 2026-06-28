const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/sign-update-manifest.js --generate-keypair <privateKeyPem> <publicKeyPem>");
  console.log("  node scripts/sign-update-manifest.js <manifestJson> <privateKeyPem>");
  console.log("  node scripts/sign-update-manifest.js --verify <manifestJson> <publicKeyPem>");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function signingBody(manifest) {
  const payload = { ...(manifest || {}) };
  delete payload.signature;
  delete payload.signatureError;
  delete payload.signatureValid;
  delete payload.signed;
  delete payload.source;
  return stableStringify(payload);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function generateKeypair(privateKeyPath, publicKeyPath) {
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

  writeText(privateKeyPath, keypair.privateKey);
  writeText(publicKeyPath, keypair.publicKey);
  console.log(JSON.stringify({
    ok: true,
    privateKeyPath: path.resolve(privateKeyPath),
    publicKeyPath: path.resolve(publicKeyPath)
  }, null, 2));
}

function signManifest(manifestPath, privateKeyPath) {
  const manifest = {
    ...readJson(manifestPath),
    signatureAlgorithm: "RSA-SHA256"
  };
  const privateKey = fs.readFileSync(privateKeyPath, "utf8");
  const signature = crypto.sign("sha256", Buffer.from(signingBody(manifest), "utf8"), privateKey);
  const signedManifest = {
    ...manifest,
    signature: signature.toString("base64")
  };

  writeText(manifestPath, `${JSON.stringify(signedManifest, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    manifestPath: path.resolve(manifestPath),
    signatureAlgorithm: signedManifest.signatureAlgorithm
  }, null, 2));
}

function verifyManifest(manifestPath, publicKeyPath) {
  const manifest = readJson(manifestPath);
  const publicKey = fs.readFileSync(publicKeyPath, "utf8");
  const signature = Buffer.from(String(manifest.signature || ""), "base64");
  const verified = Boolean(manifest.signature)
    && crypto.verify("sha256", Buffer.from(signingBody(manifest), "utf8"), publicKey, signature);

  console.log(JSON.stringify({
    ok: verified,
    manifestPath: path.resolve(manifestPath)
  }, null, 2));

  if (!verified) {
    process.exitCode = 1;
  }
}

function main() {
  const command = process.argv[2];

  if (!command || process.argv.includes("--help")) {
    usage();
    return;
  }

  if (command === "--generate-keypair") {
    const privateKeyPath = process.argv[3];
    const publicKeyPath = process.argv[4];
    if (!privateKeyPath || !publicKeyPath) {
      usage();
      process.exitCode = 1;
      return;
    }

    generateKeypair(privateKeyPath, publicKeyPath);
    return;
  }

  if (command === "--verify") {
    const manifestPath = process.argv[3];
    const publicKeyPath = process.argv[4];
    if (!manifestPath || !publicKeyPath) {
      usage();
      process.exitCode = 1;
      return;
    }

    verifyManifest(manifestPath, publicKeyPath);
    return;
  }

  const manifestPath = process.argv[2];
  const privateKeyPath = process.argv[3];
  if (!manifestPath || !privateKeyPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  signManifest(manifestPath, privateKeyPath);
}

main();
