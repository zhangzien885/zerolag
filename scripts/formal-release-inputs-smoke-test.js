const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const scriptPath = path.join(rootDir, "scripts", "formal-release-inputs.js");

function run(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readyFixture() {
  return {
    schema: "zerolag-formal-release-inputs-v1",
    version: {
      target: "1.0.0"
    },
    domains: {
      website: "zerolag.gg",
      api: "api.zerolag.gg",
      cdn: "cdn.zerolag.gg"
    },
    payment: {
      provider: "wechat_pay",
      checkoutUrlTemplate: "https://pay.zerolag.gg/checkout/{orderId}",
      webhookUrl: "https://api.zerolag.gg/v1/payments/webhook",
      merchantName: "ZeroLag",
      wechatPay: {
        merchantId: "1900000001",
        appId: "wx0000000000000000",
        serialNo: "WECHATPAYCERTSERIAL",
        privateKeyPath: "D:\\secure\\wechatpay-apiclient-key.pem",
        apiV3KeyConfigured: true
      },
      alipay: {
        appId: "",
        privateKeyPath: "",
        publicKeyPath: ""
      }
    },
    codeSigning: {
      profile: "production",
      certificateSource: "D:\\secure\\zerolag-code-signing.pfx",
      passwordConfigured: true
    },
    release: {
      cdnReleaseBaseUrl: "https://cdn.zerolag.gg/releases",
      installerName: "ZeroLag-Setup-1.0.0.exe"
    },
    support: {
      supportUrl: "https://zerolag.gg/support",
      contactEmail: "support@zerolag.gg"
    }
  };
}

function parseJson(stdout) {
  return JSON.parse(stdout);
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-release-inputs-"));
  const templatePath = path.join(tempDir, "formal-release-inputs.json");
  const setPath = path.join(tempDir, "set.json");
  const domainPath = path.join(tempDir, "domain.json");
  const badDomainPath = path.join(tempDir, "bad-domain.json");
  const readyPath = path.join(tempDir, "ready.json");
  const commandPlanPath = path.join(tempDir, "formal-release-commands.ps1");
  const blockedCommandPlanPath = path.join(tempDir, "blocked-formal-release-commands.ps1");
  const reservedPath = path.join(tempDir, "reserved.json");
  const secretPath = path.join(tempDir, "secret.json");

  const initResult = run(["--init", "--output", templatePath]);
  assert.strictEqual(initResult.status, 0, initResult.stderr);
  assert.ok(fs.existsSync(templatePath), "init should write the input template");

  const guideResult = run(["--guide"]);
  assert.strictEqual(guideResult.status, 0, guideResult.stderr);
  assert.match(guideResult.stdout, /zerolag-formal-release-guide-v1/, "guide output should include the stable guide marker");
  assert.match(guideResult.stdout, /release:next/, "guide should point back to the next-step command");

  const defaultResult = run(["--file", templatePath]);
  assert.notStrictEqual(defaultResult.status, 0, "placeholder template must not pass readiness");
  assert.match(defaultResult.stdout, /BLOCKED/, "human output should show blocked status");

  const setResult = run([
    "--file",
    setPath,
    "--set",
    "domains.website=zerolag.gg",
    "--set",
    "payment.wechatPay.apiV3KeyConfigured=true"
  ]);
  assert.notStrictEqual(setResult.status, 0, "partial --set updates should still fail readiness");
  assert.ok(fs.existsSync(setPath), "--set should create the private input file when missing");
  const setData = parseJson(fs.readFileSync(setPath, "utf8"));
  assert.strictEqual(setData.domains.website, "zerolag.gg");
  assert.strictEqual(setData.payment.wechatPay.apiV3KeyConfigured, true);
  assert.match(setResult.stdout, /Updated fields: domains\.website, payment\.wechatPay\.apiV3KeyConfigured/);

  const unsupportedSetResult = run(["--file", setPath, "--set", "payment.wechatPay.apiV3Key=do-not-write"]);
  assert.notStrictEqual(unsupportedSetResult.status, 0, "secret fields must not be writable through --set");
  assert.match(unsupportedSetResult.stderr, /Unsupported formal release field/);
  assert.ok(!unsupportedSetResult.stderr.includes("do-not-write"), "rejected secret values must not be echoed");

  const badBooleanResult = run(["--file", setPath, "--set", "codeSigning.passwordConfigured=maybe"]);
  assert.notStrictEqual(badBooleanResult.status, 0, "boolean fields should reject ambiguous values");
  assert.match(badBooleanResult.stderr, /expects true or false/);

  const domainResult = run(["--file", domainPath, "--domain", "zerolag.gg"]);
  assert.notStrictEqual(domainResult.status, 0, "domain preset alone should not pass readiness");
  assert.ok(fs.existsSync(domainPath), "--domain should write the private input file");
  const domainData = parseJson(fs.readFileSync(domainPath, "utf8"));
  assert.strictEqual(domainData.domains.website, "zerolag.gg");
  assert.strictEqual(domainData.domains.api, "api.zerolag.gg");
  assert.strictEqual(domainData.domains.cdn, "cdn.zerolag.gg");
  assert.strictEqual(domainData.payment.checkoutUrlTemplate, "https://pay.zerolag.gg/checkout/{orderId}");
  assert.strictEqual(domainData.payment.webhookUrl, "https://api.zerolag.gg/v1/payments/webhook");
  assert.strictEqual(domainData.release.cdnReleaseBaseUrl, "https://cdn.zerolag.gg/releases");
  assert.strictEqual(domainData.support.supportUrl, "https://zerolag.gg/support");
  assert.strictEqual(domainData.support.contactEmail, "support@zerolag.gg");
  assert.match(domainResult.stdout, /Domain preset: zerolag\.gg/);

  const domainOverrideResult = run([
    "--file",
    domainPath,
    "--domain",
    "zerolag.gg",
    "--set",
    "support.contactEmail=help@zerolag.gg"
  ]);
  assert.notStrictEqual(domainOverrideResult.status, 0, "--set overrides should still validate partial readiness");
  const domainOverrideData = parseJson(fs.readFileSync(domainPath, "utf8"));
  assert.strictEqual(domainOverrideData.support.contactEmail, "help@zerolag.gg");

  const badDomainResult = run(["--file", badDomainPath, "--domain", "your-domain.example"]);
  assert.notStrictEqual(badDomainResult.status, 0, "placeholder domains must be rejected");
  assert.match(badDomainResult.stderr, /real public HTTPS domain/);
  assert.ok(!fs.existsSync(badDomainPath), "bad domain preset must not write an input file");

  const blockedCommandsResult = run(["--file", setPath, "--write-commands", "--output", blockedCommandPlanPath]);
  assert.notStrictEqual(blockedCommandsResult.status, 0, "command plan must not be written before inputs are ready");
  assert.match(blockedCommandsResult.stderr, /Formal release inputs are not ready/);
  assert.ok(!fs.existsSync(blockedCommandPlanPath), "blocked command plan should not be written");

  writeJson(readyPath, readyFixture());
  const readyResult = run(["--file", readyPath, "--json"]);
  assert.strictEqual(readyResult.status, 0, readyResult.stderr);
  const ready = parseJson(readyResult.stdout);
  assert.strictEqual(ready.ok, true);
  assert.strictEqual(ready.readyForPublicRelease, true);
  assert.strictEqual(ready.blockerCount, 0);

  const commandPlanResult = run(["--file", readyPath, "--write-commands", "--output", commandPlanPath]);
  assert.strictEqual(commandPlanResult.status, 0, commandPlanResult.stderr);
  assert.ok(fs.existsSync(commandPlanPath), "ready inputs should write a command plan");
  const commandPlan = fs.readFileSync(commandPlanPath, "utf8");
  assert.match(commandPlan, /ZeroLag formal release command plan/);
  assert.match(commandPlan, /npm run release:version -- --version 1\.0\.0 --write/);
  assert.match(commandPlan, /npm run production:config -- --domain zerolag\.gg --api-domain api\.zerolag\.gg --cdn-domain cdn\.zerolag\.gg --write/);
  assert.match(commandPlan, /npm run update:prepare -- --base-url https:\/\/cdn\.zerolag\.gg\/releases/);
  assert.ok(!commandPlan.includes("do-not-print"), "command plan must not expose rejected secret fixtures");

  const reserved = readyFixture();
  reserved.domains.website = "zerolag.test";
  reserved.domains.api = "api.zerolag.test";
  reserved.domains.cdn = "cdn.zerolag.test";
  reserved.release.cdnReleaseBaseUrl = "https://cdn.zerolag.test/releases";
  writeJson(reservedPath, reserved);
  const reservedResult = run(["--file", reservedPath]);
  assert.notStrictEqual(reservedResult.status, 0, "reserved domains must not pass readiness");
  assert.match(reservedResult.stdout, /Public website domain/, "domain failures should be visible");

  const secretFixture = readyFixture();
  secretFixture.payment.wechatPay.apiV3Key = "do-not-print-api-v3-key";
  secretFixture.codeSigning.certificatePassword = "do-not-print-certificate-password";
  writeJson(secretPath, secretFixture);
  const secretResult = run(["--file", secretPath, "--json"]);
  assert.strictEqual(secretResult.status, 0, secretResult.stderr);
  const combinedOutput = `${secretResult.stdout}\n${secretResult.stderr}`;
  assert.ok(!combinedOutput.includes("do-not-print-api-v3-key"), "payment secret values must not be printed");
  assert.ok(!combinedOutput.includes("do-not-print-certificate-password"), "certificate passwords must not be printed");

  console.log("Formal release input smoke test passed.");
}

main();
