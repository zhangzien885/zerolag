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
  const indexHtml = readText("src/index.html");
  const rendererJs = readText("src/renderer.js");
  const stylesCss = readText("src/styles.css");
  const mainJs = readText("main.js");
  const packageJson = JSON.parse(readText("package.json"));

  assertIncludes(indexHtml, 'id="recoveryCard"', "Desktop UI must include the recovery assurance card.");
  assertIncludes(indexHtml, 'id="restoreState"', "Desktop UI must include a restore status label.");
  assertIncludes(indexHtml, 'id="restoreDetail"', "Desktop UI must include restore guidance text.");
  assertIncludes(rendererJs, "renderRestoreAssurance", "Renderer must update recovery assurance state.");
  assertIncludes(rendererJs, "restoreButton.querySelector", "Renderer must update restore button microcopy.");
  assertIncludes(rendererJs, "restoreDailyMode", "Renderer must call the restore-daily-mode IPC.");
  assertIncludes(rendererJs, "result && result.ok !== false", "Renderer must handle restore warnings without exposing internals.");
  assertIncludes(stylesCss, ".recovery-card.active", "Recovery card must have an active visual state.");
  assertIncludes(stylesCss, ".recovery-card.warn", "Recovery card must have a warning visual state.");
  assertIncludes(mainJs, "Daily mode restored.", "Main process must return user-safe restore success copy.");
  assertIncludes(mainJs, "sessionCleared", "Main process restore result must report session cleanup status.");
  assertOk(!mainJs.includes("deletedGuid: runtimePowerPlanGuid"), "Main process restore result must not expose runtime power plan GUIDs.");
  assertOk(packageJson.scripts && packageJson.scripts["ui:restore:smoke"], "ui:restore:smoke script is missing.");
  assertOk((packageJson.scripts.ci || "").includes("npm run ui:restore:smoke"), "npm run ci must include restore UI smoke coverage.");

  console.log("ZeroLag restore UI smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
