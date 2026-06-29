const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const projectPath = path.join(rootDir, "build", "native-service", "ZeroLag.RuntimeGuard.Service.csproj");
const programPath = path.join(rootDir, "build", "native-service", "Program.cs");
const defaultOutputDir = path.join(rootDir, "build", "native-service", "dist");
const exeName = "ZeroLag.RuntimeGuard.Service.exe";

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function dotnetVersion() {
  const result = spawnSync("dotnet", ["--version"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function ensureSourceFiles() {
  const missing = [projectPath, programPath].filter((filePath) => !fs.existsSync(filePath));
  if (missing.length) {
    throw new Error(`Missing native service wrapper source file(s): ${missing.map((item) => path.relative(rootDir, item)).join(", ")}`);
  }
}

function buildCommand(outputDir) {
  return [
    "publish",
    projectPath,
    "-c",
    "Release",
    "-r",
    "win-x64",
    "--self-contained",
    "true",
    "-p:PublishSingleFile=true",
    "-p:EnableCompressionInSingleFile=true",
    "-o",
    outputDir
  ];
}

function buildNativeServiceWrapper(input = {}) {
  const outputDir = path.resolve(input.outputDir || defaultOutputDir);
  const exePath = path.join(outputDir, exeName);
  const command = buildCommand(outputDir);
  const dryRun = input.dryRun === true;
  const optional = input.optional === true;
  const json = input.json === true;

  ensureSourceFiles();
  const version = dotnetVersion();
  if (!version) {
    const result = {
      ok: optional,
      skipped: optional,
      reason: ".NET SDK was not found. Install .NET 8 SDK, then rerun npm run guard:wrapper:build.",
      project: path.relative(rootDir, projectPath).replace(/\\/g, "/"),
      output: path.relative(rootDir, exePath).replace(/\\/g, "/"),
      command: `dotnet ${command.map((item) => item.includes(" ") ? `"${item}"` : item).join(" ")}`
    };
    if (json) printJson(result);
    else console.log(result.reason);
    if (!optional) process.exitCode = 1;
    return result;
  }

  if (dryRun) {
    const result = {
      ok: true,
      dryRun: true,
      dotnetVersion: version,
      project: path.relative(rootDir, projectPath).replace(/\\/g, "/"),
      output: path.relative(rootDir, exePath).replace(/\\/g, "/"),
      command: `dotnet ${command.map((item) => item.includes(" ") ? `"${item}"` : item).join(" ")}`
    };
    if (json) printJson(result);
    else console.log(result.command);
    return result;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const publish = spawnSync("dotnet", command, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "inherit"
  });

  if (publish.status !== 0) {
    process.exitCode = publish.status || 1;
    return {
      ok: false,
      output: exePath
    };
  }

  if (!fs.existsSync(exePath)) {
    throw new Error(`Native service wrapper build completed but output is missing: ${exePath}`);
  }

  const result = {
    ok: true,
    dotnetVersion: version,
    output: path.relative(rootDir, exePath).replace(/\\/g, "/")
  };
  if (json) printJson(result);
  else console.log(`ZeroLag native service wrapper built: ${result.output}`);
  return result;
}

function main() {
  try {
    buildNativeServiceWrapper({
      outputDir: argValue("--output", defaultOutputDir),
      dryRun: hasArg("--dry-run"),
      optional: hasArg("--optional"),
      json: hasArg("--json")
    });
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildNativeServiceWrapper
};
