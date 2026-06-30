const fs = require("fs");
const path = require("path");
const { isRealHttpsUrl } = require("./release-url-policy");

const rootDir = path.join(__dirname, "..");
const defaultInputPath = path.join(rootDir, ".secrets", "formal-release-inputs.json");
const guidePath = path.join(rootDir, "docs", "formal-release-inputs.zh-CN.md");

const paymentProviders = new Set(["wechat_pay", "alipay"]);

function usage() {
  console.log("Usage:");
  console.log("  node scripts/formal-release-inputs.js --init [--output .secrets/formal-release-inputs.json] [--force]");
  console.log("  node scripts/formal-release-inputs.js --guide");
  console.log("  node scripts/formal-release-inputs.js --set domains.website=zerolag.gg [--set payment.provider=wechat_pay]");
  console.log("  node scripts/formal-release-inputs.js [--file .secrets/formal-release-inputs.json] [--json]");
  console.log("");
  console.log("Collects and validates the external facts required for a paid public release without printing secrets.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    } else if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
    }
  }
  return values;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function template() {
  return {
    schema: "zerolag-formal-release-inputs-v1",
    notes: [
      "Copy this file to .secrets/formal-release-inputs.json before filling real values.",
      "Do not paste private-key PEM text, certificate passwords, API keys, or payment secrets into this file.",
      "Use boolean flags such as apiV3KeyConfigured/passwordConfigured to prove secrets exist elsewhere."
    ],
    version: {
      target: "1.0.0"
    },
    domains: {
      website: "your-domain.example",
      api: "api.your-domain.example",
      cdn: "cdn.your-domain.example"
    },
    payment: {
      provider: "manual",
      checkoutUrlTemplate: "https://pay.your-domain.example/checkout/{orderId}",
      webhookUrl: "https://api.your-domain.example/v1/payments/webhook",
      merchantName: "",
      wechatPay: {
        merchantId: "",
        appId: "",
        serialNo: "",
        privateKeyPath: "",
        apiV3KeyConfigured: false
      },
      alipay: {
        appId: "",
        privateKeyPath: "",
        publicKeyPath: ""
      }
    },
    codeSigning: {
      profile: "test",
      certificateSource: "",
      passwordConfigured: false
    },
    release: {
      cdnReleaseBaseUrl: "https://cdn.your-domain.example/releases",
      installerName: "ZeroLag-Setup-1.0.0.exe"
    },
    support: {
      supportUrl: "https://your-domain.example/support",
      contactEmail: "support@your-domain.example"
    }
  };
}

function text(value) {
  return String(value || "").trim();
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(text(value));
}

function asHttpsUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    url.hash = "";
    return url.toString().replace(/\/$/g, "");
  } catch (_error) {
    return "";
  }
}

function asCheckoutUrl(value) {
  return text(value)
    .replace(/\{orderId\}/g, "ord_formal_check")
    .replace(/\{amount\}/g, "3000")
    .replace(/\{currency\}/g, "CNY")
    .replace(/\{provider\}/g, "wechat_pay");
}

function isRealPublicHttps(value) {
  const normalized = asHttpsUrl(value);
  return Boolean(normalized && isRealHttpsUrl(normalized));
}

function isRealPublicCheckout(value) {
  const normalized = asHttpsUrl(asCheckoutUrl(value));
  return Boolean(normalized && isRealHttpsUrl(normalized));
}

function hostForCommand(value, fallback) {
  const normalized = asHttpsUrl(value);
  try {
    return new URL(normalized).hostname;
  } catch (_error) {
    return fallback;
  }
}

function releaseBaseUrl(input) {
  const configured = input.release && input.release.cdnReleaseBaseUrl;
  const fromConfig = asHttpsUrl(configured);
  if (fromConfig) return fromConfig.replace(/\/+$/g, "");

  const cdn = asHttpsUrl(input.domains && input.domains.cdn);
  return cdn ? `${cdn.replace(/\/+$/g, "")}/releases` : "https://<cdn-domain>/releases";
}

function boolStatus(value) {
  return value === true ? "configured" : "missing";
}

function hasText(value) {
  return text(value).length > 0;
}

const editableFields = {
  "version.target": "string",
  "domains.website": "string",
  "domains.api": "string",
  "domains.cdn": "string",
  "payment.provider": "string",
  "payment.checkoutUrlTemplate": "string",
  "payment.webhookUrl": "string",
  "payment.merchantName": "string",
  "payment.wechatPay.merchantId": "string",
  "payment.wechatPay.appId": "string",
  "payment.wechatPay.serialNo": "string",
  "payment.wechatPay.privateKeyPath": "string",
  "payment.wechatPay.apiV3KeyConfigured": "boolean",
  "payment.alipay.appId": "string",
  "payment.alipay.privateKeyPath": "string",
  "payment.alipay.publicKeyPath": "string",
  "codeSigning.profile": "string",
  "codeSigning.certificateSource": "string",
  "codeSigning.passwordConfigured": "boolean",
  "codeSigning.passwordSecretName": "string",
  "release.cdnReleaseBaseUrl": "string",
  "release.installerName": "string",
  "support.supportUrl": "string",
  "support.contactEmail": "string"
};

function parseSetArg(raw) {
  const equalsIndex = raw.indexOf("=");
  if (equalsIndex <= 0) {
    throw new Error(`Invalid --set value: ${raw}. Use --set field.path=value.`);
  }
  return {
    field: raw.slice(0, equalsIndex).trim(),
    value: raw.slice(equalsIndex + 1).trim()
  };
}

function parseFieldValue(field, rawValue) {
  const fieldType = editableFields[field];
  if (!fieldType) {
    throw new Error(`Unsupported formal release field: ${field}. Run npm run release:inputs -- --guide for supported fields.`);
  }
  if (fieldType === "boolean") {
    if (/^(true|yes|1)$/i.test(rawValue)) return true;
    if (/^(false|no|0)$/i.test(rawValue)) return false;
    throw new Error(`Field ${field} expects true or false.`);
  }
  return rawValue;
}

function setDeepValue(target, dottedPath, value) {
  const parts = dottedPath.split(".");
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
}

function applySetValues(input, assignments) {
  const data = input || template();
  assignments.forEach((assignment) => {
    const parsed = parseSetArg(assignment);
    setDeepValue(data, parsed.field, parseFieldValue(parsed.field, parsed.value));
  });
  return data;
}

function makeCheck(id, label, ok, detail, nextStep, severity = "blocker") {
  return {
    id,
    label,
    ok: Boolean(ok),
    detail: text(detail),
    nextStep: text(nextStep),
    severity
  };
}

function collectFormalReleaseInputs(input) {
  const data = input || {};
  const version = data.version || {};
  const domains = data.domains || {};
  const payment = data.payment || {};
  const wechatPay = payment.wechatPay || {};
  const alipay = payment.alipay || {};
  const codeSigning = data.codeSigning || {};
  const release = data.release || {};
  const support = data.support || {};
  const provider = text(payment.provider);
  const providerKnown = paymentProviders.has(provider);
  const targetVersion = text(version.target);
  const baseUrl = releaseBaseUrl(data);

  const checks = [
    makeCheck(
      "version-target",
      "Formal release version",
      isSemver(targetVersion) && targetVersion !== "0.1.0",
      targetVersion || "missing",
      "Choose the first paid-release version, for example 1.0.0, then run npm run release:version -- --version <version> --write."
    ),
    makeCheck(
      "website-domain",
      "Public website domain",
      isRealPublicHttps(domains.website),
      hostForCommand(domains.website, "missing"),
      "Buy or connect the official website domain before public release."
    ),
    makeCheck(
      "api-domain",
      "Public API domain",
      isRealPublicHttps(domains.api),
      hostForCommand(domains.api, "missing"),
      "Point a real HTTPS API domain to the account/member server."
    ),
    makeCheck(
      "cdn-domain",
      "Public CDN/download domain",
      isRealPublicHttps(domains.cdn),
      hostForCommand(domains.cdn, "missing"),
      "Prepare a real HTTPS download/CDN domain for installer and update manifests."
    ),
    makeCheck(
      "payment-provider",
      "Real payment provider",
      providerKnown,
      provider || "missing",
      "Select wechat_pay or alipay before opening paid subscriptions."
    ),
    makeCheck(
      "payment-checkout",
      "Public checkout URL template",
      isRealPublicCheckout(payment.checkoutUrlTemplate),
      payment.checkoutUrlTemplate ? "configured" : "missing",
      "Configure a real HTTPS checkout URL template that can receive an order ID."
    ),
    makeCheck(
      "payment-webhook",
      "Public payment webhook URL",
      isRealPublicHttps(payment.webhookUrl),
      payment.webhookUrl ? "configured" : "missing",
      "Expose the signed payment webhook over the real HTTPS API domain."
    ),
    makeCheck(
      "wechat-merchant",
      "WeChat Pay merchant fields",
      provider !== "wechat_pay" || (
        hasText(wechatPay.merchantId)
        && hasText(wechatPay.appId)
        && hasText(wechatPay.serialNo)
        && hasText(wechatPay.privateKeyPath)
        && wechatPay.apiV3KeyConfigured === true
      ),
      provider === "wechat_pay" ? "required" : "not selected",
      "For WeChat Pay, configure merchant ID, app ID, serial number, private-key path, and API v3 key in private env."
    ),
    makeCheck(
      "alipay-merchant",
      "Alipay merchant fields",
      provider !== "alipay" || (
        hasText(alipay.appId)
        && hasText(alipay.privateKeyPath)
        && hasText(alipay.publicKeyPath)
      ),
      provider === "alipay" ? "required" : "not selected",
      "For Alipay, configure app ID, private-key path, and Alipay public-key path in private env."
    ),
    makeCheck(
      "codesign-profile",
      "Production code-signing profile",
      text(codeSigning.profile) === "production",
      text(codeSigning.profile) || "missing",
      "Use a real OV/EV code-signing certificate for paid public installers."
    ),
    makeCheck(
      "codesign-certificate",
      "Code-signing certificate configured",
      hasText(codeSigning.certificateSource),
      codeSigning.certificateSource ? "configured" : "missing",
      "Configure the signing certificate source outside Git, for example a secure PFX path or CI secret."
    ),
    makeCheck(
      "codesign-password",
      "Code-signing password configured",
      codeSigning.passwordConfigured === true || hasText(codeSigning.passwordSecretName),
      boolStatus(codeSigning.passwordConfigured === true || hasText(codeSigning.passwordSecretName)),
      "Configure the signing password as a private environment variable or CI secret."
    ),
    makeCheck(
      "release-base-url",
      "Release CDN base URL",
      isRealPublicHttps(baseUrl),
      baseUrl,
      "Use the final HTTPS CDN release folder before preparing update metadata."
    ),
    makeCheck(
      "support-url",
      "Customer support URL",
      isRealPublicHttps(support.supportUrl),
      support.supportUrl ? "configured" : "missing",
      "Prepare a customer-facing support page before the website download flow goes public.",
      "warning"
    )
  ];

  const blockers = checks.filter((entry) => !entry.ok && entry.severity === "blocker");
  const warnings = checks.filter((entry) => !entry.ok && entry.severity === "warning");
  const websiteHost = hostForCommand(domains.website, "<website-domain>");
  const apiHost = hostForCommand(domains.api, "<api-domain>");
  const cdnHost = hostForCommand(domains.cdn, "<cdn-domain>");

  return {
    ok: blockers.length === 0,
    readyForPublicRelease: blockers.length === 0 && warnings.length === 0,
    readyItems: checks.filter((entry) => entry.ok).length,
    totalItems: checks.length,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    checks,
    nextCommands: [
      `npm run release:version -- --version ${targetVersion || "<version>"} --write`,
      `npm run production:config -- --domain ${websiteHost} --api-domain ${apiHost} --cdn-domain ${cdnHost} --write`,
      "Fill .secrets/server.env payment values, then run npm run server:env-check -- --profile sqlite --strict",
      "npm run release:artifacts",
      `npm run update:prepare -- --base-url ${baseUrl} --private-key .secrets\\update-private.pem --public-key .secrets\\update-public.pem --write`,
      "npm run production:mode -- --mode production --write",
      "npm run website:release",
      "npm run release:preflight:strict"
    ]
  };
}

function printHuman(result, inputFile) {
  const status = result.ok ? "READY" : "BLOCKED";
  console.log(`ZeroLag formal release inputs: ${status}`);
  console.log(`Input file: ${inputFile}`);
  console.log(`Ready checks: ${result.readyItems}/${result.totalItems}`);
  console.log("");

  const failed = result.checks.filter((entry) => !entry.ok);
  if (failed.length) {
    console.log("Remaining external inputs:");
    failed.forEach((entry) => {
      console.log(`- [${entry.severity}] ${entry.label}: ${entry.detail || "not ready"}`);
      if (entry.nextStep) console.log(`  Next: ${entry.nextStep}`);
    });
    console.log("");
  }

  console.log("Next command chain after the external inputs are real:");
  result.nextCommands.forEach((command, index) => {
    console.log(`${index + 1}. ${command}`);
  });
}

function initTemplate(outputPath, force) {
  if (fs.existsSync(outputPath) && !force) {
    throw new Error(`${outputPath} already exists. Pass --force to overwrite it.`);
  }
  writeJson(outputPath, template());
  return outputPath;
}

function printGuide() {
  if (!fs.existsSync(guidePath)) {
    throw new Error(`Formal release input guide is missing: ${guidePath}`);
  }
  console.log(fs.readFileSync(guidePath, "utf8").trimEnd());
}

function updateInputFile(inputFile, assignments) {
  const existing = fs.existsSync(inputFile) ? readJson(inputFile) : template();
  const updated = applySetValues(existing, assignments);
  writeJson(inputFile, updated);
  return updated;
}

function main() {
  if (hasFlag("--help")) {
    usage();
    return;
  }

  try {
    if (hasFlag("--guide")) {
      printGuide();
      return;
    }

    if (hasFlag("--init")) {
      const outputPath = path.resolve(argValue("--output", defaultInputPath));
      initTemplate(outputPath, hasFlag("--force"));
      console.log(`Formal release input template written: ${outputPath}`);
      console.log("Keep real merchant, certificate, and server details outside Git.");
      return;
    }

    const inputFile = path.resolve(argValue("--file", defaultInputPath));
    const setValues = argValues("--set");
    if (setValues.length) {
      const updated = updateInputFile(inputFile, setValues);
      console.log(`Formal release input file updated: ${inputFile}`);
      console.log(`Updated fields: ${setValues.map((item) => parseSetArg(item).field).join(", ")}`);
      console.log("");
      const result = collectFormalReleaseInputs(updated);
      printHuman(result, inputFile);
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (!fs.existsSync(inputFile)) {
      throw new Error(`Formal release input file is missing: ${inputFile}. Run npm run release:inputs -- --init first.`);
    }

    const result = collectFormalReleaseInputs(readJson(inputFile));
    if (hasFlag("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result, inputFile);
    }
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  applySetValues,
  collectFormalReleaseInputs,
  initTemplate,
  printGuide,
  template
};
