const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadServerEnvFile } = require("./env");
const { createConfiguredStateStore } = require("./state-store");

const rootDir = path.join(__dirname, "..");
const defaultDataDir = path.join(__dirname, "data");
const defaultStatePath = path.join(defaultDataDir, "server-state.json");
const updateManifestPath = path.join(rootDir, "assets", "update.json");
const maxAuditEvents = 2000;
const defaultBackupRetention = 25;
const defaultRateLimitWindowMs = 60 * 1000;
const defaultRateLimitMax = 120;
const websiteMetricKeyLimit = 64;
const websiteDailyRetentionDays = 90;
const defaultMaintenanceIntervalMs = 6 * 60 * 60 * 1000;
const defaultServerSecret = "zerolag-dev-server-secret-change-before-production";
const defaultAdminSecret = "zerolag-dev-admin-secret-change-before-production";
const defaultPaymentWebhookSecret = "zerolag-dev-payment-webhook-secret-change-before-production";
const defaultPaymentProvider = "manual";
const defaultRuntimeSessionKeyVersion = "runtime-session-v1";
const defaultRuntimeSessionProofAlgorithm = "HMAC-SHA256";
const defaultPaymentAllowedProviders = [
  "manual",
  "manual-admin",
  "manual-signed-webhook",
  "signed-webhook",
  "self-test"
];
const defaultPaymentUrlTemplate = "zerolag://pay/{orderId}";
const defaultPaymentMessage = "支付通道正在准备，完成支付确认后会自动开通。";
const defaultRateLimitByRoute = {
  "website:events": 240,
  "orders:create": 30,
  "orders:status": 240,
  "accounts:auth": 60,
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
  const text = String(code || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—―＿_]/g, "-");
  const match = text.match(/ZL[\s-]*PRO[\sA-Z0-9-]*/);
  const candidate = match ? match[0] : text;
  let normalized = candidate
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (normalized.startsWith("ZLPRO")) {
    normalized = `ZL-PRO-${normalized.slice(5)}`;
  }

  if (normalized.startsWith("ZL-PRO-")) {
    const body = normalized.slice(7).replace(/-/g, "");
    if (/^[A-F0-9]{12}$/.test(body)) return `ZL-PRO-${body.slice(0, 6)}-${body.slice(6)}`;
    if (/^DEMO[0-9]{4}$/.test(body)) return `ZL-PRO-DEMO-${body.slice(4)}`;
  }

  return normalized;
}

const accountProviders = new Set(["wechat", "qq", "email", "phone"]);

function normalizeAccountProvider(provider) {
  const value = String(provider || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  return accountProviders.has(value) ? value : "";
}

function normalizeAccountIdentifier(provider, identifier) {
  const value = String(identifier || "").normalize("NFKC").trim();
  if (provider === "email") {
    return value.toLowerCase().replace(/\s+/g, "");
  }

  if (provider === "phone") {
    const compact = value.replace(/[\s()\-_.]/g, "");
    return compact.startsWith("+") ? `+${compact.slice(1).replace(/\D/g, "")}` : compact.replace(/\D/g, "");
  }

  return value.replace(/\s+/g, "").slice(0, 128);
}

function validateAccountIdentifier(provider, identifier) {
  if (provider === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
  if (provider === "phone") return /^\+?\d{7,15}$/.test(identifier);
  if (provider === "qq") return /^[a-zA-Z0-9_.-]{3,64}$/.test(identifier);
  if (provider === "wechat") return /^[a-zA-Z0-9_.@-]{3,128}$/.test(identifier);
  return false;
}

function maskAccountIdentifier(provider, identifier) {
  const value = String(identifier || "");
  if (!value) return "";
  if (provider === "email") {
    const [name, domain] = value.split("@");
    return `${name.slice(0, 2)}***@${domain || "***"}`;
  }

  if (provider === "phone") {
    return value.length > 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : `${value.slice(0, 2)}***`;
  }

  return value.length > 8 ? `${value.slice(0, 3)}***${value.slice(-3)}` : `${value.slice(0, 2)}***`;
}

function accountIdentityHash(secret, provider, identifier) {
  return hmac(secret, `account:${provider}:${identifier}`);
}

function accountTokenHash(secret, token) {
  return hmac(secret, `account-token:${token}`);
}

function safeAccountRecord(account = {}) {
  return {
    accountId: account.accountId || "",
    provider: account.provider || "",
    maskedIdentifier: account.maskedIdentifier || "",
    displayName: account.displayName || "",
    linkedMemberships: Array.isArray(account.subscriptionIds) ? account.subscriptionIds.length : 0,
    createdAt: account.createdAt || "",
    updatedAt: account.updatedAt || ""
  };
}

function issueAccountToken(state, account, options = {}) {
  state.accountTokens = state.accountTokens && typeof state.accountTokens === "object" ? state.accountTokens : {};
  const secret = serverSecretFromOptions(options);
  const token = randomId("acctok");
  state.accountTokens[accountTokenHash(secret, token)] = {
    accountId: account.accountId,
    createdAt: nowIso(),
    lastUsedAt: nowIso()
  };
  return token;
}

function accountFromToken(state, token, options = {}) {
  const value = String(token || "").trim();
  if (!value) return null;

  state.accountTokens = state.accountTokens && typeof state.accountTokens === "object" ? state.accountTokens : {};
  const secret = serverSecretFromOptions(options);
  const record = state.accountTokens[accountTokenHash(secret, value)];
  if (!record || !record.accountId) return null;

  const account = state.accounts && state.accounts[record.accountId];
  if (!account) return null;

  record.lastUsedAt = nowIso();
  return account;
}

function accountTokenFromRequest(request, body = {}) {
  const auth = String(request.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  return String((bearer && bearer[1]) || request.headers["x-zerolag-account-token"] || body.accountToken || "").trim();
}

function subscriptionSummaryForAccount(subscription = {}) {
  return {
    subscriptionId: subscription.subscriptionId || "",
    plan: subscription.plan || "",
    status: subscription.status || "",
    expiresAt: subscription.expiresAt || "",
    deviceBound: Boolean(subscription.deviceHash),
    accountLinkedAt: subscription.accountLinkedAt || ""
  };
}

function accountMemberships(state, account = {}) {
  const ids = Array.isArray(account.subscriptionIds) ? account.subscriptionIds : [];
  return ids
    .map((subscriptionId) => state.subscriptions && state.subscriptions[subscriptionId])
    .filter(Boolean)
    .map(subscriptionSummaryForAccount);
}

function bindSubscriptionToAccount(state, account, subscription, actor = "client") {
  if (!account || !subscription) return false;

  account.subscriptionIds = Array.isArray(account.subscriptionIds) ? account.subscriptionIds : [];
  if (!account.subscriptionIds.includes(subscription.subscriptionId)) {
    account.subscriptionIds.push(subscription.subscriptionId);
  }

  account.updatedAt = nowIso();
  subscription.accountId = account.accountId;
  subscription.accountProvider = account.provider;
  subscription.accountLinkedAt = subscription.accountLinkedAt || nowIso();

  appendAuditEvent(state, "account.membership_bound", {
    actor,
    targetType: "subscription",
    targetId: subscription.subscriptionId,
    metadata: {
      accountId: account.accountId,
      provider: account.provider,
      plan: subscription.plan || "",
      expiresAt: subscription.expiresAt || ""
    }
  });
  return true;
}

function subscriptionBoundToAnotherAccount(subscription, account) {
  return Boolean(subscription && subscription.accountId && account && subscription.accountId !== account.accountId);
}

function createEmptyState() {
  return {
    version: 1,
    createdAt: nowIso(),
    activationCodes: {},
    accounts: {},
    accountIdentities: {},
    accountTokens: {},
    auditEvents: [],
    orders: {},
    paymentEvents: {},
    subscriptions: {},
    tokens: {},
    websiteEvents: {
      total: 0,
      events: {},
      versions: {},
      channels: {},
      statuses: {},
      daily: {},
      dailyEvents: {}
    }
  };
}

function statePathFromOptions(options = {}) {
  return options.statePath || process.env.ZEROLAG_SERVER_STATE_PATH || defaultStatePath;
}

function serverSecretFromOptions(options = {}) {
  return options.serverSecret || process.env.ZEROLAG_SERVER_SECRET || defaultServerSecret;
}

function adminSecretFromOptions(options = {}) {
  return options.adminSecret || process.env.ZEROLAG_ADMIN_SECRET || defaultAdminSecret;
}

function paymentWebhookSecretFromOptions(options = {}) {
  return options.paymentWebhookSecret
    || process.env.ZEROLAG_PAYMENT_WEBHOOK_SECRET
    || defaultPaymentWebhookSecret;
}

function normalizePaymentProvider(value, fallback = defaultPaymentProvider) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 48);
  return normalized || fallback;
}

function paymentProviderListFromValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePaymentProvider(item, "")).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => normalizePaymentProvider(item, ""))
    .filter(Boolean);
}

function paymentConfigFromOptions(options = {}) {
  const input = options.payment || {};
  const provider = normalizePaymentProvider(input.provider || process.env.ZEROLAG_PAYMENT_PROVIDER || defaultPaymentProvider);
  const configuredAllowed = paymentProviderListFromValue(
    input.allowedProviders || process.env.ZEROLAG_PAYMENT_ALLOWED_PROVIDERS || defaultPaymentAllowedProviders
  );
  const allowedProviders = Array.from(new Set([provider, ...configuredAllowed]));

  return {
    provider,
    allowedProviders,
    urlTemplate: String(input.urlTemplate || process.env.ZEROLAG_PAYMENT_URL_TEMPLATE || defaultPaymentUrlTemplate),
    message: String(input.message || process.env.ZEROLAG_PAYMENT_MESSAGE || defaultPaymentMessage)
  };
}

function runtimeSessionKeyVersionFromOptions(options = {}) {
  const input = options.runtimeSession || {};
  const value = String(input.keyVersion || process.env.ZEROLAG_RUNTIME_SESSION_KEY_VERSION || defaultRuntimeSessionKeyVersion)
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 64);
  return value || defaultRuntimeSessionKeyVersion;
}

function normalizeRuntimeSessionProofAlgorithm(value) {
  const normalized = String(value || defaultRuntimeSessionProofAlgorithm)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "RSA-SHA256" ? "RSA-SHA256" : defaultRuntimeSessionProofAlgorithm;
}

function decodeRuntimeSessionPrivateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\\n/g, "\n");
}

function decodeRuntimeSessionPrivateKeyBase64(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    return Buffer.from(raw, "base64").toString("utf8").replace(/\\n/g, "\n").trim();
  } catch {
    return "";
  }
}

function runtimeSessionPrivateKeyPemFromOptions(options = {}) {
  const input = options.runtimeSession || {};
  return decodeRuntimeSessionPrivateKey(
    input.privateKeyPem || process.env.ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_PEM
  ) || decodeRuntimeSessionPrivateKeyBase64(
    input.privateKeyBase64
      || input.privateKeyB64
      || process.env.ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64
  );
}

function runtimeSessionProofConfigFromOptions(options = {}) {
  const input = options.runtimeSession || {};
  const algorithm = normalizeRuntimeSessionProofAlgorithm(
    input.proofAlgorithm || input.algorithm || process.env.ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM
  );

  return {
    algorithm,
    privateKeyPem: runtimeSessionPrivateKeyPemFromOptions(options)
  };
}

function paymentProviderAllowed(provider, options = {}) {
  return paymentConfigFromOptions(options).allowedProviders.includes(normalizePaymentProvider(provider, ""));
}

function paymentUrlFromTemplate(template, order) {
  return String(template || defaultPaymentUrlTemplate)
    .replace(/\{orderId\}/g, encodeURIComponent(order.orderId || ""))
    .replace(/\{amountCents\}/g, encodeURIComponent(String(order.amountCents || "")))
    .replace(/\{currency\}/g, encodeURIComponent(order.currency || ""))
    .replace(/\{plan\}/g, encodeURIComponent(order.plan || ""));
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

function maintenanceConfigFromOptions(options = {}) {
  const input = options.maintenance || {};
  return {
    enabled: input.enabled !== false && process.env.ZEROLAG_MAINTENANCE_DISABLED !== "1",
    intervalMs: positiveNumber(input.intervalMs || process.env.ZEROLAG_MAINTENANCE_INTERVAL_MS, defaultMaintenanceIntervalMs)
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

function normalizeStateRecord(input) {
  return {
    ...createEmptyState(),
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {})
  };
}

function stateStoreFromOptions(options = {}) {
  const store = options.stateStore || createConfiguredStateStore(options);
  if (!store || typeof store !== "object") return null;
  if (typeof store.loadState !== "function" || typeof store.saveState !== "function") {
    throw new Error("stateStore must provide loadState() and saveState(state).");
  }
  return store;
}

function loadStateFromJsonFile(options = {}) {
  const statePath = statePathFromOptions(options);
  if (!fs.existsSync(statePath)) {
    return createEmptyState();
  }

  try {
    return normalizeStateRecord(JSON.parse(fs.readFileSync(statePath, "utf8")));
  } catch {
    return loadLatestBackupState(options) || createEmptyState();
  }
}

function loadState(options = {}) {
  const store = stateStoreFromOptions(options);
  if (store) {
    return normalizeStateRecord(store.loadState() || createEmptyState());
  }

  return loadStateFromJsonFile(options);
}

function safeTimestampForFileName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function listBackupFiles(options = {}) {
  const store = stateStoreFromOptions(options);
  if (store) {
    return typeof store.listBackups === "function" ? store.listBackups() : [];
  }

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
  if (stateStoreFromOptions(options)) return null;

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
      return normalizeStateRecord(JSON.parse(fs.readFileSync(backup.filePath, "utf8")));
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
  const store = stateStoreFromOptions(options);
  if (store) {
    store.saveState(normalizeStateRecord(state));
    return;
  }

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
    refundedAt: order.refundedAt || "",
    paymentProvider: order.paymentProvider || "",
    accountLinked: Boolean(order.accountId),
    accountProvider: order.accountProvider || ""
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
    lastValidatedAt: subscription.lastValidatedAt || "",
    runtimeSessionRevision: Number(subscription.runtimeSessionRevision || 0),
    runtimeSessionKeyVersion: subscription.runtimeSessionKeyVersion || ""
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

function safeCountMap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => typeof key === "string" && Number.isFinite(Number(value)))
      .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value)))])
  );
}

function safeNestedCountMap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
      .map(([key, value]) => [key, safeCountMap(value)])
      .filter(([key, value]) => typeof key === "string" && Object.keys(value).length > 0)
  );
}

function websiteEventsSummary(input = {}) {
  return {
    total: Math.max(0, Math.floor(Number(input.total || 0))),
    updatedAt: String(input.updatedAt || ""),
    events: safeCountMap(input.events),
    versions: safeCountMap(input.versions),
    channels: safeCountMap(input.channels),
    statuses: safeCountMap(input.statuses),
    daily: safeCountMap(input.daily),
    dailyEvents: safeNestedCountMap(input.dailyEvents)
  };
}

function stateSummary(state) {
  const activationCodes = Object.values(state.activationCodes || {});
  const accounts = Object.values(state.accounts || {});
  const orders = Object.values(state.orders || {});
  const subscriptions = Object.values(state.subscriptions || {});
  return {
    accounts: {
      total: accounts.length,
      linked: accounts.filter((account) => Array.isArray(account.subscriptionIds) && account.subscriptionIds.length > 0).length
    },
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
    websiteEvents: websiteEventsSummary(state.websiteEvents),
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

function cleanupExpiredServerState(state, input = {}) {
  const before = stateSummary(state);
  const now = Date.now();
  let expiredSubscriptions = 0;
  let removedTokens = 0;

  Object.values(state.subscriptions || {}).forEach((subscription) => {
    const expiresAt = new Date(subscription.expiresAt || "").getTime();
    if (subscription.status === "active" && Number.isFinite(expiresAt) && expiresAt <= now) {
      subscription.status = "expired";
      subscription.expiredAt = subscription.expiredAt || nowIso();
      subscription.runtimeSessionId = "";
      subscription.runtimeSessionProof = "";
      subscription.runtimeSessionExpiredAt = subscription.expiredAt;
      expiredSubscriptions += 1;
    }
  });

  Object.entries(state.tokens || {}).forEach(([hash, token]) => {
    const subscription = state.subscriptions && state.subscriptions[token.subscriptionId];
    const tokenExpiresAt = new Date(token.expiresAt || "").getTime();
    const tokenExpired = Number.isFinite(tokenExpiresAt) && tokenExpiresAt <= now;
    if (!subscription || !activeSubscription(subscription) || tokenExpired) {
      delete state.tokens[hash];
      removedTokens += 1;
    }
  });

  const changed = expiredSubscriptions > 0 || removedTokens > 0;
  if (changed) {
    appendAuditEvent(state, "maintenance.cleanup", {
      actor: input.actor || "admin",
      targetType: "server_state",
      targetId: "cleanup",
      metadata: {
        expiredSubscriptions,
        removedTokens
      }
    });
  }

  return {
    changed,
    expiredSubscriptions,
    removedTokens,
    before,
    after: stateSummary(state)
  };
}

function runServerMaintenance(options = {}, actor = "maintenance") {
  const state = loadState(options);
  const cleanup = cleanupExpiredServerState(state, { actor });
  if (cleanup.changed) {
    saveState(state, options);
  }
  return cleanup;
}

function fileSnapshot(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        exists: false,
        sizeBytes: 0,
        updatedAt: ""
      };
    }

    const stats = fs.statSync(filePath);
    return {
      exists: true,
      sizeBytes: stats.size,
      updatedAt: stats.mtime.toISOString()
    };
  } catch {
    return {
      exists: false,
      sizeBytes: 0,
      updatedAt: "",
      error: "FILE_UNREADABLE"
    };
  }
}

function updateManifestReadiness() {
  const file = fileSnapshot(updateManifestPath);
  if (!file.exists) {
    return {
      ...file,
      valid: false,
      latest: "",
      minSupported: "",
      signed: false
    };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(updateManifestPath, "utf8"));
    return {
      ...file,
      valid: true,
      latest: manifest.latest || "",
      minSupported: manifest.minSupported || "",
      signed: Boolean(manifest.signature)
    };
  } catch {
    return {
      ...file,
      valid: false,
      latest: "",
      minSupported: "",
      signed: false,
      error: "UPDATE_MANIFEST_INVALID"
    };
  }
}

function serverReadiness(options = {}) {
  const statePath = statePathFromOptions(options);
  const stateStore = stateStoreFromOptions(options);
  const backup = stateStore
    ? {
      enabled: typeof stateStore.listBackups === "function",
      retention: 0
    }
    : backupConfigFromOptions(options);
  const backupFiles = listBackupFiles(options);
  const state = loadState(options);
  const rateLimit = rateLimitConfigFromOptions(options, "admin");
  const maintenance = maintenanceConfigFromOptions(options);
  const payment = paymentConfigFromOptions(options);
  const warnings = [];

  if (serverSecretFromOptions(options) === defaultServerSecret) warnings.push("SERVER_SECRET_DEFAULT");
  if (adminSecretFromOptions(options) === defaultAdminSecret) warnings.push("ADMIN_SECRET_DEFAULT");
  if (paymentWebhookSecretFromOptions(options) === defaultPaymentWebhookSecret) warnings.push("PAYMENT_WEBHOOK_SECRET_DEFAULT");
  if (payment.provider === defaultPaymentProvider) warnings.push("PAYMENT_PROVIDER_MANUAL");
  if (!stateStore && (!backup.enabled || backup.retention === 0)) warnings.push("BACKUP_DISABLED");

  const updateManifest = updateManifestReadiness();
  if (updateManifest.exists && !updateManifest.valid) warnings.push("UPDATE_MANIFEST_INVALID");

  return {
    ok: true,
    product: "ZeroLag",
    checkedAt: nowIso(),
    state: {
      path: statePath,
      file: fileSnapshot(statePath),
      summary: stateSummary(state)
    },
    storage: {
      kind: stateStore ? String(stateStore.kind || "custom") : "json-file",
      backups: backup.enabled
    },
    backups: {
      enabled: backup.enabled,
      retention: backup.retention,
      count: backupFiles.length,
      latestAt: backupFiles[0] ? backupFiles[0].createdAt : ""
    },
    updateManifest,
    secrets: {
      serverSecret: serverSecretFromOptions(options) === defaultServerSecret ? "default" : "custom",
      adminSecret: adminSecretFromOptions(options) === defaultAdminSecret ? "default" : "custom",
      paymentWebhookSecret: paymentWebhookSecretFromOptions(options) === defaultPaymentWebhookSecret ? "default" : "custom"
    },
    rateLimit: {
      enabled: rateLimit.enabled,
      trustProxy: rateLimit.trustProxy,
      windowMs: rateLimit.windowMs
    },
    maintenance: {
      enabled: maintenance.enabled,
      intervalMs: maintenance.intervalMs
    },
    payment: {
      provider: payment.provider,
      allowedProviders: payment.allowedProviders,
      paymentUrlConfigured: payment.urlTemplate !== defaultPaymentUrlTemplate
    },
    runtimeSession: {
      keyVersion: runtimeSessionKeyVersionFromOptions(options),
      proofAlgorithm: runtimeSessionProofConfigFromOptions(options).algorithm,
      asymmetricProofConfigured: Boolean(runtimeSessionPrivateKeyPemFromOptions(options))
    },
    warnings
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

function emptyResponse(response, statusCode) {
  response.writeHead(statusCode, {
    "Content-Length": 0,
    "Cache-Control": "no-store"
  });
  response.end();
}

function setWebsiteEventCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Max-Age", "86400");
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

const allowedWebsiteEvents = new Set([
  "release_view",
  "download_click",
  "purchase_click",
  "support_click",
  "checksum_copy",
  "checksum_info_click",
  "cta_click"
]);

function normalizeWebsiteEventName(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 64);
  return allowedWebsiteEvents.has(normalized) ? normalized : "";
}

function normalizeWebsiteMetricKey(value, fallback = "unknown") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 48);
  return normalized || fallback;
}

function bumpCount(map, key) {
  map[key] = Math.max(0, Math.floor(Number(map[key] || 0))) + 1;
}

function pruneCountMap(map, limit, options = {}) {
  const entries = Object.entries(map || {})
    .filter(([key, value]) => typeof key === "string" && Number.isFinite(Number(value)))
    .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value)))]);
  const selected = entries
    .sort((left, right) => {
      if (options.sortByKeyDesc) return right[0].localeCompare(left[0]);
      return right[1] - left[1] || left[0].localeCompare(right[0]);
    })
    .slice(0, limit);

  for (const key of Object.keys(map || {})) {
    delete map[key];
  }
  for (const [key, value] of selected) {
    map[key] = value;
  }
}

function pruneNestedDailyCountMap(map, limit) {
  const selectedDays = Object.keys(map || {})
    .filter((day) => typeof day === "string" && map[day] && typeof map[day] === "object" && !Array.isArray(map[day]))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, limit);
  const selectedDaySet = new Set(selectedDays);

  for (const day of Object.keys(map || {})) {
    if (!selectedDaySet.has(day)) {
      delete map[day];
      continue;
    }

    pruneCountMap(map[day], allowedWebsiteEvents.size);
  }
}

function pruneWebsiteEventMetrics(metrics) {
  pruneCountMap(metrics.versions, websiteMetricKeyLimit);
  pruneCountMap(metrics.channels, websiteMetricKeyLimit);
  pruneCountMap(metrics.statuses, websiteMetricKeyLimit);
  pruneCountMap(metrics.daily, websiteDailyRetentionDays, { sortByKeyDesc: true });
  pruneNestedDailyCountMap(metrics.dailyEvents, websiteDailyRetentionDays);
}

function recordWebsiteEventInState(state, body = {}) {
  const eventName = normalizeWebsiteEventName(body.event);
  if (!eventName) return null;

  const detail = body.detail && typeof body.detail === "object" && !Array.isArray(body.detail)
    ? body.detail
    : {};
  const now = nowIso();
  const metrics = state.websiteEvents && typeof state.websiteEvents === "object" && !Array.isArray(state.websiteEvents)
    ? state.websiteEvents
    : {};
  metrics.total = Math.max(0, Math.floor(Number(metrics.total || 0))) + 1;
  metrics.updatedAt = now;
  metrics.events = metrics.events && typeof metrics.events === "object" && !Array.isArray(metrics.events) ? metrics.events : {};
  metrics.versions = metrics.versions && typeof metrics.versions === "object" && !Array.isArray(metrics.versions) ? metrics.versions : {};
  metrics.channels = metrics.channels && typeof metrics.channels === "object" && !Array.isArray(metrics.channels) ? metrics.channels : {};
  metrics.statuses = metrics.statuses && typeof metrics.statuses === "object" && !Array.isArray(metrics.statuses) ? metrics.statuses : {};
  metrics.daily = metrics.daily && typeof metrics.daily === "object" && !Array.isArray(metrics.daily) ? metrics.daily : {};
  metrics.dailyEvents = metrics.dailyEvents && typeof metrics.dailyEvents === "object" && !Array.isArray(metrics.dailyEvents) ? metrics.dailyEvents : {};

  const day = now.slice(0, 10);
  bumpCount(metrics.events, eventName);
  bumpCount(metrics.versions, normalizeWebsiteMetricKey(detail.version));
  bumpCount(metrics.channels, normalizeWebsiteMetricKey(detail.channel));
  bumpCount(metrics.statuses, normalizeWebsiteMetricKey(detail.status));
  bumpCount(metrics.daily, day);
  metrics.dailyEvents[day] = metrics.dailyEvents[day] && typeof metrics.dailyEvents[day] === "object" && !Array.isArray(metrics.dailyEvents[day])
    ? metrics.dailyEvents[day]
    : {};
  bumpCount(metrics.dailyEvents[day], eventName);
  pruneWebsiteEventMetrics(metrics);

  state.websiteEvents = metrics;
  return websiteEventsSummary(metrics);
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

function rotateSubscriptionRuntimeSession(subscription, input = {}, options = {}) {
  const now = nowIso();
  const proofConfig = runtimeSessionProofConfigFromOptions(options);
  subscription.runtimeSessionId = randomId("rsess");
  subscription.runtimeSessionIssuedAt = now;
  subscription.runtimeSessionRotatedAt = now;
  subscription.runtimeSessionRotateReason = String(input.reason || "validation").slice(0, 64);
  subscription.runtimeSessionKeyVersion = runtimeSessionKeyVersionFromOptions(options);
  subscription.runtimeSessionRevision = Number(subscription.runtimeSessionRevision || 0) + 1;
  subscription.runtimeSessionProofAlgorithm = proofConfig.algorithm;
  subscription.runtimeSessionProof = signRuntimeSessionProof(subscription, options);

  return {
    sessionId: subscription.runtimeSessionId,
    keyVersion: subscription.runtimeSessionKeyVersion,
    revision: subscription.runtimeSessionRevision,
    proof: subscription.runtimeSessionProof
  };
}

function runtimeSessionProofBody(subscription) {
  return JSON.stringify({
    subscriptionId: subscription.subscriptionId || "",
    deviceHash: subscription.deviceHash || "",
    expiresAt: subscription.expiresAt || "",
    sessionId: subscription.runtimeSessionId || "",
    keyVersion: subscription.runtimeSessionKeyVersion || defaultRuntimeSessionKeyVersion,
    revision: Number(subscription.runtimeSessionRevision || 0)
  });
}

function signRuntimeSessionProof(subscription, options = {}) {
  const proofConfig = runtimeSessionProofConfigFromOptions(options);
  const body = runtimeSessionProofBody(subscription);
  if (proofConfig.algorithm === "RSA-SHA256") {
    if (!proofConfig.privateKeyPem) {
      throw new Error("ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_PEM or ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64 is required for RSA-SHA256 runtime session proofs.");
    }

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(body);
    signer.end();
    return `rsa-sha256=${signer.sign(proofConfig.privateKeyPem).toString("base64url")}`;
  }

  return `sha256=${hmac(serverSecretFromOptions(options), body)}`;
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
  subscription.runtimeSessionId = "";
  subscription.runtimeSessionProof = "";
  subscription.runtimeSessionRevokedAt = nowIso();

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
    sessionId: subscription.runtimeSessionId || "",
    runtimeSessionKeyVersion: subscription.runtimeSessionKeyVersion || defaultRuntimeSessionKeyVersion,
    runtimeSessionRevision: Number(subscription.runtimeSessionRevision || 0),
    runtimeSessionProofAlgorithm: subscription.runtimeSessionProofAlgorithm || defaultRuntimeSessionProofAlgorithm,
    runtimeSessionProof: subscription.runtimeSessionProof || "",
    accountLinked: Boolean(subscription.accountId),
    accountId: subscription.accountId || "",
    accountProvider: subscription.accountProvider || ""
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

async function registerAccount(request, response, options = {}) {
  const body = await readRequestBody(request);
  const provider = normalizeAccountProvider(body.provider);
  const identifier = normalizeAccountIdentifier(provider, body.identifier);

  if (!provider || !validateAccountIdentifier(provider, identifier)) {
    jsonResponse(response, 400, { ok: false, message: "Invalid account registration request." });
    return;
  }

  const state = loadState(options);
  state.accounts = state.accounts && typeof state.accounts === "object" ? state.accounts : {};
  state.accountIdentities = state.accountIdentities && typeof state.accountIdentities === "object" ? state.accountIdentities : {};

  const secret = serverSecretFromOptions(options);
  const identityHash = accountIdentityHash(secret, provider, identifier);
  const existingId = state.accountIdentities[identityHash];
  let account = existingId ? state.accounts[existingId] : null;
  let created = false;

  if (!account) {
    account = {
      accountId: randomId("acct"),
      provider,
      identifierHash: identityHash,
      maskedIdentifier: maskAccountIdentifier(provider, identifier),
      displayName: String(body.displayName || "").trim().slice(0, 48),
      subscriptionIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.accounts[account.accountId] = account;
    state.accountIdentities[identityHash] = account.accountId;
    created = true;
  } else {
    account.updatedAt = nowIso();
    if (body.displayName) {
      account.displayName = String(body.displayName || "").trim().slice(0, 48);
    }
  }

  const token = issueAccountToken(state, account, options);
  appendAuditEvent(state, created ? "account.registered" : "account.logged_in", {
    actor: "client",
    targetType: "account",
    targetId: account.accountId,
    metadata: {
      provider,
      linkedMemberships: Array.isArray(account.subscriptionIds) ? account.subscriptionIds.length : 0
    }
  });
  saveState(state, options);

  jsonResponse(response, created ? 201 : 200, {
    ok: true,
    created,
    account: safeAccountRecord(account),
    token,
    memberships: accountMemberships(state, account)
  });
}

async function getAccountProfile(request, response, options = {}) {
  const state = loadState(options);
  const token = accountTokenFromRequest(request);
  const account = accountFromToken(state, token, options);

  if (!account) {
    jsonResponse(response, 401, { ok: false, message: "Account session is invalid." });
    return;
  }

  saveState(state, options);
  jsonResponse(response, 200, {
    ok: true,
    account: safeAccountRecord(account),
    memberships: accountMemberships(state, account)
  });
}

async function bindAccountMembership(request, response, options = {}) {
  const body = await readRequestBody(request);
  const state = loadState(options);
  const account = accountFromToken(state, accountTokenFromRequest(request, body), options);

  if (!account) {
    jsonResponse(response, 401, { ok: false, message: "Account session is invalid." });
    return;
  }

  const subscriptionId = String(body.subscriptionId || "").trim();
  const licenseToken = String(body.licenseToken || body.token || "").trim();
  const deviceHash = String(body.deviceHash || "").trim();
  const secret = serverSecretFromOptions(options);
  const subscription = state.subscriptions && state.subscriptions[subscriptionId];
  const tokenRecord = licenseToken ? state.tokens[tokenHash(secret, licenseToken)] : null;

  if (!subscription || !tokenRecord || tokenRecord.subscriptionId !== subscriptionId) {
    jsonResponse(response, 403, { ok: false, message: "Membership session is invalid." });
    return;
  }

  if (deviceHash && subscription.deviceHash !== deviceHash) {
    jsonResponse(response, 403, { ok: false, message: "Device binding mismatch." });
    return;
  }

  if (subscriptionBoundToAnotherAccount(subscription, account)) {
    jsonResponse(response, 403, { ok: false, message: "Membership belongs to another account." });
    return;
  }

  bindSubscriptionToAccount(state, account, subscription);
  saveState(state, options);
  jsonResponse(response, 200, {
    ok: true,
    account: safeAccountRecord(account),
    memberships: accountMemberships(state, account)
  });
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
  const accountToken = String(body.accountToken || "").trim();
  const account = accountToken ? accountFromToken(state, accountToken, options) : null;
  if (accountToken && !account) {
    jsonResponse(response, 403, { active: false, message: "Account session is invalid." });
    return;
  }

  const hash = codeHash(secret, activationCode);
  const code = state.activationCodes[hash];

  if (!code || !code.enabled) {
    jsonResponse(response, 403, { active: false, message: "Activation code is invalid." });
    return;
  }

  const existing = findExistingSubscriptionByCodeAndDevice(state, hash, deviceHash);
  if (existing) {
    if (account && subscriptionBoundToAnotherAccount(existing, account)) {
      jsonResponse(response, 403, { active: false, message: "Membership belongs to another account." });
      return;
    }

    const runtimeSession = rotateSubscriptionRuntimeSession(existing, { reason: "activation_reuse" }, options);
    const token = issueToken(state, existing, options);
    if (account) bindSubscriptionToAccount(state, account, existing);
    existing.lastValidatedAt = nowIso();
    appendAuditEvent(state, "license.reused", {
      actor: "client",
      targetType: "subscription",
      targetId: existing.subscriptionId,
      metadata: {
        device: maskDeviceHash(deviceHash),
        plan: existing.plan,
        channel: String(body.channel || ""),
        appVersion: String(body.appVersion || ""),
        runtimeSessionRevision: runtimeSession.revision
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
    if (account && subscriptionBoundToAnotherAccount(renewable, account)) {
      jsonResponse(response, 403, { active: false, message: "Membership belongs to another account." });
      return;
    }

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

    const runtimeSession = rotateSubscriptionRuntimeSession(renewable, { reason: "renewal" }, options);
    const token = issueToken(state, renewable, options);
    if (account) bindSubscriptionToAccount(state, account, renewable);
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
        appVersion: renewable.appVersion,
        runtimeSessionRevision: runtimeSession.revision
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

  const runtimeSession = rotateSubscriptionRuntimeSession(subscription, { reason: "activation" }, options);
  const token = issueToken(state, subscription, options);
  if (account) bindSubscriptionToAccount(state, account, subscription);
  appendAuditEvent(state, "license.activated", {
    actor: "client",
    targetType: "subscription",
    targetId: subscription.subscriptionId,
    metadata: {
      device: maskDeviceHash(deviceHash),
      plan: subscription.plan,
      expiresAt: subscription.expiresAt,
      channel: subscription.channel,
      appVersion: subscription.appVersion,
      runtimeSessionRevision: runtimeSession.revision
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
  const requireAccountBinding = Boolean(body.requireAccountBinding);
  const accountToken = String(body.accountToken || "").trim();

  if (!token || !subscriptionId || !validateDeviceHash(deviceHash)) {
    jsonResponse(response, 400, { active: false, message: "Invalid validation request." });
    return;
  }

  const state = loadState(options);
  const account = accountToken ? accountFromToken(state, accountToken, options) : null;
  if (requireAccountBinding && !account) {
    jsonResponse(response, 401, { active: false, message: "Please sign in before using membership." });
    return;
  }

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

  if (requireAccountBinding && (!subscription.accountId || subscription.accountId !== account.accountId)) {
    jsonResponse(response, 403, { active: false, message: "Membership is not bound to this account." });
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
      subscription.runtimeSessionId = "";
      subscription.runtimeSessionProof = "";
      subscription.runtimeSessionExpiredAt = nowIso();
    }
    saveState(state, options);
    jsonResponse(response, 200, { active: false, message: "Membership expired." });
    return;
  }

  delete state.tokens[tokenHash(secret, token)];
  subscription.lastValidatedAt = nowIso();
  rotateSubscriptionRuntimeSession(subscription, { reason: "validation" }, options);
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

async function recordWebsiteEvent(request, response, options = {}) {
  const body = await readRequestBody(request);

  if (body.product && body.product !== "ZeroLag") {
    jsonResponse(response, 400, { accepted: false, message: "Invalid product." });
    return;
  }

  const state = loadState(options);
  const websiteEvents = recordWebsiteEventInState(state, body);
  if (!websiteEvents) {
    jsonResponse(response, 400, { accepted: false, message: "Invalid website event." });
    return;
  }

  saveState(state, options);
  jsonResponse(response, 202, {
    accepted: true,
    total: websiteEvents.total
  });
}

async function createOrder(request, response, options = {}) {
  const body = await readRequestBody(request);
  const state = loadState(options);
  const account = accountFromToken(state, accountTokenFromRequest(request, body), options);
  if (!account) {
    jsonResponse(response, 401, { ok: false, message: "Please sign in before purchasing membership." });
    return;
  }

  const plan = body.plan || "ZeroLag Pro Monthly";
  const durationDays = Number(body.durationDays || 30);
  const amountCents = Number(body.amountCents || 3000);
  const orderId = randomId("ord");
  const paymentConfig = paymentConfigFromOptions(options);
  const order = {
    orderId,
    status: "pending",
    plan,
    durationDays: Number.isFinite(durationDays) && durationDays > 0 ? durationDays : 30,
    maxUses: 1,
    amountCents: Number.isFinite(amountCents) && amountCents > 0 ? amountCents : 3000,
    currency: body.currency || "CNY",
    accountId: account.accountId,
    accountProvider: account.provider,
    channel: String(body.channel || ""),
    createdAt: nowIso(),
    paidAt: "",
    refundedAt: "",
    paymentProvider: paymentConfig.provider,
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
      accountId: account.accountId,
      accountProvider: account.provider
    }
  });
  saveState(state, options);
  jsonResponse(response, 201, {
    ok: true,
    order: safeOrderRecord(order),
    payment: {
      provider: paymentConfig.provider,
      paymentUrl: paymentUrlFromTemplate(paymentConfig.urlTemplate, order),
      message: paymentConfig.message
    }
  });
}

async function getOrderStatus(request, response, options = {}, orderId = "") {
  const state = loadState(options);
  const order = state.orders[String(orderId || "")];
  if (!order) {
    jsonResponse(response, 404, { message: "Order not found." });
    return;
  }

  if (order.accountId) {
    const account = accountFromToken(state, accountTokenFromRequest(request), options);
    if (!account || account.accountId !== order.accountId) {
      jsonResponse(response, 403, { ok: false, message: "Order belongs to another account." });
      return;
    }
    saveState(state, options);
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
  const provider = normalizePaymentProvider(body.provider || "signed-webhook");
  if (!paymentProviderAllowed(provider, options)) {
    jsonResponse(response, 400, { ok: false, message: "Payment provider is not enabled." });
    return;
  }

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
        type: eventType,
        paymentProvider: provider
      }
    });
    saveState(state, options);
    jsonResponse(response, 202, ignoredPayload);
    return;
  }

  const order = eventType === "payment.refunded"
    ? refundOrderInState(state, body.orderId, {
      paymentProvider: provider,
      refundTradeId: body.refundTradeId || body.providerTradeId || eventId,
      reason: "payment_refunded"
    }, options)
    : completeOrderInState(state, body.orderId, {
      paymentProvider: provider,
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

async function adminReadiness(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  jsonResponse(response, 200, serverReadiness(options));
}

async function maintenanceCleanupAdmin(request, response, options = {}) {
  if (!requireAdmin(request, response, options)) return;

  const cleanup = runServerMaintenance(options, adminActor(request));

  jsonResponse(response, 200, {
    ok: true,
    cleanup
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
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
      jsonResponse(response, 200, { ok: true, product: "ZeroLag", time: nowIso() });
      return;
    }

    if (url.pathname === "/v1/website/events") {
      setWebsiteEventCorsHeaders(response);
      if (request.method === "OPTIONS") {
        emptyResponse(response, 204);
        return;
      }
      if (request.method === "POST") {
        if (!applyRateLimit(request, response, "website:events", options)) return;
        await recordWebsiteEvent(request, response, options);
        return;
      }

      jsonResponse(response, 405, { message: "Method not allowed." });
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

    if (request.method === "POST" && url.pathname === "/v1/accounts/register") {
      if (!applyRateLimit(request, response, "accounts:auth", options)) return;
      await registerAccount(request, response, options);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/accounts/me") {
      if (!applyRateLimit(request, response, "accounts:auth", options)) return;
      await getAccountProfile(request, response, options);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/accounts/bind-membership") {
      if (!applyRateLimit(request, response, "accounts:auth", options)) return;
      await bindAccountMembership(request, response, options);
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

    if (request.method === "GET" && url.pathname === "/v1/admin/readiness") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await adminReadiness(request, response, options);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/admin/maintenance/cleanup") {
      if (!applyRateLimit(request, response, "admin", options)) return;
      await maintenanceCleanupAdmin(request, response, options);
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
  attachAutomaticMaintenance(server, options);
  return server;
}

function attachAutomaticMaintenance(server, options = {}) {
  const config = maintenanceConfigFromOptions(options);
  if (!config.enabled) return;

  let stopped = false;
  const runSafely = () => {
    if (stopped) return;
    try {
      runServerMaintenance(options, "maintenance");
    } catch {
      // Maintenance should never take down the API server.
    }
  };
  const interval = setInterval(runSafely, config.intervalMs);
  const immediate = setImmediate(runSafely);

  if (typeof interval.unref === "function") interval.unref();
  if (typeof immediate.unref === "function") immediate.unref();

  server.on("close", () => {
    stopped = true;
    clearInterval(interval);
    clearImmediate(immediate);
  });
}

function startServer(options = {}) {
  loadServerEnvFile();
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
