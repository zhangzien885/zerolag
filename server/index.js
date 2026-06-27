const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const defaultDataDir = path.join(__dirname, "data");
const defaultStatePath = path.join(defaultDataDir, "server-state.json");
const updateManifestPath = path.join(rootDir, "assets", "update.json");

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hmac(secret, value) {
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
}

function tokenHash(secret, token) {
  return hmac(secret, `token:${token}`);
}

function codeHash(secret, code) {
  return hmac(secret, `activation:${String(code || "").trim().toUpperCase()}`);
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function createEmptyState() {
  return {
    version: 1,
    createdAt: nowIso(),
    activationCodes: {},
    subscriptions: {},
    tokens: {}
  };
}

function statePathFromOptions(options = {}) {
  return options.statePath || process.env.ZEROLAG_SERVER_STATE_PATH || defaultStatePath;
}

function serverSecretFromOptions(options = {}) {
  return options.serverSecret || process.env.ZEROLAG_SERVER_SECRET || "zerolag-dev-server-secret-change-before-production";
}

function loadState(options = {}) {
  const statePath = statePathFromOptions(options);
  if (!fs.existsSync(statePath)) {
    return createEmptyState();
  }

  try {
    return {
      ...createEmptyState(),
      ...JSON.parse(fs.readFileSync(statePath, "utf8"))
    };
  } catch {
    return createEmptyState();
  }
}

function saveState(state, options = {}) {
  const statePath = statePathFromOptions(options);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function addActivationCode(code, input = {}, options = {}) {
  const normalized = normalizeCode(code);
  if (!normalized) {
    throw new Error("Activation code is required.");
  }

  const secret = serverSecretFromOptions(options);
  const state = loadState(options);
  const hash = codeHash(secret, normalized);
  state.activationCodes[hash] = {
    codeHash: hash,
    label: input.label || "",
    plan: input.plan || "ZeroLag Pro Monthly",
    durationDays: Number(input.durationDays || 30),
    maxUses: Number(input.maxUses || 1),
    useCount: Number(input.useCount || 0),
    enabled: input.enabled !== false,
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  saveState(state, options);
  return state.activationCodes[hash];
}

function jsonResponse(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store"
  });
  response.end(payload);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function activeSubscription(subscription) {
  return Boolean(subscription)
    && subscription.status === "active"
    && new Date(subscription.expiresAt).getTime() > Date.now();
}

function issueToken(state, subscription, options = {}) {
  const secret = serverSecretFromOptions(options);
  const token = `zl_${crypto.randomBytes(32).toString("base64url")}`;
  const hash = tokenHash(secret, token);
  state.tokens[hash] = {
    tokenHash: hash,
    subscriptionId: subscription.subscriptionId,
    deviceHash: subscription.deviceHash,
    expiresAt: subscription.expiresAt,
    createdAt: nowIso(),
    lastUsedAt: nowIso()
  };
  return token;
}

function successLicensePayload(subscription, token) {
  return {
    active: true,
    plan: subscription.plan,
    expiresAt: subscription.expiresAt,
    token,
    subscriptionId: subscription.subscriptionId,
    sessionId: randomId("sess")
  };
}

function findExistingSubscriptionByCodeAndDevice(state, hash, deviceHash) {
  return Object.values(state.subscriptions).find((subscription) => (
    subscription.activationCodeHash === hash
    && subscription.deviceHash === deviceHash
    && activeSubscription(subscription)
  ));
}

function validateDeviceHash(deviceHash) {
  return /^[a-f0-9]{64}$/i.test(String(deviceHash || ""));
}

async function activateLicense(request, response, options = {}) {
  const body = await readRequestBody(request);
  const activationCode = normalizeCode(body.activationCode);
  const deviceHash = String(body.deviceHash || "").trim();

  if (!activationCode || !validateDeviceHash(deviceHash)) {
    jsonResponse(response, 400, { active: false, message: "Invalid activation request." });
    return;
  }

  const secret = serverSecretFromOptions(options);
  const state = loadState(options);
  const hash = codeHash(secret, activationCode);
  const code = state.activationCodes[hash];

  if (!code || !code.enabled) {
    jsonResponse(response, 403, { active: false, message: "Activation code is invalid." });
    return;
  }

  const existing = findExistingSubscriptionByCodeAndDevice(state, hash, deviceHash);
  if (existing) {
    const token = issueToken(state, existing, options);
    existing.lastValidatedAt = nowIso();
    saveState(state, options);
    jsonResponse(response, 200, successLicensePayload(existing, token));
    return;
  }

  if (Number(code.useCount || 0) >= Number(code.maxUses || 1)) {
    jsonResponse(response, 403, { active: false, message: "Activation code has already been used." });
    return;
  }

  const durationMs = Math.max(1, Number(code.durationDays || 30)) * 24 * 60 * 60 * 1000;
  const subscription = {
    subscriptionId: randomId("sub"),
    activationCodeHash: hash,
    deviceHash,
    plan: code.plan || "ZeroLag Pro Monthly",
    status: "active",
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + durationMs).toISOString(),
    lastValidatedAt: nowIso(),
    appVersion: String(body.appVersion || ""),
    channel: String(body.channel || "")
  };
  state.subscriptions[subscription.subscriptionId] = subscription;
  code.useCount = Number(code.useCount || 0) + 1;
  code.updatedAt = nowIso();

  const token = issueToken(state, subscription, options);
  saveState(state, options);
  jsonResponse(response, 200, successLicensePayload(subscription, token));
}

async function validateLicense(request, response, options = {}) {
  const body = await readRequestBody(request);
  const secret = serverSecretFromOptions(options);
  const deviceHash = String(body.deviceHash || "").trim();
  const subscriptionId = String(body.subscriptionId || "").trim();
  const token = String(body.token || "").trim();

  if (!token || !subscriptionId || !validateDeviceHash(deviceHash)) {
    jsonResponse(response, 400, { active: false, message: "Invalid validation request." });
    return;
  }

  const state = loadState(options);
  const tokenRecord = state.tokens[tokenHash(secret, token)];
  const subscription = state.subscriptions[subscriptionId];

  if (!tokenRecord || !subscription || tokenRecord.subscriptionId !== subscriptionId) {
    jsonResponse(response, 403, { active: false, message: "Membership needs reactivation." });
    return;
  }

  if (tokenRecord.deviceHash !== deviceHash || subscription.deviceHash !== deviceHash) {
    jsonResponse(response, 403, { active: false, message: "Device binding mismatch." });
    return;
  }

  if (!activeSubscription(subscription)) {
    subscription.status = "expired";
    saveState(state, options);
    jsonResponse(response, 200, { active: false, message: "Membership expired." });
    return;
  }

  delete state.tokens[tokenHash(secret, token)];
  subscription.lastValidatedAt = nowIso();
  const nextToken = issueToken(state, subscription, options);
  saveState(state, options);
  jsonResponse(response, 200, successLicensePayload(subscription, nextToken));
}

async function updateManifest(_request, response) {
  if (!fs.existsSync(updateManifestPath)) {
    jsonResponse(response, 404, { message: "Update manifest not found." });
    return;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(updateManifestPath, "utf8"));
    jsonResponse(response, 200, { ...manifest, source: "server" });
  } catch {
    jsonResponse(response, 500, { message: "Update manifest is invalid." });
  }
}

async function routeRequest(request, response, options = {}) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      jsonResponse(response, 200, { ok: true, product: "ZeroLag", time: nowIso() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/licenses/activate") {
      await activateLicense(request, response, options);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/licenses/validate") {
      await validateLicense(request, response, options);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/updates/manifest") {
      await updateManifest(request, response, options);
      return;
    }

    jsonResponse(response, 404, { message: "Not found." });
  } catch (error) {
    jsonResponse(response, 500, { message: error.message || "Server error." });
  }
}

function createAppServer(options = {}) {
  const server = http.createServer((request, response) => {
    routeRequest(request, response, options);
  });
  return server;
}

function startServer(options = {}) {
  const port = Number(options.port || process.env.ZEROLAG_SERVER_PORT || 8787);
  const host = options.host || process.env.ZEROLAG_SERVER_HOST || "127.0.0.1";
  const server = createAppServer(options);
  server.listen(port, host, () => {
    console.log(`ZeroLag license server listening on http://${host}:${port}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  addActivationCode,
  createAppServer,
  loadState,
  saveState,
  startServer
};
