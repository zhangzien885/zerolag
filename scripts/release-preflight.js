const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const strict = process.argv.includes("--strict");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function readTextIfExists(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function isPlaceholderUrl(value) {
  return /example\.com|localhost|127\.0\.0\.1/i.test(String(value || ""));
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(value || ""));
}

function hasStrongCodeSigningSignal() {
  return Boolean(
    process.env.CSC_LINK
      || process.env.WIN_CSC_LINK
      || process.env.WINDOWS_CODESIGN_CERT
      || process.env.ZEROLAG_CODESIGN_CERT
  );
}

function forbiddenPublicReleaseNoteTerms() {
  return [
    "subscription control",
    "protection strategy",
    "permanent config",
    "watchdog",
    "task scheduler",
    "windows service",
    "anti-crack",
    "reverse engineering",
    "private key",
    "server env",
    "forbidden helper",
    "\u53cd\u7834\u89e3",
    "\u6c38\u4e45\u7559\u5b58",
    "\u8ba2\u9605\u63a7\u5236",
    "\u4fdd\u62a4\u7b56\u7565",
    "\u5f3a\u6740\u515c\u5e95",
    "\u79c1\u94a5",
    "\u670d\u52a1\u7aef\u73af\u5883"
  ];
}

function publicReleaseNotesAreSafe(notes) {
  if (!Array.isArray(notes)) return true;
  const forbiddenTerms = forbiddenPublicReleaseNoteTerms();
  return notes.every((note) => {
    if (typeof note !== "string") return true;
    const lowered = note.toLowerCase();
    return !forbiddenTerms.some((term) => lowered.includes(term.toLowerCase()));
  });
}

function addIssue(issues, ok, message) {
  if (!ok) issues.push(message);
}

function addReleaseGate(issues, warnings, ok, message) {
  if (ok) return;
  if (strict) issues.push(message);
  else warnings.push(message);
}

function hasScript(packageJson, scriptName) {
  return Boolean(packageJson.scripts && packageJson.scripts[scriptName]);
}

function scriptIncludesInOrder(packageJson, scriptName, first, second) {
  const script = packageJson.scripts && packageJson.scripts[scriptName] || "";
  const firstIndex = script.indexOf(first);
  const secondIndex = script.indexOf(second);
  return firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex;
}

function hasWindowsNsisTarget(build) {
  const targets = build && build.win && build.win.target;
  if (!Array.isArray(targets)) return false;
  return targets.some((target) => {
    if (typeof target === "string") return target === "nsis";
    return target && target.target === "nsis";
  });
}

function main() {
  const issues = [];
  const warnings = [];

  addIssue(issues, fileExists("package.json"), "package.json is missing.");
  addIssue(issues, fileExists("package-lock.json"), "package-lock.json is missing; releases should be reproducible with npm ci.");
  addIssue(issues, fileExists("main.js"), "main.js is missing.");
  addIssue(issues, fileExists("assets/app-config.json"), "assets/app-config.json is missing.");
  addIssue(issues, fileExists("assets/update.json"), "assets/update.json is missing.");
  addIssue(issues, fileExists("assets/integrity-manifest.json"), "assets/integrity-manifest.json is missing.");
  addIssue(issues, fileExists(".github/workflows/ci.yml"), ".github/workflows/ci.yml is missing.");
  addIssue(issues, fileExists("build/service-guard.json"), "Windows Service guard manifest is missing.");
  addIssue(issues, fileExists("build/install-runtime-guard-service.ps1"), "Windows Service guard install script is missing.");
  addIssue(issues, fileExists("build/uninstall-runtime-guard-service.ps1"), "Windows Service guard uninstall script is missing.");
  addIssue(issues, fileExists("build/install-runtime-guard-task.ps1"), "Task Scheduler fallback install script is missing.");
  addIssue(issues, fileExists("build/uninstall-runtime-guard-task.ps1"), "Task Scheduler fallback uninstall script is missing.");
  addIssue(issues, fileExists("build/installer-guard.nsh"), "NSIS installer guard hook is missing.");
  addIssue(issues, fileExists("scripts/runtime-guard-core.js"), "Runtime guard core worker is missing.");
  addIssue(issues, fileExists("scripts/runtime-guard-service.js"), "Runtime guard service worker is missing.");
  addIssue(issues, fileExists("scripts/generate-runtime-session-keys.js"), "Runtime session key generation tool is missing.");
  addIssue(issues, fileExists("scripts/runtime-session-keygen-smoke-test.js"), "Runtime session keygen smoke test is missing.");
  addIssue(issues, fileExists("scripts/bootstrap-production-env.js"), "Production server env bootstrap tool is missing.");
  addIssue(issues, fileExists("scripts/bootstrap-production-env-smoke-test.js"), "Production server env bootstrap smoke test is missing.");

  if (issues.length) {
    printResult({ issues, warnings, packageJson: {}, appConfig: {} });
    return;
  }

  const packageJson = readJson(path.join(rootDir, "package.json"));
  const appConfig = readJson(path.join(rootDir, "assets", "app-config.json"));
  const updateManifest = readJson(path.join(rootDir, "assets", "update.json"));
  const serviceGuard = readJson(path.join(rootDir, "build", "service-guard.json"));
  const mainJs = readTextIfExists("main.js");
  const gitignore = readTextIfExists(".gitignore");
  const ciWorkflow = readTextIfExists(".github/workflows/ci.yml");

  ["check", "ci", "icon:generate", "pack:dir", "package:smoke", "package:verify", "installer:smoke", "installer:guard:smoke", "installer:verify", "release:artifacts", "release:report", "release:report:smoke", "ci:reports:smoke", "guard:service:smoke", "guard:install:smoke", "guard:task:smoke", "guard:runtime:smoke", "runtime:keys", "runtime:keys:smoke", "server:bootstrap", "server:bootstrap:smoke", "release:gate", "release:gate:smoke", "website:release", "website:smoke", "website:release:smoke", "release:verify", "release:build", "dist:win", "production:check", "production:config", "production:config:smoke", "server:check", "server:smoke", "server:test", "server:env-check", "server:deployment-report", "server:deployment-report:json", "server:deployment-report:strict", "server:deployment-report:smoke", "server:migrate-sqlite", "server:backup-sqlite", "server:restore-sqlite", "server:check-sqlite-backups", "deploy:checklist", "integrity:verify", "update:sign", "update:smoke"].forEach((scriptName) => {
    addIssue(issues, hasScript(packageJson, scriptName), `package.json script is missing: ${scriptName}`);
  });

  const build = packageJson.build || {};
  addIssue(issues, ciWorkflow.includes("npm run ci"), "GitHub CI workflow must run npm run ci.");
  addIssue(issues, ciWorkflow.includes("ZEROLAG_STATE_STORE=sqlite"), "GitHub CI strict server sample must exercise SQLite state storage.");
  addIssue(issues, ciWorkflow.includes("ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM=RSA-SHA256"), "GitHub CI strict server sample must exercise RSA runtime session proofs.");
  addIssue(issues, ciWorkflow.includes("ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64"), "GitHub CI strict server sample must configure a runtime session RSA private key.");
  addIssue(issues, ciWorkflow.includes("npm run server:migrate-sqlite"), "GitHub CI strict server sample must create a SQLite state file.");
  addIssue(issues, ciWorkflow.includes("npm run server:backup-sqlite"), "GitHub CI strict server sample must create a SQLite backup.");
  addIssue(issues, ciWorkflow.includes("npm run server:env-check -- --profile sqlite --strict"), "GitHub CI strict server sample must run strict SQLite env validation.");
  addIssue(issues, ciWorkflow.includes("npm run server:check-sqlite-backups"), "GitHub CI strict server sample must validate SQLite backups.");
  addIssue(issues, ciWorkflow.includes("npm run server:deployment-report -- --output"), "GitHub CI workflow must generate a Markdown server deployment report artifact.");
  addIssue(issues, ciWorkflow.includes("npm run server:deployment-report:json -- --output"), "GitHub CI workflow must generate a redacted JSON server deployment report artifact.");
  addIssue(issues, ciWorkflow.includes("npm run release:report -- --output-dir"), "GitHub CI workflow must generate a release candidate report artifact.");
  addIssue(issues, ciWorkflow.includes("actions/upload-artifact@v4"), "GitHub CI workflow must upload release reports as an artifact.");
  addIssue(issues, ciWorkflow.includes("zerolag-ci-reports"), "GitHub CI workflow must use the zerolag-ci-reports artifact name.");
  addIssue(issues, (packageJson.scripts.ci || "").includes("npm run ci:reports:smoke"), "npm run ci must verify CI report artifact generation.");
  addIssue(issues, (packageJson.scripts.ci || "").includes("npm run installer:guard:smoke"), "npm run ci must verify the NSIS installer guard hook.");
  addIssue(issues, (packageJson.scripts.ci || "").includes("npm run guard:service:smoke"), "npm run ci must verify Windows Service guard assets.");
  addIssue(issues, (packageJson.scripts.ci || "").includes("npm run guard:install:smoke"), "npm run ci must verify Windows Service install-script gating.");
  addIssue(issues, (packageJson.scripts.ci || "").includes("npm run guard:task:smoke"), "npm run ci must verify Task Scheduler fallback gating.");
  addIssue(issues, (packageJson.scripts.ci || "").includes("npm run guard:runtime:smoke"), "npm run ci must verify the runtime guard service worker.");
  addIssue(issues, (packageJson.scripts.ci || "").includes("npm run runtime:keys:smoke"), "npm run ci must verify runtime session key generation.");
  addIssue(issues, (packageJson.scripts.ci || "").includes("npm run server:bootstrap:smoke"), "npm run ci must verify production server env bootstrap.");
  addIssue(issues, (packageJson.scripts.ci || "").includes("npm run production:config:smoke"), "npm run ci must verify production URL config generation.");
  addIssue(issues, scriptIncludesInOrder(packageJson, "release:verify", "release:gate", "website:release"), "release:verify must run release:gate before website:release.");
  addIssue(issues, scriptIncludesInOrder(packageJson, "release:verify", "installer:guard:smoke", "installer:smoke"), "release:verify must check the NSIS guard hook before installer artifacts.");
  addIssue(issues, scriptIncludesInOrder(packageJson, "release:build", "dist:win", "release:verify"), "release:build must build the installer before running release:verify.");
  addIssue(issues, gitignore.includes(".secrets/"), ".gitignore must keep .secrets/ out of Git.");
  addIssue(issues, gitignore.includes("dist/"), ".gitignore must keep dist/ build outputs out of Git.");
  addIssue(issues, gitignore.includes("out/"), ".gitignore must keep out/ build outputs out of Git.");
  addIssue(issues, gitignore.includes("server/data/*.sqlite"), ".gitignore must keep SQLite server state out of Git.");
  addIssue(issues, isSemver(packageJson.version), "package.json version must be semantic, for example 1.0.0.");
  addIssue(issues, Boolean(packageJson.author), "package.json author must be set for packaged builds.");
  addIssue(issues, Boolean(build.appId), "Installer packaging config must define build.appId.");
  addIssue(issues, Boolean(build.productName), "Installer packaging config must define build.productName.");
  addIssue(issues, Array.isArray(build.files) && build.files.length > 0, "Installer packaging config must define build.files.");
  addIssue(issues, !JSON.stringify(build.files || []).includes("scripts/**/*.js"), "Installer packaging config must not ship every scripts/*.js helper.");
  addIssue(issues, !JSON.stringify(build.files || []).includes("scripts/**"), "Installer packaging config must not use broad scripts/** globs.");
  addIssue(issues, !JSON.stringify(build.files || []).includes("server/"), "Installer packaging config must not ship server-side helpers.");
  addIssue(issues, !JSON.stringify(build.files || []).includes("server/env.js"), "Installer packaging config must not ship server env helpers.");
  addIssue(issues, JSON.stringify(build.files || []).includes("scripts/runtime-guard-core.js"), "Installer packaging config must include runtime guard core in the app archive.");
  addIssue(issues, JSON.stringify(build.files || []).includes("scripts/runtime-guard-service.js"), "Installer packaging config must include runtime guard service worker in the app archive.");
  addIssue(issues, JSON.stringify(build.files || []).includes("scripts/runtime-watchdog.js"), "Installer packaging config must include runtime watchdog in the app archive.");
  addIssue(issues, JSON.stringify(build.extraResources || []).includes("service-guard/service-guard.json"), "Installer packaging config must include the service guard manifest as an extra resource.");
  addIssue(issues, JSON.stringify(build.extraResources || []).includes("service-guard/install-runtime-guard-service.ps1"), "Installer packaging config must include the service guard install script as an extra resource.");
  addIssue(issues, JSON.stringify(build.extraResources || []).includes("service-guard/uninstall-runtime-guard-service.ps1"), "Installer packaging config must include the service guard uninstall script as an extra resource.");
  addIssue(issues, JSON.stringify(build.extraResources || []).includes("service-guard/install-runtime-guard-task.ps1"), "Installer packaging config must include the Task Scheduler fallback install script as an extra resource.");
  addIssue(issues, JSON.stringify(build.extraResources || []).includes("service-guard/uninstall-runtime-guard-task.ps1"), "Installer packaging config must include the Task Scheduler fallback uninstall script as an extra resource.");
  addIssue(issues, JSON.stringify(build.extraResources || []).includes("service-guard/runtime-guard-core.js"), "Installer packaging config must include the runtime guard core as an extra resource.");
  addIssue(issues, JSON.stringify(build.extraResources || []).includes("service-guard/runtime-guard-service.js"), "Installer packaging config must include the runtime guard service worker as an extra resource.");
  addIssue(issues, hasWindowsNsisTarget(build), "Installer packaging config must target Windows NSIS.");
  addIssue(issues, build.nsis && build.nsis.include === "build/installer-guard.nsh", "Installer packaging config must include the NSIS guard hook.");
  addIssue(issues, build.win && build.win.requestedExecutionLevel === "requireAdministrator", "Windows package must request administrator execution.");
  addIssue(issues, serviceGuard.serviceName === "ZeroLagRuntimeGuard", "Windows Service guard manifest must use the ZeroLagRuntimeGuard service name.");
  addIssue(issues, serviceGuard.serviceBinary === "ZeroLag.exe", "Windows Service guard manifest must use the installed ZeroLag executable for worker mode.");
  addIssue(issues, serviceGuard.serviceBinaryStatus === "electron-worker-mode", "Windows Service guard manifest must mark the Electron worker-mode entry.");
  addIssue(issues, serviceGuard.installerRegistrationStatus === "explicit-private-validation-only", "Windows Service guard registration must stay explicitly gated until the native wrapper exists.");
  addIssue(issues, serviceGuard.taskSchedulerFallback && serviceGuard.taskSchedulerFallback.registrationStatus === "explicit-private-validation-only", "Task Scheduler fallback registration must stay explicitly gated.");
  addIssue(issues, serviceGuard.taskSchedulerFallback && serviceGuard.taskSchedulerFallback.enabledWhenServiceInstallFails === true, "Task Scheduler fallback must be enabled when service installation fails.");
  addIssue(issues, serviceGuard.taskSchedulerFallback && serviceGuard.taskSchedulerFallback.installScript === "build/install-runtime-guard-task.ps1", "Task Scheduler fallback install script path is wrong.");
  addIssue(issues, serviceGuard.taskSchedulerFallback && serviceGuard.taskSchedulerFallback.uninstallScript === "build/uninstall-runtime-guard-task.ps1", "Task Scheduler fallback uninstall script path is wrong.");
  addIssue(issues, serviceGuard.serviceWorker === "service-guard/runtime-guard-service.js", "Windows Service guard manifest must point to the runtime guard service worker.");
  addIssue(issues, serviceGuard.serviceCore === "service-guard/runtime-guard-core.js", "Windows Service guard manifest must point to the runtime guard core.");
  addIssue(issues, mainJs.includes("--runtime-guard-service"), "main.js must expose the runtime guard service mode before normal app startup.");
  addIssue(issues, serviceGuard.visibleInWindowsServices === true, "Windows Service guard must remain visible in Windows service tools.");
  addIssue(issues, Array.isArray(serviceGuard.prohibitedBehaviors) && serviceGuard.prohibitedBehaviors.includes("block Task Manager"), "Windows Service guard manifest must forbid blocking Task Manager.");
  addIssue(issues, Array.isArray(serviceGuard.prohibitedBehaviors) && serviceGuard.prohibitedBehaviors.includes("disable Windows Security"), "Windows Service guard manifest must forbid disabling Windows Security.");

  addReleaseGate(issues, warnings, packageJson.version !== "0.1.0", "Release version is still 0.1.0.");
  addReleaseGate(issues, warnings, !/prototype/i.test(packageJson.description || ""), "package.json description still says prototype.");
  addReleaseGate(issues, warnings, appConfig.releaseMode === "production", "app-config releaseMode must be production before a paid release.");
  addReleaseGate(issues, warnings, appConfig.allowLocalDemoLicense === false, "Local demo license must be disabled before a paid release.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.websiteUrl) && !isPlaceholderUrl(appConfig.websiteUrl), "Production websiteUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.purchaseUrl) && !isPlaceholderUrl(appConfig.purchaseUrl), "Production purchaseUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.analyticsUrl) && !isPlaceholderUrl(appConfig.analyticsUrl), "Production analyticsUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.supportUrl) && !isPlaceholderUrl(appConfig.supportUrl), "Production supportUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.apiBaseUrl) && !isPlaceholderUrl(appConfig.apiBaseUrl), "Production apiBaseUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, isHttpsUrl(appConfig.updateManifestUrl) && !isPlaceholderUrl(appConfig.updateManifestUrl), "Production updateManifestUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, Boolean(appConfig.updatePublicKeyPem), "Production updatePublicKeyPem must be configured.");
  addReleaseGate(issues, warnings, Boolean(appConfig.runtimeSessionPublicKeyPem), "Production runtimeSessionPublicKeyPem must be configured for RSA runtime session proof verification.");
  addReleaseGate(issues, warnings, updateManifest.latest === packageJson.version, "Update manifest latest version must match package.json version before release.");
  addReleaseGate(issues, warnings, isHttpsUrl(updateManifest.downloadUrl) && !isPlaceholderUrl(updateManifest.downloadUrl), "Update manifest downloadUrl must be a real HTTPS URL.");
  addReleaseGate(issues, warnings, updateManifest.signatureAlgorithm === "RSA-SHA256" && Boolean(updateManifest.signature), "Update manifest must be signed before release.");
  addIssue(issues, publicReleaseNotesAreSafe(updateManifest.releaseNotes), "Update manifest releaseNotes must not contain internal protection, service, key, or packaging wording.");
  addReleaseGate(issues, warnings, Boolean(packageJson.devDependencies && packageJson.devDependencies["electron-builder"]), "electron-builder is not installed yet.");
  addReleaseGate(issues, warnings, build.asar === true, "Installer packaging should keep app files inside an asar archive.");
  addReleaseGate(issues, warnings, JSON.stringify(build.asarUnpack || []).includes("runtime-guard-core"), "Runtime guard core must stay unpacked for packaged watchdog execution.");
  addReleaseGate(issues, warnings, JSON.stringify(build.asarUnpack || []).includes("runtime-watchdog"), "Runtime watchdog must stay unpacked for packaged cleanup execution.");
  addReleaseGate(issues, warnings, serviceGuard.nativeServiceWrapperStatus === "implemented", "Native Windows Service wrapper is not implemented yet; Electron worker mode is ready for the installer entry.");
  addReleaseGate(issues, warnings, fileExists("build/icon.ico"), "Final Windows icon is not configured at build/icon.ico.");
  addReleaseGate(issues, warnings, hasStrongCodeSigningSignal(), "Windows code-signing certificate environment is not configured in this shell.");

  printResult({ issues, warnings, packageJson, appConfig });
}

function printResult({ issues, warnings, packageJson, appConfig }) {
  console.log("ZeroLag release preflight");
  console.log(`Version: ${packageJson.version || "unknown"}`);
  console.log(`Mode: ${appConfig.releaseMode || "unknown"}`);
  console.log(`Strict: ${strict ? "yes" : "no"}`);

  if (warnings.length) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (issues.length) {
    console.log("\nBlocking issues:");
    for (const issue of issues) console.log(`- ${issue}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nRelease preflight passed with ${warnings.length} warning(s).`);
}

main();
