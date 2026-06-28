const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const defaultServerEnvPath = path.join(rootDir, ".secrets", "server.env");

function unquote(value) {
  const trimmed = String(value || "").trim();
  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separator = trimmed.indexOf("=");
  if (separator <= 0) return null;

  const key = trimmed.slice(0, separator).trim();
  if (!/^[A-Z0-9_]+$/.test(key)) return null;

  return {
    key,
    value: unquote(trimmed.slice(separator + 1))
  };
}

function serverEnvPath() {
  return path.resolve(process.env.ZEROLAG_ENV_FILE || defaultServerEnvPath);
}

function loadServerEnvFile(inputPath = serverEnvPath()) {
  const filePath = path.resolve(inputPath);
  if (!fs.existsSync(filePath)) {
    return {
      loaded: false,
      path: filePath,
      keys: []
    };
  }

  const keys = [];
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry || process.env[entry.key] !== undefined) continue;

    process.env[entry.key] = entry.value;
    keys.push(entry.key);
  }

  return {
    loaded: true,
    path: filePath,
    keys
  };
}

module.exports = {
  defaultServerEnvPath,
  loadServerEnvFile,
  parseEnvLine,
  serverEnvPath
};
