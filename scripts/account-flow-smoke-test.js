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
  const serverSelfTest = readText("server/self-test.js");
  const packageJson = JSON.parse(readText("package.json"));

  assertIncludes(serverIndex, "/v1/accounts/register", "Server must expose account registration.");
  assertIncludes(serverIndex, "/v1/accounts/me", "Server must expose account profile reads.");
  assertIncludes(serverIndex, "/v1/accounts/activate-membership", "Server must expose account-based device session activation.");
  assertIncludes(serverIndex, "/v1/accounts/bind-membership", "Server must expose account membership binding.");
  assertIncludes(serverIndex, "const accountProviders = new Set([\"wechat\", \"qq\", \"email\", \"phone\"])", "Server must support WeChat, QQ, email, and phone account providers.");
  assertIncludes(serverIndex, "const accountToken = String(body.accountToken || \"\").trim()", "Server activation path must accept account tokens.");
  assertIncludes(serverIndex, "const requireAccountBinding = Boolean(body.requireAccountBinding)", "Server validation must support account-bound membership enforcement.");
  assertIncludes(serverIndex, "Membership is not bound to this account.", "Server validation must reject memberships bound to another account.");
  assertIncludes(serverIndex, "subscriptionBoundToAnotherAccount", "Server must prevent account-bound memberships from being transferred.");
  assertIncludes(serverIndex, "findActiveAccountSubscription", "Server must find active memberships by account.");
  assertIncludes(serverIndex, "account_device_session", "Server must issue portable account membership sessions.");
  assertIncludes(serverIndex, "bindSubscriptionToAccount", "Server must bind memberships to accounts.");
  assertIncludes(serverIndex, "safeAccountRecord", "Server must return redacted account records.");
  assertIncludes(serverSelfTest, "Account registration failed", "Server self-test must cover account registration.");
  assertIncludes(serverSelfTest, "Activation should bind membership to the registered account", "Server self-test must cover membership binding.");
  assertIncludes(serverSelfTest, "Validation should require the logged-in account when account binding is enforced.", "Server self-test must cover logged-out validation blocking.");
  assertIncludes(serverSelfTest, "A membership bound to one account must not be transferable to another account.", "Server self-test must cover cross-account transfer blocking.");
  assertIncludes(serverSelfTest, "Account membership should activate on another device.", "Server self-test must cover portable account membership sessions.");
  assertIncludes(serverSelfTest, "Copied device tokens must not work on another device.", "Server self-test must keep copied device tokens blocked.");

  assertIncludes(mainJs, "registerAccountWithServer", "Main process must register accounts through the server.");
  assertIncludes(mainJs, "bindCurrentMembershipToAccount", "Main process must bind active memberships to accounts.");
  assertIncludes(mainJs, "activateAccountMembershipWithServer", "Main process must restore account memberships on a new device.");
  assertIncludes(mainJs, "accountSessionAllowsMembership", "Main process must require the current account before granting membership.");
  assertIncludes(mainJs, "requireAccountBinding: true", "Main process must request account-bound validation from the server.");
  assertIncludes(mainJs, "logoutAccount", "Main process must support account logout.");
  assertIncludes(mainJs, "account-session.json", "Main process must persist a signed local account session.");
  assertIncludes(mainJs, "activateLicenseV2(normalizeActivationCode(code))", "License activation IPC must stay normalized.");
  assertIncludes(mainJs, "accountToken: accountSession && accountSession.accountToken || \"\"", "Activation should include account tokens when available.");
  assertIncludes(mainJs, "zerolag:register-account", "Main process must expose account registration IPC.");
  assertIncludes(mainJs, "zerolag:get-account-status", "Main process must expose account status IPC.");
  assertIncludes(mainJs, "zerolag:bind-account-membership", "Main process must expose manual account binding IPC.");
  assertIncludes(mainJs, "zerolag:logout-account", "Main process must expose account logout IPC.");

  assertIncludes(preloadJs, "registerAccount", "Preload must expose account registration.");
  assertIncludes(preloadJs, "getAccountStatus", "Preload must expose account status.");
  assertIncludes(preloadJs, "bindAccountMembership", "Preload must expose account membership binding.");
  assertIncludes(preloadJs, "logoutAccount", "Preload must expose account logout.");

  assertIncludes(indexHtml, 'id="accountProvider"', "Membership center must include an account provider selector.");
  assertIncludes(indexHtml, 'value="wechat"', "Account provider selector must include WeChat.");
  assertIncludes(indexHtml, 'value="qq"', "Account provider selector must include QQ.");
  assertIncludes(indexHtml, 'value="email"', "Account provider selector must include email.");
  assertIncludes(indexHtml, 'value="phone"', "Account provider selector must include phone.");
  assertIncludes(indexHtml, 'id="accountIdentifier"', "Membership center must include an account identifier input.");
  assertIncludes(indexHtml, 'id="accountBindButton"', "Membership center must include an account bind action.");
  assertIncludes(indexHtml, 'id="accountLogoutButton"', "Membership center must include an account logout action.");
  assertIncludes(rendererJs, "window.zeroLag.registerAccount", "Renderer must call account registration through IPC.");
  assertIncludes(rendererJs, "window.zeroLag.logoutAccount", "Renderer must call account logout through IPC.");
  assertIncludes(rendererJs, "refreshAccountStatus", "Renderer must refresh account status.");
  assertIncludes(rendererJs, "accountProviderLabel", "Renderer must label account providers for users.");
  assertIncludes(rendererJs, "normalizeAccountIdentifierInput", "Renderer must normalize account identifiers.");
  assertIncludes(stylesCss, ".account-card", "Account binding card must have dedicated styling.");
  assertIncludes(stylesCss, ".account-state-actions", "Account logout action must have dedicated styling.");
  assertIncludes(stylesCss, ".account-row", "Account binding controls must have dedicated layout.");
  assertOk(packageJson.scripts && packageJson.scripts["ui:account:smoke"], "ui:account:smoke script is missing.");
  assertOk((packageJson.scripts.ci || "").includes("npm run ui:account:smoke"), "npm run ci must include account flow smoke coverage.");

  console.log("ZeroLag account flow smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
