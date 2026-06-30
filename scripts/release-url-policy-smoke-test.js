const {
  isHttpsUrl,
  isPlaceholderHost,
  isPlaceholderUrl,
  isRealHttpUrl,
  isRealHttpsUrl
} = require("./release-url-policy");

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  [
    "https://zerolag.gg",
    "https://api.zerolag.gg/v1/status",
    "https://cdn.zerolag.cn/releases/ZeroLag.exe"
  ].forEach((url) => {
    assertOk(isHttpsUrl(url), `${url} should be HTTPS.`);
    assertOk(isRealHttpsUrl(url), `${url} should be accepted as a public HTTPS URL.`);
  });

  [
    "https://zerolag.test",
    "https://api.zerolag.invalid",
    "https://zerolag.example",
    "https://zerolag.example.com",
    "https://localhost:8787",
    "https://127.0.0.1:8787",
    "https://10.0.0.8",
    "https://172.16.4.2",
    "https://192.168.1.8",
    "https://169.254.1.8",
    "https://203.0.113.8",
    "https://service.local"
  ].forEach((url) => {
    assertOk(isPlaceholderUrl(url), `${url} should be treated as placeholder/local-only.`);
    assertOk(!isRealHttpsUrl(url), `${url} must not be accepted for paid public release.`);
  });

  assertOk(isRealHttpUrl("http://pay.zerolag.gg/checkout"), "Payment checkout URLs may be HTTP/HTTPS when they are public.");
  assertOk(!isRealHttpUrl("http://pay.zerolag.test/checkout"), "Payment checkout URLs must reject reserved domains.");
  assertOk(isPlaceholderHost("api.zerolag.test"), "Reserved .test host should be blocked without a URL wrapper.");
  assertOk(isPlaceholderHost("internal-host"), "Single-label internal host should be blocked.");

  console.log("ZeroLag release URL policy smoke test passed.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
