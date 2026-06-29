const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(text, snippet, message) {
  assertOk(text.includes(snippet), message);
}

function main() {
  const mainJs = readText("main.js");
  const preloadJs = readText("preload.js");
  const indexHtml = readText("src/index.html");
  const rendererJs = readText("src/renderer.js");
  const stylesCss = readText("src/styles.css");
  const serverIndex = readText("server/index.js");
  const packageJson = JSON.parse(readText("package.json"));

  assertIncludes(preloadJs, "openPaymentUrl", "Preload must expose payment URL opening.");
  assertIncludes(mainJs, "zerolag:open-payment-url", "Main process must expose payment URL IPC.");
  assertIncludes(mainJs, "PAYMENT_URL_NOT_READY", "Payment URL IPC must reject missing or invalid URLs.");
  assertIncludes(mainJs, "PAYMENT_URL_OPEN_FAILED", "Payment URL IPC must fail safely if the browser handoff fails.");
  assertIncludes(serverIndex, "paymentProvider: order.paymentProvider", "Order status must include the payment provider.");
  assertIncludes(indexHtml, 'id="paymentCheckoutButton"', "Purchase dialog must include a checkout button.");
  assertIncludes(indexHtml, 'id="paymentOrderId"', "Purchase dialog must show the order ID.");
  assertIncludes(indexHtml, 'id="paymentProvider"', "Purchase dialog must show the payment provider.");
  assertIncludes(indexHtml, 'id="copyActivationCodeButton"', "Purchase dialog must copy activation codes only after payment.");
  assertIncludes(rendererJs, "pendingPaymentUrl", "Renderer must keep checkout URL state.");
  assertIncludes(rendererJs, "renderPurchaseOrder(order, payment = null)", "Renderer must render payment metadata.");
  assertIncludes(rendererJs, "window.zeroLag.openPaymentUrl", "Renderer must open checkout through IPC.");
  assertIncludes(rendererJs, "isHttpPaymentUrl", "Renderer must gate checkout by HTTP payment URL.");
  assertIncludes(rendererJs, "wechat_pay", "Renderer must recognize WeChat Pay provider metadata.");
  assertIncludes(rendererJs, "alipay", "Renderer must recognize Alipay provider metadata.");
  assertOk(!indexHtml.includes("ZL-PRO-DEMO-2026"), "Purchase dialog must not show demo activation codes.");
  assertOk(!rendererJs.includes('pendingPurchaseActivationCode || "ZL-PRO-DEMO-2026"'), "Renderer must not copy a demo code by default.");
  assertOk(!rendererJs.includes("copyDemoCodeButton"), "Renderer must not keep demo-code naming in the formal payment flow.");
  assertIncludes(stylesCss, ".confirm-pay-button:disabled", "Disabled payment action state must be styled.");
  assertIncludes(stylesCss, ".update-actions", "Update dialog must keep a dedicated action layout.");
  assertOk(packageJson.scripts && packageJson.scripts["ui:payment:smoke"], "ui:payment:smoke script is missing.");
  assertOk((packageJson.scripts.ci || "").includes("npm run ui:payment:smoke"), "npm run ci must include payment flow smoke coverage.");

  console.log("ZeroLag payment flow smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
