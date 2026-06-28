const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadServerEnvFile } = require("./env");

loadServerEnvFile();

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
  console.log("  node server/admin-client.js analytics");
  console.log("  node server/admin-client.js analytics-funnel");
  console.log("  node server/admin-client.js analytics-csv [outputFile]");
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

function analyticsPayloadFromSummary(summary) {
  const websiteEvents = summary && summary.websiteEvents ? summary.websiteEvents : {};
  return {
    ok: true,
    websiteEvents: {
      total: Number(websiteEvents.total || 0),
      updatedAt: websiteEvents.updatedAt || "",
      events: websiteEvents.events || {},
      versions: websiteEvents.versions || {},
      channels: websiteEvents.channels || {},
      statuses: websiteEvents.statuses || {},
      daily: websiteEvents.daily || {},
      dailyEvents: websiteEvents.dailyEvents || {}
    }
  };
}

function percent(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return 0;
  return Number(((top / bottom) * 100).toFixed(2));
}

function funnelFromEvents(events = {}) {
  const releaseViews = Number(events.release_view || 0);
  const downloads = Number(events.download_click || 0);
  const purchases = Number(events.purchase_click || 0);

  return {
    releaseViews,
    downloads,
    purchases,
    downloadRatePct: percent(downloads, releaseViews),
    purchaseRatePct: percent(purchases, releaseViews),
    purchasePerDownloadPct: percent(purchases, downloads)
  };
}

function assistanceFromEvents(events = {}) {
  const supportClicks = Number(events.support_click || 0);
  const checksumCopies = Number(events.checksum_copy || 0);
  const checksumInfoClicks = Number(events.checksum_info_click || 0);

  return {
    supportClicks,
    checksumCopies,
    checksumInfoClicks
  };
}

function analyticsFunnelFromSummary(summary) {
  const analytics = analyticsPayloadFromSummary(summary).websiteEvents;
  const events = analytics.events || {};
  const dailyEvents = analytics.dailyEvents || {};
  const latestDay = Object.keys(dailyEvents).sort().pop() || "";
  const latestDayEvents = latestDay ? dailyEvents[latestDay] || {} : {};

  return {
    ok: true,
    updatedAt: analytics.updatedAt,
    funnel: funnelFromEvents(events),
    assistance: assistanceFromEvents(events),
    latestDay: {
      date: latestDay,
      funnel: funnelFromEvents(latestDayEvents),
      assistance: assistanceFromEvents(latestDayEvents)
    }
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function sortedMetricRows(metric, map, updatedAt) {
  return Object.entries(map || {})
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0) || left[0].localeCompare(right[0]))
    .map(([key, count]) => [metric, key, Number(count || 0), updatedAt]);
}

function sortedDailyEventRows(dailyEvents, updatedAt) {
  return Object.entries(dailyEvents || {})
    .sort((left, right) => right[0].localeCompare(left[0]))
    .flatMap(([day, events]) => sortedMetricRows("day_event", events, updatedAt)
      .map((row) => [row[0], `${day}:${row[1]}`, row[2], row[3]]));
}

function analyticsCsvFromSummary(summary) {
  const analytics = analyticsPayloadFromSummary(summary).websiteEvents;
  const rows = [
    ["metric", "key", "count", "updatedAt"],
    ["total", "all", analytics.total, analytics.updatedAt],
    ...sortedMetricRows("event", analytics.events, analytics.updatedAt),
    ...sortedMetricRows("version", analytics.versions, analytics.updatedAt),
    ...sortedMetricRows("channel", analytics.channels, analytics.updatedAt),
    ...sortedMetricRows("status", analytics.statuses, analytics.updatedAt),
    ...sortedMetricRows("day", analytics.daily, analytics.updatedAt),
    ...sortedDailyEventRows(analytics.dailyEvents, analytics.updatedAt)
  ];

  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
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

  if (command === "analytics") {
    const response = await requestJson("/v1/admin/summary");
    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.log(JSON.stringify(response.body, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(analyticsPayloadFromSummary(response.body.summary), null, 2));
    return;
  }

  if (command === "analytics-funnel") {
    const response = await requestJson("/v1/admin/summary");
    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.log(JSON.stringify(response.body, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(analyticsFunnelFromSummary(response.body.summary), null, 2));
    return;
  }

  if (command === "analytics-csv") {
    const outputFile = path.resolve(process.argv[3] || `zerolag-website-analytics-${Date.now()}.csv`);
    const response = await requestJson("/v1/admin/summary");
    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.log(JSON.stringify(response.body, null, 2));
      process.exitCode = 1;
      return;
    }

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, analyticsCsvFromSummary(response.body.summary), "utf8");
    console.log(JSON.stringify({
      ok: true,
      outputFile,
      websiteEvents: analyticsPayloadFromSummary(response.body.summary).websiteEvents
    }, null, 2));
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
