const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const defaultPackagePath = path.join(rootDir, "package.json");
const defaultUpdatePath = path.join(rootDir, "assets", "update.json");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/sync-release-version.js [--version 1.0.0] [--min-supported 1.0.0] [--write]");
  console.log("");
  console.log("Checks or synchronizes package.json and assets/update.json release versions.");
  console.log("Dry-run is default; pass --write to update the target JSON files.");
}

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(value || ""));
}

function safeRelative(filePath) {
  const relative = path.relative(rootDir, path.resolve(filePath));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return `${path.basename(filePath)} (external)`;
}

function syncReleaseVersion(input = {}) {
  const packagePath = path.resolve(input.packagePath || defaultPackagePath);
  const updatePath = path.resolve(input.updatePath || defaultUpdatePath);
  const write = input.write === true;
  const packageJson = readJson(packagePath);
  const updateManifest = readJson(updatePath);
  const currentPackageVersion = String(packageJson.version || "");
  const currentManifestLatest = String(updateManifest.latest || "");
  const targetVersion = String(input.version || currentPackageVersion);
  const targetMinSupported = String(input.minSupported || updateManifest.minSupported || targetVersion);

  if (!isSemver(targetVersion)) {
    throw new Error(`Release version must be semantic, for example 1.0.0. Received: ${targetVersion || "missing"}`);
  }
  if (!isSemver(targetMinSupported)) {
    throw new Error(`Minimum supported version must be semantic, for example 1.0.0. Received: ${targetMinSupported || "missing"}`);
  }

  const packagePatch = {
    version: targetVersion
  };
  const updatePatch = {
    latest: targetVersion,
    minSupported: targetMinSupported
  };
  const alreadyAligned = currentPackageVersion === targetVersion
    && currentManifestLatest === targetVersion
    && String(updateManifest.minSupported || "") === targetMinSupported;

  if (write) {
    writeJson(packagePath, { ...packageJson, ...packagePatch });
    writeJson(updatePath, { ...updateManifest, ...updatePatch });
  }

  return {
    ok: alreadyAligned || write,
    written: write,
    packageFile: safeRelative(packagePath),
    updateManifestFile: safeRelative(updatePath),
    before: {
      packageVersion: currentPackageVersion,
      updateLatest: currentManifestLatest,
      minSupported: String(updateManifest.minSupported || "")
    },
    target: {
      version: targetVersion,
      minSupported: targetMinSupported
    },
    changes: {
      packageVersion: currentPackageVersion !== targetVersion,
      updateLatest: currentManifestLatest !== targetVersion,
      minSupported: String(updateManifest.minSupported || "") !== targetMinSupported
    },
    nextSteps: [
      "Review customer-facing release notes in assets/update.json.",
      "Run npm run update:sign after the final download URL and version are ready.",
      "Run npm run release:preflight:strict before publishing the installer."
    ]
  };
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  try {
    const result = syncReleaseVersion({
      version: argValue("--version"),
      minSupported: argValue("--min-supported"),
      packagePath: argValue("--package", defaultPackagePath),
      updatePath: argValue("--update", defaultUpdatePath),
      write: process.argv.includes("--write")
    });
    console.log(JSON.stringify(result, null, 2));

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  syncReleaseVersion
};
