const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const manifestPath = path.join(rootDir, "build", "service-guard.json");
const csprojPath = path.join(rootDir, "build", "native-service", "ZeroLag.RuntimeGuard.Service.csproj");
const programPath = path.join(rootDir, "build", "native-service", "Program.cs");
const installScriptPath = path.join(rootDir, "build", "install-runtime-guard-service.ps1");
const hookPath = path.join(rootDir, "build", "installer-guard.nsh");
const buildScriptPath = path.join(rootDir, "scripts", "build-native-service-wrapper.js");
const packageJsonPath = path.join(rootDir, "package.json");

const forbiddenText = [
  "taskkill",
  "Set-MpPreference",
  "DisableRealtimeMonitoring",
  "netsh advfirewall set allprofiles state off",
  "Remove-Item -Recurse",
  "reg add",
  "block Task Manager",
  "disable antivirus",
  "disable firewall",
  "disable Windows Security"
];

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function readText(filePath) {
  assertOk(fs.existsSync(filePath), `Missing file: ${path.relative(rootDir, filePath)}`);
  return fs.readFileSync(filePath, "utf8");
}

function assertIncludes(text, pattern, message) {
  assertOk(text.includes(pattern), message);
}

function assertNoForbiddenText(text, label) {
  const lower = text.toLowerCase();
  for (const pattern of forbiddenText) {
    assertOk(!lower.includes(pattern.toLowerCase()), `${label} contains forbidden operation: ${pattern}`);
  }
}

function runBuildScriptDryRun() {
  const result = spawnSync(process.execPath, [buildScriptPath, "--dry-run", "--optional", "--json"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assertOk(result.status === 0, `Wrapper build dry-run failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function main() {
  const manifest = JSON.parse(readText(manifestPath));
  const csproj = readText(csprojPath);
  const program = readText(programPath);
  const installScript = readText(installScriptPath);
  const hook = readText(hookPath);
  const buildScript = readText(buildScriptPath);
  const packageJson = JSON.parse(readText(packageJsonPath));
  const dryRun = runBuildScriptDryRun();

  assertOk(manifest.nativeServiceWrapperStatus === "implemented", "Manifest must mark the native service wrapper as implemented after local validation.");
  assertOk(manifest.serviceBinary === "ZeroLag.RuntimeGuard.Service.exe", "Manifest must use the native service wrapper as the service binary.");
  assertOk(manifest.desktopWorkerBinary === "ZeroLag.exe", "Manifest must keep the desktop worker binary explicit.");
  assertOk(manifest.serviceBinaryStatus === "native-wrapper-exe", "Manifest must use the native wrapper executable status.");
  assertOk(manifest.nativeServiceWrapperSource === "build/native-service", "Manifest must point to wrapper source.");
  assertOk(manifest.nativeServiceWrapperBuildScript === "scripts/build-native-service-wrapper.js", "Manifest must point to wrapper build script.");
  assertOk(manifest.nativeServiceWrapperOutput === "build/native-service/dist/ZeroLag.RuntimeGuard.Service.exe", "Manifest must point to wrapper build output.");

  assertIncludes(csproj, "net8.0-windows", "Native wrapper must target Windows.");
  assertIncludes(csproj, "System.ServiceProcess.ServiceController", "Native wrapper must reference Windows Service APIs.");
  assertIncludes(program, "ServiceBase", "Native wrapper must implement a Windows Service entry.");
  assertIncludes(program, "--worker-binary", "Native wrapper must receive the installed ZeroLag worker path.");
  assertIncludes(program, "--runtime-guard-service", "Native wrapper must start ZeroLag in runtime guard service mode.");
  assertIncludes(program, "Kill(entireProcessTree: true)", "Native wrapper must stop only its own worker process tree.");
  assertNoForbiddenText(program, "Native wrapper source");

  assertIncludes(buildScript, "dotnet", "Build script must publish the wrapper with dotnet.");
  assertIncludes(buildScript, "--optional", "Build script must support optional CI-safe validation.");
  assertOk(dryRun.output === "build/native-service/dist/ZeroLag.RuntimeGuard.Service.exe", "Dry-run must report the expected wrapper output.");
  assertOk(dryRun.command.includes("dotnet publish"), "Dry-run must report the publish command.");

  assertIncludes(installScript, "$WrapperBinary", "Install script must accept a native wrapper binary path.");
  assertIncludes(installScript, "--worker-binary", "Install script must pass the desktop worker path into the wrapper.");
  assertIncludes(installScript, "npm run guard:wrapper:build", "Install script must tell operators how to build the wrapper.");
  assertIncludes(installScript, "AllowElectronWorkerService", "Install script must keep the private Electron-worker validation escape hatch.");
  assertIncludes(hook, "-WrapperBinary", "Installer hook must pass the native wrapper path to service registration.");
  assertIncludes(hook, "ZeroLag.RuntimeGuard.Service.exe", "Installer hook must name the native wrapper executable.");
  assertOk(!hook.includes("-AllowElectronWorkerService"), "Final installer hook must not enable Electron-worker service mode by default.");

  assertOk(packageJson.scripts && packageJson.scripts["guard:wrapper:build"], "guard:wrapper:build script is missing.");
  assertOk(packageJson.scripts && packageJson.scripts["guard:wrapper:smoke"], "guard:wrapper:smoke script is missing.");
  assertOk(JSON.stringify(packageJson.build && packageJson.build.extraResources || []).includes("build/native-service/dist/ZeroLag.RuntimeGuard.Service.exe"), "Native wrapper exe must be packaged as an extra resource.");
  assertOk(JSON.stringify(packageJson.build && packageJson.build.extraResources || []).includes("service-guard/ZeroLag.RuntimeGuard.Service.exe"), "Native wrapper exe must land under service-guard resources.");
  assertOk((packageJson.scripts.check || "").includes("scripts/build-native-service-wrapper.js"), "npm run check must syntax-check the wrapper build script.");
  assertOk((packageJson.scripts.check || "").includes("scripts/native-service-wrapper-smoke-test.js"), "npm run check must syntax-check the wrapper smoke test.");
  assertOk((packageJson.scripts.ci || "").includes("npm run guard:wrapper:smoke"), "npm run ci must include native wrapper smoke coverage.");

  console.log("ZeroLag native service wrapper smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
