const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const defaultCodeSigningEnvPath = path.join(rootDir, ".secrets", "codesign", "test-signing.env");
const strict = process.argv.includes("--strict");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/check-code-signing-env.js [--strict] [--env-file path]");
  console.log("");
  console.log("Checks whether Windows code-signing env variables are present without printing secret values.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex <= 0) return null;
  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return key ? { key, value } : null;
}

function loadCodeSigningEnvFile(env = process.env, explicitEnvPath = "") {
  const candidate = explicitEnvPath
    || String(env.ZEROLAG_CODESIGN_ENV_FILE || "").trim()
    || defaultCodeSigningEnvPath;

  if (!candidate || !fs.existsSync(path.resolve(candidate))) {
    return {
      loaded: false,
      path: candidate
    };
  }

  const loaded = {};
  for (const line of fs.readFileSync(path.resolve(candidate), "utf8").split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (entry && !Object.prototype.hasOwnProperty.call(env, entry.key)) {
      loaded[entry.key] = entry.value;
    }
  }

  return {
    loaded: true,
    path: path.resolve(candidate),
    env: loaded
  };
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
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && relative.replace(/\\/g, "/").startsWith(".secrets/")) return "private-secret-file";
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return `repo:${relative.replace(/\\/g, "/")}`;
  return "external-file";
}

function inspectSigningEnv(env = process.env, options = {}) {
  const envFile = options.loadEnvFile === false ? { loaded: false } : loadCodeSigningEnvFile(env, options.envFile || "");
  const effectiveEnv = {
    ...(envFile.env || {}),
    ...env
  };
  const certValue = String(effectiveEnv.CSC_LINK || effectiveEnv.WIN_CSC_LINK || effectiveEnv.WINDOWS_CODESIGN_CERT || effectiveEnv.ZEROLAG_CODESIGN_CERT || "").trim();
  const passwordPresent = Boolean(
    String(effectiveEnv.CSC_KEY_PASSWORD || effectiveEnv.WIN_CSC_KEY_PASSWORD || effectiveEnv.WINDOWS_CODESIGN_PASSWORD || effectiveEnv.ZEROLAG_CODESIGN_PASSWORD || "").trim()
  );
  const profile = String(effectiveEnv.ZEROLAG_CODESIGN_PROFILE || "").trim().toLowerCase() || "production";
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

  if (profile === "test") {
    warnings.push("Using a local test code-signing certificate; this is not valid for paid public release.");
  }

  return {
    ok: issues.length === 0,
    productionReady: issues.length === 0 && profile !== "test",
    profile,
    certificateConfigured: Boolean(certValue),
    certificateSource,
    passwordConfigured: passwordPresent,
    envFileLoaded: Boolean(envFile.loaded),
    envFileSource: envFile.loaded ? safeLocation(envFile.path) : "not-loaded",
    issues,
    warnings
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const result = inspectSigningEnv(process.env, {
    envFile: argValue("--env-file", "")
  });
  console.log("ZeroLag Windows code signing environment");
  console.log(`Profile: ${result.profile}`);
  console.log(`Certificate: ${result.certificateConfigured ? "configured" : "missing"}`);
  console.log(`Certificate source: ${result.certificateSource}`);
  console.log(`Password: ${result.passwordConfigured ? "configured" : "missing"}`);
  console.log(`Env file: ${result.envFileLoaded ? result.envFileSource : "not loaded"}`);

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
  defaultCodeSigningEnvPath,
  loadCodeSigningEnvFile,
  inspectSigningEnv
};
