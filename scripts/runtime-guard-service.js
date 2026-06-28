const fs = require("fs");
const os = require("os");
const path = require("path");
const { guardOnce, runCommand } = require("./runtime-guard-core");

const serviceName = "ZeroLagRuntimeGuard";
const appConfigPath = path.join(__dirname, "..", "assets", "app-config.json");

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function defaultSessionPath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "ZeroLag", "runtime-session.json");
}

function readAppConfig() {
  try {
    if (fs.existsSync(appConfigPath)) {
      return JSON.parse(fs.readFileSync(appConfigPath, "utf8"));
    }
  } catch {
    // The guard can still operate on local session signatures without app config.
  }

  return {};
}

function runtimeSessionPublicKeyPem() {
  return argValue("--runtime-session-public-key", "")
    || process.env.ZEROLAG_RUNTIME_SESSION_PUBLIC_KEY
    || readAppConfig().runtimeSessionPublicKeyPem
    || "";
}

function safeMkdirFor(filePath) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function appendLog(logFile, event) {
  if (!logFile) return;
  safeMkdirFor(logFile);
  fs.appendFileSync(logFile, `${JSON.stringify(event)}\n`, "utf8");
}

function writeHealth(healthFile, event) {
  if (!healthFile) return;
  safeMkdirFor(healthFile);
  fs.writeFileSync(healthFile, `${JSON.stringify(event, null, 2)}\n`, "utf8");
}

function dryRunCommand(command, args = []) {
  return Promise.resolve({
    ok: true,
    stdout: "",
    stderr: "",
    error: "",
    dryRun: true,
    command,
    args
  });
}

function shouldStop(stopFile) {
  return Boolean(stopFile && fs.existsSync(stopFile));
}

async function main() {
  const sessionPath = path.resolve(argValue("--session", process.env.ZEROLAG_RUNTIME_SESSION || defaultSessionPath()));
  const pollMs = Math.max(1000, Number(argValue("--interval-ms", "5000")) || 5000);
  const onceMode = process.argv.includes("--once");
  const dryRun = process.argv.includes("--dry-run") || process.env.ZEROLAG_GUARD_DRY_RUN === "1";
  const healthFile = argValue("--health-file", "");
  const logFile = argValue("--log-file", "");
  const stopFile = argValue("--stop-file", "");
  const run = dryRun ? dryRunCommand : runCommand;
  const publicKeyPem = runtimeSessionPublicKeyPem();

  while (true) {
    const result = await guardOnce(sessionPath, { run, publicKeyPem });
    const event = {
      serviceName,
      timestamp: new Date().toISOString(),
      sessionFile: path.basename(sessionPath),
      action: result.action,
      reason: result.reason,
      dryRun
    };

    writeHealth(healthFile, event);
    appendLog(logFile, event);

    if (onceMode || result.action === "cleanup" || shouldStop(stopFile)) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  defaultSessionPath,
  dryRunCommand,
  main
};
