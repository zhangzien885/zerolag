const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const strict = process.argv.includes("--strict");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/check-code-signing-env.js [--strict]");
  console.log("");
  console.log("Checks whether Windows code-signing env variables are present without printing secret values.");
}

function value(name) {
  return String(process.env[name] || "").trim();
}

function isUrl(valueText) {
  return /^https?:\/\//i.test(valueText);
}

function isBase64Like(valueText) {
  return /^[A-Za-z0-9+/=]+$/.test(valueText) && valueText.length > 128;
}

function isLikelyCertPath(valueText) {
  return /\.(p12|pfx)$/i.test(valueText);
}

function safeLocation(valueText) {
  if (!valueText) return "missing";
  if (isUrl(valueText)) return "remote-url";
  if (isBase64Like(valueText)) return "base64";
  const resolved = path.resolve(valueText);
  const relative = path.relative(rootDir, resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return `repo:${relative.replace(/\\/g, "/")}`;
  return "external-file";
}

function inspectSigningEnv(env = process.env) {
  const certValue = String(env.CSC_LINK || env.WIN_CSC_LINK || env.WINDOWS_CODESIGN_CERT || env.ZEROLAG_CODESIGN_CERT || "").trim();
  const passwordPresent = Boolean(
    String(env.CSC_KEY_PASSWORD || env.WIN_CSC_KEY_PASSWORD || env.WINDOWS_CODESIGN_PASSWORD || env.ZEROLAG_CODESIGN_PASSWORD || "").trim()
  );
  const certificateSource = safeLocation(certValue);
  const issues = [];
  const warnings = [];

  if (!certValue) {
    issues.push("Windows code-signing certificate is not configured.");
  } else if (!isUrl(certValue) && !isBase64Like(certValue)) {
    if (!isLikelyCertPath(certValue)) warnings.push("Certificate path should normally point to a .p12 or .pfx file.");
    if (!fs.existsSync(path.resolve(certValue))) issues.push("Certificate file path does not exist.");
  }

  if (certificateSource.startsWith("repo:")) {
    issues.push("Certificate file must not live inside the repository.");
  }

  if (!passwordPresent) {
    issues.push("Windows code-signing certificate password is not configured.");
  }

  return {
    ok: issues.length === 0,
    certificateConfigured: Boolean(certValue),
    certificateSource,
    passwordConfigured: passwordPresent,
    issues,
    warnings
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const result = inspectSigningEnv();
  console.log("ZeroLag Windows code signing environment");
  console.log(`Certificate: ${result.certificateConfigured ? "configured" : "missing"}`);
  console.log(`Certificate source: ${result.certificateSource}`);
  console.log(`Password: ${result.passwordConfigured ? "configured" : "missing"}`);

  if (result.warnings.length) {
    console.log("\nWarnings:");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }

  if (result.issues.length) {
    console.log("\nBlocking issues:");
    for (const issue of result.issues) console.log(`- ${issue}`);
    if (strict) process.exitCode = 1;
    return;
  }

  console.log("\nWindows code-signing env checks passed.");
}

if (require.main === module) main();

module.exports = {
  inspectSigningEnv
};
