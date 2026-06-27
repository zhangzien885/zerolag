const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { addActivationCode, createAppServer, signPaymentWebhook } = require("./index");

function requestJson(port, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const request = require("http").request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: body ? "POST" : "GET",
      headers: {
        ...headers,
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

function requestRaw(port, pathname, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = require("http").request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "POST",
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(payload)
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-server-test-"));
  const options = {
    statePath: path.join(tempDir, "server-state.json"),
    serverSecret: "self-test-secret",
    adminSecret: "self-test-admin",
    paymentWebhookSecret: "self-test-payment"
  };
  const code = "ZL-PRO-SELF-TEST";
  const adminCode = "ZL-PRO-ADMIN-TEST";
  const revokeCode = "ZL-PRO-REVOKE-TEST";
  const deviceHash = crypto.createHash("sha256").update("device-a").digest("hex");
  const otherDeviceHash = crypto.createHash("sha256").update("device-b").digest("hex");
  const revokeDeviceHash = crypto.createHash("sha256").update("device-c").digest("hex");

  addActivationCode(code, { durationDays: 30, maxUses: 1 }, options);
  const server = createAppServer(options);
  const port = await listen(server);

  try {
    const health = await requestJson(port, "/health");
    assert(health.statusCode === 200 && health.body.ok, "Health check failed.");

    const deniedAdmin = await requestJson(port, "/v1/admin/activation-codes", {
      code: adminCode
    });
    assert(deniedAdmin.statusCode === 401, "Admin endpoint should reject missing secret.");

    const createdByAdmin = await requestJson(port, "/v1/admin/activation-codes", {
      code: adminCode,
      durationDays: 30,
      maxUses: 1
    }, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(createdByAdmin.statusCode === 201 && createdByAdmin.body.code === adminCode, "Admin code creation failed.");

    const summaryBefore = await requestJson(port, "/v1/admin/summary", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(summaryBefore.statusCode === 200 && summaryBefore.body.summary.activationCodes.total >= 2, "Admin summary failed.");

    const createdOrder = await requestJson(port, "/v1/orders/create", {
      plan: "ZeroLag Pro Monthly",
      deviceHash,
      channel: "test"
    });
    assert(createdOrder.statusCode === 201 && createdOrder.body.order.status === "pending", "Order creation failed.");

    const orderStatusBefore = await requestJson(port, `/v1/orders/${createdOrder.body.order.orderId}`);
    assert(orderStatusBefore.statusCode === 200 && !orderStatusBefore.body.order.activationCode, "Pending order should not expose a code.");

    const adminOrders = await requestJson(port, "/v1/admin/orders", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(adminOrders.statusCode === 200 && adminOrders.body.orders.length === 1, "Admin order list failed.");

    const badWebhookBody = JSON.stringify({
      type: "payment.succeeded",
      eventId: "evt_bad_signature",
      orderId: createdOrder.body.order.orderId,
      provider: "self-test",
      providerTradeId: "trade_bad_signature"
    });
    const rejectedWebhook = await requestRaw(port, "/v1/payments/webhook", badWebhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": "sha256=bad"
    });
    assert(rejectedWebhook.statusCode === 401, "Payment webhook should reject invalid signatures.");

    const webhookBody = JSON.stringify({
      type: "payment.succeeded",
      eventId: "evt_self_test_paid",
      orderId: createdOrder.body.order.orderId,
      provider: "self-test",
      providerTradeId: "trade_self_test"
    });
    const completedOrder = await requestRaw(port, "/v1/payments/webhook", webhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": signPaymentWebhook("self-test-payment", webhookBody)
    });
    assert(completedOrder.statusCode === 200 && completedOrder.body.order.status === "paid", "Order completion failed.");
    assert(Boolean(completedOrder.body.order.activationCode), "Paid order should receive an activation code.");

    const repeatedWebhook = await requestRaw(port, "/v1/payments/webhook", webhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": signPaymentWebhook("self-test-payment", webhookBody)
    });
    assert(repeatedWebhook.statusCode === 200, "Repeated webhook should be idempotent.");
    assert(
      repeatedWebhook.body.order.activationCode === completedOrder.body.order.activationCode,
      "Repeated webhook should return the original activation code."
    );

    const orderStatusAfter = await requestJson(port, `/v1/orders/${createdOrder.body.order.orderId}`);
    assert(orderStatusAfter.body.order.activationCode === completedOrder.body.order.activationCode, "Paid order status should return activation code.");

    const activated = await requestJson(port, "/v1/licenses/activate", {
      activationCode: completedOrder.body.order.activationCode,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test"
    });
    assert(activated.statusCode === 200 && activated.body.active, "Activation failed.");
    assert(Boolean(activated.body.token), "Activation did not return a token.");
    const firstExpiresAt = new Date(activated.body.expiresAt).getTime();

    const validated = await requestJson(port, "/v1/licenses/validate", {
      token: activated.body.token,
      subscriptionId: activated.body.subscriptionId,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test"
    });
    assert(validated.statusCode === 200 && validated.body.active, "Validation failed.");
    assert(validated.body.token !== activated.body.token, "Validation should rotate token.");

    const renewalOrder = await requestJson(port, "/v1/orders/create", {
      plan: "ZeroLag Pro Monthly",
      deviceHash,
      channel: "test-renewal"
    });
    assert(renewalOrder.statusCode === 201 && renewalOrder.body.order.status === "pending", "Renewal order creation failed.");

    const renewalWebhookBody = JSON.stringify({
      type: "payment.succeeded",
      eventId: "evt_self_test_renewal_paid",
      orderId: renewalOrder.body.order.orderId,
      provider: "self-test",
      providerTradeId: "trade_self_test_renewal"
    });
    const completedRenewalOrder = await requestRaw(port, "/v1/payments/webhook", renewalWebhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": signPaymentWebhook("self-test-payment", renewalWebhookBody)
    });
    assert(completedRenewalOrder.statusCode === 200 && completedRenewalOrder.body.order.status === "paid", "Renewal order completion failed.");

    const renewed = await requestJson(port, "/v1/licenses/activate", {
      activationCode: completedRenewalOrder.body.order.activationCode,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test-renewal"
    });
    assert(renewed.statusCode === 200 && renewed.body.active, "Renewal activation failed.");
    assert(renewed.body.subscriptionId === activated.body.subscriptionId, "Renewal should extend the existing subscription.");
    assert(
      new Date(renewed.body.expiresAt).getTime() >= firstExpiresAt + 29 * 24 * 60 * 60 * 1000,
      "Renewal should extend the subscription expiry."
    );

    const adminSubscriptions = await requestJson(port, "/v1/admin/subscriptions", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(adminSubscriptions.statusCode === 200, "Admin subscription list failed.");
    assert(adminSubscriptions.body.subscriptions.length === 1, "Admin subscription list should show one renewed subscription.");
    assert(adminSubscriptions.body.subscriptions[0].subscriptionId === activated.body.subscriptionId, "Admin subscription list should include the active subscription.");
    assert(adminSubscriptions.body.subscriptions[0].activationCount === 2, "Renewed subscription should show two activation links.");

    const adminSubscriptionDetail = await requestJson(port, `/v1/admin/subscriptions/${activated.body.subscriptionId}`, null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(adminSubscriptionDetail.statusCode === 200, "Admin subscription detail failed.");
    assert(adminSubscriptionDetail.body.orders.length === 2, "Admin subscription detail should include linked paid orders.");

    const blocked = await requestJson(port, "/v1/licenses/validate", {
      token: validated.body.token,
      subscriptionId: validated.body.subscriptionId,
      deviceHash: otherDeviceHash,
      appVersion: "0.1.0",
      channel: "test"
    });
    assert(blocked.statusCode === 403 && blocked.body.active === false, "Device mismatch should be blocked.");

    const summaryPaid = await requestJson(port, "/v1/admin/summary", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(summaryPaid.body.summary.subscriptions.active === 1, "Admin summary should show active subscription.");
    assert(summaryPaid.body.summary.orders.paid === 2, "Admin summary should show paid orders.");

    const refundWebhookBody = JSON.stringify({
      type: "payment.refunded",
      eventId: "evt_self_test_refunded",
      orderId: createdOrder.body.order.orderId,
      provider: "self-test",
      refundTradeId: "refund_self_test"
    });
    const refundedOrder = await requestRaw(port, "/v1/payments/webhook", refundWebhookBody, {
      "Content-Type": "application/json",
      "X-ZeroLag-Signature": signPaymentWebhook("self-test-payment", refundWebhookBody)
    });
    assert(refundedOrder.statusCode === 200 && refundedOrder.body.order.status === "refunded", "Refund webhook failed.");
    assert(Boolean(refundedOrder.body.order.refundedAt), "Refunded order should include refundedAt.");

    const orderStatusRefunded = await requestJson(port, `/v1/orders/${createdOrder.body.order.orderId}`);
    assert(orderStatusRefunded.body.order.status === "refunded", "Refunded order status should be visible.");
    assert(!orderStatusRefunded.body.order.activationCode, "Refunded order should not expose activation code.");

    const revokedValidation = await requestJson(port, "/v1/licenses/validate", {
      token: validated.body.token,
      subscriptionId: validated.body.subscriptionId,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test"
    });
    assert(revokedValidation.statusCode === 403 && revokedValidation.body.active === false, "Refund should revoke membership access.");

    const summaryRefunded = await requestJson(port, "/v1/admin/summary", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(summaryRefunded.body.summary.subscriptions.active === 0, "Refund should remove active subscription count.");
    assert(summaryRefunded.body.summary.subscriptions.revoked === 1, "Refund should show revoked subscription count.");
    assert(summaryRefunded.body.summary.orders.refunded === 1, "Admin summary should show refunded order.");

    const createdRevokeCode = await requestJson(port, "/v1/admin/activation-codes", {
      code: revokeCode,
      durationDays: 30,
      maxUses: 1
    }, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(createdRevokeCode.statusCode === 201 && createdRevokeCode.body.code === revokeCode, "Admin revoke-test code creation failed.");

    const revokable = await requestJson(port, "/v1/licenses/activate", {
      activationCode: revokeCode,
      deviceHash: revokeDeviceHash,
      appVersion: "0.1.0",
      channel: "test-revoke"
    });
    assert(revokable.statusCode === 200 && revokable.body.active, "Revokable activation failed.");

    const activeSubscriptions = await requestJson(port, "/v1/admin/subscriptions?status=active", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(
      activeSubscriptions.body.subscriptions.some((subscription) => subscription.subscriptionId === revokable.body.subscriptionId),
      "Active subscription filter should include revokable subscription."
    );

    const manuallyRevoked = await requestJson(port, "/v1/admin/subscriptions/revoke", {
      subscriptionId: revokable.body.subscriptionId,
      reason: "support_revoke"
    }, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(manuallyRevoked.statusCode === 200, "Admin subscription revoke failed.");
    assert(manuallyRevoked.body.subscription.status === "revoked", "Admin revoke should mark subscription revoked.");

    const manuallyRevokedValidation = await requestJson(port, "/v1/licenses/validate", {
      token: revokable.body.token,
      subscriptionId: revokable.body.subscriptionId,
      deviceHash: revokeDeviceHash,
      appVersion: "0.1.0",
      channel: "test-revoke"
    });
    assert(manuallyRevokedValidation.statusCode === 403 && manuallyRevokedValidation.body.active === false, "Admin revoke should invalidate token.");

    const auditEvents = await requestJson(port, "/v1/admin/audit-events?limit=200", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(auditEvents.statusCode === 200, "Admin audit events failed.");
    const auditTypes = new Set(auditEvents.body.events.map((event) => event.type));
    assert(auditTypes.has("activation_code.created"), "Audit log should include admin activation-code creation.");
    assert(auditTypes.has("order.created"), "Audit log should include order creation.");
    assert(auditTypes.has("payment.succeeded"), "Audit log should include successful payment.");
    assert(auditTypes.has("license.activated"), "Audit log should include license activation.");
    assert(auditTypes.has("license.renewed"), "Audit log should include license renewal.");
    assert(auditTypes.has("payment.refunded"), "Audit log should include refund.");
    assert(auditTypes.has("subscription.revoked"), "Audit log should include manual subscription revoke.");
    assert(
      !JSON.stringify(auditEvents.body.events).includes(completedOrder.body.order.activationCode),
      "Audit log should not expose activation codes."
    );

    const renewalAuditEvents = await requestJson(port, "/v1/admin/audit-events?limit=10&type=license.renewed", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(renewalAuditEvents.statusCode === 200, "Filtered audit events failed.");
    assert(renewalAuditEvents.body.events.length === 1, "Filtered audit events should return renewal event.");

    console.log("ZeroLag server self-test passed.");
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
