const assert = require("assert");
const {
  createPaymentIntent,
  defaultPaymentProvider,
  missingPaymentCredentialKeys,
  normalizePaymentProvider,
  paymentConfigFromOptions,
  paymentCredentialKeysFor,
  paymentProviderAllowed,
  paymentProviderListFromValue
} = require("../server/payment-provider");

function mapFromObject(value) {
  return new Map(Object.entries(value));
}

function main() {
  assert.strictEqual(normalizePaymentProvider(" WeChat Pay "), "wechat_pay");
  assert.strictEqual(normalizePaymentProvider("", defaultPaymentProvider), "manual");
  assert.deepStrictEqual(paymentProviderListFromValue("wechat_pay, alipay, signed-webhook"), [
    "wechat_pay",
    "alipay",
    "signed-webhook"
  ]);

  assert.deepStrictEqual(paymentCredentialKeysFor("wechat_pay"), [
    "ZEROLAG_WECHAT_PAY_MCH_ID",
    "ZEROLAG_WECHAT_PAY_APP_ID",
    "ZEROLAG_WECHAT_PAY_API_V3_KEY",
    "ZEROLAG_WECHAT_PAY_SERIAL_NO",
    "ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH"
  ]);
  assert.deepStrictEqual(paymentCredentialKeysFor("alipay"), [
    "ZEROLAG_ALIPAY_APP_ID",
    "ZEROLAG_ALIPAY_PRIVATE_KEY_PATH",
    "ZEROLAG_ALIPAY_PUBLIC_KEY_PATH"
  ]);

  const partialWechat = mapFromObject({
    ZEROLAG_WECHAT_PAY_MCH_ID: "1900000001",
    ZEROLAG_WECHAT_PAY_APP_ID: "wx0000000000000000"
  });
  assert.deepStrictEqual(missingPaymentCredentialKeys(partialWechat, "wechat_pay"), [
    "ZEROLAG_WECHAT_PAY_API_V3_KEY",
    "ZEROLAG_WECHAT_PAY_SERIAL_NO",
    "ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH"
  ]);

  const config = paymentConfigFromOptions({
    payment: {
      provider: "wechat_pay",
      allowedProviders: ["wechat_pay"],
      urlTemplate: "https://pay.zerolag.gg/checkout/{orderId}?amount={amountCents}&currency={currency}&plan={plan}",
      message: "Open checkout."
    }
  });
  assert.strictEqual(config.provider, "wechat_pay");
  assert.strictEqual(paymentProviderAllowed("wechat_pay", { payment: config }), true);
  assert.strictEqual(paymentProviderAllowed("self-test", { payment: config }), false);

  const payment = createPaymentIntent(config, {
    orderId: "ord_hello world",
    amountCents: 3000,
    currency: "CNY",
    plan: "ZeroLag Pro Monthly"
  });
  assert.strictEqual(payment.provider, "wechat_pay");
  assert.ok(payment.paymentUrl.includes("ord_hello%20world"));
  assert.ok(payment.paymentUrl.includes("amount=3000"));
  assert.ok(payment.paymentUrl.includes("currency=CNY"));
  assert.ok(payment.paymentUrl.includes("plan=ZeroLag%20Pro%20Monthly"));
  assert.strictEqual(payment.message, "Open checkout.");

  console.log("ZeroLag payment provider smoke test passed.");
}

main();
