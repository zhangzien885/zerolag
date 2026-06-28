const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const defaultDataDir = path.join(__dirname, "data");
const defaultStatePath = path.join(defaultDataDir, "server-state.json");
const updateManifestPath = path.join(rootDir, "assets", "update.json");
const maxAuditEvents = 2000;
const defaultBackupRetention = 25;
const defaultRateLimitWindowMs = 60 * 1000;
const defaultRateLimitMax = 120;
const defaultRateLimitByRoute = {
  "orders:create": 30,
  "orders:status": 240,
  "payments:webhook": 120,
  "licenses:activate": 20,
  "licenses:validate": 240,
  admin: 120
};
const rateLimitBuckets = new Map();

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
    auditEvents: [],
    orders: {},
    paymentEvents: {},
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

function adminSecretFromOptions(options = {}) {
  return options.adminSecret || process.env.ZEROLAG_ADMIN_SECRET || "zerolag-dev-admin-secret-change-before-production";
}

function paymentWebhookSecretFromOptions(options = {}) {
  return options.paymentWebhookSecret
    || process.env.ZEROLAG_PAYMENT_WEBHOOK_SECRET
    || "zerolag-dev-payment-webhook-secret-change-before-production";
}

function backupConfigFromOptions(options = {}) {
  const input = options.backup || {};
  const retention = Number(input.retention ?? process.env.ZEROLAG_SERVER_BACKUP_RETENTION ?? defaultBackupRetention);
  return {
    dir: input.dir || process.env.ZEROLAG_SERVER_BACKUP_DIR || path.join(path.dirname(statePathFromOptions(options)), "backups"),
    enabled: input.enabled !== false && process.env.ZEROLAG_SERVER_BACKUP_DISABLED !== "1",
    retention: Number.isFinite(retention) && retention >= 0 ? Math.floor(retention) : defaultBackupRetention
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function rateLimitConfigFromOptions(options = {}, routeKey = "default") {
  const input = options.rateLimit || {};
  const routeDefaultMax = defaultRateLimitByRoute[routeKey] || defaultRateLimitMax;
  return {
    enabled: input.enabled !== false && process.env.ZEROLAG_RATE_LIMIT_DISABLED !== "1",
    max: Math.max(1, Math.floor(positiveNumber(
      input.maxByRoute && input.maxByRoute[routeKey]
        ? input.maxByRoute[routeKey]
        : input.max || process.env.ZEROLAG_RATE_LIMIT_MAX,
      routeDefaultMax
    ))),
    namespace: String(input.namespace || statePathFromOptions(options)),
    trustProxy: input.trustProxy === true || process.env.ZEROLAG_TRUST_PROXY === "1",
    windowMs: positiveNumber(input.windowMs || process.env.ZEROLAG_RATE_LIMIT_WINDOW_MS, defaultRateLimitWindowMs)
  };
}

function clientIpFromRequest(request, config) {
  if (!config.trustProxy) {
    return request.socket.remoteAddress || "unknown";
  }

  const forwardedFor = String(request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwardedFor || String(request.headers["x-real-ip"] || "").trim() || request.socket.remoteAddress || "unknown";
}

function cleanupRateLimitBuckets(now) {
  if (rateLimitBuckets.size < 5000) return;

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function applyRateLimit(request, response, routeKey, options = {}) {
  const config = rateLimitConfigFromOptions(options, routeKey);
  if (!config.enabled) return true;

  const now = Date.now();
  cleanupRateLimitBuckets(now);
  const key = `${config.namespace}:${routeKey}:${clientIpFromRequest(request, config)}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + config.windowMs
    });
    return true;
  }

  bucket.count += 1;
  if (bucket.count <= config.max) return true;

  response.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
  jsonResponse(response, 429, {
    message: "Too many requests. Please try again later."
  });
  return false;
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
    return loadLatestBackupState(options) || createEmptyState();
  }
}

function safeTimestampForFileName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function listBackupFiles(options = {}) {
  const config = backupConfigFromOptions(options);
  if (!fs.existsSync(config.dir)) return [];

  return fs.readdirSync(config.dir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      const filePath = path.join(config.dir, fileName);
      const stats = fs.statSync(filePath);
      return {
        fileName,
        filePath,
        createdAt: stats.mtime.toISOString(),
        sizeBytes: stats.size
      };
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function pruneBackupFiles(options = {}) {
  const config = backupConfigFromOptions(options);
  if (config.retention <= 0) return;

  listBackupFiles(options)
    .slice(config.retention)
    .forEach((backup) => {
      fs.rmSync(backup.filePath, { force: true });
    });
}

function backupCurrentStateFile(statePath, options = {}) {
  const config = backupConfigFromOptions(options);
  if (!config.enabled || config.retention === 0 || !fs.existsSync(statePath)) return null;

  const currentState = fs.readFileSync(statePath);
  const digest = crypto.createHash("sha256").update(currentState).digest("hex").slice(0, 12);
  fs.mkdirSync(config.dir, { recursive: true });
  const backupPath = path.join(config.dir, `server-state-${safeTimestampForFileName()}-${digest}-${crypto.randomBytes(3).toString("hex")}.json`);
  fs.writeFileSync(backupPath, currentState);
  pruneBackupFiles(options);
  return backupPath;
}

function loadLatestBackupState(options = {}) {
  for (const backup of listBackupFiles(options)) {
    try {
      return {
        ...createEmptyState(),
        ...JSON.parse(fs.readFileSync(backup.filePath, "utf8"))
      };
    } catch {
      // Keep scanning older backups if the latest snapshot is also damaged.
    }
  }

  return null;
}

function writeFileAtomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function saveState(state, options = {}) {
  const statePath = statePathFromOptions(options);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  backupCurrentStateFile(statePath, options);
  writeFileAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function safeActivationCodeRecord(record) {
  return {
    label: record.label || "",
    plan: record.plan || "ZeroLag Pro Monthly",
    durationDays: Number(record.durationDays || 30),
    maxUses: Number(record.maxUses || 1),
    useCount: Number(record.useCount || 0),
    enabled: record.enabled !== false,
    createdAt: record.createdAt || "",
    updatedAt: record.updatedAt || ""
  };
}

function generateActivationCode() {
  return `ZL-PRO-${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function safeOrderRecord(order) {
  return {
    orderId: order.orderId,
    status: order.status,
    plan: order.plan,
    amountCents: Number(order.amountCents || 0),
    currency: order.currency || "CNY",
    activationCode: order.status === "paid" ? order.activationCode || "" : "",
    createdAt: order.createdAt || "",
    paidAt: order.paidAt || "",
    refundedAt: order.refundedAt || ""
  };
}

function maskDeviceHash(deviceHash) {
  const value = String(deviceHash || "");
  if (value.length < 16) return "";
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function subscriptionEffectiveStatus(subscription) {
  if (!subscription) return "unknown";
  if (subscription.status === "revoked") return "revoked";
  if (activeSubscription(subscription)) return "active";
  if (subscription.status === "active") return "expired";
  return subscription.status || "unknown";
}

function safeSubscriptionRecord(subscription) {
  return {
    subscriptionId: subscription.subscriptionId,
    status: subscriptionEffectiveStatus(subscription),
    active: activeSubscription(subscription),
    plan: subscription.plan,
    expiresAt: subscription.expiresAt || "",
    createdAt: subscription.createdAt || "",
    renewedAt: subscription.renewedAt || "",
    revokedAt: subscription.revokedAt || "",
    renewalCount: Number(subscription.renewalCount || 0),
    activationCount: Array.isArray(subscription.activationCodeHashes)
      ? subscription.activationCodeHashes.length
      : Number(Boolean(subscription.activationCodeHash)),
    device: maskDeviceHash(subscription.deviceHash),
    appVersion: subscription.appVersion || "",
    channel: subscription.channel || "",
    lastValidatedAt: subscription.lastValidatedAt || ""
  };
}

function safeAuditEventRecord(event) {
  return {
    eventId: event.eventId,
    type: event.type,
    actor: event.actor || "system",
    targetType: event.targetType || "",
    targetId: event.targetId || "",
    createdAt: event.createdAt || "",
    metadata: event.metadata || {}
  };
}

function appendAuditEvent(state, type, input = {}) {
  state.auditEvents = Array.isArray(state.auditEvents) ? state.auditEvents : [];
  state.auditEvents.push({
    eventId: randomId("aud"),
    type,
    actor: input.actor || "system",
    targetType: input.targetType || "",
    targetId: input.targetId || "",
    createdAt: nowIso(),
    metadata: input.metadata || {}
  });

  if (state.auditEvents.length > maxAuditEvents) {
    state.auditEvents = state.auditEvents.slice(-maxAuditEvents);
  }
}

function stateSummary(state) {
  const activationCodes = Object.values(state.activationCodes || {});
  const orders = Object.values(state.orders || {});
  const subscriptions = Object.values(state.subscriptions || {});
  return {
    activationCodes: {
      total: activationCodes.length,
      enabled: activationCodes.filter((code) => code.enabled !== false).length,
      used: activationCodes.filter((code) => Number(code.useCount || 0) > 0).length
    },
    orders: {
      total: orders.length,
      pending: orders.filter((order) => order.status === "pending").length,
      paid: orders.filter((order) => order.status === "paid").length,
      refunded: orders.filter((order) => order.status === "refunded").length
    },
    paymentEvents: {
      total: Object.keys(state.paymentEvents || {}).length
    },
    auditEvents: {
      total: Array.isArray(state.auditEvents) ? state.auditEvents.length : 0
    },
    subscriptions: {
      total: subscriptions.length,
      active: subscriptions.filter(activeSubscription).length,
      revoked: subscriptions.filter((subscription) => subscription.status === "revoked").length,
      expired: subscriptions.filter((subscription) => subscriptionEffectiveStatus(subscription) === "expired").length
    },
    tokens: {
      active: Object.keys(state.tokens || {}).length
    }
  };
}

function stateExportPayload(state) {
  const serializedState = JSON.stringify(state);
  return {
    ok: true,
    exportedAt: nowIso(),
    schemaVersion: Number(state.version || 1),
    stateSha256: sha256(serializedState),
    summary: stateSummary(state),
    state
  };
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdmin(request, response, options = {}) {
  const expected = adminSecretFromOptions(options);
  const provided = request.headers["x-zerolag-admin-secret"];
  if (!expected || !timingSafeEqualText(provided, expected)) {
    jsonResponse(response, 401, { message: "Admin authorization required." });
    return false;
  }
  return true;
}

function adminActor(request) {
  return String(request.headers["x-zerolag-admin-actor"] || "admin").trim() || "admin";
}

function signPaymentWebhook(secret, bodyText) {
  return `sha256=${crypto.createHmac("sha256", secret).update(String(bodyText || "")).digest("hex")}`;
}

function verifyPaymentWebhookSignature(request, rawBody, options = {}) {
  const expected = signPaymentWebhook(paymentWebhookSecretFromOptions(options), rawBody);
  const provided = request.headers["x-zerolag-signature"];
  return timingSafeEqualText(provided, expected);
}

function putActivationCode(state, code, input = {}, options = {}) {
  const normalized = normalizeCode(code);
  if (!normalized) {
    throw new Error("Activation code is required.");
  }

  const secret = serverSecretFromOptions(options);
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
  return state.activationCodes[hash];
}

function addActivationCode(code, input = {}, options = {}) {
  const state = loadState(options);
  const record = putActivationCode(state, code, input, options);
  saveState(state, options);
  return record;
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

function readRawRequestBody(request) {
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
      resolve(raw);
    });
    request.on("error", reject);
  });
}

function parseJsonBody(raw) {
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

async function readRequestBody(request) {
  return parseJsonBody(await readRawRequestBody(request));
}

function activeSubscription(subscription) {
  return Boolean(subscription)
    && subscription.status === "active"
    && new Date(subscription.expiresAt).getTime() > Date.now();
}

function subscriptionUsesActivationHash(subscription, hash) {
  const hashes = Array.isArray(subscription.activationCodeHashes)
    ? subscription.activationCodeHashes
    : [];
  return subscription.activationCodeHash === hash || hashes.includes(hash);
}

function addActivationHashToSubscription(subscription, hash) {
  const hashes = Array.isArray(subscription.activationCodeHashes)
    ? subscription.activationCodeHashes
    : [];
  const nextHashes = new Set([
    subscription.activationCodeHash,
    ...hashes,
    hash
  ].filter(Boolean));
  subscription.activationCodeHash = subscription.activationCodeHash || hash;
  subscription.activationCodeHashes = Array.from(nextHashes);
}

function subscriptionActivationHashes(subscription) {
  const hashes = Array.isArray(subscription.activationCodeHashes)
    ? subscription.activationCodeHashes
    : [];
  return Array.from(new Set([
    subscription.activationCodeHash,
    ...hashes
  ].filter(Boolean)));
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

function invalidateSubscriptionTokens(state, subscriptionId) {
  Object.entries(state.tokens || {}).forEach(([hash, token]) => {
    if (token.subscriptionId === subscriptionId) {
      delete state.tokens[hash];
    }
  });
}

function revokeSubscriptionInState(state, subscriptionId, input = {}) {
  const subscription = state.subscriptions[String(subscriptionId || "").trim()];
  if (!subscription) return null;

  subscription.status = "revoked";
  subscription.revokedAt = subscription.revokedAt || nowIso();
  subscription.revokeReason = input.reason || "manual_revoke";

  if (input.disableActivationCodes !== false) {
    subscriptionActivationHashes(subscription).forEach((hash) => {
      const activationRecord = state.activationCodes[hash];
      if (activationRecord) {
        activationRecord.enabled = false;
        activationRecord.updatedAt = nowIso();
      }
    });
  }

  invalidateSubscriptionTokens(state, subscription.subscriptionId);
  return subscription;
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
    subscriptionUsesActivationHash(subscription, hash)
    && subscription.deviceHash === deviceHash
    && activeSubscription(subscription)
  ));
}

function findRenewableSubscriptionByDevice(state, deviceHash, plan) {
  return Object.values(state.subscriptions).find((subscription) => (
    subscription.deviceHash === deviceHash
    && subscription.plan === plan
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
    appendAuditEvent(state, "license.reused", {
      actor: "client",
      targetType: "subscription",
      targetId: existing.subscriptionId,
      metadata: {
        device: maskDeviceHash(deviceHash),
        plan: existing.plan,
        channel: String(body.channel || ""),
        appVersion: String(body.appVersion || "")
      }
    });
    saveState(state, options);
    jsonResponse(response, 200, successLicensePayload(existing, token));
    return;
  }

  if (Number(code.useCount || 0) >= Number(code.maxUses || 1)) {
    jsonResponse(response, 403, { active: false, message: "Activation code has already been used." });
    return;
  }

  const durationMs = Math.max(1, Number(code.durationDays || 30)) * 24 * 60 * 60 * 1000;
  const plan = code.plan || "ZeroLag Pro Monthly";
  const renewable = findRenewableSubscriptionByDevice(state, deviceHash, plan);

  if (renewable) {
    const currentExpiry = new Date(renewable.expiresAt).getTime();
    const renewalBase = Number.isFinite(currentExpiry) && currentExpiry > Date.now()
      ? currentExpiry
      : Date.now();
    addActivationHashToSubscription(renewable, hash);
    renewable.expiresAt = new Date(renewalBase + durationMs).toISOString();
    renewable.lastValidatedAt = nowIso();
    renewable.renewedAt = nowIso();
    renewable.renewalCount = Number(renewable.renewalCount || 0) + 1;
    renewable.appVersion = String(body.appVersion || renewable.appVersion || "");
    renewable.channel = String(body.channel || renewable.channel || "");
    code.useCount = Number(code.useCount || 0) + 1;
    code.updatedAt = nowIso();

    const token = issueToken(state, renewable, options);
    appendAuditEvent(state, "license.renewed", {
      actor: "client",
      targetType: "subscription",
      targetId: renewable.subscriptionId,
      metadata: {
        device: maskDeviceHash(deviceHash),
        plan: renewable.plan,
        expiresAt: renewable.expiresAt,
        renewalCount: Number(renewable.renewalCount || 0),
        channel: renewable.channel,
        appVersion: renewable.appVersion
      }
    });
    saveState(state, options);
    jsonResponse(response, 200, successLicensePayload(renewable, token));
    return;
  }

  const subscription = {
    subscriptionId: randomId("sub"),
    activationCodeHash: hash,
    activationCodeHashes: [hash],
    deviceHash,
    plan,
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
  appendAuditEvent(state, "license.activated", {
    actor: "client",
    targetType: "subscription",
    targetId: subscription.subscriptionId,
    metadata: {
      device: maskDeviceHash(deviceHash),
      plan: subscription.plan,
      expiresAt: subscription.expiresAt,
      channel: subscription.channel,
      appVersion: subscription.appVersion
    }
  });
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

  if (subscription.status === "revoked") {
    delete state.tokens[tokenHash(secret, token)];
    saveState(state, options);
    jsonResponse(response, 403, { active: false, message: "Membership is no longer active." });
    return;
  }

  if (!activeSubscription(subscription)) {
    if (subscription.status !== "revoked") {
      subscription.status = "expired";
    }
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

async function createOrder(request, response, options = {}) {
  const body = await readRequestBody(request);
  const state = loadState(options);
  const plan = body.plan || "ZeroLag Pro Monthly";
  const durationDays = Number(body.durationDays || 30);
  const amountCents = Number(body.amountCents || 3000);
  const orderId = randomId("ord");
  const deviceHash = validateDeviceHash(body.deviceHash) ? String(body.deviceHash).trim() : "";
  const order = {
    orderId,
    status: "pending",
    plan,
    durationDays: Number.isFinite(durationDays) && durationDays > 0 ? durationDays : 30,
    maxUses: 1,
    amountCents: Number.isFinite(amountCents) && amountCents > 0 ? amountCents : 3000,
    currency: body.currency || "CNY",
    deviceHash,
    channel: String(body.channel || ""),
    createdAt: nowIso(),
    paidAt: "",
    refundedAt: "",
    paymentProvider: "",
    providerTradeId: "",
    refundTradeId: "",
    activationCode: ""
  };

  state.orders[orderId] = order;
  appendAuditEvent(state, "order.created", {
    actor: "client",
    targetType: "order",
    targetId: orderId,
    metadata: {
      plan: order.plan,
      amountCents: order.amountCents,
      currency: order.currency,
      channel: order.channel,
      device: maskDeviceHash(deviceHash)
    }
  });
  saveState(state, options);
  jsonResponse(response, 201, {
    ok: true,
    order: safeOrderRecord(order),
    payment: {
      provider: "manual",
      paymentUrl: `zerolag://pay/${orderId}`,
      message: "Manual payment confirmation is required in the MVP."
    }
  });
}

async function getOrderStatus(_request, response, options = {}, orderId = "") {
  const state = loadState(options);
  const order = state.orders[String(orderId || "")];
  if (!order) {
    jsonResponse(response, 404, { message: "Order not found." });
    return;
  }

  jsonResponse(response, 200, {
    ok: true,
    order: safeOrderRecord(order)
  });
}

function completeOrderInState(state, orderId, input = {}, options = {}) {
  const order = state.orders[String(orderId || "").trim()];
  if (!order) return null;

  if (!order.activationCode) {
    const code = normalizeCode(input.activationCode || generateActivationCode());
    putActivationCode(state, code, {
      label: `order:${order.orderId}`,
      plan: order.plan || "ZeroLag Pro Monthly",
      durationDays: Number(order.durationDays || 30),
      maxUses: Number(order.maxUses || 1),
      enabled: true
    }, options);
    order.activationCode = code;
  }

  order.status = "paid";
  order.paidAt = order.paidAt || nowIso();
  order.paymentProvider = String(input.paymentProvider || order.paymentProvider || "");
  order.providerTradeId = String(input.providerTradeId || order.providerTradeId || "");
  return order;
}

function refundOrderInState(state, orderId, input = {}, options = {}) {
  const order = state.orders[String(orderId || "").trim()];
  if (!order) return null;

  order.status = "refunded";
  order.refundedAt = order.refundedAt || nowIso();
  order.paymentProvider = String(input.paymentProvider || order.paymentProvider || "");
  order.refundTradeId = String(input.refundTradeId || input.providerTradeId || order.refundTradeId || "");

  const activationCode = normalizeCode(order.activationCode);
  if (!activationCode) return order;

  const secret = serverSecretFromOptions(options);
  const activationCodeHash = codeHash(secret, activationCode);
  const activationRecord = state.activationCodes[activationCodeHash];
  if (activationRecord) {
    activationRecord.enabled = false;
    activationRecord.updatedAt = nowIso();
  }

  const revokedSubscriptionIds = new Set();
  Object.values(state.subscriptions || {}).forEach((subscription) => {
    if (!subscriptionUsesActivationHash(subscription, activationCodeHash)) return;
    revokeSubscriptionInState(state, subscription.subscriptionId, {
      reason: input.reason || "payment_refunded",
      disableActivationCodes: false
    });
    revokedSubscriptionIds.add(subscription.subscriptionId);
  });

  revokedSubscriptionIds.forEach((subscriptionId) => {
    invalidateSubscriptionTokens(state, subscriptionId);
  });

  return order;
}

function ordersForSubscription(state, subscription, options = {}) {
  const secret = serverSecretFromOptions(options);
  const hashes = new Set(subscriptionActivationHashes(subscription));
  return Object.values(state.orders || {})
    .filter((order) => order.activationCode && hashes.has(codeHash(secret, order.activationCode)))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map(safeOrderRecord);
}

async function createActivationCodeAdmin(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  const body = await readRequestBody(request);
  const code = normalizeCode(body.code || `ZL-PRO-${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`);
  const state = loadState(options);
  const record = putActivationCode(state, code, {
    label: body.label || "admin-created",
    plan: body.plan || "ZeroLag Pro Monthly",
    durationDays: Number(body.durationDays || 30),
    maxUses: Number(body.maxUses || 1),
    enabled: body.enabled !== false
  }, options);
  appendAuditEvent(state, "activation_code.created", {
    actor: adminActor(request),
    targetType: "activation_code",
    targetId: record.codeHash,
    metadata: {
      label: record.label,
      plan: record.plan,
      durationDays: record.durationDays,
      maxUses: record.maxUses,
      enabled: record.enabled
    }
  });
  saveState(state, options);

  jsonResponse(response, 201, {
    ok: true,
    code,
    activationCode: safeActivationCodeRecord(record)
  });
}

async function completeOrderAdmin(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  const body = await readRequestBody(request);
  const orderId = String(body.orderId || "").trim();
  const state = loadState(options);
  const order = completeOrderInState(state, orderId, {
    activationCode: body.activationCode,
    paymentProvider: body.paymentProvider || "manual-admin",
    providerTradeId: body.providerTradeId
  }, options);

  if (!order) {
    jsonResponse(response, 404, { message: "Order not found." });
    return;
  }

  appendAuditEvent(state, "order.completed", {
    actor: adminActor(request),
    targetType: "order",
    targetId: order.orderId,
    metadata: {
      source: "admin",
      paymentProvider: order.paymentProvider,
      hasActivationCode: Boolean(order.activationCode)
    }
  });
  saveState(state, options);

  jsonResponse(response, 200, {
    ok: true,
    order: safeOrderRecord(order)
  });
}

async function refundOrderAdmin(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  const body = await readRequestBody(request);
  const state = loadState(options);
  const order = refundOrderInState(state, body.orderId, {
    paymentProvider: body.paymentProvider || "manual-admin",
    refundTradeId: body.refundTradeId || body.providerTradeId,
    reason: body.reason || "manual_refund"
  }, options);

  if (!order) {
    jsonResponse(response, 404, { message: "Order not found." });
    return;
  }

  appendAuditEvent(state, "order.refunded", {
    actor: adminActor(request),
    targetType: "order",
    targetId: order.orderId,
    metadata: {
      source: "admin",
      paymentProvider: order.paymentProvider,
      reason: body.reason || "manual_refund"
    }
  });
  saveState(state, options);
  jsonResponse(response, 200, {
    ok: true,
    order: safeOrderRecord(order)
  });
}

async function paymentWebhook(request, response, options = {}) {
  const rawBody = await readRawRequestBody(request);
  if (!verifyPaymentWebhookSignature(request, rawBody, options)) {
    jsonResponse(response, 401, { ok: false, message: "Invalid payment signature." });
    return;
  }

  const body = parseJsonBody(rawBody);
  const eventId = String(body.eventId || body.providerTradeId || "").trim() || randomId("evt");
  const state = loadState(options);
  state.paymentEvents = state.paymentEvents || {};

  if (state.paymentEvents[eventId]) {
    jsonResponse(response, 200, state.paymentEvents[eventId].response);
    return;
  }

  const eventType = String(body.type || "payment.succeeded");
  if (eventType !== "payment.succeeded" && eventType !== "payment.refunded") {
    const ignoredPayload = { ok: true, ignored: true };
    state.paymentEvents[eventId] = {
      eventId,
      type: eventType,
      createdAt: nowIso(),
      response: ignoredPayload
    };
    appendAuditEvent(state, "payment.webhook_ignored", {
      actor: "webhook",
      targetType: "payment_event",
      targetId: eventId,
      metadata: {
        type: eventType
      }
    });
    saveState(state, options);
    jsonResponse(response, 202, ignoredPayload);
    return;
  }

  const order = eventType === "payment.refunded"
    ? refundOrderInState(state, body.orderId, {
      paymentProvider: body.provider || "signed-webhook",
      refundTradeId: body.refundTradeId || body.providerTradeId || eventId,
      reason: "payment_refunded"
    }, options)
    : completeOrderInState(state, body.orderId, {
      paymentProvider: body.provider || "signed-webhook",
      providerTradeId: body.providerTradeId || eventId
    }, options);

  if (!order) {
    jsonResponse(response, 404, { ok: false, message: "Order not found." });
    return;
  }

  const payload = {
    ok: true,
    order: safeOrderRecord(order)
  };
  state.paymentEvents[eventId] = {
    eventId,
    type: eventType,
    orderId: order.orderId,
    createdAt: nowIso(),
    response: payload
  };
  appendAuditEvent(state, eventType === "payment.refunded" ? "payment.refunded" : "payment.succeeded", {
    actor: "webhook",
    targetType: "order",
    targetId: order.orderId,
    metadata: {
      eventId,
      paymentProvider: order.paymentProvider,
      hasActivationCode: Boolean(order.activationCode)
    }
  });
  saveState(state, options);
  jsonResponse(response, 200, payload);
}

async function listOrdersAdmin(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  const state = loadState(options);
  const orders = Object.values(state.orders || {})
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map(safeOrderRecord);
  jsonResponse(response, 200, {
    ok: true,
    orders
  });
}

async function listSubscriptionsAdmin(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const statusFilter = String(url.searchParams.get("status") || "").trim();
  const deviceHash = String(url.searchParams.get("deviceHash") || "").trim();
  const state = loadState(options);
  const subscriptions = Object.values(state.subscriptions || {})
    .filter((subscription) => !statusFilter || subscriptionEffectiveStatus(subscription) === statusFilter)
    .filter((subscription) => !deviceHash || subscription.deviceHash === deviceHash)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map(safeSubscriptionRecord);

  jsonResponse(response, 200, {
    ok: true,
    subscriptions
  });
}

async function getSubscriptionAdmin(request, response, options = {}, subscriptionId = "") {
  if (!requireAdmin(request, response, options)) return;

  const state = loadState(options);
  const subscription = state.subscriptions[String(subscriptionId || "").trim()];
  if (!subscription) {
    jsonResponse(response, 404, { message: "Subscription not found." });
    return;
  }

  jsonResponse(response, 200, {
    ok: true,
    subscription: safeSubscriptionRecord(subscription),
    orders: ordersForSubscription(state, subscription, options)
  });
}

async function revokeSubscriptionAdmin(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  const body = await readRequestBody(request);
  const state = loadState(options);
  const subscription = revokeSubscriptionInState(state, body.subscriptionId, {
    reason: body.reason || "manual_revoke",
    disableActivationCodes: body.disableActivationCodes !== false
  });

  if (!subscription) {
    jsonResponse(response, 404, { message: "Subscription not found." });
    return;
  }

  appendAuditEvent(state, "subscription.revoked", {
    actor: adminActor(request),
    targetType: "subscription",
    targetId: subscription.subscriptionId,
    metadata: {
      reason: body.reason || "manual_revoke",
      disableActivationCodes: body.disableActivationCodes !== false
    }
  });
  saveState(state, options);
  jsonResponse(response, 200, {
    ok: true,
    subscription: safeSubscriptionRecord(subscription)
  });
}

async function listAuditEventsAdmin(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const typeFilter = String(url.searchParams.get("type") || "").trim();
  const targetIdFilter = String(url.searchParams.get("targetId") || "").trim();
  const rawLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
  const state = loadState(options);
  const events = (Array.isArray(state.auditEvents) ? state.auditEvents : [])
    .filter((event) => !typeFilter || event.type === typeFilter)
    .filter((event) => !targetIdFilter || event.targetId === targetIdFilter)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit)
    .map(safeAuditEventRecord);

  jsonResponse(response, 200, {
    ok: true,
    events
  });
}

async function adminSummary(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  const state = loadState(options);
  jsonResponse(response, 200, {
    ok: true,
    summary: stateSummary(state)
  });
}

async function exportStateAdmin(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  const state = loadState(options);
  jsonResponse(response, 200, stateExportPayload(state));
}

async function routeRequest(request, response, options = {}) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      jsonResponse(response, 200, { ok: true, product: "ZeroLag", time: nowIso() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/orders/create") {
      if (!applyRateLimit(request, response, "orders:create", options)) return;
      await createOrder(request, response, options);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/payments/webhook") {
      if (!applyRateLimit(request, response, "payments:webhook", options)) return;
      await paymentWebhook(request, response, options);
      return;
    }

    const orderStatusMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)$/);
    if (request.method === "GET" && orderStatusMatch) {
      if (!applyRateLimit(request, response, "orders:status", options)) return;
      await getOrderStatus(request, response, options, orderStatusMatch[1]);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/admin/activation-codes") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await createActivationCodeAdmin(request, response, options);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/admin/orders/complete") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await completeOrderAdmin(request, response, options);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/admin/orders/refund") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await refundOrderAdmin(request, response, options);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/admin/orders") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await listOrdersAdmin(request, response, options);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/admin/subscriptions") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await listSubscriptionsAdmin(request, response, options);
      return;
    }

    const subscriptionAdminMatch = url.pathname.match(/^\/v1\/admin\/subscriptions\/([^/]+)$/);
    if (request.method === "GET" && subscriptionAdminMatch) {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await getSubscriptionAdmin(request, response, options, subscriptionAdminMatch[1]);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/admin/subscriptions/revoke") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await revokeSubscriptionAdmin(request, response, options);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/admin/audit-events") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await listAuditEventsAdmin(request, response, options);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/admin/summary") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await adminSummary(request, response, options);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/admin/export") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await exportStateAdmin(request, response, options);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/licenses/activate") {
      if (!applyRateLimit(request, response, "licenses:activate", options)) return;
      await activateLicense(request, response, options);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/licenses/validate") {
      if (!applyRateLimit(request, response, "licenses:validate", options)) return;
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
  signPaymentWebhook,
  startServer
};
