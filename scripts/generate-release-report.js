const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const rootDir = path.join(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const packageJsonPath = path.join(rootDir, "package.json");
const appConfigPath = path.join(rootDir, "assets", "app-config.json");
const updateManifestPath = path.join(rootDir, "assets", "update.json");
const releaseArtifactsPath = path.join(distDir, "release-artifacts.json");

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeGit(args, fallback = "") {
  try {
    return cp.execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch (_error) {
    return fallback;
  }
}

function safeJsonCommand(command, args, fallback = {}) {
  try {
    return JSON.parse(cp.execFileSync(command, args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }));
  } catch (_error) {
    return fallback;
  }
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(String(value || ""));
}

function isPlaceholderUrl(value) {
  return /example\.com|localhost|127\.0\.0\.1/i.test(String(value || ""));
}

function status(ok) {
  return ok ? "OK" : "TODO";
}

function line(label, value) {
  return `| ${label} | ${value} |`;
}

function buildReadiness(packageJson, appConfig, updateManifest, releaseArtifacts) {
  const checks = [
    ["Release mode", appConfig.releaseMode === "production", "Set assets/app-config.json releaseMode to production"],
    ["Local demo disabled", appConfig.allowLocalDemoLicense === false, "Disable allowLocalDemoLicense before paid release"],
    ["Website URL", isHttpsUrl(appConfig.websiteUrl) && !isPlaceholderUrl(appConfig.websiteUrl), "Configure a real HTTPS websiteUrl"],
    ["Purchase URL", isHttpsUrl(appConfig.purchaseUrl) && !isPlaceholderUrl(appConfig.purchaseUrl), "Configure a real HTTPS purchaseUrl"],
    ["Analytics URL", isHttpsUrl(appConfig.analyticsUrl) && !isPlaceholderUrl(appConfig.analyticsUrl), "Configure a real HTTPS analyticsUrl"],
    ["Support URL", isHttpsUrl(appConfig.supportUrl) && !isPlaceholderUrl(appConfig.supportUrl), "Configure a real HTTPS supportUrl"],
    ["API URL", isHttpsUrl(appConfig.apiBaseUrl) && !isPlaceholderUrl(appConfig.apiBaseUrl), "Configure a real HTTPS apiBaseUrl"],
    ["Update manifest URL", isHttpsUrl(appConfig.updateManifestUrl) && !isPlaceholderUrl(appConfig.updateManifestUrl), "Configure a real HTTPS updateManifestUrl"],
    ["Update public key", Boolean(appConfig.updatePublicKeyPem), "Add production updatePublicKeyPem"],
    ["Manifest version", updateManifest.latest === packageJson.version, "Match assets/update.json latest with package.json version"],
    ["Manifest download URL", isHttpsUrl(updateManifest.downloadUrl) && !isPlaceholderUrl(updateManifest.downloadUrl), "Set a real HTTPS update downloadUrl"],
    ["Manifest signature", updateManifest.signatureAlgorithm === "RSA-SHA256" && Boolean(updateManifest.signature), "Sign assets/update.json"],
    ["Installer artifacts", Boolean(releaseArtifacts.installer && releaseArtifacts.installer.sha256), "Run npm run release:build or npm run release:verify"],
    ["Windows signing", Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK || process.env.WINDOWS_CODESIGN_CERT || process.env.ZEROLAG_CODESIGN_CERT), "Configure Windows code signing in the build environment"]
  ];

  return checks.map(([name, ok, nextStep]) => ({ name, ok, nextStep }));
}

function serverDeploymentReport() {
  return safeJsonCommand(process.execPath, [
    path.join(rootDir, "scripts", "generate-server-deployment-report.js"),
    "--json",
    "--stdout"
  ], {
    ready: false,
    gates: [],
    strictFailureSummary: "Server deployment report unavailable.",
    snapshot: {
      privateEnvFile: {}
    }
  });
}

function renderMarkdown(report) {
  const readyCount = report.readiness.filter((item) => item.ok).length;
  const serverGateCount = Array.isArray(report.serverDeployment.gates) ? report.serverDeployment.gates.length : 0;
  const serverReadyCount = Array.isArray(report.serverDeployment.gates)
    ? report.serverDeployment.gates.filter((item) => item.ok).length
    : 0;
  const lines = [
    "# ZeroLag Release Candidate Report",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    "| Item | Value |",
    "| --- | --- |",
    line("Product", report.productName),
    line("Version", report.version),
    line("Mode", report.releaseMode),
    line("Channel", report.channel),
    line("Git branch", report.git.branch),
    line("Git commit", report.git.commit),
    line("Working tree", report.git.dirty ? "DIRTY" : "clean"),
    line("Readiness", `${readyCount}/${report.readiness.length} checks OK`),
    line("Server deployment", `${serverReadyCount}/${serverGateCount} gates OK`),
    "",
    "## Installer",
    "",
    "| Item | Value |",
    "| --- | --- |",
    line("Installer", report.installer.file || "missing"),
    line("Size", report.installer.size ? `${report.installer.size} bytes` : "missing"),
    line("SHA256", report.installer.sha256 || "missing"),
    line("Artifact manifest", report.artifactManifestExists ? "present" : "missing"),
    "",
    "## Readiness Checks",
    "",
    "| Check | Status | Next step |",
    "| --- | --- | --- |",
    ...report.readiness.map((item) => `| ${item.name} | ${status(item.ok)} | ${item.ok ? "Ready" : item.nextStep} |`),
    "",
    "## Server Deployment Gates",
    "",
    "| Gate | Status | Detail |",
    "| --- | --- | --- |",
    ...(Array.isArray(report.serverDeployment.gates) && report.serverDeployment.gates.length
      ? report.serverDeployment.gates.map((item) => `| ${item.label} | ${status(item.ok)} | ${item.detail || ""} |`)
      : ["| Server deployment report | TODO | Run npm run server:deployment-report:json |"]),
    "",
    report.serverDeployment.ready ? "Server deployment strict gates are ready." : `Server deployment strict gate is not ready: ${report.serverDeployment.strictFailureSummary || "unknown"}`,
    "",
    "## Final Commands",
    "",
    "```powershell",
    "npm run ci",
    "npm run server:deployment-report:smoke",
    "npm run server:deployment-report:strict",
    "npm run production:check:strict",
    "npm run release:preflight:strict",
    "npm run release:build",
    "```",
    ""
  ];

  return lines.join("\n");
}

function main() {
  const packageJson = readJson(packageJsonPath);
  const appConfig = readJson(appConfigPath);
  const updateManifest = readJson(updateManifestPath);
  const releaseArtifacts = readJson(releaseArtifactsPath);
  const report = {
    productName: packageJson.build && packageJson.build.productName ? packageJson.build.productName : "ZeroLag",
    version: packageJson.version || "unknown",
    releaseMode: appConfig.releaseMode || "unknown",
    channel: appConfig.releaseChannel || "unknown",
    generatedAt: new Date().toISOString(),
    git: {
      branch: safeGit(["branch", "--show-current"], "unknown"),
      commit: safeGit(["rev-parse", "--short", "HEAD"], "unknown"),
      dirty: Boolean(safeGit(["status", "--short"], ""))
    },
    artifactManifestExists: fs.existsSync(releaseArtifactsPath),
    installer: releaseArtifacts.installer || {},
    serverDeployment: serverDeploymentReport(),
    readiness: buildReadiness(packageJson, appConfig, updateManifest, releaseArtifacts)
  };

  fs.mkdirSync(distDir, { recursive: true });
  const jsonPath = path.join(distDir, "release-candidate-report.json");
  const markdownPath = path.join(distDir, "release-candidate-report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");

  console.log("ZeroLag release candidate report generated.");
  console.log(`JSON: ${path.relative(rootDir, jsonPath)}`);
  console.log(`Markdown: ${path.relative(rootDir, markdownPath)}`);
}

main();
