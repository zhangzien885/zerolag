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
  const alipayReadyPath = path.join(tempDir, "alipay-ready.json");
  const commandPlanPath = path.join(tempDir, "formal-release-commands.ps1");
  const blockedCommandPlanPath = path.join(tempDir, "blocked-formal-release-commands.ps1");
  const serverEnvSnippetPath = path.join(tempDir, "server-payment-snippet.env");
  const alipayServerEnvSnippetPath = path.join(tempDir, "alipay-server-payment-snippet.env");
  const blockedServerEnvSnippetPath = path.join(tempDir, "blocked-server-payment-snippet.env");
  const alignedServerEnvPath = path.join(tempDir, "server.env");
  const missingSecretServerEnvPath = path.join(tempDir, "missing-secret-server.env");
  const mismatchedServerEnvPath = path.join(tempDir, "mismatched-server.env");
  const alipayAlignedServerEnvPath = path.join(tempDir, "alipay-server.env");
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

  const blockedServerEnvSnippetResult = run(["--file", setPath, "--write-server-env-snippet", "--output", blockedServerEnvSnippetPath]);
  assert.notStrictEqual(blockedServerEnvSnippetResult.status, 0, "payment env snippet must not be written before payment inputs are ready");
  assert.match(blockedServerEnvSnippetResult.stderr, /Payment server env snippet is not ready/);
  assert.ok(!fs.existsSync(blockedServerEnvSnippetPath), "blocked payment env snippet should not be written");

  const blockedServerEnvAlignmentResult = run(["--file", setPath, "--verify-server-env", "--server-env", missingSecretServerEnvPath]);
  assert.notStrictEqual(blockedServerEnvAlignmentResult.status, 0, "payment env alignment must not pass before formal payment inputs are ready");
  assert.match(blockedServerEnvAlignmentResult.stdout, /Formal payment inputs are not ready/);

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
  assert.match(commandPlan, /npm run release:inputs -- --write-server-env-snippet/);
  assert.match(commandPlan, /npm run release:inputs -- --verify-server-env --server-env \.secrets\\server\.env/);
  assert.match(commandPlan, /npm run server:env-check -- --profile sqlite --strict/);
  assert.match(commandPlan, /npm run update:prepare -- --base-url https:\/\/cdn\.zerolag\.gg\/releases/);
  assert.ok(!commandPlan.includes("do-not-print"), "command plan must not expose rejected secret fixtures");

  const serverEnvSnippetResult = run(["--file", readyPath, "--write-server-env-snippet", "--output", serverEnvSnippetPath]);
  assert.strictEqual(serverEnvSnippetResult.status, 0, serverEnvSnippetResult.stderr);
  assert.ok(fs.existsSync(serverEnvSnippetPath), "ready WeChat inputs should write a payment server env snippet");
  const serverEnvSnippet = fs.readFileSync(serverEnvSnippetPath, "utf8");
  assert.match(serverEnvSnippet, /ZeroLag payment server env snippet/);
  assert.match(serverEnvSnippet, /ZEROLAG_PAYMENT_PROVIDER=wechat_pay/);
  assert.match(serverEnvSnippet, /ZEROLAG_PAYMENT_ALLOWED_PROVIDERS=wechat_pay/);
  assert.match(serverEnvSnippet, /ZEROLAG_PAYMENT_URL_TEMPLATE=https:\/\/pay\.zerolag\.gg\/checkout\/\{orderId\}/);
  assert.match(serverEnvSnippet, /ZEROLAG_WECHAT_PAY_MCH_ID=1900000001/);
  assert.match(serverEnvSnippet, /ZEROLAG_WECHAT_PAY_APP_ID=wx0000000000000000/);
  assert.match(serverEnvSnippet, /ZEROLAG_WECHAT_PAY_SERIAL_NO=WECHATPAYCERTSERIAL/);
  assert.match(serverEnvSnippet, /ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH=D:\\secure\\wechatpay-apiclient-key\.pem/);
  assert.match(serverEnvSnippet, /# ZEROLAG_WECHAT_PAY_API_V3_KEY=<set only in your private server secret store>/);
  assert.ok(!/^ZEROLAG_WECHAT_PAY_API_V3_KEY=.+$/m.test(serverEnvSnippet), "WeChat API v3 key value must not be generated");
  assert.ok(!serverEnvSnippet.includes("certificatePassword"), "payment snippet must not mention certificate password fields");
  assert.ok(!serverEnvSnippet.includes("do-not-print"), "payment snippet must not expose secret fixtures");

  const webhookSecret = "zl_payment_webhook_should_not_print_abcdefghijklmnopqrstuvwxyz123456";
  const apiV3Key = "wechat_api_v3_should_not_print_abcdefghijklmnopqrstuvwxyz123456";
  fs.writeFileSync(
    alignedServerEnvPath,
    `${serverEnvSnippet}\nZEROLAG_PAYMENT_WEBHOOK_SECRET=${webhookSecret}\nZEROLAG_WECHAT_PAY_API_V3_KEY=${apiV3Key}\n`,
    "utf8"
  );
  const alignedServerEnvResult = run(["--file", readyPath, "--verify-server-env", "--server-env", alignedServerEnvPath, "--json"]);
  assert.strictEqual(alignedServerEnvResult.status, 0, alignedServerEnvResult.stderr);
  const alignedServerEnv = parseJson(alignedServerEnvResult.stdout);
  assert.strictEqual(alignedServerEnv.ok, true);
  assert.strictEqual(alignedServerEnv.provider, "wechat_pay");
  assert.strictEqual(alignedServerEnv.checkedKeys, 9);
  assert.strictEqual(alignedServerEnv.matchedKeys, 9);
  assert.ok(!alignedServerEnvResult.stdout.includes(webhookSecret), "webhook secret values must not be printed");
  assert.ok(!alignedServerEnvResult.stdout.includes(apiV3Key), "WeChat API v3 key values must not be printed");

  fs.writeFileSync(missingSecretServerEnvPath, serverEnvSnippet, "utf8");
  const missingSecretAlignmentResult = run(["--file", readyPath, "--verify-server-env", "--server-env", missingSecretServerEnvPath, "--json"]);
  assert.notStrictEqual(missingSecretAlignmentResult.status, 0, "missing private payment secrets should block alignment");
  const missingSecretAlignment = parseJson(missingSecretAlignmentResult.stdout);
  assert.strictEqual(missingSecretAlignment.ok, false);
  assert.ok(missingSecretAlignment.issues.some((issue) => issue.includes("ZEROLAG_PAYMENT_WEBHOOK_SECRET")), "missing webhook secret should be reported by key name");
  assert.ok(missingSecretAlignment.issues.some((issue) => issue.includes("ZEROLAG_WECHAT_PAY_API_V3_KEY")), "missing WeChat API key should be reported by key name");

  fs.writeFileSync(
    mismatchedServerEnvPath,
    [
      "ZEROLAG_PAYMENT_PROVIDER=manual",
      "ZEROLAG_PAYMENT_ALLOWED_PROVIDERS=manual",
      "ZEROLAG_PAYMENT_URL_TEMPLATE=https://pay.zerolag.gg/checkout/{orderId}",
      `ZEROLAG_PAYMENT_WEBHOOK_SECRET=${webhookSecret}`,
      "ZEROLAG_WECHAT_PAY_MCH_ID=wrong-mch",
      "ZEROLAG_WECHAT_PAY_APP_ID=wx0000000000000000",
      "ZEROLAG_WECHAT_PAY_SERIAL_NO=WECHATPAYCERTSERIAL",
      "ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH=D:\\secure\\wechatpay-apiclient-key.pem",
      `ZEROLAG_WECHAT_PAY_API_V3_KEY=${apiV3Key}`,
      ""
    ].join("\n"),
    "utf8"
  );
  const mismatchedServerEnvResult = run(["--file", readyPath, "--verify-server-env", "--server-env", mismatchedServerEnvPath]);
  assert.notStrictEqual(mismatchedServerEnvResult.status, 0, "mismatched payment env values should block alignment");
  assert.match(mismatchedServerEnvResult.stdout, /ZEROLAG_PAYMENT_PROVIDER does not match/);
  assert.match(mismatchedServerEnvResult.stdout, /ZEROLAG_PAYMENT_ALLOWED_PROVIDERS does not include wechat_pay/);
  assert.match(mismatchedServerEnvResult.stdout, /ZEROLAG_WECHAT_PAY_MCH_ID does not match/);
  assert.ok(!mismatchedServerEnvResult.stdout.includes(webhookSecret), "alignment output must not print webhook secret values");
  assert.ok(!mismatchedServerEnvResult.stdout.includes(apiV3Key), "alignment output must not print API key values");

  const alipayReady = readyFixture();
  alipayReady.payment.provider = "alipay";
  alipayReady.payment.checkoutUrlTemplate = "https://pay.zerolag.gg/alipay/{orderId}";
  alipayReady.payment.wechatPay = {
    merchantId: "",
    appId: "",
    serialNo: "",
    privateKeyPath: "",
    apiV3KeyConfigured: false
  };
  alipayReady.payment.alipay = {
    appId: "2026000000000000",
    privateKeyPath: "D:\\secure\\alipay-app-private-key.pem",
    publicKeyPath: "D:\\secure\\alipay-public-key.pem"
  };
  writeJson(alipayReadyPath, alipayReady);
  const alipayServerEnvSnippetResult = run(["--file", alipayReadyPath, "--write-server-env-snippet", "--output", alipayServerEnvSnippetPath]);
  assert.strictEqual(alipayServerEnvSnippetResult.status, 0, alipayServerEnvSnippetResult.stderr);
  const alipayServerEnvSnippet = fs.readFileSync(alipayServerEnvSnippetPath, "utf8");
  assert.match(alipayServerEnvSnippet, /ZEROLAG_PAYMENT_PROVIDER=alipay/);
  assert.match(alipayServerEnvSnippet, /ZEROLAG_PAYMENT_ALLOWED_PROVIDERS=alipay/);
  assert.match(alipayServerEnvSnippet, /ZEROLAG_ALIPAY_APP_ID=2026000000000000/);
  assert.match(alipayServerEnvSnippet, /ZEROLAG_ALIPAY_PRIVATE_KEY_PATH=D:\\secure\\alipay-app-private-key\.pem/);
  assert.match(alipayServerEnvSnippet, /ZEROLAG_ALIPAY_PUBLIC_KEY_PATH=D:\\secure\\alipay-public-key\.pem/);
  assert.ok(!alipayServerEnvSnippet.includes("ZEROLAG_WECHAT_PAY_API_V3_KEY"), "Alipay snippet should not include WeChat secret placeholders");

  fs.writeFileSync(
    alipayAlignedServerEnvPath,
    `${alipayServerEnvSnippet}\nZEROLAG_PAYMENT_WEBHOOK_SECRET=${webhookSecret}\n`,
    "utf8"
  );
  const alipayAlignmentResult = run(["--file", alipayReadyPath, "--verify-server-env", "--server-env", alipayAlignedServerEnvPath, "--json"]);
  assert.strictEqual(alipayAlignmentResult.status, 0, alipayAlignmentResult.stderr);
  const alipayAlignment = parseJson(alipayAlignmentResult.stdout);
  assert.strictEqual(alipayAlignment.ok, true);
  assert.strictEqual(alipayAlignment.provider, "alipay");
  assert.strictEqual(alipayAlignment.checkedKeys, 7);
  assert.strictEqual(alipayAlignment.matchedKeys, 7);
  assert.ok(!alipayAlignmentResult.stdout.includes(webhookSecret), "Alipay alignment output must not print webhook secret values");

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
