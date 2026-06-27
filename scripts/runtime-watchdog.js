const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");

const sessionPath = process.argv[2];
const pollMs = 1000;
const onceMode = process.argv.includes("--once");
const runtimePlanBaseName = "Windows Performance Session";
const runtimeSessionSecret = "zerolag-runtime-session-prototype-v1";
const runtimeGuardTaskName = "ZeroLagRuntimeGuard";

function run(command, args = []) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout || "",
        stderr: stderr || "",
        error: error ? error.message : ""
      });
    });
  });
}

function firstGuid(text) {
  const match = String(text || "").match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return match ? match[0] : "";
}

function runtimeSessionSigningBody(session) {
  return JSON.stringify({
    version: session.version,
    parentPid: Number(session.parentPid) || 0,
    runtimePowerPlanGuid: session.runtimePowerPlanGuid || "",
    originalPowerPlanGuid: session.originalPowerPlanGuid || "",
    machineHash: session.machineHash || "",
    licenseSessionId: session.licenseSessionId || "",
    createdAt: session.createdAt || "",
    expiresAt: session.expiresAt || ""
  });
}

function signRuntimeSessionPayload(session) {
  return crypto.createHmac("sha256", runtimeSessionSecret).update(runtimeSessionSigningBody(session)).digest("hex");
}

function verifyRuntimeSessionPayload(session) {
  return Boolean(session && session.signature && signRuntimeSessionPayload(session) === session.signature);
}

function isSessionExpired(session) {
  if (!session || !session.expiresAt) return false;
  const expiresAt = new Date(session.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readSession() {
  if (!sessionPath || !fs.existsSync(sessionPath)) return null;

  try {
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    return {
      ...session,
      signatureValid: verifyRuntimeSessionPayload(session)
    };
  } catch {
    return {
      signatureValid: false
    };
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function getActivePowerPlanGuid() {
  const result = await run("powercfg", ["/getactivescheme"]);
  return firstGuid(result.stdout || result.stderr || result.error);
}

async function findPowerPlansByName(planName) {
  const result = await run("powercfg", ["/list"]);
  if (!result.ok) return [];

  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.includes(planName))
    .map((line) => firstGuid(line))
    .filter(Boolean);
}

async function removeRuntimeGuardTask() {
  await run("schtasks.exe", ["/Delete", "/TN", runtimeGuardTaskName, "/F"]);
}

async function deleteRuntimePlansByName(originalGuid) {
  const activeGuid = await getActivePowerPlanGuid();
  const stalePlans = await findPowerPlansByName(runtimePlanBaseName);
  const activeIsRuntime = stalePlans.some((guid) => guid.toLowerCase() === String(activeGuid).toLowerCase());

  if (activeIsRuntime) {
    await run("powercfg", ["/setactive", originalGuid || "SCHEME_BALANCED"]);
  }

  for (const guid of stalePlans) {
    await run("powercfg", ["/delete", guid]);
  }
}

async function cleanupRuntimeSession(session) {
  const signed = Boolean(session.signatureValid);
  const runtimeGuid = signed ? String(session.runtimePowerPlanGuid || "") : "";

  if (runtimeGuid) {
    const activeGuid = await getActivePowerPlanGuid();
    if (activeGuid.toLowerCase() === runtimeGuid.toLowerCase()) {
      await run("powercfg", ["/setactive", session.originalPowerPlanGuid || "SCHEME_BALANCED"]);
    }

    await run("powercfg", ["/delete", runtimeGuid]);
  }

  await deleteRuntimePlansByName(signed ? session.originalPowerPlanGuid : "");
  await removeRuntimeGuardTask();

  try {
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
  } catch {
    // The main app will perform orphan cleanup on next launch if this fails.
  }
}

async function main() {
  while (true) {
    const session = readSession();
    if (!session) return;

    if (!session.signatureValid || isSessionExpired(session) || !isProcessAlive(Number(session.parentPid))) {
      await cleanupRuntimeSession(session);
      return;
    }

    if (onceMode) return;
    await sleep(pollMs);
  }
}

main();
