const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..");
const sourcePath = path.join(rootDir, "assets", "zerolag-power-plan-template.json");
const protectedPath = path.join(rootDir, "assets", "zerolag-power-plan-template.protected.json");
const templateProtectionSecret = "zerolag-template-protection-v1";

function deriveKey() {
  return crypto.createHash("sha256").update(templateProtectionSecret).digest();
}

function protectTemplate() {
  if (!fs.existsSync(sourcePath)) {
    console.error("Plain template source is missing.");
    process.exitCode = 1;
    return;
  }

  const source = fs.readFileSync(sourcePath);
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from("ZeroLagRuntimeTemplate:v1", "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(source), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    version: 1,
    algorithm: "aes-256-gcm",
    aad: aad.toString("utf8"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };

  fs.writeFileSync(protectedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log("Protected template updated.");
}

protectTemplate();
