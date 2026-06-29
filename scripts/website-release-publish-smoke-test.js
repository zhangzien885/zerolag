const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const rootDir = path.join(__dirname, "..");
const publisherPath = path.join(rootDir, "scripts", "publish-website-release.js");

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeRemoveTemp(tempDir) {
  const resolvedTemp = path.resolve(os.tmpdir());
  const resolvedTarget = path.resolve(tempDir);
  if (!resolvedTarget.startsWith(resolvedTemp) || !path.basename(resolvedTarget).startsWith("zerolag-website-release-")) {
    throw new Error(`Refusing to remove unexpected temp path: ${tempDir}`);
  }

  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

function runPublisher(paths) {
  cp.execFileSync(process.execPath, [publisherPath], {
    cwd: rootDir,
    env: {
      ...process.env,
      ZEROLAG_RELEASE_ARTIFACTS_PATH: paths.artifacts,
      ZEROLAG_RELEASE_REPORT_PATH: paths.report,
      ZEROLAG_UPDATE_MANIFEST_PATH: paths.update,
      ZEROLAG_APP_CONFIG_PATH: paths.config,
      ZEROLAG_WEBSITE_RELEASE_PATH: paths.output
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function scenarioPaths(tempDir, name) {
  const scenarioDir = path.join(tempDir, name);
  return {
    artifacts: path.join(scenarioDir, "release-artifacts.json"),
    report: path.join(scenarioDir, "release-candidate-report.json"),
    update: path.join(scenarioDir, "update.json"),
    config: path.join(scenarioDir, "app-config.json"),
    output: path.join(scenarioDir, "website-release.json")
  };
}

function writeCommonArtifacts(paths) {
  writeJson(paths.artifacts, {
    productName: "ZeroLag",
    version: "1.2.3",
    channel: "stable",
    installer: {
      file: "ZeroLag Setup 1.2.3.exe",
      size: 42 * 1024 * 1024,
      sha256: "a".repeat(64)
    },
    updateMetadata: {
      file: "latest.yml",
      sha256: "b".repeat(64),
      releaseDate: "2026-06-28T00:00:00.000Z"
    }
  });

  writeJson(paths.report, {
    readiness: [
      { name: "Release mode", ok: true },
      { name: "Installer artifacts", ok: true },
      { name: "Windows signing", ok: false }
    ]
  });
}

function testAvailableRelease(tempDir) {
  const paths = scenarioPaths(tempDir, "available");
  writeCommonArtifacts(paths);
  writeJson(paths.update, {
    latest: "1.2.3",
    downloadUrl: "https://cdn.zerolag.app/releases/ZeroLag-Setup-1.2.3.exe",
    releaseNotes: [
      "Startup feels smoother",
      "",
      42,
      "Internal watchdog cleanup improved",
      "\u4fdd\u62a4\u7b56\u7565\u5df2\u8c03\u6574",
      "Checksum info updated",
      "x".repeat(180)
    ]
  });
  writeJson(paths.config, {
    releaseChannel: "stable",
    purchaseUrl: "https://zerolag.app/buy",
    analyticsUrl: "https://zerolag.app/analytics",
    supportUrl: "https://zerolag.app/support"
  });

  runPublisher(paths);

  const output = readJson(paths.output);
  assertOk(output.status === "available", "Available fixture should publish available status.");
  assertOk(output.downloadReady === true, "Available fixture should be download ready.");
  assertOk(output.downloadUrl === "https://cdn.zerolag.app/releases/ZeroLag-Setup-1.2.3.exe", "Download URL was not preserved.");
  assertOk(output.purchaseUrl === "https://zerolag.app/buy", "Purchase URL was not preserved.");
  assertOk(output.analyticsUrl === "https://zerolag.app/analytics", "Analytics URL was not preserved.");
  assertOk(output.supportUrl === "https://zerolag.app/support", "Support URL was not preserved.");
  assertOk(output.installer.file === "ZeroLag Setup 1.2.3.exe", "Installer filename was not preserved.");
  assertOk(output.installer.size === 42 * 1024 * 1024, "Installer size was not preserved.");
  assertOk(output.installer.sha256 === "a".repeat(64), "Installer checksum was not preserved.");
  assertOk(output.updateMetadata.sha256 === "b".repeat(64), "Update metadata checksum was not preserved.");
  assertOk(output.readiness.ok === 2 && output.readiness.total === 3, "Readiness summary is incorrect.");
  assertOk(output.releaseNotes.length === 3, "Release notes should keep only public non-empty strings.");
  assertOk(output.releaseNotes[0] === "Startup feels smoother", "First release note was not preserved.");
  assertOk(output.releaseNotes[1] === "Checksum info updated", "Second release note was not preserved.");
  assertOk(output.releaseNotes[2].length === 160 && output.releaseNotes[2].endsWith("..."), "Long release notes should be truncated.");
  assertOk(!JSON.stringify(output.releaseNotes).toLowerCase().includes("watchdog"), "Internal watchdog release notes must be filtered.");
  assertOk(!JSON.stringify(output.releaseNotes).includes("\u4fdd\u62a4\u7b56\u7565"), "Internal protection-strategy release notes must be filtered.");
}

function testPreparingRelease(tempDir) {
  const paths = scenarioPaths(tempDir, "preparing");
  writeCommonArtifacts(paths);
  writeJson(paths.update, {
    latest: "1.2.3",
    downloadUrl: "https://example.com/zerolag/download",
    releaseNotes: []
  });
  writeJson(paths.config, {
    releaseChannel: "stable",
    purchaseUrl: "https://example.com/buy",
    analyticsUrl: "https://example.com/analytics",
    supportUrl: "https://example.com/support"
  });

  runPublisher(paths);

  const output = readJson(paths.output);
  assertOk(output.status === "preparing", "Placeholder download fixture should publish preparing status.");
  assertOk(output.downloadReady === false, "Placeholder download fixture must not be download ready.");
  assertOk(output.downloadUrl === "", "Placeholder download URL must be removed.");
  assertOk(output.purchaseUrl === "", "Placeholder purchase URL must be removed.");
  assertOk(output.analyticsUrl === "", "Placeholder analytics URL must be removed.");
  assertOk(output.supportUrl === "", "Placeholder support URL must be removed.");
  assertOk(output.installer.sha256 === "a".repeat(64), "Installer checksum should still be carried for internal verification.");
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-website-release-"));

  try {
    testAvailableRelease(tempDir);
    testPreparingRelease(tempDir);
  } finally {
    safeRemoveTemp(tempDir);
  }

  console.log("ZeroLag website release publish smoke test passed.");
  console.log("Scenarios: available, preparing");
}

main();
