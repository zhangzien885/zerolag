const http = require("http");

const baseUrl = process.env.ZEROLAG_ADMIN_API_BASE_URL || "http://127.0.0.1:8787";
const adminSecret = process.env.ZEROLAG_ADMIN_SECRET || "zerolag-dev-admin-secret-change-before-production";

function usage() {
  console.log("Usage:");
  console.log("  node server/admin-client.js create-code [code] [durationDays] [maxUses]");
  console.log("  node server/admin-client.js complete-order [orderId] [providerTradeId]");
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

  if (command === "complete-order") {
    const response = await requestJson("/v1/admin/orders/complete", {
      orderId: process.argv[3],
      providerTradeId: process.argv[4] || "manual"
    });
    console.log(JSON.stringify(response.body, null, 2));
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
    return;
  }

  if (command === "summary") {
    const response = await requestJson("/v1/admin/summary");
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
