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

function between(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assertOk(startIndex >= 0 && endIndex > startIndex, `Could not extract block: ${start}`);
  return text.slice(startIndex, endIndex);
}

function main() {
  const mainJs = readText("main.js");
  const preloadJs = readText("preload.js");
  const indexHtml = readText("src/index.html");
  const rendererJs = readText("src/renderer.js");
  const stylesCss = readText("src/styles.css");
  const packageJson = JSON.parse(readText("package.json"));
  const handoffBlock = between(mainJs, "function supportHandoffSummary", "async function buildSupportDiagnosticPayload");

  assertIncludes(mainJs, "function supportCaseId", "Main process must generate support case IDs.");
  assertIncludes(mainJs, "supportHandoffSummary", "Main process must build a redacted support handoff summary.");
  assertIncludes(mainJs, "getSupportHandoff", "Main process must expose a support handoff read path.");
  assertIncludes(mainJs, "zerolag:get-support-handoff", "IPC must expose support handoff.");
  assertIncludes(mainJs, "payload.supportHandoff = supportHandoffSummary(payload)", "Diagnostic bundle must include the same support handoff summary.");
  assertIncludes(mainJs, "caseId: payload.supportHandoff.caseId", "Support bundle result summary must return the case ID.");
  assertOk(!/activationCode|serverToken|licenseToken|accessToken|webhook|privateKey/i.test(handoffBlock), "Support handoff summary must not include sensitive token/code fields.");

  assertIncludes(preloadJs, "getSupportHandoff", "Preload must expose support handoff to the renderer.");
  assertIncludes(indexHtml, 'id="supportHandoff"', "Toolbox must include support handoff UI.");
  assertIncludes(indexHtml, 'id="supportPrepareButton"', "Toolbox must include a support preparation action.");
  assertIncludes(indexHtml, 'id="supportCaseId"', "Toolbox must show support case ID.");
  assertIncludes(indexHtml, 'id="supportMemberStatus"', "Toolbox must show membership support status.");
  assertIncludes(indexHtml, 'id="supportVersionStatus"', "Toolbox must show version support status.");
  assertIncludes(indexHtml, 'id="supportRuntimeStatus"', "Toolbox must show runtime support status.");
  assertIncludes(rendererJs, "refreshSupportHandoff", "Renderer must refresh support handoff.");
  assertIncludes(rendererJs, "window.zeroLag.getSupportHandoff", "Renderer must call support handoff IPC.");
  assertIncludes(rendererJs, "supportPrepareButton.addEventListener", "Renderer must wire support preparation action.");
  assertIncludes(rendererJs, "summary.caseId", "Renderer must surface generated support case IDs.");
  assertIncludes(stylesCss, ".support-handoff", "Support handoff must have dedicated styling.");
  assertIncludes(stylesCss, ".support-actions", "Support actions must have dedicated layout.");
  assertOk(packageJson.scripts && packageJson.scripts["ui:support:smoke"], "ui:support:smoke script is missing.");
  assertOk((packageJson.scripts.ci || "").includes("npm run ui:support:smoke"), "npm run ci must include support flow smoke coverage.");

  console.log("ZeroLag support flow smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
