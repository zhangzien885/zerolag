const fs = require("fs");
const path = require("path");
const { isRealHttpsUrl } = require("./release-url-policy");

const rootDir = path.join(__dirname, "..");
const websiteDir = path.join(rootDir, "website");

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readText(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  assertOk(fs.existsSync(filePath), `Missing website file: ${relativePath}`);
  return fs.readFileSync(filePath, "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function isPublicHttpsUrl(value) {
  return isRealHttpsUrl(value);
}

function assertHas(text, snippet, context) {
  assertOk(text.includes(snippet), `${context} is missing: ${snippet}`);
}

function assertNotHas(text, snippet, context) {
  assertOk(!text.includes(snippet), `${context} must not include: ${snippet}`);
}

function assertNoForbiddenCopy(relativePath, text) {
  const forbiddenTerms = [
    "subscription control",
    "protection strategy",
    "permanent config",
    "watchdog",
    "task scheduler",
    "windows service",
    "\u53cd\u7834\u89e3",
    "\u6c38\u4e45\u7559\u5b58",
    "\u8ba2\u9605\u63a7\u5236",
    "\u4fdd\u62a4\u7b56\u7565",
    "\u5f3a\u6740\u515c\u5e95"
  ];
  const lowered = text.toLowerCase();

  for (const term of forbiddenTerms) {
    assertOk(!lowered.includes(term.toLowerCase()), `Customer-facing website copy contains internal wording in ${relativePath}: ${term}`);
  }
}

function assertReleaseManifest(release) {
  assertOk(release && typeof release === "object", "website/release.json must be an object.");
  assertOk(release.productName === "ZeroLag", "website/release.json productName must be ZeroLag.");
  assertOk(/^\d+\.\d+\.\d+/.test(String(release.version || "")), "website/release.json version must be semver-like.");
  assertOk(["preparing", "available"].includes(release.status), "website/release.json status must be preparing or available.");
  assertOk(typeof release.downloadReady === "boolean", "website/release.json downloadReady must be boolean.");
  assertOk(Array.isArray(release.releaseNotes), "website/release.json releaseNotes must be an array.");
  assertOk(release.releaseNotes.length <= 6, "website/release.json releaseNotes must expose at most 6 public notes.");
  for (const note of release.releaseNotes) {
    assertOk(typeof note === "string" && note.trim().length > 0, "website/release.json releaseNotes must contain non-empty strings.");
    assertOk(note.length <= 160, "website/release.json releaseNotes entries must be 160 characters or less.");
  }
  assertOk(release.installer && typeof release.installer === "object", "website/release.json installer must be an object.");
  assertOk(release.updateMetadata && typeof release.updateMetadata === "object", "website/release.json updateMetadata must be an object.");
  assertOk(release.readiness && typeof release.readiness === "object", "website/release.json readiness must be an object.");

  if (release.supportUrl) {
    assertOk(isPublicHttpsUrl(release.supportUrl), "website/release.json supportUrl must be a real HTTPS URL when set.");
  }

  if (release.purchaseUrl) {
    assertOk(isPublicHttpsUrl(release.purchaseUrl), "website/release.json purchaseUrl must be a real HTTPS URL when set.");
  }

  if (release.analyticsUrl) {
    assertOk(isPublicHttpsUrl(release.analyticsUrl), "website/release.json analyticsUrl must be a real HTTPS URL when set.");
  }

  if (release.downloadReady) {
    assertOk(release.status === "available", "downloadReady releases must use available status.");
    assertOk(isPublicHttpsUrl(release.downloadUrl), "downloadReady releases must include a real HTTPS downloadUrl.");
    assertOk(/\.exe$/i.test(release.installer.file || ""), "downloadReady releases must expose a Windows installer .exe.");
    assertOk(/^[a-f0-9]{64}$/i.test(release.installer.sha256 || ""), "downloadReady releases must expose a full SHA256 checksum.");
    assertOk(Number(release.installer.size) > 1024 * 1024, "downloadReady installer size looks too small.");
  } else {
    assertOk(release.status === "preparing", "non-download releases must use preparing status.");
    assertOk(!release.downloadUrl, "preparing releases must not expose a downloadUrl.");
  }
}

function main() {
  assertOk(fs.existsSync(websiteDir), "website/ directory is missing.");

  const indexHtml = readText("website/index.html");
  const scriptJs = readText("website/script.js");
  const stylesCss = readText("website/styles.css");
  const releaseJsonText = readText("website/release.json");
  const release = JSON.parse(releaseJsonText);

  [
    "downloadKicker",
    "downloadIntro",
    "releaseStatus",
    "releaseDescription",
    "releaseChecksum",
    "copyChecksumButton",
    "releaseNotes",
    "pricingPurchase",
    "downloadPrimary",
    "downloadPurchase",
    "downloadSecondary",
    "downloadSupport"
  ].forEach((id) => assertHas(indexHtml, `id="${id}"`, "website download panel"));

  assertHas(indexHtml, "./script.js", "website page");
  assertHas(scriptJs, "fetch(\"./release.json\"", "website release loader");
  assertHas(scriptJs, "cache: \"no-store\"", "website release loader");
  assertHas(scriptJs, "renderRelease", "website release renderer");
  assertHas(scriptJs, "renderReleaseNotes", "website release notes renderer");
  assertHas(scriptJs, "formatBytes", "website installer size formatter");
  assertHas(scriptJs, "copyReleaseChecksum", "website checksum copy handler");
  assertHas(scriptJs, "clipboard.writeText", "website checksum clipboard path");
  assertHas(scriptJs, "release.purchaseUrl", "website purchase link wiring");
  assertHas(scriptJs, "release.supportUrl", "website support link wiring");
  assertHas(scriptJs, "release.analyticsUrl", "website analytics endpoint wiring");
  assertHas(scriptJs, "trackWebsiteEvent", "website analytics event tracking");
  assertHas(scriptJs, "safeEventDetail", "website analytics payload redaction");
  assertHas(scriptJs, "navigator.sendBeacon", "website analytics beacon path");
  assertHas(scriptJs, "rel = \"noopener\"", "external download link safety");
  assertNotHas(scriptJs, "userAgent", "website privacy-safe analytics");
  assertNotHas(scriptJs, "localStorage", "website privacy-safe analytics");
  assertHas(stylesCss, ".release-checksum", "website release checksum style");
  assertHas(stylesCss, ".checksum-copy-button", "website checksum copy button style");
  assertHas(stylesCss, ".release-notes", "website release notes style");
  assertHas(stylesCss, ".purchase-button", "website purchase button style");
  assertHas(stylesCss, ".support-button", "website support button style");
  assertHas(stylesCss, "[hidden]", "website hidden element style");

  assertNoForbiddenCopy("website/index.html", indexHtml);
  assertNoForbiddenCopy("website/script.js", scriptJs);
  assertNoForbiddenCopy("website/release.json", releaseJsonText);
  assertReleaseManifest(release);

  console.log("ZeroLag website smoke test passed.");
  console.log(`Release status: ${release.status}`);
  console.log(`Download ready: ${release.downloadReady ? "yes" : "no"}`);
}

main();
