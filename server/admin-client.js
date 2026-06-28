const http = require("http");
const fs = require("fs");
const path = require("path");
const { signPaymentWebhook } = require("./index");

const baseUrl = process.env.ZEROLAG_ADMIN_API_BASE_URL || "http://127.0.0.1:8787";
const adminSecret = process.env.ZEROLAG_ADMIN_SECRET || "zerolag-dev-admin-secret-change-before-production";
const paymentWebhookSecret = process.env.ZEROLAG_PAYMENT_WEBHOOK_SECRET || "zerolag-dev-payment-webhook-secret-change-before-production";

function usage() {
  console.log("Usage:");
  console.log("  node server/admin-client.js create-code [code] [durationDays] [maxUses]");
  console.log("  node server/admin-client.js orders");
  console.log("  node server/admin-client.js complete-order [orderId] [providerTradeId]");
  console.log("  node server/admin-client.js refund-order [orderId] [refundTradeId]");
  console.log("  node server/admin-client.js complete-latest [providerTradeId]");
  console.log("  node server/admin-client.js send-webhook [orderId] [providerTradeId]");
  console.log("  node server/admin-client.js send-refund-webhook [orderId] [refundTradeId]");
  console.log("  node server/admin-client.js subscriptions [status]");
  console.log("  node server/admin-client.js subscription [subscriptionId]");
  console.log("  node server/admin-client.js revoke-subscription [subscriptionId] [reason]");
  console.log("  node server/admin-client.js audit-events [limit] [type]");
  console.log("  node server/admin-client.js cleanup");
  console.log("  node server/admin-client.js export-state [outputFile]");
  console.log("  node server/admin-client.js readiness");
  console.log("  node server/admin-client.js summary");
}

function requestJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(pathname, baseUrl);
    const payload = body ? JSON.stringify(body) : "";
    const request = http.request(target, {
      method: body ? "POST" : "GET",
      headers: {
        "X-ZeroLag-Admin-Secret": adminSecret,
        ...(payload ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        } : {})
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
            statusCode: response.statusCode,
            body: raw ? JSON.parse(raw) : null
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function requestSignedWebhook(body) {
  return new Promise((resolve, reject) => {
    const target = new URL("/v1/payments/webhook", baseUrl);
    const payload = JSON.stringify(body);
    const request = http.request(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-ZeroLag-Signature": signPaymentWebhook(paymentWebhookSecret, payload)
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
            statusCode: response.statusCode,
            body: raw ? JSON.parse(raw) : null
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

async function main() {
  const command = process.argv[2];

  if (!command || process.argv.includes("--help")) {
    usage();
    return;
  }

  if (command === "create-code") {
    const response = await requestJson("/v1/admin/activation-codes", {
      code: process.argv[3],
      durationDays: Number(process.argv[4] || 30),
      maxUses: Number(process.argv[5] || 1)
    });
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "orders") {
    const response = await requestJson("/v1/admin/orders");
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "complete-order") {
    const response = await requestJson("/v1/admin/orders/complete", {
      orderId: process.argv[3],
      providerTradeId: process.argv[4] || "manual"
    });
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "refund-order") {
    const response = await requestJson("/v1/admin/orders/refund", {
      orderId: process.argv[3],
      refundTradeId: process.argv[4] || "manual_refund",
      reason: "manual_refund"
    });
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "complete-latest") {
    const orders = await requestJson("/v1/admin/orders");
    const latestPending = orders.body && Array.isArray(orders.body.orders)
      ? orders.body.orders.find((order) => order.status === "pending")
      : null;

    if (!latestPending) {
      console.log(JSON.stringify({ ok: false, message: "No pending order found." }, null, 2));
      process.exitCode = 1;
      return;
    }

    const response = await requestJson("/v1/admin/orders/complete", {
      orderId: latestPending.orderId,
      providerTradeId: process.argv[3] || "manual"
    });
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "send-webhook") {
    const orderId = process.argv[3];
    const providerTradeId = process.argv[4] || `manual_${Date.now()}`;

    if (!orderId) {
      console.log(JSON.stringify({ ok: false, message: "Order id is required." }, null, 2));
      process.exitCode = 1;
      return;
    }

    const response = await requestSignedWebhook({
      type: "payment.succeeded",
      eventId: `evt_${providerTradeId}`,
      orderId,
      provider: "manual-signed-webhook",
      providerTradeId
    });
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "send-refund-webhook") {
    const orderId = process.argv[3];
    const refundTradeId = process.argv[4] || `manual_refund_${Date.now()}`;

    if (!orderId) {
      console.log(JSON.stringify({ ok: false, message: "Order id is required." }, null, 2));
      process.exitCode = 1;
      return;
    }

    const response = await requestSignedWebhook({
      type: "payment.refunded",
      eventId: `evt_${refundTradeId}`,
      orderId,
      provider: "manual-signed-webhook",
      refundTradeId
    });
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "subscriptions") {
    const status = process.argv[3] ? `?status=${encodeURIComponent(process.argv[3])}` : "";
    const response = await requestJson(`/v1/admin/subscriptions${status}`);
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "subscription") {
    const subscriptionId = process.argv[3];
    if (!subscriptionId) {
      console.log(JSON.stringify({ ok: false, message: "Subscription id is required." }, null, 2));
      process.exitCode = 1;
      return;
    }

    const response = await requestJson(`/v1/admin/subscriptions/${encodeURIComponent(subscriptionId)}`);
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "revoke-subscription") {
    const response = await requestJson("/v1/admin/subscriptions/revoke", {
      subscriptionId: process.argv[3],
      reason: process.argv[4] || "manual_revoke"
    });
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "audit-events") {
    const params = new URLSearchParams();
    if (process.argv[3]) params.set("limit", process.argv[3]);
    if (process.argv[4]) params.set("type", process.argv[4]);
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await requestJson(`/v1/admin/audit-events${query}`);
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "cleanup") {
    const response = await requestJson("/v1/admin/maintenance/cleanup", {});
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "export-state") {
    const outputFile = path.resolve(process.argv[3] || `zerolag-state-export-${Date.now()}.json`);
    const response = await requestJson("/v1/admin/export");

    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.log(JSON.stringify(response.body, null, 2));
      process.exitCode = 1;
      return;
    }

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(response.body, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      ok: true,
      outputFile,
      stateSha256: response.body.stateSha256,
      summary: response.body.summary
    }, null, 2));
    return;
  }

  if (command === "summary") {
    const response = await requestJson("/v1/admin/summary");
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "readiness") {
    const response = await requestJson("/v1/admin/readiness");
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
