const { runGuardLoop } = require("./runtime-guard-core");

const sessionPath = process.argv[2];
const onceMode = process.argv.includes("--once");

runGuardLoop(sessionPath, { onceMode }).catch(() => {
  process.exitCode = 1;
});
