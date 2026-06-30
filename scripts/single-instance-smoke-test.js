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

function assertNotIncludes(text, snippet, message) {
  assertOk(!text.includes(snippet), message);
}

function main() {
  const mainJs = readText("main.js");
  const packageJson = JSON.parse(readText("package.json"));

  assertIncludes(mainJs, "app.requestSingleInstanceLock()", "Desktop startup must acquire Electron's single-instance lock.");
  assertIncludes(mainJs, "let hasDesktopInstanceLock = runtimeGuardServiceMode || app.requestSingleInstanceLock();", "Runtime guard service mode must bypass the desktop instance lock while allowing relaunch recovery.");
  assertIncludes(mainJs, "if (!hasDesktopInstanceLock)", "Second desktop processes must exit when another instance already owns the lock.");
  assertIncludes(mainJs, 'app.on("second-instance"', "Primary desktop instance must handle second launch attempts.");
  assertIncludes(mainJs, "revealPrimaryInstanceWindow", "Second launch attempts must reveal the existing ZeroLag window.");
  assertIncludes(mainJs, "showMainWindow();", "Second launch handling must reuse the existing tray/window reveal path.");
  assertIncludes(mainJs, "let normalDesktopStartupReady = false;", "Second launch reveal must wait until desktop startup finishes.");
  assertIncludes(mainJs, "let pendingPrimaryInstanceReveal = false;", "Second launch reveal must queue instead of creating a premature window.");
  assertIncludes(mainJs, "pendingPrimaryInstanceReveal = true;", "Second launch attempts during startup must be queued.");
  assertIncludes(mainJs, "normalDesktopStartupReady = true;", "Desktop startup must mark when it is safe to reveal the main window.");
  assertIncludes(mainJs, "app.releaseSingleInstanceLock();", "Admin relaunch must release the current lock before starting the elevated process.");
  assertIncludes(mainJs, "hasDesktopInstanceLock = app.requestSingleInstanceLock();", "Failed admin relaunch must reacquire the desktop lock before continuing.");
  assertNotIncludes(mainJs, 'app.once("ready", showMainWindow)', "Second launch must not create windows before IPC handlers and tray startup are ready.");
  assertOk(mainJs.indexOf("app.requestSingleInstanceLock()") < mainJs.indexOf("app.whenReady"), "Single-instance lock must be acquired before normal desktop startup.");
  assertOk(mainJs.indexOf('app.on("second-instance"') < mainJs.indexOf("app.whenReady"), "Second-instance handler must be registered before normal desktop startup.");
  assertOk(mainJs.indexOf("app.releaseSingleInstanceLock();") < mainJs.indexOf("await relaunchAsAdmin();"), "Admin relaunch must release the single-instance lock before spawning the elevated instance.");
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
