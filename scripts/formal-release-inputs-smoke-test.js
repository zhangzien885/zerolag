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
  const readyPath = path.join(tempDir, "ready.json");
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

  writeJson(readyPath, readyFixture());
  const readyResult = run(["--file", readyPath, "--json"]);
  assert.strictEqual(readyResult.status, 0, readyResult.stderr);
  const ready = parseJson(readyResult.stdout);
  assert.strictEqual(ready.ok, true);
  assert.strictEqual(ready.readyForPublicRelease, true);
  assert.strictEqual(ready.blockerCount, 0);

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
