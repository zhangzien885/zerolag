const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { inspectSigningEnv } = require("./check-code-signing-env");
const { checkServerEnvFile } = require("./check-server-env");
const { isRealHttpsUrl } = require("./release-url-policy");
const { defaultServerEnvPath } = require("../server/env");

const rootDir = path.join(__dirname, "..");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/release-status.js [--json] [--no-git]");
  console.log("");
  console.log("Shows a beginner-friendly formal release status dashboard without printing secrets.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function safeRelative(filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(rootDir, resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(resolved)} (external)`;
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  });
  return result.status === 0 ? String(result.stdout || "").trim().split(/\r?\n/)[0] : "";
}

function dotnetVersion() {
  const direct = commandVersion("dotnet", ["--version"]);
  if (direct) return direct;
  if (process.platform !== "win32") return "";

  const defaultDotnet = path.join(process.env.ProgramFiles || "C:\\Program Files", "dotnet", "dotnet.exe");
  return fs.existsSync(defaultDotnet) ? commandVersion(defaultDotnet, ["--version"]) : "";
}

function gitClean(noGit) {
  if (noGit) return { checked: false, clean: true, detail: "skipped" };

  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  });
  if (result.status !== 0) return { checked: true, clean: false, detail: "git status failed" };

  const changed = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  return {
    checked: true,
    clean: changed.length === 0,
    detail: changed.length ? `${changed.length} changed file(s)` : "clean"
  };
}

function item(id, label, ok, detail, nextStep, severity = "blocker") {
  return {
    id,
    label,
    ok: Boolean(ok),
    detail: String(detail || ""),
    nextStep: String(nextStep || ""),
    severity
  };
}

function group(id, title, items) {
  const blocking = items.filter((entry) => !entry.ok && entry.severity === "blocker");
  const warnings = items.filter((entry) => !entry.ok && entry.severity === "warning");
  return {
    id,
    title,
    ready: blocking.length === 0 && warnings.length === 0,
    okCount: items.filter((entry) => entry.ok).length,
    total: items.length,
    blockingCount: blocking.length,
    warningCount: warnings.length,
    items
  };
}

function urlCount(appConfig) {
  const fields = ["websiteUrl", "purchaseUrl", "analyticsUrl", "supportUrl", "apiBaseUrl", "updateManifestUrl"];
  return {
    configured: fields.filter((field) => isRealHttpsUrl(appConfig[field])).length,
    total: fields.length
  };
}

function serverSummary(serverEnvPath) {
  if (!exists(serverEnvPath)) {
    return {
      exists: false,
      ok: false,
      warningCount: 0,
      issueCount: 1,
      summary: {}
    };
  }

  const status = checkServerEnvFile(serverEnvPath, { profile: "sqlite", strict: true });
  return {
    exists: true,
    ok: status.ok,
    warningCount: status.warnings.length,
    issueCount: status.issues.length,
    summary: status.summary || {}
  };
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function resolveInstallerPath(installer, releaseArtifactsPath) {
  const candidates = [];
  if (installer.path) {
    candidates.push(path.isAbsolute(installer.path) ? installer.path : path.resolve(rootDir, installer.path));
    candidates.push(path.resolve(path.dirname(releaseArtifactsPath), installer.path));
  }
  if (installer.file) {
    candidates.push(path.resolve(path.dirname(releaseArtifactsPath), installer.file));
    candidates.push(path.join(rootDir, "dist", installer.file));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || "";
}

function firstInstaller(releaseArtifacts, releaseArtifactsPath, packageVersion) {
  const installer = releaseArtifacts.installer || {};
  const filePath = resolveInstallerPath(installer, releaseArtifactsPath);
  const existsOnDisk = Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  const actualSha256 = existsOnDisk ? sha256File(filePath) : "";
  const hashMatches = Boolean(installer.sha256 && actualSha256 && installer.sha256 === actualSha256);
  const versionMatches = releaseArtifacts.version === packageVersion;
  return {
    file: installer.file || "",
    filePath,
    sha256: installer.sha256 || "",
    actualSha256,
    size: installer.size || 0,
    existsOnDisk,
    hashMatches,
    versionMatches,
    ok: Boolean(installer.file && installer.sha256 && existsOnDisk && hashMatches && versionMatches)
  };
}

function collectReleaseStatus(input = {}) {
  const packageJsonPath = path.resolve(input.packageJsonPath || argValue("--package-json", path.join(rootDir, "package.json")));
  const appConfigPath = path.resolve(input.appConfigPath || argValue("--app-config", path.join(rootDir, "assets", "app-config.json")));
  const updateManifestPath = path.resolve(input.updateManifestPath || argValue("--update-manifest", path.join(rootDir, "assets", "update.json")));
  const releaseArtifactsPath = path.resolve(input.releaseArtifactsPath || argValue("--release-artifacts", path.join(rootDir, "dist", "release-artifacts.json")));
  const websiteReleasePath = path.resolve(input.websiteReleasePath || argValue("--website-release", path.join(rootDir, "website", "release.json")));
  const serviceGuardPath = path.resolve(input.serviceGuardPath || argValue("--service-guard", path.join(rootDir, "build", "service-guard.json")));
  const serverEnvPath = path.resolve(input.serverEnvPath || argValue("--server-env", process.env.ZEROLAG_ENV_FILE || defaultServerEnvPath));
  const wrapperOutputArg = input.wrapperOutputPath || argValue("--wrapper-output", "");
  const noGit = input.noGit === true || process.argv.includes("--no-git");
  const packageJson = readJson(packageJsonPath);
  const appConfig = readJson(appConfigPath);
  const updateManifest = readJson(updateManifestPath);
  const releaseArtifacts = readJson(releaseArtifactsPath);
  const websiteRelease = readJson(websiteReleasePath);
  const serviceGuard = readJson(serviceGuardPath);
  const scripts = packageJson.scripts || {};
  const version = packageJson.version || "missing";
  const urls = urlCount(appConfig);
  const signing = inspectSigningEnv(input.env || process.env, {
    envFile: input.codeSigningEnvPath || argValue("--codesign-env", "")
  });
  const server = serverSummary(serverEnvPath);
  const paymentProvider = server.summary.paymentProvider || "missing";
  const paymentConfigured = paymentProvider !== "manual" && paymentProvider !== "missing" && Boolean(server.summary.paymentProviderCredentialsConfigured);
  const runtimeProof = server.summary.runtimeSessionProofAlgorithm || "missing";
  const installer = firstInstaller(releaseArtifacts, releaseArtifactsPath, version);
  const wrapperOutput = wrapperOutputArg
    ? path.resolve(wrapperOutputArg)
    : serviceGuard.nativeServiceWrapperOutput
    ? path.join(rootDir, serviceGuard.nativeServiceWrapperOutput)
    : path.join(rootDir, "build", "native-service", "dist", "ZeroLag.RuntimeGuard.Service.exe");
  const git = gitClean(noGit);
  const dotnet = input.dotnetVersion || argValue("--dotnet-version", "") || dotnetVersion();

  const groups = [
    group("desktop", "桌面客户端", [
      item("version", "正式版本号", version !== "0.1.0", version, "发布前把版本号从 0.1.0 升到真实版本，例如 npm run release:version -- --version 1.0.0 --write", "warning"),
      item("release-mode", "生产模式", appConfig.releaseMode === "production", appConfig.releaseMode || "missing", "正式发布前运行 npm run production:mode -- --mode production --write"),
      item("public-urls", "官网/API/CDN 地址", urls.configured === urls.total, `${urls.configured}/${urls.total} configured`, "买好域名后运行 npm run production:config -- --domain 你的域名 --write"),
      item("local-demo", "本地演示会员关闭", appConfig.allowLocalDemoLicense === false, String(appConfig.allowLocalDemoLicense), "正式版必须保持 allowLocalDemoLicense=false"),
      item("runtime-public-key", "运行期会话公钥", Boolean(appConfig.runtimeSessionPublicKeyPem), appConfig.runtimeSessionPublicKeyPem ? "configured" : "missing", "运行 npm run runtime:keys 后用 npm run app-config:snippet 写入公钥"),
      item("update-public-key", "更新验签公钥", Boolean(appConfig.updatePublicKeyPem), appConfig.updatePublicKeyPem ? "configured" : "missing", "生成更新签名密钥后用 npm run app-config:snippet 写入公钥")
    ]),
    group("account-server", "账号会员服务", [
      item("server-env", "私有服务端配置", server.exists, server.exists ? safeRelative(serverEnvPath) : "missing", "先运行 npm run server:provision-local，正式上线前再换成服务器私有 env"),
      item("server-env-valid", "服务端配置校验", server.ok, `${server.issueCount} issue(s), ${server.warningCount} warning(s)`, "运行 npm run server:env-check -- --profile sqlite --strict 处理服务端配置问题"),
      item("sqlite", "SQLite 状态存储", server.summary.stateStore === "sqlite", server.summary.stateStore || "missing", "正式版建议使用 SQLite：ZEROLAG_STATE_STORE=sqlite"),
      item("runtime-proof", "账号会话 RSA 校验", runtimeProof === "RSA-SHA256", runtimeProof, "正式版使用 RSA-SHA256，避免把客户端变成可信来源"),
      item("server-guards", "限流/备份/维护保护", server.summary.rateLimitEnabled && server.summary.backupsEnabled && server.summary.maintenanceEnabled, `rate=${Boolean(server.summary.rateLimitEnabled)}, backup=${Boolean(server.summary.backupsEnabled)}, maintenance=${Boolean(server.summary.maintenanceEnabled)}`, "保持限流、备份、维护开关启用")
    ]),
    group("payment", "支付和会员", [
      item("payment-provider", "正式支付渠道", paymentProvider !== "manual" && paymentProvider !== "missing", paymentProvider, "接入微信支付或支付宝后设置 ZEROLAG_PAYMENT_PROVIDER"),
      item("payment-credentials", "支付商户密钥", paymentConfigured, paymentConfigured ? "configured" : "missing", "补齐微信/支付宝商户号、应用 ID、证书和私钥路径"),
      item("payment-loop", "支付闭环测试", Boolean(scripts["server:payment-loop:smoke"]), scripts["server:payment-loop:smoke"] ? "covered by CI" : "missing", "保留 npm run server:payment-loop:smoke，确保下单、支付、退款都可测")
    ]),
    group("update-release", "更新和发布", [
      item("installer-artifact", "安装包工件", installer.ok, installer.ok ? installer.file : `file=${installer.file || "missing"}; disk=${installer.existsOnDisk ? "yes" : "no"}; version=${installer.versionMatches ? "match" : "mismatch"}; sha256=${installer.hashMatches ? "match" : "mismatch"}`, "运行 npm run release:rehearsal 或 npm run release:build 生成安装包"),
      item("update-version", "更新版本匹配", updateManifest.latest === version, `manifest=${updateManifest.latest || "missing"}; package=${version}`, "运行 npm run release:version 和 npm run update:prepare"),
      item("update-signature", "更新清单签名", updateManifest.signatureAlgorithm === "RSA-SHA256" && Boolean(updateManifest.signature), updateManifest.signature ? "signed" : "missing", "运行 npm run update:prepare 或 npm run update:sign"),
      item("download-url", "更新下载地址", isRealHttpsUrl(updateManifest.downloadUrl), updateManifest.downloadUrl || "missing", "真实 CDN 准备好后重新生成 update.json"),
      item("website-release", "官网发布数据", Boolean(websiteRelease.downloadReady), websiteRelease.status || "preparing", "运行 npm run website:release，并确认官网展示真实下载链接"),
      item("rehearsal-command", "本地发布演练", Boolean(scripts["release:rehearsal"]), scripts["release:rehearsal"] ? "available" : "missing", "保留 npm run release:rehearsal")
    ]),
    group("build-signing", "签名和安装", [
      item("dotnet", ".NET 8 SDK", /^([8-9]|\d{2,})\./.test(dotnet), dotnet || "missing", "安装 .NET 8 SDK，用于构建 Windows 服务包装器"),
      item("service-wrapper", "Windows 服务包装器", exists(wrapperOutput), safeRelative(wrapperOutput), "运行 npm run guard:wrapper:build"),
      item("test-signing", "本地测试签名", signing.ok, `profile=${signing.profile}; source=${signing.certificateSource}`, "运行 npm run signing:test-cert"),
      item("production-signing", "正式代码签名", signing.productionReady, `profile=${signing.profile}`, "购买正式代码签名证书后配置 CSC_LINK/CSC_KEY_PASSWORD", "warning")
    ]),
    group("operations", "上线前运维", [
      item("git-clean", "Git 工作区干净", git.clean, git.detail, "提交或暂存所有改动后再切正式包"),
      item("ci", "完整 CI 命令", Boolean(scripts.ci), scripts.ci ? "available" : "missing", "保留 npm run ci"),
      item("preflight", "正式发布闸门", Boolean(scripts["release:preflight:strict"]), scripts["release:preflight:strict"] ? "available" : "missing", "正式发布前必须跑 npm run release:preflight:strict"),
      item("server-report", "服务端部署报告", Boolean(scripts["server:deployment-report:strict"]), scripts["server:deployment-report:strict"] ? "available" : "missing", "部署服务器前跑 npm run server:deployment-report:strict")
    ])
  ];

  const allItems = groups.flatMap((entry) => entry.items);
  const blockers = allItems.filter((entry) => !entry.ok && entry.severity === "blocker");
  const warnings = allItems.filter((entry) => !entry.ok && entry.severity === "warning");
  const nextSteps = allItems
    .filter((entry) => !entry.ok && entry.nextStep)
    .map((entry) => entry.nextStep)
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .slice(0, 8);

  return {
    ok: blockers.length === 0 && warnings.length === 0,
    publicReleaseReady: blockers.length === 0 && warnings.length === 0,
    localRehearsalReady: Boolean(scripts["release:rehearsal"]) && signing.ok && installer.ok,
    generatedAt: new Date().toISOString(),
    version,
    summary: {
      readyItems: allItems.filter((entry) => entry.ok).length,
      totalItems: allItems.length,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      groupsReady: groups.filter((entry) => entry.ready).length,
      groupCount: groups.length
    },
    files: {
      packageJson: safeRelative(packageJsonPath),
      appConfig: safeRelative(appConfigPath),
      updateManifest: safeRelative(updateManifestPath),
      releaseArtifacts: exists(releaseArtifactsPath) ? safeRelative(releaseArtifactsPath) : "missing",
      websiteRelease: exists(websiteReleasePath) ? safeRelative(websiteReleasePath) : "missing",
      serverEnv: exists(serverEnvPath) ? safeRelative(serverEnvPath) : "missing"
    },
    groups,
    nextSteps
  };
}

function marker(entry) {
  if (entry.ok) return "OK";
  return entry.severity === "warning" ? "WARN" : "TODO";
}

function printHuman(status) {
  console.log("ZeroLag 正式版状态面板");
  console.log(`正式上线：${status.publicReleaseReady ? "可以准备发布" : `还差 ${status.summary.blockerCount} 个阻塞项，${status.summary.warningCount} 个提醒项`}`);
  console.log(`本地发布演练：${status.localRehearsalReady ? "可用" : "还不可用"}`);
  console.log(`总体进度：${status.summary.readyItems}/${status.summary.totalItems}`);

  for (const entryGroup of status.groups) {
    console.log("");
    console.log(`[${entryGroup.title}] ${entryGroup.okCount}/${entryGroup.total}`);
    for (const entry of entryGroup.items) {
      console.log(`- ${marker(entry)} ${entry.label}: ${entry.detail}`);
    }
  }

  if (status.nextSteps.length) {
    console.log("");
    console.log("建议下一步：");
    status.nextSteps.forEach((step, index) => console.log(`${index + 1}. ${step}`));
  }
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const status = collectReleaseStatus();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  printHuman(status);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectReleaseStatus,
  isRealHttpsUrl
};
