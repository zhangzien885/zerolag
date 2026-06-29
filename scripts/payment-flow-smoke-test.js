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
  assertIncludes(preloadJs, "openPurchaseUrl", "Preload must expose official purchase fallback opening.");
  assertIncludes(mainJs, "zerolag:open-payment-url", "Main process must expose payment URL IPC.");
  assertIncludes(mainJs, "zerolag:open-purchase-url", "Main process must expose purchase URL IPC.");
  assertIncludes(mainJs, "function normalizeActivationCode", "Main process must normalize pasted activation codes before activation.");
  assertIncludes(mainJs, "activateLicenseV2(normalizeActivationCode(code))", "License activation IPC must use normalized activation codes.");
  assertIncludes(mainJs, "PAYMENT_URL_NOT_READY", "Payment URL IPC must reject missing or invalid URLs.");
  assertIncludes(mainJs, "PAYMENT_URL_OPEN_FAILED", "Payment URL IPC must fail safely if the browser handoff fails.");
  assertIncludes(mainJs, "purchaseTargetFromConfig", "Main process must choose purchase targets from app config.");
  assertIncludes(mainJs, "isConfiguredPublicUrl", "Main process must reject placeholder purchase targets.");
  assertIncludes(mainJs, "PURCHASE_URL_NOT_CONFIGURED", "Purchase fallback must fail safely when no official URL is configured.");
  assertIncludes(mainJs, "PURCHASE_URL_OPEN_FAILED", "Purchase fallback must fail safely if the browser handoff fails.");
  assertIncludes(mainJs, "ACCOUNT_SIGN_IN_REQUIRED", "Order creation must require a signed-in account.");
  assertIncludes(mainJs, "accountToken: accountGate.session.accountToken", "Order creation must use the current account token.");
  assertOk(!mainJs.includes("deviceHash: machineHash,\n      channel: config.releaseChannel || \"desktop\""), "Order creation must not bind purchase requests to the machine hash.");
  assertIncludes(serverIndex, "Please sign in before purchasing membership.", "Server order creation must reject signed-out customers.");
  assertIncludes(serverIndex, "accountId: account.accountId", "Server orders must be linked to the signed-in account.");
  assertIncludes(serverIndex, "Order belongs to another account.", "Order status must reject non-owner accounts.");
  assertIncludes(serverIndex, "paymentProvider: order.paymentProvider", "Order status must include the payment provider.");
  assertIncludes(indexHtml, 'id="paymentCheckoutButton"', "Purchase dialog must include a checkout button.");
  assertIncludes(indexHtml, 'autocapitalize="characters"', "Activation-code input should encourage uppercase entry.");
  assertIncludes(indexHtml, 'id="paymentOrderId"', "Purchase dialog must show the order ID.");
  assertIncludes(indexHtml, 'id="paymentProvider"', "Purchase dialog must show the payment provider.");
  assertIncludes(indexHtml, 'id="copyOrderIdButton"', "Purchase dialog must include an order ID copy action.");
  assertIncludes(indexHtml, 'id="copyOrderIdButton" class="ghost-button" disabled', "Order ID copy action must stay disabled until an order exists.");
  assertIncludes(indexHtml, 'id="copyActivationCodeButton"', "Purchase dialog must copy activation codes only after payment.");
  assertIncludes(rendererJs, "pendingPaymentUrl", "Renderer must keep checkout URL state.");
  assertIncludes(rendererJs, "normalizeActivationCodeInput", "Renderer must normalize pasted activation codes.");
  assertIncludes(rendererJs, 'licenseCode.addEventListener("paste"', "Renderer must normalize pasted activation codes after paste.");
  assertIncludes(rendererJs, "normalizeLicenseInputField", "Renderer must normalize the activation field before submit.");
  assertIncludes(rendererJs, "pendingCheckoutMode", "Renderer must track whether checkout opens payment or purchase fallback.");
  assertIncludes(rendererJs, "renderPurchaseLoginRequired", "Renderer must show a sign-in-required purchase state.");
  assertIncludes(rendererJs, "purchaseFallbackAvailable", "Renderer must know when the official purchase fallback can be used.");
  assertIncludes(rendererJs, "前往官网购买", "Renderer must expose an official purchase fallback label.");
  assertIncludes(rendererJs, "renderPurchaseOrder(order, payment = null", "Renderer must render payment metadata.");
  assertIncludes(rendererJs, "window.zeroLag.openPaymentUrl", "Renderer must open checkout through IPC.");
  assertIncludes(rendererJs, "window.zeroLag.openPurchaseUrl", "Renderer must open the official purchase fallback through IPC.");
  assertIncludes(rendererJs, "copyOrderIdButton.addEventListener", "Renderer must wire order ID copying.");
  assertIncludes(rendererJs, "navigator.clipboard.writeText(pendingPurchaseOrderId)", "Renderer must copy order IDs without exposing activation codes.");
  assertIncludes(rendererJs, "copyOrderIdButton.disabled = !pendingPurchaseOrderId", "Order ID copy action must be enabled only after order creation.");
  assertIncludes(rendererJs, "isHttpPaymentUrl", "Renderer must gate checkout by HTTP payment URL.");
  assertIncludes(rendererJs, "example\\.com|localhost|127\\.0\\.0\\.1", "Renderer must not enable placeholder purchase URLs.");
  assertIncludes(rendererJs, "wechat_pay", "Renderer must recognize WeChat Pay provider metadata.");
  assertIncludes(rendererJs, "alipay", "Renderer must recognize Alipay provider metadata.");
  assertIncludes(serverIndex, "function normalizeCode", "Server must normalize activation codes consistently.");
  assertIncludes(serverIndex, ".normalize(\"NFKC\")", "Server activation-code normalization must handle full-width pasted text.");
  assertOk(!indexHtml.includes("ZL-PRO-DEMO-2026"), "Purchase dialog must not show demo activation codes.");
  assertOk(!rendererJs.includes('pendingPurchaseActivationCode || "ZL-PRO-DEMO-2026"'), "Renderer must not copy a demo code by default.");
  assertOk(!rendererJs.includes("copyDemoCodeButton"), "Renderer must not keep demo-code naming in the formal payment flow.");
  assertIncludes(stylesCss, ".confirm-pay-button:disabled", "Disabled payment action state must be styled.");
  assertIncludes(stylesCss, "grid-template-columns: 1.25fr repeat(3, minmax(0, 1fr))", "Purchase actions must support checkout, refresh, order copy, and activation copy buttons.");
  assertIncludes(stylesCss, ".update-actions", "Update dialog must keep a dedicated action layout.");
  assertOk(packageJson.scripts && packageJson.scripts["ui:payment:smoke"], "ui:payment:smoke script is missing.");
  assertOk(packageJson.scripts && packageJson.scripts["server:payment-loop"], "server:payment-loop script is missing.");
  assertOk((packageJson.scripts.ci || "").includes("npm run ui:payment:smoke"), "npm run ci must include payment flow smoke coverage.");
  assertOk((packageJson.scripts.ci || "").includes("npm run server:payment-loop:smoke"), "npm run ci must include production payment loop coverage.");

  console.log("ZeroLag payment flow smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
