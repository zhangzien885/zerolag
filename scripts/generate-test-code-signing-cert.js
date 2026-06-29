const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const defaultOutputDir = path.join(rootDir, ".secrets", "codesign");
const defaultSubject = "CN=ZeroLag Local Test Code Signing";
const certFileName = "zerolag-test-codesign.pfx";
const envFileName = "test-signing.env";
const psEnvFileName = "use-test-signing-env.ps1";

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(filePath)} (external)`;
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function randomPassword() {
  return `zl_test_${crypto.randomBytes(24).toString("base64url")}`;
}

function writeEnvFiles({ envPath, psEnvPath, pfxPath, password, subject, thumbprint }) {
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(envPath, [
    "# ZeroLag local TEST code-signing certificate.",
    "# Do not commit this file. It is for development packaging only, not paid public release.",
    `CSC_LINK=${pfxPath}`,
    `CSC_KEY_PASSWORD=${password}`,
    "ZEROLAG_CODESIGN_PROFILE=test",
    `ZEROLAG_CODESIGN_SUBJECT=${subject}`,
    `ZEROLAG_CODESIGN_THUMBPRINT=${thumbprint}`,
    `ZEROLAG_CODESIGN_GENERATED_AT=${generatedAt}`,
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(psEnvPath, [
    "# Dot-source this file in PowerShell when you want test signing in the current shell:",
    "# . .\\.secrets\\codesign\\use-test-signing-env.ps1",
    `$env:CSC_LINK = ${quotePowerShell(pfxPath)}`,
    `$env:CSC_KEY_PASSWORD = ${quotePowerShell(password)}`,
    "$env:ZEROLAG_CODESIGN_PROFILE = 'test'",
    `$env:ZEROLAG_CODESIGN_ENV_FILE = ${quotePowerShell(envPath)}`,
    ""
  ].join("\n"), "utf8");
}

function powershellScript() {
  return `
$ErrorActionPreference = "Stop"
$subject = $env:ZEROLAG_TEST_CODESIGN_SUBJECT
$pfxPath = $env:ZEROLAG_TEST_CODESIGN_PFX
$passwordText = $env:ZEROLAG_TEST_CODESIGN_PASSWORD
$validYears = [int]$env:ZEROLAG_TEST_CODESIGN_VALID_YEARS
$password = ConvertTo-SecureString -String $passwordText -AsPlainText -Force
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -CertStoreLocation "Cert:\\CurrentUser\\My" -KeyExportPolicy Exportable -KeySpec Signature -KeyLength 3072 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears($validYears)
try {
  Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password -Force | Out-Null
  [pscustomobject]@{
    thumbprint = $cert.Thumbprint
    subject = $cert.Subject
    notAfter = $cert.NotAfter.ToString("o")
  } | ConvertTo-Json -Compress
} finally {
  Remove-Item -LiteralPath ("Cert:\\CurrentUser\\My\\" + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue
}
`;
}

function generateTestCodeSigningCert(input = {}) {
  const outputDir = path.resolve(input.outputDir || defaultOutputDir);
  const pfxPath = path.resolve(input.pfxPath || path.join(outputDir, certFileName));
  const envPath = path.resolve(input.envPath || path.join(outputDir, envFileName));
  const psEnvPath = path.resolve(input.psEnvPath || path.join(outputDir, psEnvFileName));
  const subject = input.subject || defaultSubject;
  const validYears = Number(input.validYears || 2);
  const force = input.force === true;
  const dryRun = input.dryRun === true;

  if (process.platform !== "win32" && !dryRun) {
    throw new Error("Test code-signing certificate generation requires Windows PowerShell.");
  }

  if (!force && !dryRun && (fs.existsSync(pfxPath) || fs.existsSync(envPath))) {
    throw new Error("Test code-signing files already exist. Pass --force to replace them.");
  }

  const resultBase = {
    ok: true,
    dryRun,
    profile: "test",
    pfx: safeRelative(pfxPath),
    envFile: safeRelative(envPath),
    psEnvFile: safeRelative(psEnvPath),
    subject,
    nextCommands: [
      "npm run signing:check:strict",
      "npm run release:workstation",
      ". .\\.secrets\\codesign\\use-test-signing-env.ps1"
    ]
  };

  if (dryRun) return resultBase;

  fs.mkdirSync(outputDir, { recursive: true });
  const password = randomPassword();
  const ps = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", powershellScript()], {
    cwd: rootDir,
    env: {
      ...process.env,
      ZEROLAG_TEST_CODESIGN_SUBJECT: subject,
      ZEROLAG_TEST_CODESIGN_PFX: pfxPath,
      ZEROLAG_TEST_CODESIGN_PASSWORD: password,
      ZEROLAG_TEST_CODESIGN_VALID_YEARS: String(validYears)
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (ps.status !== 0) {
    throw new Error(`Failed to generate test code-signing certificate: ${ps.stderr || ps.stdout}`);
  }

  const certSummary = JSON.parse(String(ps.stdout || "").trim());
  writeEnvFiles({
    envPath,
    psEnvPath,
    pfxPath,
    password,
    subject: certSummary.subject || subject,
    thumbprint: certSummary.thumbprint || ""
  });

  return {
    ...resultBase,
    thumbprint: certSummary.thumbprint || "",
    notAfter: certSummary.notAfter || ""
  };
}

function main() {
  try {
    if (hasArg("--help")) {
      console.log("Usage:");
      console.log("  node scripts/generate-test-code-signing-cert.js [--force] [--json] [--dry-run]");
      return;
    }

    const result = generateTestCodeSigningCert({
      outputDir: argValue("--output-dir", defaultOutputDir),
      subject: argValue("--subject", defaultSubject),
      validYears: argValue("--valid-years", "2"),
      force: hasArg("--force"),
      dryRun: hasArg("--dry-run")
    });

    if (hasArg("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log("ZeroLag local TEST code-signing certificate prepared.");
    console.log(`PFX: ${result.pfx}`);
    console.log(`Env file: ${result.envFile}`);
    console.log(`PowerShell env helper: ${result.psEnvFile}`);
    console.log("This certificate is only for development testing, not paid public release.");
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  generateTestCodeSigningCert
};
