const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { generateTestCodeSigningCert } = require("./generate-test-code-signing-cert");
const { generateRuntimeSessionKeys } = require("./generate-runtime-session-keys");
const { applyAppConfigSnippet } = require("./apply-app-config-snippet");
const { prepareProductionConfig } = require("./prepare-production-config");
const { prepareUpdateManifest } = require("./prepare-update-manifest");

const rootDir = path.join(__dirname, "..");
const appConfigPath = path.join(rootDir, "assets", "app-config.json");
const updateManifestPath = path.join(rootDir, "assets", "update.json");
const distDir = path.join(rootDir, "dist");
const defaultRehearsalDir = path.join(distDir, "release-rehearsal");
const testSigningDir = path.join(rootDir, ".secrets", "codesign");
const testSigningEnvPath = path.join(testSigningDir, "test-signing.env");
const testSigningPfxPath = path.join(testSigningDir, "zerolag-test-codesign.pfx");
const updatePrivateKeyPath = path.join(rootDir, ".secrets", "update-private.pem");
const updatePublicKeyPath = path.join(rootDir, ".secrets", "update-public.pem");
const updateAppConfigSnippetPath = path.join(rootDir, ".secrets", "update-app-config-snippet.json");
const runtimeKeyDir = path.join(rootDir, ".secrets", "runtime-session");
const runtimeKeyVersion = "runtime-session-v1";
const runtimeAppConfigSnippetPath = path.join(runtimeKeyDir, `${runtimeKeyVersion}.app-config-snippet.json`);

function usage() {
  console.log("Usage:");
  console.log("  node scripts/local-release-rehearsal.js [--domain zerolag.example.com] [--api-domain api.zerolag.example.com] [--cdn-domain cdn.zerolag.example.com] [--skip-build] [--dry-run] [--json]");
  console.log("");
  console.log("Runs a local release rehearsal with placeholder domains and local test signing.");
  console.log("Tracked app config is restored after the package build finishes.");
}

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(filePath)} (external)`;
}

function loadEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    env[line.slice(0, separator)] = line.slice(separator + 1);
  }

  return env;
}

function runStep(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true
  });

  if (result.status !== 0) {
    const commandError = result.error ? result.error.message : "";
    const details = options.quiet
      ? [result.stdout, result.stderr].filter(Boolean).join("\n")
      : "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}${commandError ? `\n${commandError}` : ""}${details ? `\n${details}` : ""}`);
  }

  return result;
}

function renderArtifactName(packageJson, ext = "exe") {
  const build = packageJson.build || {};
  const productName = build.productName || "ZeroLag";
  const template = build.artifactName || "${productName}-Setup-${version}.${ext}";
  return template
    .replace(/\$\{productName\}/g, productName)
    .replace(/\$\{version\}/g, packageJson.version || "0.0.0")
    .replace(/\$\{ext\}/g, ext);
}

function buildPlan(input = {}) {
  const domain = input.domain || "zerolag.example.com";
  const apiDomain = input.apiDomain || `api.${domain}`;
  const cdnDomain = input.cdnDomain || `cdn.${domain}`;
  const packageJson = readJson(path.join(rootDir, "package.json"));
  const installerName = renderArtifactName(packageJson, "exe");
  const rehearsalDir = path.resolve(input.outputDir || defaultRehearsalDir);

  return {
    dryRun: input.dryRun === true,
    skipBuild: input.skipBuild === true,
    domain,
    apiDomain,
    cdnDomain,
    installerName,
    baseUrl: `https://${cdnDomain}/releases`,
    rehearsalDir,
    files: {
      stagedAppConfig: path.join(rehearsalDir, "app-config.json"),
      stagedUpdateManifest: path.join(rehearsalDir, "update.json"),
      stagedWebsiteRelease: path.join(rehearsalDir, "website-release.json"),
      summary: path.join(rehearsalDir, "summary.json"),
      releaseArtifacts: path.join(distDir, "release-artifacts.json")
    },
    steps: [
      "ensure local test code-signing certificate",
      "ensure update signing keypair",
      "ensure runtime session keypair",
      "temporarily apply placeholder production desktop config",
      input.skipBuild ? "reuse existing Windows installer" : "build Windows NSIS installer with test signing",
      "verify installer metadata",
      "generate release artifacts and release report",
      "prepare signed staged update manifest",
      "publish staged website release manifest",
      "restore tracked app config"
    ]
  };
}

function ensureTestSigning() {
  if (fs.existsSync(testSigningPfxPath) && fs.existsSync(testSigningEnvPath)) {
    return { generated: false, envPath: testSigningEnvPath };
  }

  generateTestCodeSigningCert({ outputDir: testSigningDir });
  return { generated: true, envPath: testSigningEnvPath };
}

function ensureUpdateKeys() {
  if (fs.existsSync(updatePrivateKeyPath) && fs.existsSync(updatePublicKeyPath) && fs.existsSync(updateAppConfigSnippetPath)) {
    return { generated: false };
  }

  runStep(process.execPath, [
    path.join(rootDir, "scripts", "sign-update-manifest.js"),
    "--generate-keypair",
    updatePrivateKeyPath,
    updatePublicKeyPath,
    "--app-config-snippet",
    updateAppConfigSnippetPath
  ], { quiet: true });
  return { generated: true };
}

function ensureRuntimeKeys() {
  if (fs.existsSync(runtimeAppConfigSnippetPath)) {
    return { generated: false };
  }

  generateRuntimeSessionKeys({
    outputDir: runtimeKeyDir,
    keyVersion: runtimeKeyVersion
  });
  return { generated: true };
}

function preserveFile(filePath) {
  return {
    filePath,
    existed: fs.existsSync(filePath),
    content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
  };
}

function restoreFile(snapshot) {
  if (snapshot.existed) {
    fs.writeFileSync(snapshot.filePath, snapshot.content);
    return;
  }

  fs.rmSync(snapshot.filePath, { force: true });
}

function applyTemporaryAppConfig(plan) {
  fs.mkdirSync(plan.rehearsalDir, { recursive: true });
  fs.copyFileSync(updateManifestPath, plan.files.stagedUpdateManifest);

  prepareProductionConfig({
    domain: plan.domain,
    apiDomain: plan.apiDomain,
    cdnDomain: plan.cdnDomain,
    installerName: plan.installerName,
    allowPlaceholder: true,
    configPath: appConfigPath,
    updatePath: plan.files.stagedUpdateManifest,
    write: true
  });
  applyAppConfigSnippet({
    snippetPath: updateAppConfigSnippetPath,
    configPath: appConfigPath,
    write: true
  });
  applyAppConfigSnippet({
    snippetPath: runtimeAppConfigSnippetPath,
    configPath: appConfigPath,
    write: true
  });
  fs.copyFileSync(appConfigPath, plan.files.stagedAppConfig);
}

function buildInstallerWithTestSigning(signingEnv) {
  runStep(path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder"), [
    "--win",
    "nsis",
    "--x64",
    "--publish",
    "never"
  ], {
    env: signingEnv
  });
}

function runLocalReleaseRehearsal(input = {}) {
  const plan = buildPlan(input);
  if (plan.dryRun) {
    return {
      ok: true,
      dryRun: true,
      skipBuild: plan.skipBuild,
      domain: plan.domain,
      apiDomain: plan.apiDomain,
      cdnDomain: plan.cdnDomain,
      installerName: plan.installerName,
      outputDir: safeRelative(plan.rehearsalDir),
      steps: plan.steps,
      trackedFilesRestored: true
    };
  }

  const appConfigSnapshot = preserveFile(appConfigPath);
  const results = {};

  try {
    fs.mkdirSync(plan.rehearsalDir, { recursive: true });
    results.testSigning = ensureTestSigning();
    results.updateKeys = ensureUpdateKeys();
    results.runtimeKeys = ensureRuntimeKeys();
    applyTemporaryAppConfig(plan);

    const signingEnv = loadEnvFile(testSigningEnvPath);
    if (!signingEnv.CSC_LINK || !signingEnv.CSC_KEY_PASSWORD) {
      throw new Error("Local test signing env is incomplete. Run npm run signing:test-cert first.");
    }

    if (!plan.skipBuild) {
      buildInstallerWithTestSigning(signingEnv);
    }

    runStep(process.execPath, [path.join(rootDir, "scripts", "installer-smoke-test.js")]);
    runStep(process.execPath, [path.join(rootDir, "scripts", "generate-release-artifacts.js")]);
    runStep(process.execPath, [path.join(rootDir, "scripts", "generate-release-report.js")]);

    results.updateManifest = prepareUpdateManifest({
      baseUrl: plan.baseUrl,
      manifestPath: plan.files.stagedUpdateManifest,
      artifactsPath: plan.files.releaseArtifacts,
      privateKeyPath: updatePrivateKeyPath,
      publicKeyPath: updatePublicKeyPath,
      allowPlaceholder: true,
      write: true
    });

    runStep(process.execPath, [path.join(rootDir, "scripts", "publish-website-release.js")], {
      env: {
        ZEROLAG_APP_CONFIG_PATH: plan.files.stagedAppConfig,
        ZEROLAG_UPDATE_MANIFEST_PATH: plan.files.stagedUpdateManifest,
        ZEROLAG_WEBSITE_RELEASE_PATH: plan.files.stagedWebsiteRelease
      }
    });

    const releaseArtifacts = readJson(plan.files.releaseArtifacts);
    const websiteRelease = readJson(plan.files.stagedWebsiteRelease);
    const summary = {
      ok: true,
      generatedAt: new Date().toISOString(),
      mode: "local-release-rehearsal",
      domain: plan.domain,
      apiDomain: plan.apiDomain,
      cdnDomain: plan.cdnDomain,
      installer: releaseArtifacts.installer || {},
      updateManifest: {
        file: safeRelative(plan.files.stagedUpdateManifest),
        signed: Boolean(results.updateManifest.signed),
        verified: Boolean(results.updateManifest.verified),
        downloadUrl: results.updateManifest.downloadUrl
      },
      websiteRelease: {
        file: safeRelative(plan.files.stagedWebsiteRelease),
        status: websiteRelease.status || "",
        downloadReady: Boolean(websiteRelease.downloadReady)
      },
      outputDir: safeRelative(plan.rehearsalDir),
      warnings: [
        "This rehearsal uses placeholder domains and a local test certificate.",
        "It is not valid for a paid public release."
      ]
    };
    writeJson(plan.files.summary, summary);

    return summary;
  } finally {
    restoreFile(appConfigSnapshot);
  }
}

function printHumanSummary(result) {
  console.log("ZeroLag local release rehearsal finished.");
  console.log(`Output: ${result.outputDir}`);
  if (result.installer && result.installer.file) {
    console.log(`Installer: ${result.installer.file}`);
  }
  if (result.updateManifest) {
    console.log(`Update manifest: ${result.updateManifest.file}`);
    console.log(`Signature verified: ${result.updateManifest.verified ? "yes" : "no"}`);
  }
  if (result.websiteRelease) {
    console.log(`Website release: ${result.websiteRelease.file}`);
  }
  console.log("Reminder: this is a local rehearsal, not a paid public release.");
}

function main() {
  if (hasArg("--help")) {
    usage();
    return;
  }

  try {
    const result = runLocalReleaseRehearsal({
      domain: argValue("--domain", "zerolag.example.com"),
      apiDomain: argValue("--api-domain"),
      cdnDomain: argValue("--cdn-domain"),
      outputDir: argValue("--output-dir", defaultRehearsalDir),
      skipBuild: hasArg("--skip-build"),
      dryRun: hasArg("--dry-run")
    });

    if (hasArg("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.dryRun) {
      console.log("ZeroLag local release rehearsal dry-run.");
      for (const step of result.steps) console.log(`- ${step}`);
      return;
    }

    printHumanSummary(result);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildPlan,
  loadEnvFile,
  runLocalReleaseRehearsal
};
