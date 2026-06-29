const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "apply-app-config-snippet.js");
const publicKeyPem = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtesttesttesttesttest",
  "testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttest",
  "testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttest",
  "testtesttesttesttesttesttesttesttesttesttesttesttesttestIDAQAB",
  "-----END PUBLIC KEY-----"
].join("\n");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runNode(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== expectedStatus) {
    throw new Error([
      `Command failed: node ${args.join(" ")}`,
      `Expected exit: ${expectedStatus}`,
      `Actual exit: ${result.status}`,
      result.stdout.trim(),
      result.stderr.trim()
    ].filter(Boolean).join("\n"));
  }

  return result;
}

function safeRemoveTemp(tempRoot) {
  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-app-config-snippet-smoke-")) {
    throw new Error(`Refusing to remove unexpected temp path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-app-config-snippet-smoke-"));
  const configPath = path.join(tempRoot, "app-config.json");
  const snippetPath = path.join(tempRoot, "snippet.json");
  const privateSnippetPath = path.join(tempRoot, "private-snippet.json");
  const unknownSnippetPath = path.join(tempRoot, "unknown-snippet.json");

  try {
    writeJson(configPath, {
      releaseMode: "development",
      updatePublicKeyPem: "",
      runtimeSessionPublicKeyPem: ""
    });
    writeJson(snippetPath, {
      updatePublicKeyPem: publicKeyPem,
      runtimeSessionPublicKeyPem: publicKeyPem.replace(/\n/g, "\\n")
    });

    const dryRun = runNode([scriptPath, "--snippet", snippetPath, "--config", configPath]);
    const dryRunResult = JSON.parse(dryRun.stdout);
    assertOk(dryRunResult.written === false, "Dry-run should not write.");
    assertOk(dryRunResult.appliedKeys.length === 2, "Dry-run should detect both public-key fields.");
    assertOk(readJson(configPath).updatePublicKeyPem === "", "Dry-run must not mutate config.");

    const written = runNode([scriptPath, "--snippet", snippetPath, "--config", configPath, "--write"]);
    const writtenResult = JSON.parse(written.stdout);
    const config = readJson(configPath);
    assertOk(writtenResult.written === true, "Write mode should report written.");
    assertOk(config.updatePublicKeyPem.includes("\\n"), "Config should store public keys as escaped newline strings.");
    assertOk(config.runtimeSessionPublicKeyPem.includes("\\n"), "Runtime public key should be written.");
    assertOk(config.releaseMode === "development", "Snippet application must preserve unrelated config fields.");

    writeJson(privateSnippetPath, {
      updatePublicKeyPem: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"
    });
    runNode([scriptPath, "--snippet", privateSnippetPath, "--config", configPath, "--write"], 1);

    writeJson(unknownSnippetPath, {
      apiBaseUrl: "https://api.zerolag.test"
    });
    runNode([scriptPath, "--snippet", unknownSnippetPath, "--config", configPath, "--write"], 1);

    console.log("ZeroLag app-config snippet smoke test passed.");
  } finally {
    safeRemoveTemp(tempRoot);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
