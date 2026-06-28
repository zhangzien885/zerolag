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
  console.log("  node server/admin-client.js ops-summary");
  console.log("  node server/admin-client.js ops-csv [outputFile]");
  console.log("  node server/admin-client.js analytics");
  console.log("  node server/admin-client.js analytics-funnel");
  console.log("  node server/admin-client.js analytics-csv [outputFile]");
  console.log("  node server/admin-client.js analytics-report [outputFile]");
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

function arrayFromResponse(body, key) {
  return body && Array.isArray(body[key]) ? body[key] : [];
}

function centsTotal(records) {
  return records.reduce((total, record) => total + Number(record.amountCents || 0), 0);
}

function currencyBreakdown(orders) {
  return orders.reduce((totals, order) => {
    const currency = order.currency || "CNY";
    totals[currency] = (totals[currency] || 0) + Number(order.amountCents || 0);
    return totals;
  }, {});
}

function isExpiringWithinDays(subscription, days) {
  if (!subscription || !subscription.active) return false;
  const expiresAt = new Date(subscription.expiresAt || "").getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt <= Date.now() + days * 24 * 60 * 60 * 1000;
}

function operationsPayloadFromData(summary, orders, subscriptions) {
  const paidOrders = orders.filter((order) => order.status === "paid");
  const pendingOrders = orders.filter((order) => order.status === "pending");
  const refundedOrders = orders.filter((order) => order.status === "refunded");
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.active);
  const renewedSubscriptions = subscriptions.filter((subscription) => Number(subscription.renewalCount || 0) > 0);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    orders: {
      total: Number(summary && summary.orders && summary.orders.total || orders.length),
      pending: Number(summary && summary.orders && summary.orders.pending || pendingOrders.length),
      paid: Number(summary && summary.orders && summary.orders.paid || paidOrders.length),
      refunded: Number(summary && summary.orders && summary.orders.refunded || refundedOrders.length),
      grossRevenueCents: centsTotal(paidOrders),
      refundedRevenueCents: centsTotal(refundedOrders),
      netRevenueCents: centsTotal(paidOrders) - centsTotal(refundedOrders),
      currencies: currencyBreakdown(paidOrders)
    },
    subscriptions: {
      total: Number(summary && summary.subscriptions && summary.subscriptions.total || subscriptions.length),
      active: Number(summary && summary.subscriptions && summary.subscriptions.active || activeSubscriptions.length),
      expired: Number(summary && summary.subscriptions && summary.subscriptions.expired || 0),
      revoked: Number(summary && summary.subscriptions && summary.subscriptions.revoked || 0),
      expiringIn7Days: subscriptions.filter((subscription) => isExpiringWithinDays(subscription, 7)).length,
      renewed: renewedSubscriptions.length,
      boundDevices: new Set(subscriptions.map((subscription) => subscription.device).filter(Boolean)).size
    },
    latest: {
      orders: orders.slice(0, 5).map((order) => ({
        orderId: order.orderId,
        status: order.status,
        plan: order.plan,
        amountCents: Number(order.amountCents || 0),
        currency: order.currency || "CNY",
        createdAt: order.createdAt || "",
        paidAt: order.paidAt || "",
        refundedAt: order.refundedAt || ""
      })),
      subscriptions: subscriptions.slice(0, 5).map((subscription) => ({
        subscriptionId: subscription.subscriptionId,
        status: subscription.status,
        active: Boolean(subscription.active),
        plan: subscription.plan,
        expiresAt: subscription.expiresAt || "",
        renewalCount: Number(subscription.renewalCount || 0),
        device: subscription.device || ""
      }))
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

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2).replace(/\.00$/, "")}%`;
}

function eventLabel(key) {
  return {
    release_view: "Release views",
    download_click: "Download clicks",
    purchase_click: "Purchase clicks",
    support_click: "Support clicks",
    checksum_copy: "Checksum copies",
    checksum_info_click: "Checksum info",
    cta_click: "Other CTA clicks"
  }[key] || key;
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

function operationsCsvFromData(orders, subscriptions) {
  const rows = [
    [
      "recordType",
      "id",
      "status",
      "plan",
      "amountCents",
      "currency",
      "createdAt",
      "paidAt",
      "refundedAt",
      "expiresAt",
      "device",
      "renewalCount",
      "activationCount",
      "appVersion",
      "channel"
    ],
    ...orders.map((order) => [
      "order",
      order.orderId || "",
      order.status || "",
      order.plan || "",
      Number(order.amountCents || 0),
      order.currency || "CNY",
      order.createdAt || "",
      order.paidAt || "",
      order.refundedAt || "",
      "",
      "",
      "",
      "",
      "",
      ""
    ]),
    ...subscriptions.map((subscription) => [
      "subscription",
      subscription.subscriptionId || "",
      subscription.status || "",
      subscription.plan || "",
      "",
      "",
      subscription.createdAt || "",
      "",
      subscription.revokedAt || "",
      subscription.expiresAt || "",
      subscription.device || "",
      Number(subscription.renewalCount || 0),
      Number(subscription.activationCount || 0),
      subscription.appVersion || "",
      subscription.channel || ""
    ])
  ];

  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function reportMetricCard(label, value, hint) {
  return `
    <article class="metric-card">
      <span>${htmlEscape(label)}</span>
      <strong>${htmlEscape(value)}</strong>
      <small>${htmlEscape(hint)}</small>
    </article>`;
}

function reportBarRows(rows, options = {}) {
  const max = Math.max(...rows.map((row) => Number(row.count || 0)), 1);
  const emptyText = options.emptyText || "No data yet";
  if (rows.length === 0) {
    return `<p class="empty">${htmlEscape(emptyText)}</p>`;
  }

  return rows.map((row) => {
    const count = Number(row.count || 0);
    const percentWidth = Math.max(2, Math.round((count / max) * 100));
    return `
      <div class="bar-row">
        <div>
          <span>${htmlEscape(row.label)}</span>
          <small>${htmlEscape(row.hint || "")}</small>
        </div>
        <div class="bar-track" aria-hidden="true"><i style="width:${percentWidth}%"></i></div>
        <strong>${htmlEscape(formatCount(count))}</strong>
      </div>`;
  }).join("");
}

function reportDailyRows(analytics) {
  const dailyEvents = analytics.dailyEvents || {};
  const days = Object.keys(analytics.daily || {}).sort().slice(-14);
  return reportBarRows(days.map((day) => {
    const events = dailyEvents[day] || {};
    const downloads = Number(events.download_click || 0);
    const purchases = Number(events.purchase_click || 0);
    const support = Number(events.support_click || 0);
    return {
      label: day,
      hint: `downloads ${downloads} / purchases ${purchases} / support ${support}`,
      count: Number(analytics.daily[day] || 0)
    };
  }), {
    emptyText: "No daily events yet"
  });
}

function analyticsReportHtmlFromSummary(summary) {
  const analytics = analyticsPayloadFromSummary(summary).websiteEvents;
  const funnel = analyticsFunnelFromSummary(summary);
  const eventRows = sortedMetricRows("event", analytics.events, analytics.updatedAt)
    .map(([, key, count]) => ({ label: eventLabel(key), hint: key, count }));
  const versionRows = sortedMetricRows("version", analytics.versions, analytics.updatedAt)
    .slice(0, 8)
    .map(([, key, count]) => ({ label: key, hint: "version", count }));
  const channelRows = sortedMetricRows("channel", analytics.channels, analytics.updatedAt)
    .slice(0, 8)
    .map(([, key, count]) => ({ label: key, hint: "channel", count }));
  const statusRows = sortedMetricRows("status", analytics.statuses, analytics.updatedAt)
    .slice(0, 8)
    .map(([, key, count]) => ({ label: key, hint: "release status", count }));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZeroLag Website Analytics Report</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #060b08;
      --panel: #0c1510;
      --panel-strong: #101e15;
      --line: #26402e;
      --muted: #95a49a;
      --text: #eef8ef;
      --acid: #95ff54;
      --mint: #4fe58a;
      --amber: #ffc657;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 18% 8%, rgba(149, 255, 84, .18), transparent 30rem),
        linear-gradient(135deg, #050807, #0b160f 48%, #050706);
      color: var(--text);
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    main {
      width: min(1180px, calc(100vw - 40px));
      margin: 0 auto;
      padding: 38px 0 56px;
    }
    header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 24px;
      align-items: end;
      padding: 28px;
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(16, 30, 21, .92), rgba(7, 12, 9, .86));
      box-shadow: 0 24px 80px rgba(0, 0, 0, .42), inset 0 1px 0 rgba(255, 255, 255, .06);
    }
    h1, h2, p { margin: 0; }
    .eyebrow {
      color: var(--acid);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .18em;
      text-transform: uppercase;
    }
    h1 {
      margin-top: 10px;
      font-size: clamp(34px, 6vw, 74px);
      line-height: .9;
      letter-spacing: -.06em;
      text-wrap: balance;
    }
    .stamp {
      border: 1px solid rgba(149, 255, 84, .48);
      padding: 14px 16px;
      min-width: 220px;
      background: rgba(149, 255, 84, .07);
      text-align: right;
    }
    .stamp span, .metric-card span, .panel-title span, .bar-row small {
      display: block;
      color: var(--muted);
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .stamp strong {
      display: block;
      margin-top: 6px;
      font-size: 18px;
      color: var(--acid);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-top: 16px;
    }
    .metric-card, .panel {
      border: 1px solid var(--line);
      background: rgba(8, 16, 11, .84);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
    }
    .metric-card {
      padding: 22px;
      min-height: 136px;
    }
    .metric-card strong {
      display: block;
      margin: 12px 0 8px;
      font-size: clamp(28px, 4vw, 48px);
      line-height: .9;
      letter-spacing: -.05em;
    }
    .metric-card small { color: var(--muted); }
    .panel-grid {
      display: grid;
      grid-template-columns: 1.15fr .85fr;
      gap: 16px;
      margin-top: 16px;
    }
    .panel { padding: 22px; }
    .panel-title {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      margin-bottom: 18px;
    }
    h2 {
      font-size: 22px;
      letter-spacing: -.03em;
    }
    .bar-row {
      display: grid;
      grid-template-columns: minmax(150px, 1fr) 1.6fr 76px;
      gap: 16px;
      align-items: center;
      padding: 13px 0;
      border-top: 1px solid rgba(38, 64, 46, .72);
    }
    .bar-row span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 800;
    }
    .bar-track {
      height: 10px;
      background: rgba(149, 255, 84, .08);
      border: 1px solid rgba(149, 255, 84, .18);
      overflow: hidden;
    }
    .bar-track i {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--acid), var(--mint));
      box-shadow: 0 0 24px rgba(149, 255, 84, .35);
    }
    .bar-row strong {
      text-align: right;
      color: var(--acid);
    }
    .empty {
      color: var(--muted);
      padding: 22px 0;
    }
    .note {
      margin-top: 18px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
    }
    @media (max-width: 860px) {
      main { width: min(100vw - 24px, 1180px); padding-top: 18px; }
      header, .panel-grid, .grid { grid-template-columns: 1fr; }
      .stamp { text-align: left; }
      .bar-row { grid-template-columns: 1fr; gap: 8px; }
      .bar-row strong { text-align: left; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <p class="eyebrow">ZeroLag private analytics</p>
        <h1>Website conversion command center</h1>
      </div>
      <div class="stamp">
        <span>Last update</span>
        <strong>${htmlEscape(analytics.updatedAt || "No events yet")}</strong>
      </div>
    </header>

    <section class="grid" aria-label="Core metrics">
      ${reportMetricCard("Total events", formatCount(analytics.total), "privacy-safe aggregate")}
      ${reportMetricCard("Download rate", formatPercent(funnel.funnel.downloadRatePct), "download / release view")}
      ${reportMetricCard("Purchase rate", formatPercent(funnel.funnel.purchaseRatePct), "purchase / release view")}
      ${reportMetricCard("Latest day", funnel.latestDay.date || "No data", `${formatCount(funnel.latestDay.funnel.downloads)} downloads`)}
    </section>

    <section class="panel-grid">
      <article class="panel">
        <div class="panel-title">
          <h2>Daily trend</h2>
          <span>latest 14 days</span>
        </div>
        ${reportDailyRows(analytics)}
      </article>
      <article class="panel">
        <div class="panel-title">
          <h2>Event mix</h2>
          <span>all time</span>
        </div>
        ${reportBarRows(eventRows)}
      </article>
    </section>

    <section class="panel-grid">
      <article class="panel">
        <div class="panel-title">
          <h2>Versions</h2>
          <span>top 8</span>
        </div>
        ${reportBarRows(versionRows)}
      </article>
      <article class="panel">
        <div class="panel-title">
          <h2>Channels</h2>
          <span>top 8</span>
        </div>
        ${reportBarRows(channelRows)}
      </article>
    </section>

    <section class="panel" style="margin-top:16px">
      <div class="panel-title">
        <h2>Release status</h2>
        <span>top 8</span>
      </div>
      ${reportBarRows(statusRows)}
      <p class="note">This report is generated locally from the admin summary endpoint. It contains aggregate counts only and should stay private.</p>
    </section>
  </main>
</body>
</html>
`;
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

  if (command === "ops-summary") {
    const [summaryResponse, ordersResponse, subscriptionsResponse] = await Promise.all([
      requestJson("/v1/admin/summary"),
      requestJson("/v1/admin/orders"),
      requestJson("/v1/admin/subscriptions")
    ]);
    const failed = [summaryResponse, ordersResponse, subscriptionsResponse]
      .find((response) => response.statusCode < 200 || response.statusCode >= 300);
    if (failed) {
      console.log(JSON.stringify(failed.body, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(operationsPayloadFromData(
      summaryResponse.body.summary,
      arrayFromResponse(ordersResponse.body, "orders"),
      arrayFromResponse(subscriptionsResponse.body, "subscriptions")
    ), null, 2));
    return;
  }

  if (command === "ops-csv") {
    const outputFile = path.resolve(process.argv[3] || `zerolag-operations-${Date.now()}.csv`);
    const [ordersResponse, subscriptionsResponse] = await Promise.all([
      requestJson("/v1/admin/orders"),
      requestJson("/v1/admin/subscriptions")
    ]);
    const failed = [ordersResponse, subscriptionsResponse]
      .find((response) => response.statusCode < 200 || response.statusCode >= 300);
    if (failed) {
      console.log(JSON.stringify(failed.body, null, 2));
      process.exitCode = 1;
      return;
    }

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, operationsCsvFromData(
      arrayFromResponse(ordersResponse.body, "orders"),
      arrayFromResponse(subscriptionsResponse.body, "subscriptions")
    ), "utf8");
    console.log(JSON.stringify({
      ok: true,
      outputFile,
      orders: arrayFromResponse(ordersResponse.body, "orders").length,
      subscriptions: arrayFromResponse(subscriptionsResponse.body, "subscriptions").length
    }, null, 2));
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

  if (command === "analytics-report") {
    const outputFile = path.resolve(process.argv[3] || `zerolag-website-analytics-${Date.now()}.html`);
    const response = await requestJson("/v1/admin/summary");
    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.log(JSON.stringify(response.body, null, 2));
      process.exitCode = 1;
      return;
    }

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, analyticsReportHtmlFromSummary(response.body.summary), "utf8");
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
