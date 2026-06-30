const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function rulesFor(stylesCss, selectorPart) {
  return stylesCss
    .split("}")
    .map((chunk) => {
      const braceIndex = chunk.indexOf("{");
      if (braceIndex < 0) return null;
      return {
        selector: chunk.slice(0, braceIndex),
        body: chunk.slice(braceIndex + 1)
      };
    })
    .filter((rule) => rule && rule.selector.includes(selectorPart));
}

function firstRule(stylesCss, selectorPart) {
  const [rule] = rulesFor(stylesCss, selectorPart);
  assertOk(rule, `Missing CSS rule for ${selectorPart}.`);
  return rule.body;
}

function main() {
  const stylesCss = readText("src/styles.css");
  const indexHtml = readText("src/index.html");
  const rendererJs = readText("src/renderer.js");
  const packageJson = JSON.parse(readText("package.json"));

  const bodyRule = firstRule(stylesCss, "body");
  assertOk(/overflow-y:\s*auto\s*;/.test(bodyRule), "Body must allow vertical scrolling when the app window is short.");
  assertOk(!/overflow:\s*hidden\s*;/.test(bodyRule), "Body must not hide overflow because it clips the right and bottom panels.");

  const shellRule = firstRule(stylesCss, ".shell");
  assertOk(/min-height:\s*calc\(100vh - 28px\)\s*;/.test(shellRule), "Shell must use min-height instead of a fixed viewport height.");
  assertOk(!/^\s*height:\s*calc\(100vh - 28px\)\s*;/m.test(shellRule), "Shell must not lock the dashboard to one viewport height.");
  assertOk(/grid-template-rows:\s*auto auto\s*;/.test(shellRule), "Shell rows must size to content so the membership panel is not cut off.");

  const membershipRules = rulesFor(stylesCss, ".membership-panel");
  assertOk(membershipRules.length > 0, "Membership panel styling is missing.");
  assertOk(!membershipRules.some((rule) => /overflow:\s*hidden\s*;/.test(rule.body)), "Membership panel must not hide overflowing account or renewal controls.");

  const topbarStatusRule = firstRule(stylesCss, ".topbar-status");
  assertOk(!/width:\s*310px\s*;/.test(topbarStatusRule), "Topbar status area must not be hard-locked to 310px.");

  const topbarPillRules = rulesFor(stylesCss, ".topbar-pills");
  assertOk(topbarPillRules.some((rule) => /display:\s*flex\s*;/.test(rule.body)), "Topbar pills must use a wrapping flex layout.");
  assertOk(topbarPillRules.some((rule) => /width:\s*100%\s*;/.test(rule.body)), "Topbar pills must stay inside the status column width.");
  assertOk(topbarPillRules.some((rule) => /max-width:\s*100%\s*;/.test(rule.body)), "Topbar pills must not expand past the right edge.");
  assertOk(topbarPillRules.some((rule) => /flex-wrap:\s*wrap\s*;/.test(rule.body)), "Topbar pills must wrap instead of clipping on the right.");
  assertOk(!topbarPillRules.some((rule) => /grid-template-columns:\s*38px repeat\(4,\s*max-content\)\s*;/.test(rule.body)), "Topbar pills must not use a fixed max-content grid.");

  assertOk(indexHtml.includes('class="preflight-panel"'), "Main dashboard must fill the lower-left empty area with the preflight panel.");
  assertOk(indexHtml.includes('id="preflightScanButton"'), "Preflight panel must include a quick scan action.");
  assertOk(indexHtml.includes('id="preflightNetworkButton"'), "Preflight panel must include a network check action.");
  assertOk(indexHtml.includes('id="preflightMemoryButton"'), "Preflight panel must include a memory refresh action.");
  assertOk(indexHtml.includes('id="preflightSupportButton"'), "Preflight panel must include a support diagnostics action.");

  const preflightRules = rulesFor(stylesCss, ".preflight-panel");
  assertOk(preflightRules.some((rule) => /grid-column:\s*1 \/ span 2\s*;/.test(rule.body)), "Preflight panel must span the lower-left two columns on desktop.");
  const preflightActionRules = rulesFor(stylesCss, ".preflight-actions");
  assertOk(preflightActionRules.some((rule) => /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)\s*;/.test(rule.body)), "Preflight actions must use four compact desktop columns.");
  assertOk(stylesCss.includes(".preflight-panel {\n    grid-column: auto;"), "Preflight panel must collapse back to normal flow on narrow windows.");
  assertOk(rendererJs.includes("renderPreflightSummary"), "Renderer must keep the preflight panel in sync with system state.");
  assertOk(rendererJs.includes('preflightScanButton.addEventListener("click"'), "Preflight scan action must be wired.");
  assertOk(rendererJs.includes('preflightNetworkButton.addEventListener("click"'), "Preflight network action must be wired.");
  assertOk(rendererJs.includes('preflightMemoryButton.addEventListener("click"'), "Preflight memory action must be wired.");
  assertOk(rendererJs.includes('preflightSupportButton.addEventListener("click"'), "Preflight support action must be wired.");

  assertOk(stylesCss.includes("@media (max-height: 820px)"), "Short windows need a compact-height layout fallback.");
  assertOk(packageJson.scripts && packageJson.scripts["ui:layout:smoke"], "ui:layout:smoke script is missing.");
  assertOk((packageJson.scripts.ci || "").includes("npm run ui:layout:smoke"), "npm run ci must include layout smoke coverage.");

  console.log("ZeroLag layout smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
