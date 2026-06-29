const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { createAppServer, signPaymentWebhook } = require("../server");

const paymentWebhookSecret = "payment-loop-webhook-secret-for-isolated-smoke";
const timeoutMs = positiveNumber(process.env.ZEROLAG_PAYMENT_LOOP_TIMEOUT_MS, 8000);
const bindHost = process.env.ZEROLAG_PAYMENT_LOOP_HOST || "127.0.0.1";
const bindPort = Math.max(0, Math.floor(positiveNumber(process.env.ZEROLAG_PAYMENT_LOOP_PORT, 0)));

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normalizeProvider(value) {
  return String(value || "wechat_pay")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_") || "wechat_pay";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function requestJson(baseUrl, pathname, input = {}) {
  const body = input.body || null;
  const payload = body ? JSON.stringify(body) : "";
  return requestRaw(baseUrl, pathname, payload, {
    method: input.method || (payload ? "POST" : "GET"),
    headers: {
      ...(input.headers || {}),
      ...(payload ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      } : {})
    }
  });
}

function requestRaw(baseUrl, pathname, payload = "", input = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(pathname, baseUrl);
    const request = http.request(target, {
      method: input.method || (payload ? "POST" : "GET"),
      headers: input.headers || {},
      timeout: timeoutMs
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        try {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: raw ? JSON.parse(raw) : null
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms: ${pathname}`));
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function safeAddressForUrl(address) {
  if (!address || typeof address === "string") return "127.0.0.1";
  if (address.address === "0.0.0.0" || address.address === "::") return "127.0.0.1";
  if (address.family === "IPv6") return `[${address.address}]`;
  return address.address || "127.0.0.1";
}

function removeTempRoot(tempRoot) {
  if (!tempRoot) return;
  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-payment-loop-")) {
    throw new Error(`Refusing to clean unexpected payment-loop path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function createPaymentOptions(tempRoot, provider) {
  return {
    statePath: path.join(tempRoot, "server-state.json"),
    serverSecret: "payment-loop-server-secret-for-isolated-smoke",
    adminSecret: "payment-loop-admin-secret-for-isolated-smoke",
    paymentWebhookSecret,
    backup: {
      dir: path.join(tempRoot, "backups"),
      enabled: true,
      retention: 2
    },
    payment: {
      provider,
      allowedProviders: [provider],
      urlTemplate: "https://checkout.zerolag.example/pay/{orderId}?amount={amountCents}&currency={currency}&plan={plan}",
      message: "Open the configured checkout provider to finish payment."
    },
    rateLimit: {
      namespace: `payment-loop:${process.pid}:${Date.now()}`
    },
    maintenance: {
      intervalMs: 60 * 1000
    }
  };
}

async function runPaymentLoop(baseUrl, provider) {
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const deviceHash = sha256(`payment-loop-device:${stamp}`);
  const accountIdentifier = `payment-loop-${stamp}@example.com`;
  const account = await requestJson(baseUrl, "/v1/accounts/register", {
    body: {
      provider: "email",
      identifier: accountIdentifier,
      displayName: "Payment Loop",
      deviceHash
    }
  });
  assertOk(account.statusCode === 201, `Account registration returned HTTP ${account.statusCode}.`);
  assertOk(account.body && account.body.ok && /^acctok_/.test(account.body.token || ""), "Account registration did not return an account token.");

  const authHeaders = {
    Authorization: `Bearer ${account.body.token}`,
    "X-ZeroLag-Device-Hash": deviceHash
  };
  const order = await requestJson(baseUrl, "/v1/orders/create", {
    headers: {
      "X-ZeroLag-Device-Hash": deviceHash
    },
    body: {
      plan: "ZeroLag Pro Monthly",
      channel: "payment-loop",
      accountToken: account.body.token
    }
  });
  assertOk(order.statusCode === 201, `Order creation returned HTTP ${order.statusCode}.`);
  assertOk(order.body && order.body.order && order.body.order.status === "pending", "Order was not created as pending.");
  assertOk(order.body.order.accountLinked === true, "Order was not linked to the signed-in account.");
  assertOk(order.body.payment && order.body.payment.provider === provider, "Order did not return the configured payment provider.");
  assertOk(/^https:\/\//.test(order.body.payment.paymentUrl || ""), "Order did not return an HTTPS checkout URL.");
  assertOk(order.body.payment.paymentUrl.includes(encodeURIComponent(order.body.order.orderId)), "Checkout URL does not include the order id.");

  const pendingStatus = await requestJson(baseUrl, `/v1/orders/${encodeURIComponent(order.body.order.orderId)}`, {
    headers: authHeaders
  });
  assertOk(pendingStatus.statusCode === 200, `Pending order status returned HTTP ${pendingStatus.statusCode}.`);
  assertOk(!pendingStatus.body.order.activationCode, "Pending order exposed an activation code too early.");

  const successWebhookBody = JSON.stringify({
    type: "payment.succeeded",
    eventId: `evt_payment_loop_paid_${stamp}`,
    orderId: order.body.order.orderId,
    provider,
    providerTradeId: `trade_payment_loop_${stamp}`
  });
  const paid = await requestRaw(baseUrl, "/v1/payments/webhook", successWebhookBody, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(successWebhookBody),
      "X-ZeroLag-Signature": signPaymentWebhook(paymentWebhookSecret, successWebhookBody)
    }
  });
  assertOk(paid.statusCode === 200, `Payment webhook returned HTTP ${paid.statusCode}.`);
  assertOk(paid.body && paid.body.order && paid.body.order.status === "paid", "Payment webhook did not mark the order paid.");
  assertOk(Boolean(paid.body.order.activationCode), "Paid order did not receive an activation code.");

  const repeatedPaid = await requestRaw(baseUrl, "/v1/payments/webhook", successWebhookBody, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(successWebhookBody),
      "X-ZeroLag-Signature": signPaymentWebhook(paymentWebhookSecret, successWebhookBody)
    }
  });
  assertOk(repeatedPaid.statusCode === 200, `Repeated webhook returned HTTP ${repeatedPaid.statusCode}.`);
  assertOk(
    repeatedPaid.body.order.activationCode === paid.body.order.activationCode,
    "Repeated webhook did not return the original activation code."
  );

  const paidStatus = await requestJson(baseUrl, `/v1/orders/${encodeURIComponent(order.body.order.orderId)}`, {
    headers: authHeaders
  });
  assertOk(paidStatus.statusCode === 200, `Paid order status returned HTTP ${paidStatus.statusCode}.`);
  assertOk(paidStatus.body.order.activationCode === paid.body.order.activationCode, "Paid order status did not expose the payment-issued activation code.");

  const activated = await requestJson(baseUrl, "/v1/licenses/activate", {
    body: {
      activationCode: paid.body.order.activationCode,
      deviceHash,
      appVersion: "0.1.0",
      channel: "payment-loop",
      accountToken: account.body.token
    }
  });
  assertOk(activated.statusCode === 200, `License activation returned HTTP ${activated.statusCode}.`);
  assertOk(activated.body && activated.body.active === true, "Payment-issued activation code did not activate membership.");
  assertOk(activated.body.accountLinked === true, "Activated membership was not linked to the account.");

  const validated = await requestJson(baseUrl, "/v1/licenses/validate", {
    body: {
      token: activated.body.token,
      subscriptionId: activated.body.subscriptionId,
      deviceHash,
      appVersion: "0.1.0",
      channel: "payment-loop",
      accountToken: account.body.token,
      requireAccountBinding: true
    }
  });
  assertOk(validated.statusCode === 200, `License validation returned HTTP ${validated.statusCode}.`);
  assertOk(validated.body && validated.body.active === true, "Activated membership did not validate.");

  const refundWebhookBody = JSON.stringify({
    type: "payment.refunded",
    eventId: `evt_payment_loop_refunded_${stamp}`,
    orderId: order.body.order.orderId,
    provider,
    refundTradeId: `refund_payment_loop_${stamp}`
  });
  const refunded = await requestRaw(baseUrl, "/v1/payments/webhook", refundWebhookBody, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(refundWebhookBody),
      "X-ZeroLag-Signature": signPaymentWebhook(paymentWebhookSecret, refundWebhookBody)
    }
  });
  assertOk(refunded.statusCode === 200, `Refund webhook returned HTTP ${refunded.statusCode}.`);
  assertOk(refunded.body && refunded.body.order && refunded.body.order.status === "refunded", "Refund webhook did not mark the order refunded.");

  const revoked = await requestJson(baseUrl, "/v1/licenses/validate", {
    body: {
      token: validated.body.token,
      subscriptionId: validated.body.subscriptionId,
      deviceHash,
      appVersion: "0.1.0",
      channel: "payment-loop",
      accountToken: account.body.token,
      requireAccountBinding: true
    }
  });
  assertOk(revoked.statusCode === 403, `Refunded membership validation returned HTTP ${revoked.statusCode}.`);
  assertOk(revoked.body && revoked.body.active === false, "Refunded membership still appears active.");

  return {
    provider,
    orderId: order.body.order.orderId,
    subscriptionId: activated.body.subscriptionId
  };
}

async function main() {
  const provider = normalizeProvider(argValue("--provider", process.env.ZEROLAG_PAYMENT_LOOP_PROVIDER || "wechat_pay"));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-payment-loop-"));
  const server = createAppServer(createPaymentOptions(tempRoot, provider));

  try {
    const address = await listen(server, bindHost, bindPort);
    const baseUrl = `http://${safeAddressForUrl(address)}:${address.port}`;
    const result = await runPaymentLoop(baseUrl, provider);

    console.log("ZeroLag production payment loop passed.");
    console.log("Mode: isolated");
    console.log(`Provider: ${result.provider}`);
    console.log("Order: pending -> paid -> refunded");
    console.log("Membership: activated -> validated -> revoked");
  } finally {
    await closeServer(server);
    removeTempRoot(tempRoot);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
