const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { execFile, spawn } = require("child_process");

const appConfigPath = path.join(__dirname, "assets", "app-config.json");
const protectedTemplatePath = path.join(__dirname, "assets", "zerolag-power-plan-template.protected.json");
const integrityManifestPath = path.join(__dirname, "assets", "integrity-manifest.json");
const updateManifestPath = path.join(__dirname, "assets", "update.json");
const runtimePlanBaseName = "Windows Performance Session";
const licenseSecret = "zerolag-local-license-prototype-v1";
const integritySecret = "zerolag-integrity-prototype-v1";
const templateProtectionSecret = "zerolag-template-protection-v1";
const runtimeSessionSecret = "zerolag-runtime-session-prototype-v1";
const demoActivationCode = "ZL-PRO-DEMO-2026";
const runtimeGuardTaskName = "ZeroLagRuntimeGuard";
const skipElevation = process.argv.includes("--no-elevation");
const skipRuntimePlan = process.argv.includes("--no-runtime-plan");

let originalPowerPlanGuid = "";
let runtimePowerPlanGuid = "";
let runtimePowerPlanResult = null;
let runtimePowerPlanError = "";
let allowQuitAfterCleanup = false;
let appIntegrityStatus = { ok: true, reason: "完整性正常" };
let splashWindow = null;
let mainWindow = null;
let tray = null;

function defaultAppConfig() {
  return {
    releaseMode: "development",
    releaseChannel: "alpha",
    websiteUrl: "https://example.com/zerolag",
    apiBaseUrl: "",
    updateManifestUrl: "",
    updatePublicKeyPem: "",
    allowLocalDemoLicense: true,
    offlineGraceHours: 24,
    supportUrl: ""
  };
}

function readAppConfig() {
  const fallback = defaultAppConfig();
  let config = fallback;

  try {
    if (fs.existsSync(appConfigPath)) {
      config = {
        ...fallback,
        ...JSON.parse(fs.readFileSync(appConfigPath, "utf8"))
      };
    }
  } catch {
    config = fallback;
  }

  return {
    ...config,
    releaseMode: process.env.ZEROLAG_RELEASE_MODE || config.releaseMode,
    releaseChannel: process.env.ZEROLAG_RELEASE_CHANNEL || config.releaseChannel,
    websiteUrl: process.env.ZEROLAG_WEBSITE_URL || config.websiteUrl,
    apiBaseUrl: process.env.ZEROLAG_API_BASE_URL || config.apiBaseUrl,
    updateManifestUrl: process.env.ZEROLAG_UPDATE_MANIFEST_URL || config.updateManifestUrl,
    updatePublicKeyPem: process.env.ZEROLAG_UPDATE_PUBLIC_KEY || config.updatePublicKeyPem,
    allowLocalDemoLicense: process.env.ZEROLAG_ALLOW_LOCAL_DEMO
      ? /^(1|true|yes)$/i.test(process.env.ZEROLAG_ALLOW_LOCAL_DEMO)
      : Boolean(config.allowLocalDemoLicense),
    offlineGraceHours: Number(process.env.ZEROLAG_OFFLINE_GRACE_HOURS || config.offlineGraceHours || 0)
  };
}

function isProductionMode() {
  return readAppConfig().releaseMode === "production";
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function requestJson(url, options = {}) {
  return new Promise((resolve) => {
    if (!isHttpUrl(url)) {
      resolve({ ok: false, statusCode: 0, data: null, error: "Invalid URL" });
      return;
    }

    const payload = options.body ? JSON.stringify(options.body) : "";
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const request = client.request(target, {
      method: options.method || (payload ? "POST" : "GET"),
      timeout: options.timeoutMs || 8000,
      headers: {
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        try {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            data: raw ? JSON.parse(raw) : null,
            error: ""
          });
        } catch {
          resolve({
            ok: false,
            statusCode: response.statusCode,
            data: null,
            error: "Invalid JSON response"
          });
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Request timeout"));
    });
    request.on("error", (error) => {
      resolve({ ok: false, statusCode: 0, data: null, error: error.message });
    });

    if (payload) request.write(payload);
    request.end();
  });
}

function run(command, args = []) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === "number" ? error.code : 0,
        stdout: stdout || "",
        stderr: stderr || "",
        error: error ? error.message : ""
      });
    });
  });
}

async function isAdmin() {
  const result = await run("net", ["session"]);
  return result.ok;
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function relaunchAsAdmin() {
  const filePath = process.execPath;
  const args = app.isPackaged ? [] : [__dirname];
  const argumentList = args.map(quotePowerShell).join(", ");
  const command = [
    "Start-Process",
    "-FilePath",
    quotePowerShell(filePath),
    argumentList ? `-ArgumentList @(${argumentList})` : "",
    "-Verb",
    "RunAs"
  ].filter(Boolean).join(" ");

  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
}

function licensePath() {
  return path.join(app.getPath("userData"), "license.json");
}

function runtimeSessionPath() {
  return path.join(app.getPath("userData"), "runtime-session.json");
}

function gameLibraryPath() {
  return path.join(app.getPath("userData"), "game-library.json");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function deriveTemplateKey() {
  return crypto.createHash("sha256").update(templateProtectionSecret).digest();
}

function readProtectedTemplate() {
  const payload = JSON.parse(fs.readFileSync(protectedTemplatePath, "utf8"));
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const encrypted = Buffer.from(payload.ciphertext, "base64");
  const aad = Buffer.from(payload.aad || "ZeroLagRuntimeTemplate:v1", "utf8");
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveTemplateKey(), iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

function signIntegrityPayload(files) {
  const body = JSON.stringify(files.map((item) => ({
    path: item.path,
    sha256: item.sha256
  })));

  return crypto.createHmac("sha256", integritySecret).update(body).digest("hex");
}

function verifyAppIntegrity() {
  if (!fs.existsSync(integrityManifestPath)) {
    return { ok: false, reason: "完整性清单缺失" };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(integrityManifestPath, "utf8"));
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (!files.length || signIntegrityPayload(files) !== manifest.signature) {
      return { ok: false, reason: "完整性签名异常" };
    }

    for (const item of files) {
      const filePath = path.join(__dirname, item.path);
      if (!fs.existsSync(filePath)) {
        return { ok: false, reason: "核心文件缺失" };
      }

      if (sha256File(filePath) !== item.sha256) {
        return { ok: false, reason: "核心文件已被修改" };
      }
    }

    return { ok: true, reason: "完整性正常" };
  } catch {
    return { ok: false, reason: "完整性校验失败" };
  }
}

function compareVersions(left, right) {
  const leftParts = String(left || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function readUpdateStatus() {
  const current = app.getVersion();
  const fallback = {
    current,
    latest: current,
    updateAvailable: false,
    force: false,
    title: "",
    message: "",
    downloadUrl: ""
  };

  if (!fs.existsSync(updateManifestPath)) {
    return fallback;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(updateManifestPath, "utf8"));
    const latest = manifest.latest || current;
    const minSupported = manifest.minSupported || current;
    const force = Boolean(manifest.force) || compareVersions(current, minSupported) < 0;

    return {
      current,
      latest,
      minSupported,
      updateAvailable: compareVersions(latest, current) > 0,
      force,
      title: manifest.title || "发现新版本",
      message: manifest.message || "ZeroLag 有可用更新。",
      releaseNotes: Array.isArray(manifest.releaseNotes) ? manifest.releaseNotes : [],
      downloadUrl: manifest.downloadUrl || ""
    };
  } catch {
    return fallback;
  }
}

function normalizeUpdateManifest(manifest, current) {
  const latest = manifest.latest || current;
  const minSupported = manifest.minSupported || current;
  const force = Boolean(manifest.force) || compareVersions(current, minSupported) < 0;

  return {
    current,
    latest,
    minSupported,
    updateAvailable: compareVersions(latest, current) > 0,
    force,
    title: manifest.title || "发现新版本",
    message: manifest.message || "ZeroLag 有可用更新。",
    releaseNotes: Array.isArray(manifest.releaseNotes) ? manifest.releaseNotes : [],
    downloadUrl: manifest.downloadUrl || "",
    source: manifest.source || "local",
    signed: Boolean(manifest.signature)
  };
}

async function readUpdateStatusV2() {
  const current = app.getVersion();
  const fallback = {
    current,
    latest: current,
    updateAvailable: false,
    force: false,
    title: "",
    message: "",
    downloadUrl: ""
  };
  const config = readAppConfig();

  if (config.updateManifestUrl) {
    const remote = await requestJson(config.updateManifestUrl, { timeoutMs: 6000 });
    if (remote.ok && remote.data) {
      return normalizeUpdateManifest({ ...remote.data, source: "remote" }, current);
    }

    if (isProductionMode()) {
      return {
        ...fallback,
        error: "UPDATE_SERVER_UNAVAILABLE"
      };
    }
  }

  if (!fs.existsSync(updateManifestPath)) {
    return fallback;
  }

  try {
    return normalizeUpdateManifest(JSON.parse(fs.readFileSync(updateManifestPath, "utf8")), current);
  } catch {
    return fallback;
  }
}

function signLicensePayload(payload) {
  const body = JSON.stringify({
    product: payload.product,
    plan: payload.plan,
    machineHash: payload.machineHash,
    expiresAt: payload.expiresAt
  });

  return crypto.createHmac("sha256", licenseSecret).update(body).digest("hex");
}

async function getMachineFingerprint() {
  const result = await run("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]);
  const machineGuid = result.ok ? (result.stdout.match(/[0-9a-fA-F-]{20,}/) || [""])[0] : "";
  return sha256([machineGuid, os.hostname(), os.platform(), os.arch()].join("|"));
}

async function readLicenseStatus() {
  const machineHash = await getMachineFingerprint();
  const fallback = {
    active: false,
    plan: "未授权",
    expiresAt: "",
    machineBound: false,
    integrityOk: appIntegrityStatus.ok,
    reason: appIntegrityStatus.ok ? "未激活" : appIntegrityStatus.reason
  };

  if (!appIntegrityStatus.ok) {
    return fallback;
  }

  if (!fs.existsSync(licensePath())) {
    return fallback;
  }

  try {
    const license = JSON.parse(fs.readFileSync(licensePath(), "utf8"));
    const signature = signLicensePayload(license);
    const signatureValid = signature === license.signature;
    const machineBound = license.machineHash === machineHash;
    const expiresAt = new Date(license.expiresAt).getTime();
    const active = signatureValid && machineBound && expiresAt > Date.now();

    return {
      active,
      plan: license.plan || "ZeroLag Pro 月度",
      expiresAt: license.expiresAt || "",
      machineBound,
      integrityOk: appIntegrityStatus.ok,
      reason: active ? "订阅有效" : "授权无效"
    };
  } catch {
    return { ...fallback, reason: "授权文件损坏" };
  }
}

async function activateLicense(code) {
  if (code !== demoActivationCode) {
    return {
      active: false,
      reason: "会员码无效"
    };
  }

  const machineHash = await getMachineFingerprint();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    product: "ZeroLag",
    plan: "ZeroLag Pro 月度",
    machineHash,
    expiresAt
  };

  const license = {
    ...payload,
    signature: signLicensePayload(payload)
  };

  fs.mkdirSync(path.dirname(licensePath()), { recursive: true });
  fs.writeFileSync(licensePath(), JSON.stringify(license, null, 2), "utf8");
  return readLicenseStatusV2();
}

function localDemoLicensingAllowed() {
  const config = readAppConfig();
  return config.allowLocalDemoLicense && config.releaseMode !== "production";
}

function serverLicensingConfigured() {
  return Boolean(normalizeBaseUrl(readAppConfig().apiBaseUrl));
}

function normalizeServerLicensePayload(data, machineHash) {
  const token = data.token || data.licenseToken || data.accessToken || "";
  const expiresAt = data.expiresAt || data.subscriptionExpiresAt || "";
  if (!token || !expiresAt) {
    return null;
  }

  const payload = {
    product: "ZeroLag",
    source: "server",
    plan: data.plan || "ZeroLag Pro 月度",
    machineHash,
    expiresAt,
    serverToken: token,
    subscriptionId: data.subscriptionId || "",
    serverSessionId: data.sessionId || data.licenseSessionId || "",
    lastValidatedAt: new Date().toISOString()
  };

  return {
    ...payload,
    signature: signLicensePayload(payload)
  };
}

function licenseStatusFallback(machineHash, reason = "未激活") {
  return {
    active: false,
    plan: "未授权",
    expiresAt: "",
    machineBound: false,
    integrityOk: appIntegrityStatus.ok,
    reason,
    source: "none",
    machineHash
  };
}

function licenseStatusFromServerRecord(record, active, reason) {
  return {
    active,
    plan: record.plan || "ZeroLag Pro 月度",
    expiresAt: record.expiresAt || "",
    machineBound: true,
    integrityOk: appIntegrityStatus.ok,
    reason,
    source: "server",
    subscriptionId: record.subscriptionId || "",
    serverBacked: true
  };
}

function hasOfflineGrace(record) {
  const config = readAppConfig();
  const lastValidatedAt = new Date(record.lastValidatedAt || 0).getTime();
  const expiresAt = new Date(record.expiresAt || 0).getTime();
  const graceMs = Math.max(0, Number(config.offlineGraceHours || 0)) * 60 * 60 * 1000;
  return Number.isFinite(lastValidatedAt)
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now()
    && lastValidatedAt + graceMs > Date.now();
}

async function activateLicenseWithServer(code, machineHash) {
  const config = readAppConfig();
  const endpoint = `${normalizeBaseUrl(config.apiBaseUrl)}/v1/licenses/activate`;
  const response = await requestJson(endpoint, {
    body: {
      activationCode: code,
      deviceHash: machineHash,
      appVersion: app.getVersion(),
      channel: config.releaseChannel
    }
  });

  if (!response.ok || !response.data || response.data.active === false) {
    return {
      ok: false,
      reason: response.data && response.data.message ? response.data.message : "激活暂时不可用"
    };
  }

  const record = normalizeServerLicensePayload(response.data, machineHash);
  if (!record) {
    return {
      ok: false,
      reason: "服务器返回信息不完整"
    };
  }

  fs.mkdirSync(path.dirname(licensePath()), { recursive: true });
  fs.writeFileSync(licensePath(), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return {
    ok: true,
    record
  };
}

async function validateLicenseWithServer(record, machineHash) {
  const config = readAppConfig();
  const endpoint = `${normalizeBaseUrl(config.apiBaseUrl)}/v1/licenses/validate`;
  const response = await requestJson(endpoint, {
    body: {
      token: record.serverToken,
      subscriptionId: record.subscriptionId || "",
      deviceHash: machineHash,
      appVersion: app.getVersion(),
      channel: config.releaseChannel
    },
    timeoutMs: 5000
  });

  if (!response.ok || !response.data) {
    return hasOfflineGrace(record)
      ? licenseStatusFromServerRecord(record, true, "订阅有效")
      : licenseStatusFromServerRecord(record, false, "需要重新验证会员");
  }

  if (response.data.active === false) {
    return licenseStatusFromServerRecord(record, false, response.data.message || "订阅已失效");
  }

  const refreshed = normalizeServerLicensePayload({
    ...record,
    ...response.data,
    token: response.data.token || response.data.licenseToken || record.serverToken
  }, machineHash);

  if (refreshed) {
    fs.writeFileSync(licensePath(), `${JSON.stringify(refreshed, null, 2)}\n`, "utf8");
    return licenseStatusFromServerRecord(refreshed, true, "订阅有效");
  }

  return licenseStatusFromServerRecord(record, false, "会员信息异常");
}

async function readLicenseStatusV2() {
  const machineHash = await getMachineFingerprint();
  const fallback = licenseStatusFallback(machineHash, appIntegrityStatus.ok ? "未激活" : appIntegrityStatus.reason);

  if (!appIntegrityStatus.ok) {
    return fallback;
  }

  if (!fs.existsSync(licensePath())) {
    return fallback;
  }

  try {
    const license = JSON.parse(fs.readFileSync(licensePath(), "utf8"));
    const machineBound = license.machineHash === machineHash;
    if (!machineBound) {
      return { ...fallback, reason: "设备绑定异常" };
    }

    if (license.source === "server" || license.serverToken) {
      return serverLicensingConfigured()
        ? validateLicenseWithServer(license, machineHash)
        : licenseStatusFromServerRecord(license, hasOfflineGrace(license), hasOfflineGrace(license) ? "订阅有效" : "需要重新验证会员");
    }

    if (!localDemoLicensingAllowed()) {
      return { ...fallback, reason: "请登录或激活会员" };
    }

    const signatureValid = signLicensePayload(license) === license.signature;
    const expiresAt = new Date(license.expiresAt).getTime();
    const active = signatureValid && expiresAt > Date.now();

    return {
      active,
      plan: license.plan || "ZeroLag Pro 月度",
      expiresAt: license.expiresAt || "",
      machineBound,
      integrityOk: appIntegrityStatus.ok,
      reason: active ? "订阅有效" : "授权无效",
      source: "local-demo",
      serverBacked: false
    };
  } catch {
    return { ...fallback, reason: "授权文件损坏" };
  }
}

async function activateLicenseV2(code) {
  const machineHash = await getMachineFingerprint();

  if (serverLicensingConfigured()) {
    const serverResult = await activateLicenseWithServer(code, machineHash);
    if (serverResult.ok) {
      return readLicenseStatusV2();
    }

    if (isProductionMode() || !localDemoLicensingAllowed()) {
      return {
        ...licenseStatusFallback(machineHash, serverResult.reason),
        source: "server"
      };
    }
  }

  if (!localDemoLicensingAllowed()) {
    return {
      ...licenseStatusFallback(machineHash, "请登录或激活会员"),
      source: "server"
    };
  }

  return activateLicense(code);
}

async function createMembershipOrder() {
  const config = readAppConfig();
  const apiBaseUrl = normalizeBaseUrl(config.apiBaseUrl);
  if (!apiBaseUrl) {
    return {
      ok: false,
      reason: "PAYMENT_SERVER_NOT_CONFIGURED"
    };
  }

  const machineHash = await getMachineFingerprint();
  const response = await requestJson(`${apiBaseUrl}/v1/orders/create`, {
    body: {
      plan: "ZeroLag Pro Monthly",
      durationDays: 30,
      amountCents: 3000,
      currency: "CNY",
      deviceHash: machineHash,
      channel: config.releaseChannel || "desktop"
    },
    timeoutMs: 8000
  });

  if (!response.ok || !response.data) {
    return {
      ok: false,
      reason: response.error || "ORDER_CREATE_FAILED"
    };
  }

  return {
    ok: true,
    ...response.data
  };
}

async function getMembershipOrderStatus(orderId) {
  const config = readAppConfig();
  const apiBaseUrl = normalizeBaseUrl(config.apiBaseUrl);
  const id = String(orderId || "").trim();
  if (!apiBaseUrl || !id) {
    return {
      ok: false,
      reason: "ORDER_STATUS_UNAVAILABLE"
    };
  }

  const response = await requestJson(`${apiBaseUrl}/v1/orders/${encodeURIComponent(id)}`, {
    method: "GET",
    timeoutMs: 8000
  });

  if (!response.ok || !response.data) {
    return {
      ok: false,
      reason: response.error || "ORDER_STATUS_FAILED"
    };
  }

  return {
    ok: true,
    ...response.data
  };
}

function gameDisplayName(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ").trim() || "未命名游戏";
}

function readGameLibrary() {
  if (!fs.existsSync(gameLibraryPath())) {
    return [];
  }

  try {
    const payload = JSON.parse(fs.readFileSync(gameLibraryPath(), "utf8"));
    return Array.isArray(payload.games) ? payload.games.filter((game) => game && game.id && game.path) : [];
  } catch {
    return [];
  }
}

function writeGameLibrary(games) {
  fs.mkdirSync(path.dirname(gameLibraryPath()), { recursive: true });
  fs.writeFileSync(gameLibraryPath(), `${JSON.stringify({ games }, null, 2)}\n`, "utf8");
}

async function addGameToLibrary() {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: "添加常用游戏",
    buttonLabel: "添加到 ZeroLag",
    properties: ["openFile"],
    filters: [
      { name: "游戏或启动器", extensions: ["exe", "lnk", "url"] }
    ]
  });

  if (result.canceled || !result.filePaths.length) {
    return readGameLibrary();
  }

  const filePath = result.filePaths[0];
  const games = readGameLibrary();
  const existing = games.find((game) => game.path.toLowerCase() === filePath.toLowerCase());

  if (!existing) {
    games.push({
      id: `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      name: gameDisplayName(filePath),
      path: filePath,
      addedAt: new Date().toISOString()
    });
    writeGameLibrary(games);
  }

  return readGameLibrary();
}

async function removeGameFromLibrary(id) {
  const games = readGameLibrary().filter((game) => game.id !== id);
  writeGameLibrary(games);
  return games;
}

async function launchGame(id) {
  const game = readGameLibrary().find((item) => item.id === id);
  if (!game) {
    return { ok: false, message: "未选择游戏" };
  }

  const error = await shell.openPath(game.path);
  return {
    ok: !error,
    name: game.name,
    message: error || "已启动"
  };
}

function firstGuid(text) {
  const match = text.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return match ? match[0] : "";
}

async function getActivePowerPlan() {
  const result = await run("powercfg", ["/getactivescheme"]);
  return {
    ok: result.ok,
    guid: firstGuid(result.stdout),
    raw: result.stdout || result.stderr || result.error
  };
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

async function cleanupOrphanRuntimePlans() {
  await cleanupRuntimeSessionFromDisk();

  const active = await getActivePowerPlan();
  const stalePlans = await findPowerPlansByName(runtimePlanBaseName);
  const activeIsStale = stalePlans.some((guid) => guid.toLowerCase() === String(active.guid).toLowerCase());

  if (activeIsStale) {
    if (originalPowerPlanGuid) {
      await run("powercfg", ["/setactive", originalPowerPlanGuid]);
    } else {
      await run("powercfg", ["/setactive", "SCHEME_BALANCED"]);
    }
  }

  for (const guid of stalePlans) {
    await deletePowerPlan(guid);
  }
}

async function deletePowerPlan(guid) {
  if (!guid) return { ok: true, skipped: true };
  return run("powercfg", ["/delete", guid]);
}

async function deleteStaleRuntimePlans(activeGuid) {
  const stalePlans = await findPowerPlansByName(runtimePlanBaseName);
  for (const guid of stalePlans) {
    if (guid.toLowerCase() !== String(activeGuid).toLowerCase()) {
      await deletePowerPlan(guid);
    }
  }
}

async function cleanupRuntimeSessionFromDisk() {
  const session = readRuntimeSessionFile();
  if (!session) return { cleaned: false };

  const shouldClean = !session.signatureValid || !isProcessAlive(session.parentPid) || isRuntimeSessionExpired(session);
  if (!shouldClean) {
    return { cleaned: false };
  }

  const runtimeGuid = session.signatureValid ? String(session.runtimePowerPlanGuid || "") : "";
  if (runtimeGuid) {
    const active = await getActivePowerPlan();
    if (active.guid && active.guid.toLowerCase() === runtimeGuid.toLowerCase()) {
      await run("powercfg", ["/setactive", session.originalPowerPlanGuid || "SCHEME_BALANCED"]);
    }
    await deletePowerPlan(runtimeGuid);
  }

  removeRuntimeSession();
  await removeRuntimeGuardTask();
  return { cleaned: true };
}

async function createRuntimePowerPlan(template) {
  const duplicate = await run("powercfg", ["/duplicatescheme", "SCHEME_BALANCED"]);
  const guid = firstGuid(duplicate.stdout);
  if (!duplicate.ok || !guid) {
    throw new Error(duplicate.stderr || duplicate.stdout || duplicate.error || "Failed to create runtime power plan");
  }

  const runtimeName = `${runtimePlanBaseName} ${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  await run("powercfg", ["/changename", guid, runtimeName, "Temporary performance session. Deleted when the session ends."]);
  return { guid, runtimeName };
}

function readRuntimeSessionFile() {
  if (!fs.existsSync(runtimeSessionPath())) {
    return null;
  }

  try {
    const session = JSON.parse(fs.readFileSync(runtimeSessionPath(), "utf8"));
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
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function isRuntimeSessionExpired(session) {
  if (!session || !session.expiresAt) return false;
  const expiresAt = new Date(session.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

async function writeRuntimeSession(plan) {
  const machineHash = await getMachineFingerprint();
  const license = await readLicenseStatusV2();
  const createdAt = new Date().toISOString();
  const expiresAt = license.expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const session = {
    version: 1,
    parentPid: process.pid,
    runtimePowerPlanGuid: plan.guid,
    originalPowerPlanGuid,
    machineHash,
    licenseSessionId: sha256([machineHash, license.plan || "", expiresAt].join("|")),
    createdAt,
    expiresAt
  };
  const signedSession = {
    ...session,
    signature: signRuntimeSessionPayload(session)
  };

  fs.mkdirSync(path.dirname(runtimeSessionPath()), { recursive: true });
  fs.writeFileSync(runtimeSessionPath(), `${JSON.stringify(signedSession, null, 2)}\n`, "utf8");
}

function removeRuntimeSession() {
  try {
    if (fs.existsSync(runtimeSessionPath())) {
      fs.unlinkSync(runtimeSessionPath());
    }
  } catch {
    // Best effort cleanup; next launch also removes orphan runtime plans.
  }
}

function launchRuntimeWatchdog() {
  const watchdogPath = path.join(__dirname, "scripts", "runtime-watchdog.js");
  const child = spawn(process.execPath, [watchdogPath, runtimeSessionPath()], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1"
    }
  });

  child.unref();
}

async function installRuntimeGuardTask() {
  const watchdogPath = path.join(__dirname, "scripts", "runtime-watchdog.js");
  const psCommand = `$env:ELECTRON_RUN_AS_NODE='1'; & ${quotePowerShell(process.execPath)} ${quotePowerShell(watchdogPath)} ${quotePowerShell(runtimeSessionPath())} '--once'`;
  const taskCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "${psCommand}"`;

  return run("schtasks.exe", [
    "/Create",
    "/TN",
    runtimeGuardTaskName,
    "/SC",
    "MINUTE",
    "/MO",
    "1",
    "/TR",
    taskCommand,
    "/RL",
    "HIGHEST",
    "/F"
  ]);
}

async function removeRuntimeGuardTask() {
  return run("schtasks.exe", ["/Delete", "/TN", runtimeGuardTaskName, "/F"]);
}

async function activateRuntimePowerPlan() {
  if (runtimePowerPlanGuid) {
    return runtimePowerPlanResult;
  }

  const template = readProtectedTemplate();
  const activeBefore = await getActivePowerPlan();
  originalPowerPlanGuid = activeBefore.guid;
  await deleteStaleRuntimePlans(activeBefore.guid);

  const plan = await createRuntimePowerPlan(template);
  await writeRuntimeSession(plan);
  launchRuntimeWatchdog();
  const guardTask = await installRuntimeGuardTask();

  const skipped = [];
  let applied = 0;

  for (const item of template.settings) {
    if (typeof item.ac === "number") {
      const ac = await run("powercfg", ["/setacvalueindex", plan.guid, item.subgroup, item.setting, String(item.ac)]);
      ac.ok ? applied += 1 : skipped.push(`${item.name} [AC]`);
    }

    if (typeof item.dc === "number") {
      const dc = await run("powercfg", ["/setdcvalueindex", plan.guid, item.subgroup, item.setting, String(item.dc)]);
      dc.ok ? applied += 1 : skipped.push(`${item.name} [DC]`);
    }
  }

  const active = await run("powercfg", ["/setactive", plan.guid]);
  if (!active.ok) {
    await deletePowerPlan(plan.guid);
    removeRuntimeSession();
    throw new Error(active.stderr || active.stdout || active.error || "Failed to activate runtime power plan");
  }

  runtimePowerPlanGuid = plan.guid;
  runtimePowerPlanResult = {
    planName: plan.runtimeName,
    planGuid: plan.guid,
    originalPlanGuid: originalPowerPlanGuid,
    activatedAt: new Date().toISOString(),
    temporary: true,
    created: true,
    guardTaskReady: guardTask.ok,
    applied,
    skipped
  };

  updateTrayMenu();
  return runtimePowerPlanResult;
}

async function cleanupRuntimePowerPlan() {
  if (!runtimePowerPlanGuid) {
    return { restored: false, deleted: false };
  }

  const active = await getActivePowerPlan();
  const isRuntimeActive = active.guid.toLowerCase() === runtimePowerPlanGuid.toLowerCase();

  if (isRuntimeActive) {
    if (originalPowerPlanGuid) {
      await run("powercfg", ["/setactive", originalPowerPlanGuid]);
    } else {
      await run("powercfg", ["/setactive", "SCHEME_BALANCED"]);
    }
  }

  const deleted = await deletePowerPlan(runtimePowerPlanGuid);
  removeRuntimeSession();
  await removeRuntimeGuardTask();
  const result = {
    restored: isRuntimeActive,
    deleted: deleted.ok,
    deletedGuid: runtimePowerPlanGuid
  };

  runtimePowerPlanGuid = "";
  runtimePowerPlanResult = null;
  updateTrayMenu();
  return result;
}

function createTrayIcon() {
  const size = 32;
  const buffer = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const distance = Math.max(Math.abs(x - center), Math.abs(y - center));
      const inside = distance <= 13;
      const border = distance > 11 && distance <= 13;
      const diagonal = Math.abs(x - y) <= 1 || Math.abs(x + y - size + 1) <= 1;
      const glow = Math.max(0, 1 - distance / 15);

      if (!inside) {
        buffer[index + 3] = 0;
        continue;
      }

      const red = border ? 210 : Math.round(92 + 72 * glow);
      const green = border ? 255 : Math.round(184 + 64 * glow);
      const blue = diagonal ? 122 : Math.round(52 + 42 * glow);

      buffer[index] = blue;
      buffer[index + 1] = green;
      buffer[index + 2] = red;
      buffer[index + 3] = 255;
    }
  }

  return nativeImage.createFromBitmap(buffer, {
    width: size,
    height: size,
    scaleFactor: 1
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function updateTrayMenu() {
  if (!tray) return;

  const statusLabel = runtimePowerPlanGuid ? "状态：Boost 后台运行中" : "状态：后台待命";
  tray.setToolTip(runtimePowerPlanGuid ? "ZeroLag Boost 正在后台运行" : "ZeroLag 正在后台待命");
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "打开 ZeroLag",
      click: showMainWindow
    },
    {
      label: statusLabel,
      enabled: false
    },
    { type: "separator" },
    {
      label: "退出 ZeroLag",
      click: () => app.quit()
    }
  ]));
}

function createTray() {
  if (tray) return;

  tray = new Tray(createTrayIcon());
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
  updateTrayMenu();
}

async function getVbsStatus() {
  const ps = [
    "try {",
    "$dg = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard;",
    "$dg | Select-Object VirtualizationBasedSecurityStatus,SecurityServicesConfigured,SecurityServicesRunning | ConvertTo-Json -Compress",
    "} catch {",
    "'{}'",
    "}"
  ].join(" ");

  const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]);
  let parsed = {};
  try {
    parsed = JSON.parse((result.stdout || "{}").trim());
  } catch {
    parsed = {};
  }

  return {
    ok: result.ok,
    status: parsed.VirtualizationBasedSecurityStatus ?? null,
    configured: parsed.SecurityServicesConfigured ?? [],
    running: parsed.SecurityServicesRunning ?? [],
    raw: result.stdout || result.stderr || result.error
  };
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const gb = value / 1024 / 1024 / 1024;
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
}

function getMemorySnapshot() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedPercent = ((totalMemory - freeMemory) / totalMemory) * 100;
  return {
    total: formatBytes(totalMemory),
    free: formatBytes(freeMemory),
    usedPercent: usedPercent.toFixed(1)
  };
}

function parseMemorySize(value) {
  const match = String(value || "").match(/^([\d.]+)\s*(GB|MB)?$/i);
  if (!match) return 0;

  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return 0;
  return match[2] && match[2].toUpperCase() === "GB" ? amount * 1024 : amount;
}

function parsePingResult(raw) {
  const text = raw || "";
  const timeMatches = [...text.matchAll(/(?:time|时间)\s*[=<]\s*(\d+)\s*ms/gi)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value));
  const averageMatch = text.match(/(?:Average|平均)[^\d]*(\d+)\s*ms/i);
  const lossMatch = text.match(/(\d+)%\s*(?:loss|丢失)/i) || text.match(/\((\d+)%\s*丢失\)/);

  const average = averageMatch
    ? Number.parseInt(averageMatch[1], 10)
    : (timeMatches.length ? Math.round(timeMatches.reduce((sum, value) => sum + value, 0) / timeMatches.length) : null);

  return {
    average,
    packetLoss: lossMatch ? Number.parseInt(lossMatch[1], 10) : (timeMatches.length ? 0 : 100),
    samples: timeMatches.length
  };
}

function networkGrade(average, packetLoss) {
  if (average === null || packetLoss >= 100) return "不可用";
  if (packetLoss > 10 || average > 120) return "需优化";
  if (packetLoss > 0 || average > 60) return "一般";
  return "良好";
}

async function pingHost(host, label) {
  const result = await run("ping.exe", ["-n", "4", "-w", "1000", host]);
  const parsed = parsePingResult(`${result.stdout}\n${result.stderr}`);
  return {
    host,
    label,
    ok: result.ok && parsed.average !== null && parsed.packetLoss < 100,
    average: parsed.average,
    packetLoss: parsed.packetLoss,
    samples: parsed.samples
  };
}

async function getNetworkDiagnostics() {
  const targets = [
    ["223.5.5.5", "阿里 DNS"],
    ["119.29.29.29", "DNSPod"],
    ["1.1.1.1", "Cloudflare"]
  ];
  const results = await Promise.all(targets.map(([host, label]) => pingHost(host, label)));
  const reachable = results.filter((item) => item.ok);
  const best = reachable.sort((left, right) => left.average - right.average)[0] || null;
  const worstLoss = results.reduce((max, item) => Math.max(max, item.packetLoss || 0), 0);
  const summary = best ? `${networkGrade(best.average, worstLoss)} · ${best.average}ms` : "网络不可用";

  return {
    summary,
    best,
    packetLoss: worstLoss,
    results
  };
}

async function flushDnsCache() {
  const result = await run("ipconfig.exe", ["/flushdns"]);
  return {
    ok: result.ok,
    message: (result.stdout || result.stderr || result.error).trim()
  };
}

async function queryRegistryDword(key, value) {
  const result = await run("reg.exe", ["query", key, "/v", value]);
  if (!result.ok) return null;

  const match = result.stdout.match(/REG_DWORD\s+0x([0-9a-f]+)/i) || result.stdout.match(/REG_DWORD\s+(\d+)/i);
  if (!match) return null;
  return Number.parseInt(match[1], match[0].includes("0x") ? 16 : 10);
}

async function getGpuInfo() {
  const ps = [
    "try {",
    "Get-CimInstance Win32_VideoController |",
    "Select-Object Name,VideoProcessor,AdapterCompatibility,AdapterRAM,PNPDeviceID |",
    "ConvertTo-Json -Compress",
    "} catch {",
    "'[]'",
    "}"
  ].join(" ");

  const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]);
  let parsed = [];
  try {
    parsed = JSON.parse((result.stdout || "[]").trim());
  } catch {
    parsed = [];
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items
    .filter((gpu) => gpu && gpu.Name)
    .map((gpu) => {
      const name = String(gpu.Name || "").trim();
      const processor = String(gpu.VideoProcessor || "").trim();
      const compatibility = String(gpu.AdapterCompatibility || "").trim();
      const pnpDeviceId = String(gpu.PNPDeviceID || "").trim();
      const identity = [name, processor, compatibility, pnpDeviceId].join(" ").toLowerCase();
      const displayName = chooseGpuDisplayName(name, processor);

      return {
        name: displayName,
        memory: formatBytes(Number(gpu.AdapterRAM)),
        score: scoreGpu(identity)
      };
    })
    .sort((a, b) => b.score - a.score || Number(Boolean(b.memory)) - Number(Boolean(a.memory)))
    .map((gpu) => ({
      name: gpu.name,
      memory: gpu.memory
    }));
}

function chooseGpuDisplayName(name, processor) {
  const processorLooksSpecific = /(geforce|rtx|gtx|radeon|rx\s?\d|arc)/i.test(processor) && !/family/i.test(processor);
  if (processorLooksSpecific && processor.length >= name.length) return processor;
  return name || processor || "未知显卡";
}

function scoreGpu(identity) {
  let score = 0;

  if (/(nvidia|geforce|rtx|gtx|quadro)/i.test(identity)) score += 100;
  if (/(amd|radeon|rx\s?\d)/i.test(identity)) score += 95;
  if (/(intel\s+arc|ven_8086.*dev_56|ven_8086.*dev_4f)/i.test(identity)) score += 80;
  if (/(intel|uhd|iris|graphics family|integrated)/i.test(identity)) score -= 45;
  if (/(microsoft basic|remote display|virtual|parsec|mirror|displaylink)/i.test(identity)) score -= 80;

  return score;
}

function statusTextFromSwitch(value) {
  if (value === 1) return "开启";
  if (value === 0) return "关闭";
  return "未知";
}

async function getGamingDiagnostics(vbsStatus) {
  const memory = getMemorySnapshot();
  const [gpus, gameModeValue, appCaptureValue, gameDvrValue] = await Promise.all([
    getGpuInfo(),
    queryRegistryDword("HKCU\\Software\\Microsoft\\GameBar", "AutoGameModeEnabled"),
    queryRegistryDword("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR", "AppCaptureEnabled"),
    queryRegistryDword("HKCU\\System\\GameConfigStore", "GameDVR_Enabled")
  ]);

  const captureEnabled = appCaptureValue === 1 || gameDvrValue === 1;
  const captureKnown = appCaptureValue !== null || gameDvrValue !== null;
  const suggestions = [];
  let readinessScore = 92;

  if (memory.usedPercent >= 85) {
    readinessScore -= 10;
    suggestions.push("内存压力偏高，开游戏前建议关闭大型后台软件。");
  }

  if (gameModeValue === 0) {
    readinessScore -= 8;
    suggestions.push("游戏模式未开启，建议打开后再启动大型游戏。");
  }

  if (captureEnabled) {
    readinessScore -= 7;
    suggestions.push("后台录制会占用资源，建议游戏前关闭。");
  }

  if (vbsStatus && vbsStatus.status === 2) {
    readinessScore -= 12;
    suggestions.push("系统延迟开销仍在运行，执行 Boost 后重启可完整生效。");
  }

  if (!gpus.length) {
    readinessScore -= 4;
    suggestions.push("未读取到显卡信息，建议确认显卡驱动正常。");
  }

  if (!suggestions.length) {
    suggestions.push("基础游戏环境良好，可以直接启动 Boost。");
  }

  return {
    cpu: {
      name: os.cpus()[0] ? os.cpus()[0].model.replace(/\s+/g, " ").trim() : "未知处理器",
      threads: os.cpus().length
    },
    memory,
    gpu: gpus,
    windows: {
      gameMode: statusTextFromSwitch(gameModeValue),
      capture: captureKnown ? (captureEnabled ? "开启" : "关闭") : "未知"
    },
    readinessScore: Math.max(55, Math.min(99, readinessScore)),
    suggestions: suggestions.slice(0, 4)
  };
}

async function disableVbsForGaming() {
  const commands = [
    ["reg.exe", ["add", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard", "/v", "EnableVirtualizationBasedSecurity", "/t", "REG_DWORD", "/d", "0", "/f"], "Disable VBS"],
    ["reg.exe", ["add", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity", "/v", "Enabled", "/t", "REG_DWORD", "/d", "0", "/f"], "Disable HVCI"],
    ["reg.exe", ["add", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa", "/v", "LsaCfgFlags", "/t", "REG_DWORD", "/d", "0", "/f"], "Disable Credential Guard"],
    ["bcdedit.exe", ["/set", "hypervisorlaunchtype", "off"], "Disable Hypervisor launch"]
  ];

  const results = [];
  for (const [command, args, label] of commands) {
    const result = await run(command, args);
    results.push({
      label,
      ok: result.ok,
      message: (result.stdout || result.stderr || result.error).trim()
    });
  }

  return {
    ok: results.every((item) => item.ok),
    rebootRequired: results.some((item) => item.ok),
    results
  };
}

async function applyGamingOptimizations() {
  const commands = [
    {
      command: "reg.exe",
      args: ["add", "HKCU\\Software\\Microsoft\\GameBar", "/v", "AutoGameModeEnabled", "/t", "REG_DWORD", "/d", "1", "/f"],
      label: "Enable Game Mode"
    },
    {
      command: "reg.exe",
      args: ["add", "HKCU\\Software\\Microsoft\\GameBar", "/v", "AllowAutoGameMode", "/t", "REG_DWORD", "/d", "1", "/f"],
      label: "Allow Game Mode"
    },
    {
      command: "reg.exe",
      args: ["add", "HKCU\\Software\\Microsoft\\GameBar", "/v", "ShowStartupPanel", "/t", "REG_DWORD", "/d", "0", "/f"],
      label: "Hide Game Bar Startup"
    },
    {
      command: "reg.exe",
      args: ["add", "HKCU\\Software\\Microsoft\\GameBar", "/v", "UseNexusForGameBarEnabled", "/t", "REG_DWORD", "/d", "0", "/f"],
      label: "Reduce Game Bar Interference"
    },
    {
      command: "reg.exe",
      args: ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR", "/v", "AppCaptureEnabled", "/t", "REG_DWORD", "/d", "0", "/f"],
      label: "Disable App Capture"
    },
    {
      command: "reg.exe",
      args: ["add", "HKCU\\System\\GameConfigStore", "/v", "GameDVR_Enabled", "/t", "REG_DWORD", "/d", "0", "/f"],
      label: "Disable Game DVR"
    },
    {
      command: "reg.exe",
      args: ["add", "HKCU\\System\\GameConfigStore", "/v", "GameDVR_FSEBehaviorMode", "/t", "REG_DWORD", "/d", "2", "/f"],
      label: "Prefer Fullscreen Exclusive"
    },
    {
      command: "reg.exe",
      args: ["add", "HKCU\\System\\GameConfigStore", "/v", "GameDVR_HonorUserFSEBehaviorMode", "/t", "REG_DWORD", "/d", "1", "/f"],
      label: "Honor Fullscreen Preference"
    },
    {
      command: "reg.exe",
      args: ["add", "HKCU\\System\\GameConfigStore", "/v", "GameDVR_DXGIHonorFSEWindowsCompatible", "/t", "REG_DWORD", "/d", "1", "/f"],
      label: "Honor DXGI Fullscreen"
    },
    {
      command: "reg.exe",
      args: ["add", "HKCU\\System\\GameConfigStore", "/v", "GameDVR_EFSEFeatureFlags", "/t", "REG_DWORD", "/d", "0", "/f"],
      label: "Reduce Fullscreen Overlays"
    },
    {
      command: "reg.exe",
      args: ["add", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling", "/v", "PowerThrottlingOff", "/t", "REG_DWORD", "/d", "1", "/f"],
      label: "Disable Power Throttling"
    },
    {
      command: "reg.exe",
      args: ["add", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers", "/v", "HwSchMode", "/t", "REG_DWORD", "/d", "2", "/f"],
      label: "Prefer Hardware GPU Scheduling",
      reboot: true
    },
    {
      command: "reg.exe",
      args: ["add", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile", "/v", "SystemResponsiveness", "/t", "REG_DWORD", "/d", "0", "/f"],
      label: "Prioritize Foreground Games"
    },
    {
      command: "reg.exe",
      args: ["add", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile", "/v", "NetworkThrottlingIndex", "/t", "REG_DWORD", "/d", "4294967295", "/f"],
      label: "Disable Network Throttling"
    },
    {
      command: "reg.exe",
      args: ["add", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games", "/v", "GPU Priority", "/t", "REG_DWORD", "/d", "8", "/f"],
      label: "Raise Game GPU Priority"
    },
    {
      command: "reg.exe",
      args: ["add", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games", "/v", "Priority", "/t", "REG_DWORD", "/d", "6", "/f"],
      label: "Raise Game Priority"
    },
    {
      command: "reg.exe",
      args: ["add", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games", "/v", "Scheduling Category", "/t", "REG_SZ", "/d", "High", "/f"],
      label: "Set Game Scheduling Category"
    },
    {
      command: "reg.exe",
      args: ["add", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games", "/v", "SFIO Priority", "/t", "REG_SZ", "/d", "High", "/f"],
      label: "Set Game IO Priority"
    }
  ];

  const results = [];
  for (const item of commands) {
    const result = await run(item.command, item.args);
    results.push({
      label: item.label,
      ok: result.ok,
      reboot: Boolean(item.reboot),
      message: (result.stdout || result.stderr || result.error).trim()
    });
  }

  return {
    ok: results.every((item) => item.ok),
    applied: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    rebootRequired: results.some((item) => item.ok && item.reboot),
    results
  };
}

async function reduceBackgroundLoad() {
  const safeTargets = [
    "Widgets.exe",
    "WidgetService.exe",
    "PhoneExperienceHost.exe",
    "YourPhone.exe",
    "GameBar.exe",
    "GameBarFTServer.exe",
    "GameBarPresenceWriter.exe",
    "XboxGameBar.exe",
    "XboxPcApp.exe",
    "OneDrive.exe",
    "AdobeCollabSync.exe",
    "AdobeIPCBroker.exe",
    "CCXProcess.exe",
    "Creative Cloud.exe",
    "CoreSync.exe",
    "GoogleCrashHandler.exe",
    "GoogleCrashHandler64.exe",
    "MicrosoftEdgeUpdate.exe"
  ];

  const results = [];
  for (const imageName of safeTargets) {
    const result = await run("taskkill.exe", ["/IM", imageName, "/T", "/F"]);
    results.push({
      imageName,
      ok: result.ok,
      message: (result.stdout || result.stderr || result.error).trim()
    });
  }

  return {
    ok: true,
    cleaned: results.filter((item) => item.ok).length,
    scanned: safeTargets.length,
    results
  };
}

async function optimizeMemoryForGaming() {
  const before = getMemorySnapshot();
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue';",
    "$source = 'using System; using System.Runtime.InteropServices; public static class ZeroLagMemoryTools { [DllImport(\"psapi.dll\")] public static extern bool EmptyWorkingSet(IntPtr hProcess); [DllImport(\"ntdll.dll\", SetLastError=true)] public static extern uint NtSetSystemInformation(int SystemInformationClass, IntPtr SystemInformation, int SystemInformationLength); [DllImport(\"advapi32.dll\", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr ProcessHandle, int DesiredAccess, out IntPtr TokenHandle); [DllImport(\"advapi32.dll\", SetLastError=true, CharSet=CharSet.Ansi, EntryPoint=\"LookupPrivilegeValueA\")] public static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out long lpLuid); [DllImport(\"advapi32.dll\", SetLastError=true)] public static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TOKEN_PRIVILEGES NewState, int BufferLength, IntPtr PreviousState, IntPtr ReturnLength); [StructLayout(LayoutKind.Sequential)] public struct TOKEN_PRIVILEGES { public int PrivilegeCount; public long Luid; public int Attributes; } }';",
    "if (-not ('ZeroLagMemoryTools' -as [type])) { Add-Type -TypeDefinition $source };",
    "$current = $PID;",
    "$trimmed = 0;",
    "$failed = 0;",
    "$scanned = 0;",
    "$memoryListSuccess = 0;",
    "$memoryListFailed = 0;",
    "$before = [uint64]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory);",
    "$token = [IntPtr]::Zero;",
    "$luid = [long]0;",
    "$privilegeEnabled = $false;",
    "if ([ZeroLagMemoryTools]::OpenProcessToken([Diagnostics.Process]::GetCurrentProcess().Handle, 0x28, [ref]$token)) {",
    "  if ([ZeroLagMemoryTools]::LookupPrivilegeValue($null, 'SeProfileSingleProcessPrivilege', [ref]$luid)) {",
    "    $tp = New-Object ZeroLagMemoryTools+TOKEN_PRIVILEGES;",
    "    $tp.PrivilegeCount = 1;",
    "    $tp.Luid = $luid;",
    "    $tp.Attributes = 2;",
    "    $privilegeEnabled = [ZeroLagMemoryTools]::AdjustTokenPrivileges($token, $false, [ref]$tp, 0, [IntPtr]::Zero, [IntPtr]::Zero);",
    "  }",
    "}",
    "foreach ($command in @(2, 3, 4, 5)) {",
    "  $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal(4);",
    "  [Runtime.InteropServices.Marshal]::WriteInt32($ptr, $command);",
    "  try {",
    "    $status = [ZeroLagMemoryTools]::NtSetSystemInformation(80, $ptr, 4);",
    "    if ($status -eq 0) { $memoryListSuccess++ } else { $memoryListFailed++ }",
    "  } catch { $memoryListFailed++ } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) }",
    "}",
    "Get-Process | ForEach-Object {",
    "  $scanned++;",
    "  if ($_.Id -ne $current) {",
    "    try {",
    "      if ([ZeroLagMemoryTools]::EmptyWorkingSet($_.Handle)) { $trimmed++ } else { $failed++ }",
    "    } catch { $failed++ }",
    "  }",
    "};",
    "[GC]::Collect();",
    "[GC]::WaitForPendingFinalizers();",
    "[GC]::Collect();",
    "$after = [uint64]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory);",
    "$freedKb = if ($after -gt $before) { [math]::Round($after - $before) } else { 0 };",
    "[pscustomobject]@{ scanned = $scanned; trimmed = $trimmed; failed = $failed; freedKb = $freedKb; privilegeEnabled = $privilegeEnabled; memoryListSuccess = $memoryListSuccess; memoryListFailed = $memoryListFailed } | ConvertTo-Json -Compress"
  ].join(" ");

  const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]);
  const after = getMemorySnapshot();
  let parsed = { scanned: 0, trimmed: 0, failed: 0, freedKb: 0, memoryListSuccess: 0, memoryListFailed: 0 };

  try {
    parsed = JSON.parse((result.stdout || "{}").trim());
  } catch {
    parsed = { scanned: 0, trimmed: 0, failed: 0, freedKb: 0, memoryListSuccess: 0, memoryListFailed: 0 };
  }

  const beforeFree = parseMemorySize(before.free);
  const afterFree = parseMemorySize(after.free);
  const freedMb = Math.max(0, Math.round(afterFree - beforeFree));

  return {
    ok: result.ok && (Number(parsed.memoryListSuccess || 0) > 0 || Number(parsed.trimmed || 0) > 0 || Number(parsed.freedKb || 0) > 0 || freedMb > 0),
    scanned: Number(parsed.scanned || 0),
    trimmed: Number(parsed.trimmed || 0),
    failed: Number(parsed.failed || 0),
    memoryListSuccess: Number(parsed.memoryListSuccess || 0),
    memoryListFailed: Number(parsed.memoryListFailed || 0),
    privilegeEnabled: Boolean(parsed.privilegeEnabled),
    freedMb: Math.max(freedMb, Math.round(Number(parsed.freedKb || 0) / 1024)),
    before,
    after
  };
}

async function runOneClickBoost() {
  const license = await readLicenseStatusV2();
  if (!license.active) {
    throw new Error("Subscription inactive");
  }

  const admin = await isAdmin();
  const beforePlan = await getActivePowerPlan();
  const beforeVbs = await getVbsStatus();

  const powerPlan = await activateRuntimePowerPlan();
  const optimizations = await applyGamingOptimizations();
  const vbs = await disableVbsForGaming();
  const backgroundCleanup = await reduceBackgroundLoad();
  const memoryOptimization = await optimizeMemoryForGaming();
  const afterPlan = await getActivePowerPlan();
  const afterVbs = await getVbsStatus();

  return {
    admin,
    beforePlan,
    beforeVbs,
    powerPlan,
    optimizations,
    vbs,
    backgroundCleanup,
    memoryOptimization,
    afterPlan,
    afterVbs,
    rebootRequired: optimizations.rebootRequired || vbs.rebootRequired
  };
}

async function enforceRuntimeAuthorization() {
  if (!runtimePowerPlanGuid) return;

  const license = await readLicenseStatusV2();
  if (!appIntegrityStatus.ok || !license.active) {
    runtimePowerPlanError = "Runtime authorization ended";
    await cleanupRuntimePowerPlan();
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 360,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#070b09",
    title: "ZeroLag 启动中",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  });

  let readyResolved = false;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const markReady = () => {
    if (readyResolved) return;
    readyResolved = true;
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
      splashWindow.focus();
    }
    resolveReady(Date.now());
  };

  splashWindow.setMenu(null);
  splashWindow.once("ready-to-show", markReady);
  splashWindow.webContents.once("did-finish-load", () => {
    setTimeout(markReady, 80);
  });
  setTimeout(markReady, 1200);
  splashWindow.loadFile(path.join(__dirname, "src", "splash.html"));
  splashWindow.on("closed", () => {
    splashWindow = null;
  });

  return { window: splashWindow, ready };
}

function createWindow() {
  const splash = createSplashWindow();
  const splashMinDurationMs = 3000;
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#090b0c",
    title: "ZeroLag",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  });

  mainWindow = win;
  win.setMenu(null);
  win.on("close", (event) => {
    if (allowQuitAfterCleanup) return;

    event.preventDefault();
    win.hide();
    updateTrayMenu();
  });
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
  win.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key || "").toLowerCase();
    const opensDevTools = key === "f12" || (input.control && input.shift && ["i", "j", "c"].includes(key));
    const reloadsApp = input.control && key === "r";
    if (opensDevTools || reloadsApp) {
      event.preventDefault();
    }
  });

  const mainReady = new Promise((resolve) => {
    win.once("ready-to-show", resolve);
  });
  Promise.all([splash.ready, mainReady]).then(([splashReadyAt]) => {
    const elapsed = Date.now() - splashReadyAt;
    const delay = Math.max(0, splashMinDurationMs - elapsed);
    setTimeout(() => {
      if (splash.window && !splash.window.isDestroyed()) {
        splash.window.close();
      }
      win.show();
      win.focus();
    }, delay);
  });

  win.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  appIntegrityStatus = verifyAppIntegrity();
  app.setAppUserModelId("ZeroLag");

  if (process.platform === "win32" && !skipElevation && !(await isAdmin())) {
    const result = await relaunchAsAdmin();
    if (result.ok) {
      app.quit();
      return;
    }
  }

  await cleanupOrphanRuntimePlans();

  try {
    if (skipRuntimePlan) {
      throw new Error("Runtime power plan skipped by --no-runtime-plan");
    }

    const license = await readLicenseStatusV2();
    if (!license.active) {
      throw new Error("Subscription inactive");
    }

    runtimePowerPlanResult = await activateRuntimePowerPlan();
  } catch (error) {
    runtimePowerPlanError = error.message;
  }

  ipcMain.handle("zerolag:get-status", async () => {
    const vbs = await getVbsStatus();
    return {
      license: await readLicenseStatusV2(),
      admin: await isAdmin(),
      activePlan: await getActivePowerPlan(),
      vbs,
      integrity: appIntegrityStatus,
      diagnostics: await getGamingDiagnostics(vbs),
      runtimePowerPlan: runtimePowerPlanResult,
      runtimePowerPlanError
    };
  });

  ipcMain.handle("zerolag:get-memory", async () => getMemorySnapshot());
  ipcMain.handle("zerolag:restore-daily-mode", async () => cleanupRuntimePowerPlan());
  ipcMain.handle("zerolag:get-game-library", async () => readGameLibrary());
  ipcMain.handle("zerolag:add-game", async () => addGameToLibrary());
  ipcMain.handle("zerolag:remove-game", async (_event, id) => removeGameFromLibrary(String(id || "")));
  ipcMain.handle("zerolag:launch-game", async (_event, id) => launchGame(String(id || "")));
  ipcMain.handle("zerolag:get-network-diagnostics", async () => getNetworkDiagnostics());
  ipcMain.handle("zerolag:flush-dns", async () => flushDnsCache());
  ipcMain.handle("zerolag:get-app-config", async () => {
    const config = readAppConfig();
    return {
      releaseMode: config.releaseMode,
      releaseChannel: config.releaseChannel,
      websiteUrl: config.websiteUrl,
      supportUrl: config.supportUrl
    };
  });
  ipcMain.handle("zerolag:get-update-status", async () => readUpdateStatusV2());
  ipcMain.handle("zerolag:create-order", async () => createMembershipOrder());
  ipcMain.handle("zerolag:get-order-status", async (_event, orderId) => getMembershipOrderStatus(orderId));
  ipcMain.handle("zerolag:open-website", async () => {
    const target = readAppConfig().websiteUrl;
    if (!isHttpUrl(target)) return false;
    await shell.openExternal(target);
    return true;
  });
  ipcMain.handle("zerolag:open-update-url", async (_event, url) => {
    const target = String(url || "");
    if (!isHttpUrl(target)) return false;
    await shell.openExternal(target);
    return true;
  });
  ipcMain.handle("zerolag:activate-license", async (_event, code) => activateLicenseV2(String(code || "").trim()));
  ipcMain.handle("zerolag:boost", async () => runOneClickBoost());
  createTray();
  createWindow();
  const authorizationTimer = setInterval(() => {
    enforceRuntimeAuthorization().catch(() => {});
  }, 30 * 1000);
  if (authorizationTimer.unref) authorizationTimer.unref();
});

app.on("before-quit", (event) => {
  if (allowQuitAfterCleanup) return;

  event.preventDefault();
  allowQuitAfterCleanup = true;
  cleanupRuntimePowerPlan().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return;
  }

  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
