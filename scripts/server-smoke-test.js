const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { loadServerEnvFile } = require("../server/env");

loadServerEnvFile();

const { createAppServer } = require("../server");

const defaultAdminSecret = "zerolag-dev-admin-secret-change-before-production";
const useLiveState = process.argv.includes("--live-state");
const timeoutMs = positiveNumber(process.env.ZEROLAG_SMOKE_TIMEOUT_MS, 5000);
const bindHost = process.env.ZEROLAG_SMOKE_HOST || "127.0.0.1";
const bindPort = Math.max(0, Math.floor(positiveNumber(process.env.ZEROLAG_SMOKE_PORT, 0)));

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requestJson(baseUrl, pathname, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const target = new URL(pathname, baseUrl);
    const payload = body ? JSON.stringify(body) : "";
    const request = http.request(target, {
      method: payload ? "POST" : "GET",
      headers: {
        ...headers,
        ...(payload ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        } : {})
      },
      timeout: timeoutMs
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        try {
          resolve({
            statusCode: response.statusCode,
            body: raw ? JSON.parse(raw) : null
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms: ${pathname}`));
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function safeAddressForUrl(address) {
  if (!address || typeof address === "string") return "127.0.0.1";
  if (address.address === "0.0.0.0" || address.address === "::") return "127.0.0.1";
  if (address.family === "IPv6") return `[${address.address}]`;
  return address.address || "127.0.0.1";
}

function createSmokeOptions() {
  if (useLiveState) {
    return {
      options: {
        rateLimit: {
          namespace: `smoke:${process.pid}:${Date.now()}`
        }
      },
      tempRoot: ""
    };
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerolag-smoke-"));
  return {
    options: {
      statePath: path.join(tempRoot, "server-state.json"),
      backup: {
        dir: path.join(tempRoot, "backups"),
        enabled: true,
        retention: 2
      },
      rateLimit: {
        namespace: `smoke:${process.pid}:${Date.now()}`
      }
    },
    tempRoot
  };
}

function removeSmokeTemp(tempRoot) {
  if (!tempRoot) return;

  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(resolvedTemp) || !path.basename(resolvedRoot).startsWith("zerolag-smoke-")) {
    throw new Error(`Refusing to clean unexpected smoke-test path: ${resolvedRoot}`);
  }

  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

async function main() {
  const { options, tempRoot } = createSmokeOptions();
  const server = createAppServer(options);

  try {
    const address = await listen(server, bindHost, bindPort);
    const baseUrl = `http://${safeAddressForUrl(address)}:${address.port}`;
    const adminSecret = process.env.ZEROLAG_ADMIN_SECRET || defaultAdminSecret;
    const health = await requestJson(baseUrl, "/v1/health");

    assertOk(health.statusCode === 200, `Health check returned HTTP ${health.statusCode}.`);
    assertOk(health.body && health.body.ok === true, "Health check did not return ok=true.");
    assertOk(health.body.product === "ZeroLag", "Health check did not return the ZeroLag product marker.");

    const websiteEvent = await requestJson(baseUrl, "/v1/website/events", {}, {
      product: "ZeroLag",
      event: "release_view",
      detail: {
        version: "0.1.0",
        channel: "smoke",
        status: "preparing"
      }
    });

    assertOk(websiteEvent.statusCode === 202, `Website analytics returned HTTP ${websiteEvent.statusCode}.`);
    assertOk(websiteEvent.body && websiteEvent.body.accepted === true, "Website analytics did not accept the event.");

    const readiness = await requestJson(baseUrl, "/v1/admin/readiness", {
      "X-ZeroLag-Admin-Secret": adminSecret
    });

    assertOk(readiness.statusCode === 200, `Admin readiness returned HTTP ${readiness.statusCode}.`);
    assertOk(readiness.body && readiness.body.ok === true, "Admin readiness did not return ok=true.");
    assertOk(readiness.body.product === "ZeroLag", "Admin readiness did not return the ZeroLag product marker.");
    assertOk(
      readiness.body.state.summary.websiteEvents.total === 1,
      "Admin readiness did not include website analytics aggregate counts."
    );

    console.log("ZeroLag server smoke test passed.");
    console.log(`Mode: ${useLiveState ? "live-state" : "isolated-state"}`);
    console.log(`Health: ${health.body.product} ok`);
    console.log(`Readiness warnings: ${(readiness.body.warnings || []).length}`);
  } finally {
    await closeServer(server);
    removeSmokeTemp(tempRoot);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
