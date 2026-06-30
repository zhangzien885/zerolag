const assert = require("assert");
const { collectFormalReleaseInputs } = require("./formal-release-inputs");
const { collectReleaseNextStep } = require("./release-next-step");

function statusWithItems(items, overrides = {}) {
  const group = {
    id: "test",
    title: "Test",
    ready: items.every((item) => item.ok),
    okCount: items.filter((item) => item.ok).length,
    total: items.length,
    blockingCount: items.filter((item) => !item.ok && item.severity !== "warning").length,
    warningCount: items.filter((item) => !item.ok && item.severity === "warning").length,
    items
  };
  return {
    publicReleaseReady: overrides.publicReleaseReady || false,
    summary: {
      readyItems: group.okCount,
      totalItems: group.total,
      blockerCount: group.blockingCount,
      warningCount: group.warningCount
    },
    groups: [group],
    ...overrides
  };
}

function item(id, ok, detail = "", severity = "blocker") {
  return {
    id,
    label: id,
    ok,
    detail,
    nextStep: `${id} next`,
    severity
  };
}

function readyFormalInputs() {
  return collectFormalReleaseInputs({
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
      wechatPay: {
        merchantId: "1900000001",
        appId: "wx0000000000000000",
        serialNo: "SERIAL",
        privateKeyPath: "D:\\secure\\wechat.pem",
        apiV3KeyConfigured: true
      }
    },
    codeSigning: {
      profile: "production",
      certificateSource: "D:\\secure\\zerolag.pfx",
      passwordConfigured: true
    },
    release: {
      cdnReleaseBaseUrl: "https://cdn.zerolag.gg/releases"
    },
    support: {
      supportUrl: "https://zerolag.gg/support"
    }
  });
}

function main() {
  const missingInputs = collectReleaseNextStep({
    formalInputsExists: false,
    releaseStatus: statusWithItems([])
  });
  assert.strictEqual(missingInputs.step.stage, "formal-inputs-init");
  assert.strictEqual(missingInputs.step.command, "npm run release:inputs -- --init");

  const incompleteInputs = collectReleaseNextStep({
    formalInputsExists: true,
    formalResult: collectFormalReleaseInputs({}),
    releaseStatus: statusWithItems([])
  });
  assert.strictEqual(incompleteInputs.step.stage, "formal-inputs-fill");
  assert.strictEqual(incompleteInputs.step.command, "npm run release:inputs");

  const formalResult = readyFormalInputs();
  assert.strictEqual(formalResult.readyForPublicRelease, true);

  const versionStep = collectReleaseNextStep({
    formalInputsExists: true,
    formalResult,
    releaseStatus: statusWithItems([item("version", false, "0.1.0", "warning"), item("public-urls", false, "0/6")])
  });
  assert.strictEqual(versionStep.step.stage, "version");

  const urlStep = collectReleaseNextStep({
    formalInputsExists: true,
    formalResult,
    releaseStatus: statusWithItems([item("version", true, "1.0.0"), item("public-urls", false, "0/6")])
  });
  assert.strictEqual(urlStep.step.stage, "production-urls");
  assert.ok(urlStep.step.command.includes("production:config"));

  const paymentStep = collectReleaseNextStep({
    formalInputsExists: true,
    formalResult,
    releaseStatus: statusWithItems([item("server-env-valid", false, "0 issue(s), 2 warning(s)")])
  });
  assert.strictEqual(paymentStep.step.stage, "server-payment-env");
  assert.ok(paymentStep.step.command.includes("server:env-check"));

  const updateStep = collectReleaseNextStep({
    formalInputsExists: true,
    formalResult,
    releaseStatus: statusWithItems([item("download-url", false, "https://example.com/app.exe")])
  });
  assert.strictEqual(updateStep.step.stage, "signed-update-metadata");
  assert.ok(updateStep.step.command.includes("update:prepare"));

  const readyStep = collectReleaseNextStep({
    formalInputsExists: true,
    formalResult,
    releaseStatus: statusWithItems([], { publicReleaseReady: true })
  });
  assert.strictEqual(readyStep.step.stage, "final-gate");
  assert.ok(readyStep.step.command.includes("release:build"));

  console.log("ZeroLag release next-step smoke test passed.");
}

main();
