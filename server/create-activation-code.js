const crypto = require("crypto");
const { loadServerEnvFile } = require("./env");

loadServerEnvFile();

const { addActivationCode } = require("./index");

function usage() {
  console.log("Usage: node server/create-activation-code.js [code] [durationDays] [maxUses]");
  console.log("Example: node server/create-activation-code.js ZL-PRO-TEST-001 30 1");
}

function makeCode() {
  return `ZL-PRO-${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const code = process.argv[2] || makeCode();
  const durationDays = Number(process.argv[3] || 30);
  const maxUses = Number(process.argv[4] || 1);
  const record = addActivationCode(code, {
    durationDays,
    maxUses,
    plan: "ZeroLag Pro Monthly"
  });

  console.log("Activation code created.");
  console.log(`Code: ${code}`);
  console.log(`Duration: ${record.durationDays} days`);
  console.log(`Max uses: ${record.maxUses}`);
}

main();
