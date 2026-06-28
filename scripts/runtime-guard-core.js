const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");

const runtimePlanBaseName = "Windows Performance Session";
const runtimeSessionSecret = "zerolag-runtime-session-prototype-v1";
const runtimeGuardTaskName = "ZeroLagRuntimeGuard";

function runCommand(command, args = []) {
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
  const body = {
    version: session.version,
    parentPid: Number(session.parentPid) || 0,
    runtimePowerPlanGuid: session.runtimePowerPlanGuid || "",
    originalPowerPlanGuid: session.originalPowerPlanGuid || "",
    machineHash: session.machineHash || "",
    licenseSessionId: session.licenseSessionId || "",
    createdAt: session.createdAt || "",
    expiresAt: session.expiresAt || ""
  };

  if (Number(session.version || 1) >= 2 || session.runtimeSessionKeyVersion) {
    body.runtimeSessionKeyVersion = session.runtimeSessionKeyVersion || "";
    body.runtimeSessionProofAlgorithm = session.runtimeSessionProofAlgorithm || "";
    body.runtimeSessionProof = session.runtimeSessionProof || "";
  }

  return JSON.stringify(body);
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

function readSession(sessionPath) {
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

async function getActivePowerPlanGuid(input = {}) {
  const run = input.run || runCommand;
  const result = await run("powercfg", ["/getactivescheme"]);
  return firstGuid(result.stdout || result.stderr || result.error);
}

async function findPowerPlansByName(planName, input = {}) {
  const run = input.run || runCommand;
  const result = await run("powercfg", ["/list"]);
  if (!result.ok) return [];

  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.includes(planName))
    .map((line) => firstGuid(line))
    .filter(Boolean);
}

async function removeRuntimeGuardTask(input = {}) {
  const run = input.run || runCommand;
  await run("schtasks.exe", ["/Delete", "/TN", runtimeGuardTaskName, "/F"]);
}

async function deleteRuntimePlansByName(originalGuid, input = {}) {
  const activeGuid = await getActivePowerPlanGuid(input);
  const stalePlans = await findPowerPlansByName(input.runtimePlanBaseName || runtimePlanBaseName, input);
  const activeIsRuntime = stalePlans.some((guid) => guid.toLowerCase() === String(activeGuid).toLowerCase());
  const run = input.run || runCommand;

  if (activeIsRuntime) {
    await run("powercfg", ["/setactive", originalGuid || "SCHEME_BALANCED"]);
  }

  for (const guid of stalePlans) {
    await run("powercfg", ["/delete", guid]);
  }
}

async function cleanupRuntimeSession(session, sessionPath, input = {}) {
  const run = input.run || runCommand;
  const signed = Boolean(session && session.signatureValid);
  const runtimeGuid = signed ? String(session.runtimePowerPlanGuid || "") : "";

  if (runtimeGuid) {
    const activeGuid = await getActivePowerPlanGuid({ ...input, run });
    if (activeGuid.toLowerCase() === runtimeGuid.toLowerCase()) {
      await run("powercfg", ["/setactive", session.originalPowerPlanGuid || "SCHEME_BALANCED"]);
    }

    await run("powercfg", ["/delete", runtimeGuid]);
  }

  await deleteRuntimePlansByName(signed ? session.originalPowerPlanGuid : "", { ...input, run });
  await removeRuntimeGuardTask({ ...input, run });

  try {
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
  } catch {
    // The main app will perform orphan cleanup on next launch if this fails.
  }
}

function shouldCleanupSession(session, input = {}) {
  const alive = input.isAlive || isProcessAlive;
  if (!session) return { cleanup: false, reason: "missing" };
  if (!session.signatureValid) return { cleanup: true, reason: "invalid-signature" };
  if (isSessionExpired(session)) return { cleanup: true, reason: "expired" };
  if (!alive(Number(session.parentPid))) return { cleanup: true, reason: "desktop-missing" };
  return { cleanup: false, reason: "active" };
}

async function guardOnce(sessionPath, input = {}) {
  const session = readSession(sessionPath);
  const decision = shouldCleanupSession(session, input);

  if (!session) {
    return { action: "idle", reason: decision.reason };
  }

  if (decision.cleanup) {
    await cleanupRuntimeSession(session, sessionPath, input);
    return { action: "cleanup", reason: decision.reason };
  }

  return { action: "keep", reason: decision.reason };
}

async function runGuardLoop(sessionPath, input = {}) {
  const pollMs = Number(input.pollMs) > 0 ? Number(input.pollMs) : 1000;
  const onceMode = Boolean(input.onceMode);

  while (true) {
    const result = await guardOnce(sessionPath, input);
    if (result.action !== "keep" || onceMode) return result;
    await sleep(pollMs);
  }
}

module.exports = {
  cleanupRuntimeSession,
  firstGuid,
  guardOnce,
  isProcessAlive,
  isSessionExpired,
  readSession,
  runCommand,
  runGuardLoop,
  shouldCleanupSession,
  signRuntimeSessionPayload,
  verifyRuntimeSessionPayload
};
