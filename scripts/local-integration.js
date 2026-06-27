const path = require("path");
const { spawn } = require("child_process");
const { addActivationCode, startServer } = require("../server");

const rootDir = path.join(__dirname, "..");
const port = Number(process.env.ZEROLAG_LOCAL_SERVER_PORT || 8787);
const host = process.env.ZEROLAG_LOCAL_SERVER_HOST || "127.0.0.1";
const activationCode = process.env.ZEROLAG_LOCAL_ACTIVATION_CODE || "ZL-PRO-LOCAL-TEST";

function electronCommand() {
  return process.platform === "win32"
    ? path.join(rootDir, "node_modules", ".bin", "electron.cmd")
    : path.join(rootDir, "node_modules", ".bin", "electron");
}

function startDesktop() {
  const child = spawn(electronCommand(), [".", "--no-elevation", "--no-runtime-plan"], {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ZEROLAG_API_BASE_URL: `http://${host}:${port}`,
      ZEROLAG_ALLOW_LOCAL_DEMO: "false",
      ZEROLAG_RELEASE_CHANNEL: "local-server",
      ZEROLAG_UPDATE_MANIFEST_URL: `http://${host}:${port}/v1/updates/manifest`
    }
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.log(`ZeroLag desktop exited with code ${code}.`);
    }
  });

  return child;
}

function main() {
  addActivationCode(activationCode, {
    durationDays: 30,
    maxUses: 10,
    plan: "ZeroLag Pro Monthly"
  });

  const server = startServer({ host, port });
  const desktop = startDesktop();

  console.log("");
  console.log("ZeroLag local integration is ready.");
  console.log(`API: http://${host}:${port}`);
  console.log(`Activation code: ${activationCode}`);
  console.log("Use this code in the desktop app to test server-backed membership.");
  console.log("");

  const stop = () => {
    if (desktop && !desktop.killed) {
      desktop.kill();
    }
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main();
