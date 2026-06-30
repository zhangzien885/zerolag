const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const sourceManifestPath = path.join(rootDir, "assets", "update.json");
const signingScriptPath = path.join(rootDir, "scripts", "sign-update-manifest.js");
const mainJsPath = path.join(rootDir, "main.js");
const rendererJsPath = path.join(rootDir, "src", "renderer.js");

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

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(text, snippet, message) {
  assertOk(text.includes(snippet), message);
}

function safeRemoveTemp(tempRoot) {
  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-update-smoke-")) {
    throw new Error(`Refusing to remove unexpected path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

function main() {
  assertOk(fs.existsSync(sourceManifestPath), "assets/update.json is missing.");
  assertOk(fs.existsSync(signingScriptPath), "scripts/sign-update-manifest.js is missing.");

  const mainJs = fs.readFileSync(mainJsPath, "utf8");
  const rendererJs = fs.readFileSync(rendererJsPath, "utf8");
  assertIncludes(mainJs, "zerolag:open-update-url", "Main process must expose the update download opener.");
  assertIncludes(mainJs, "isConfiguredPublicUrl(target)", "Update download opener must reject placeholder or local URLs.");
  assertIncludes(mainJs, 'reason: "UPDATE_URL_NOT_READY"', "Update download opener must return a safe not-ready reason.");
  assertIncludes(mainJs, 'reason: "UPDATE_URL_OPEN_FAILED"', "Update download opener must report shell open failures.");
  assertIncludes(rendererJs, "openUpdateDownloadWithFeedback", "Renderer must route update opening through a feedback helper.");
  assertIncludes(rendererJs, "updateOpenSucceeded(result)", "Renderer must verify update opening before showing success.");
  assertIncludes(rendererJs, 'result && result.reason === "UPDATE_URL_NOT_READY"', "Renderer must show a safe not-ready update message.");
  const rendererOpenUpdateCalls = rendererJs.match(/window\.zeroLag\.openUpdateUrl/g) || [];
  assertOk(
    rendererOpenUpdateCalls.length === 1,
    "Renderer must call openUpdateUrl only from the shared update feedback helper."
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-update-smoke-"));
  const manifestPath = path.join(tempRoot, "update.json");
  const privateKeyPath = path.join(tempRoot, "update-private.pem");
  const publicKeyPath = path.join(tempRoot, "update-public.pem");
  const appConfigSnippetPath = path.join(tempRoot, "update-app-config-snippet.json");

  try {
    fs.copyFileSync(sourceManifestPath, manifestPath);

    const generated = runNode([
      signingScriptPath,
      "--generate-keypair",
      privateKeyPath,
      publicKeyPath,
      "--app-config-snippet",
      appConfigSnippetPath
    ]);
    assertOk(!generated.stdout.includes("PRIVATE KEY"), "Key generation output must not print private key material.");
    runNode([signingScriptPath, manifestPath, privateKeyPath]);
    runNode([signingScriptPath, "--verify", manifestPath, publicKeyPath]);

    const signedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const appConfigSnippet = JSON.parse(fs.readFileSync(appConfigSnippetPath, "utf8"));
    assertOk(signedManifest.signatureAlgorithm === "RSA-SHA256", "Signed manifest is missing RSA-SHA256 algorithm.");
    assertOk(Boolean(signedManifest.signature), "Signed manifest is missing signature.");
    assertOk(
      /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(appConfigSnippet.updatePublicKeyPem || ""),
      "App config snippet should contain only the update public key."
    );

    fs.writeFileSync(manifestPath, `${JSON.stringify({
      ...signedManifest,
      latest: `${signedManifest.latest || "0.0.0"}-tampered`
    }, null, 2)}\n`, "utf8");
    runNode([signingScriptPath, "--verify", manifestPath, publicKeyPath], 1);

    console.log("ZeroLag update signing smoke test passed.");
    console.log("Generated temporary keypair, signed a copied manifest, verified it, and rejected a tampered copy.");
  } finally {
    safeRemoveTemp(tempRoot);
  }
}

main();
