const defaultPaymentProvider = "manual";
const defaultPaymentAllowedProviders = [
  "manual",
  "manual-admin",
  "manual-signed-webhook",
  "signed-webhook",
  "self-test"
];
const defaultPaymentUrlTemplate = "zerolag://pay/{orderId}";
const defaultPaymentMessage = "支付通道正在准备，完成支付确认后会自动开通。";
const testPaymentProviders = new Set(["self-test", "manual-signed-webhook", "signed-webhook"]);

const providerCredentialKeys = Object.freeze({
  wechat_pay: Object.freeze([
    "ZEROLAG_WECHAT_PAY_MCH_ID",
    "ZEROLAG_WECHAT_PAY_APP_ID",
    "ZEROLAG_WECHAT_PAY_API_V3_KEY",
    "ZEROLAG_WECHAT_PAY_SERIAL_NO",
    "ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH"
  ]),
  alipay: Object.freeze([
    "ZEROLAG_ALIPAY_APP_ID",
    "ZEROLAG_ALIPAY_PRIVATE_KEY_PATH",
    "ZEROLAG_ALIPAY_PUBLIC_KEY_PATH"
  ])
});

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

function paymentCredentialKeysFor(provider) {
  return providerCredentialKeys[normalizePaymentProvider(provider, "")] || [];
}

function paymentConfigFromOptions(options = {}, env = process.env) {
  const input = options.payment || {};
  const provider = normalizePaymentProvider(input.provider || env.ZEROLAG_PAYMENT_PROVIDER || defaultPaymentProvider);
  const configuredAllowed = paymentProviderListFromValue(
    input.allowedProviders || env.ZEROLAG_PAYMENT_ALLOWED_PROVIDERS || defaultPaymentAllowedProviders
  );
  const allowedProviders = Array.from(new Set([provider, ...configuredAllowed]));

  return {
    provider,
    allowedProviders,
    urlTemplate: String(input.urlTemplate || env.ZEROLAG_PAYMENT_URL_TEMPLATE || defaultPaymentUrlTemplate),
    message: String(input.message || env.ZEROLAG_PAYMENT_MESSAGE || defaultPaymentMessage)
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

function createPaymentIntent(paymentConfig, order) {
  const config = paymentConfig && paymentConfig.provider
    ? paymentConfig
    : paymentConfigFromOptions(paymentConfig || {});

  return {
    provider: config.provider,
    paymentUrl: paymentUrlFromTemplate(config.urlTemplate, order),
    message: config.message
  };
}

function missingPaymentCredentialKeys(entries, provider) {
  const keys = paymentCredentialKeysFor(provider);
  return keys.filter((key) => {
    const raw = entries && entries.get ? entries.get(key) : entries && entries[key];
    return !String(raw || "").trim();
  });
}

module.exports = {
  createPaymentIntent,
  defaultPaymentAllowedProviders,
  defaultPaymentMessage,
  defaultPaymentProvider,
  defaultPaymentUrlTemplate,
  missingPaymentCredentialKeys,
  normalizePaymentProvider,
  paymentConfigFromOptions,
  paymentCredentialKeysFor,
  paymentProviderAllowed,
  paymentProviderListFromValue,
  paymentUrlFromTemplate,
  providerCredentialKeys,
  testPaymentProviders
};
