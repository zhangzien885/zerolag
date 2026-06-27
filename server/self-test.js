const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { addActivationCode, createAppServer } = require("./index");

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
    adminSecret: "self-test-admin"
  };
  const code = "ZL-PRO-SELF-TEST";
  const adminCode = "ZL-PRO-ADMIN-TEST";
  const deviceHash = crypto.createHash("sha256").update("device-a").digest("hex");
  const otherDeviceHash = crypto.createHash("sha256").update("device-b").digest("hex");

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

    const completedOrder = await requestJson(port, "/v1/admin/orders/complete", {
      orderId: createdOrder.body.order.orderId,
      providerTradeId: "test_trade"
    }, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(completedOrder.statusCode === 200 && completedOrder.body.order.status === "paid", "Order completion failed.");
    assert(Boolean(completedOrder.body.order.activationCode), "Paid order should receive an activation code.");

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

    const validated = await requestJson(port, "/v1/licenses/validate", {
      token: activated.body.token,
      subscriptionId: activated.body.subscriptionId,
      deviceHash,
      appVersion: "0.1.0",
      channel: "test"
    });
    assert(validated.statusCode === 200 && validated.body.active, "Validation failed.");
    assert(validated.body.token !== activated.body.token, "Validation should rotate token.");

    const blocked = await requestJson(port, "/v1/licenses/validate", {
      token: validated.body.token,
      subscriptionId: validated.body.subscriptionId,
      deviceHash: otherDeviceHash,
      appVersion: "0.1.0",
      channel: "test"
    });
    assert(blocked.statusCode === 403 && blocked.body.active === false, "Device mismatch should be blocked.");

    const summaryAfter = await requestJson(port, "/v1/admin/summary", null, {
      "X-ZeroLag-Admin-Secret": "self-test-admin"
    });
    assert(summaryAfter.body.summary.subscriptions.active === 1, "Admin summary should show active subscription.");
    assert(summaryAfter.body.summary.orders.paid === 1, "Admin summary should show paid order.");

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
