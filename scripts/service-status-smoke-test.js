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
  const indexHtml = readText("src/index.html");
  const rendererJs = readText("src/renderer.js");
  const stylesCss = readText("src/styles.css");
  const packageJson = JSON.parse(readText("package.json"));

  assertIncludes(mainJs, "publicServiceStatusFromConfig", "Main process must build a public service readiness summary.");
  assertIncludes(mainJs, "serviceStatus: publicServiceStatusFromConfig(config)", "App config IPC must return service readiness status.");
  assertIncludes(mainJs, "purchaseConfigured: Boolean(purchaseTargetFromConfig(config))", "Purchase readiness must reuse official purchase fallback rules.");
  assertIncludes(mainJs, "isConfiguredPublicUrl(config.apiBaseUrl)", "Account readiness must require a configured public API URL.");
  assertIncludes(mainJs, "isConfiguredPublicUrl(config.updateManifestUrl)", "Update readiness must require a configured public update URL.");
  assertIncludes(indexHtml, 'id="serviceState"', "Toolbox must include official service state.");
  assertIncludes(indexHtml, 'id="servicePurchaseState"', "Toolbox must include purchase service state.");
  assertIncludes(indexHtml, 'id="serviceAccountState"', "Toolbox must include account service state.");
  assertIncludes(indexHtml, 'id="serviceUpdateState"', "Toolbox must include update service state.");
  assertIncludes(indexHtml, 'id="serviceSupportState"', "Toolbox must include support service state.");
  assertIncludes(rendererJs, "renderServiceStatus", "Renderer must render service readiness.");
  assertIncludes(rendererJs, "refreshServiceStatus", "Renderer must refresh service readiness.");
  assertIncludes(rendererJs, "refreshServiceStatus();", "Toolbox open must refresh service readiness.");
  assertIncludes(rendererJs, "renderServiceStatus(config);", "Update checks must refresh service readiness from app config.");
  assertIncludes(rendererJs, "部分官方服务已准备", "Service readiness copy must stay customer-facing.");
  assertIncludes(stylesCss, ".service-grid", "Service status grid must have dedicated styling.");
  assertIncludes(stylesCss, ".service-grid strong.ready", "Ready service items must have a visible state.");
  assertIncludes(stylesCss, ".service-grid strong.pending", "Pending service items must have a visible state.");
  assertOk(packageJson.scripts && packageJson.scripts["ui:service:smoke"], "ui:service:smoke script is missing.");
  assertOk((packageJson.scripts.ci || "").includes("npm run ui:service:smoke"), "npm run ci must include service status smoke coverage.");

  console.log("ZeroLag service status smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
