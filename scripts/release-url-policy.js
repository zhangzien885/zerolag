const net = require("net");

const reservedTlds = new Set(["example", "invalid", "localhost", "test"]);
const localHostnames = new Set(["localhost", "local"]);
const exactPlaceholderHosts = new Set(["example.com"]);

function normalizeHostname(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/g, "");
}

function hostnameFromUrl(value) {
  try {
    return normalizeHostname(new URL(String(value || "")).hostname);
  } catch (_error) {
    return "";
  }
}

function isHttpUrl(value) {
  try {
    const protocol = new URL(String(value || "")).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a >= 224;
}

function isPrivateIpv6(hostname) {
  const host = normalizeHostname(hostname);
  return host === "::"
    || host === "::1"
    || host.startsWith("fc")
    || host.startsWith("fd")
    || host.startsWith("fe80:")
    || host.startsWith("2001:db8:");
}

function isPlaceholderHost(value) {
  const hostname = normalizeHostname(value);
  if (!hostname) return true;
  if (hostname.includes("..")) return true;
  if (hostname.endsWith(".local")) return true;
  if (!hostname.includes(".") && net.isIP(hostname) === 0) return true;
  if (localHostnames.has(hostname) || exactPlaceholderHosts.has(hostname)) return true;
  if (hostname.endsWith(".example.com")) return true;

  const labels = hostname.split(".");
  const tld = labels[labels.length - 1];
  if (reservedTlds.has(tld)) return true;

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) return isPrivateIpv4(hostname);
  if (ipVersion === 6) return isPrivateIpv6(hostname);

  return false;
}

function isPlaceholderUrl(value) {
  return isPlaceholderHost(hostnameFromUrl(value));
}

function isRealHttpsUrl(value) {
  return isHttpsUrl(value) && !isPlaceholderUrl(value);
}

function isRealHttpUrl(value) {
  return isHttpUrl(value) && !isPlaceholderUrl(value);
}

module.exports = {
  isHttpUrl,
  isHttpsUrl,
  isPlaceholderHost,
  isPlaceholderUrl,
  isRealHttpUrl,
  isRealHttpsUrl,
  normalizeHostname
};
