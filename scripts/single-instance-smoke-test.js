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
  const packageJson = JSON.parse(readText("package.json"));

  assertIncludes(mainJs, "app.requestSingleInstanceLock()", "Desktop startup must acquire Electron's single-instance lock.");
  assertIncludes(mainJs, "const hasDesktopInstanceLock = runtimeGuardServiceMode || app.requestSingleInstanceLock();", "Runtime guard service mode must bypass the desktop instance lock.");
  assertIncludes(mainJs, "if (!hasDesktopInstanceLock)", "Second desktop processes must exit when another instance already owns the lock.");
  assertIncludes(mainJs, 'app.on("second-instance"', "Primary desktop instance must handle second launch attempts.");
  assertIncludes(mainJs, "revealPrimaryInstanceWindow", "Second launch attempts must reveal the existing ZeroLag window.");
  assertIncludes(mainJs, "showMainWindow();", "Second launch handling must reuse the existing tray/window reveal path.");
  assertOk(mainJs.indexOf("app.requestSingleInstanceLock()") < mainJs.indexOf("app.whenReady"), "Single-instance lock must be acquired before normal desktop startup.");
  assertOk(mainJs.indexOf('app.on("second-instance"') < mainJs.indexOf("app.whenReady"), "Second-instance handler must be registered before normal desktop startup.");
  assertOk(packageJson.scripts && packageJson.scripts["app:single-instance:smoke"], "app:single-instance:smoke script is missing.");
  assertOk((packageJson.scripts.ci || "").includes("npm run app:single-instance:smoke"), "npm run ci must include single-instance smoke coverage.");

  console.log("ZeroLag single-instance smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
