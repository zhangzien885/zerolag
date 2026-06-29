const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { inspectSigningEnv } = require("./check-code-signing-env");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "check-code-signing-env.js");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function runNode(env, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [scriptPath, "--strict"], {
    cwd: rootDir,
    env,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== expectedStatus) {
    throw new Error([
      "Code signing env check had unexpected status.",
      `Expected: ${expectedStatus}`,
      `Actual: ${result.status}`,
      result.stdout.trim(),
      result.stderr.trim()
    ].filter(Boolean).join("\n"));
  }

  return result;
}

function cleanEnv() {
  const env = { ...process.env };
  [
    "CSC_LINK",
    "WIN_CSC_LINK",
    "WINDOWS_CODESIGN_CERT",
    "ZEROLAG_CODESIGN_CERT",
    "CSC_KEY_PASSWORD",
    "WIN_CSC_KEY_PASSWORD",
    "WINDOWS_CODESIGN_PASSWORD",
    "ZEROLAG_CODESIGN_PASSWORD"
  ].forEach((key) => delete env[key]);
  return env;
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-codesign-smoke-"));

  try {
    const missing = inspectSigningEnv(cleanEnv());
    assertOk(missing.ok === false, "Missing signing env should not be ready.");
    assertOk(missing.issues.some((issue) => issue.includes("certificate")), "Missing env should report missing certificate.");

    const certPath = path.join(tempDir, "certificate.p12");
    fs.writeFileSync(certPath, "fake certificate bytes", "utf8");
    const externalEnv = {
      ...cleanEnv(),
      WIN_CSC_LINK: certPath,
      WIN_CSC_KEY_PASSWORD: "secret-password"
    };
    const external = inspectSigningEnv(externalEnv);
    assertOk(external.ok === true, "External certificate path with password should pass.");
    assertOk(external.certificateSource === "external-file", "External certificate source should be redacted.");

    const externalCli = runNode(externalEnv, 0);
    assertOk(!externalCli.stdout.includes(certPath), "CLI output must not print certificate path.");
    assertOk(!externalCli.stdout.includes("secret-password"), "CLI output must not print password.");

    const repoCertPath = path.join(rootDir, "build", "repo-cert.p12");
    fs.mkdirSync(path.dirname(repoCertPath), { recursive: true });
    fs.writeFileSync(repoCertPath, "fake certificate bytes", "utf8");
    const repo = inspectSigningEnv({
      ...cleanEnv(),
      WIN_CSC_LINK: repoCertPath,
      WIN_CSC_KEY_PASSWORD: "secret-password"
    });
    assertOk(repo.ok === false, "Repository certificate path should be rejected.");
    fs.rmSync(repoCertPath, { force: true });

    const remoteEnv = {
      ...cleanEnv(),
      WIN_CSC_LINK: "https://secrets.example.invalid/certificate.p12",
      WIN_CSC_KEY_PASSWORD: "secret-password"
    };
    const remote = inspectSigningEnv(remoteEnv);
    assertOk(remote.ok === true, "Remote certificate URL with password should pass readiness.");
    assertOk(remote.certificateSource === "remote-url", "Remote certificate source should be summarized.");

    const base64Env = {
      ...cleanEnv(),
      CSC_LINK: "a".repeat(180),
      CSC_KEY_PASSWORD: "secret-password"
    };
    const base64 = inspectSigningEnv(base64Env);
    assertOk(base64.ok === true, "Base64 certificate with password should pass readiness.");
    assertOk(base64.certificateSource === "base64", "Base64 certificate source should be summarized.");

    console.log("ZeroLag code signing env smoke test passed.");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
