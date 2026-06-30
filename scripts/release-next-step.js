const fs = require("fs");
const path = require("path");
const { collectFormalReleaseInputs } = require("./formal-release-inputs");
const { collectReleaseStatus } = require("./release-status");

const rootDir = path.join(__dirname, "..");
const defaultFormalInputsPath = path.join(rootDir, ".secrets", "formal-release-inputs.json");

function usage() {
  console.log("Usage:");
  console.log("  node scripts/release-next-step.js [--formal-inputs .secrets/formal-release-inputs.json] [--json] [--no-git]");
  console.log("");
  console.log("Prints the single next release action that should happen now.");
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

function allItems(status) {
  return (status.groups || []).flatMap((group) => group.items || []);
}

function itemById(status, id) {
  return allItems(status).find((item) => item.id === id) || null;
}

function failedItem(status, id) {
  const item = itemById(status, id);
  return item && !item.ok ? item : null;
}

function firstFormalFailure(formalResult) {
  return (formalResult.checks || []).find((check) => !check.ok) || null;
}

function commandStartingWith(formalResult, prefix, fallback) {
  return (formalResult.nextCommands || []).find((command) => command.startsWith(prefix)) || fallback;
}

function makeStep(input) {
  return {
    stage: input.stage,
    title: input.title,
    why: input.why,
    command: input.command || "",
    detail: input.detail || "",
    blocksPublicRelease: input.blocksPublicRelease !== false,
    afterThis: input.afterThis || ""
  };
}

function nextFromStatus(status, formalResult) {
  const version = failedItem(status, "version");
  if (version) {
    return makeStep({
      stage: "version",
      title: "Set the first public version",
      why: "A paid release needs a real version number before update metadata, installer names, and website release data are prepared.",
      command: commandStartingWith(formalResult, "npm run release:version", "npm run release:version -- --version 1.0.0 --write"),
      detail: version.detail,
      afterThis: "Run npm run release:status again to confirm package.json and assets/update.json agree."
    });
  }

  const publicUrls = failedItem(status, "public-urls");
  if (publicUrls) {
    return makeStep({
      stage: "production-urls",
      title: "Write production website, API, and CDN URLs",
      why: "The desktop app, update checker, purchase flow, and website download panel must point at real public HTTPS endpoints.",
      command: commandStartingWith(formalResult, "npm run production:config", "npm run production:config -- --domain <domain> --api-domain <api-domain> --cdn-domain <cdn-domain> --write"),
      detail: publicUrls.detail,
      afterThis: "Review assets/app-config.json and assets/update.json before signing update metadata."
    });
  }

  const serverEnv = failedItem(status, "server-env-valid");
  const paymentProvider = failedItem(status, "payment-provider");
  const paymentCredentials = failedItem(status, "payment-credentials");
  if (serverEnv || paymentProvider || paymentCredentials) {
    return makeStep({
      stage: "server-payment-env",
      title: "Apply real payment settings to the private server env",
      why: "The formal input file proves what the provider should be; the private env is what the live server will actually use.",
      command: "Fill .secrets/server.env payment values, then run npm run server:env-check -- --profile sqlite --strict",
      detail: [serverEnv, paymentProvider, paymentCredentials].filter(Boolean).map((item) => `${item.id}: ${item.detail}`).join("; "),
      afterThis: "Run npm run server:check:strict after the provider warnings disappear."
    });
  }

  const downloadUrl = failedItem(status, "download-url");
  if (downloadUrl) {
    return makeStep({
      stage: "signed-update-metadata",
      title: "Prepare signed update metadata with the real CDN URL",
      why: "Users should only receive update prompts whose download URL, installer checksum, and signature match the release artifact.",
      command: commandStartingWith(formalResult, "npm run update:prepare", "npm run release:artifacts && npm run update:prepare -- --base-url <cdn-release-url> --private-key .secrets\\update-private.pem --public-key .secrets\\update-public.pem --write"),
      detail: downloadUrl.detail,
      afterThis: "Run npm run update:smoke and npm run release:status after preparing the manifest."
    });
  }

  const releaseMode = failedItem(status, "release-mode");
  if (releaseMode) {
    return makeStep({
      stage: "production-mode",
      title: "Switch the desktop config to production mode",
      why: "Production mode should be the last desktop-config switch after URLs, keys, update metadata, and demo-license settings are ready.",
      command: commandStartingWith(formalResult, "npm run production:mode", "npm run production:mode -- --mode production --write"),
      detail: releaseMode.detail,
      afterThis: "Run npm run production:check:strict."
    });
  }

  const websiteRelease = failedItem(status, "website-release");
  if (websiteRelease) {
    return makeStep({
      stage: "website-release",
      title: "Publish sanitized website release metadata",
      why: "The public website should show the verified version, download URL, checksum, and customer-facing release notes only after release gates are ready.",
      command: "npm run website:release",
      detail: websiteRelease.detail,
      afterThis: "Run npm run website:smoke and review website/release.json."
    });
  }

  const productionSigning = failedItem(status, "production-signing");
  if (productionSigning) {
    return makeStep({
      stage: "production-signing",
      title: "Configure production code signing",
      why: "The local test certificate proves the signing flow, but a public paid installer needs a real OV/EV signing certificate.",
      command: "Configure CSC_LINK and CSC_KEY_PASSWORD, then run npm run signing:check:strict",
      detail: productionSigning.detail,
      blocksPublicRelease: false,
      afterThis: "Run npm run release:workstation."
    });
  }

  return makeStep({
    stage: "final-gate",
    title: status.publicReleaseReady ? "Run the final release gate" : "Review remaining release status",
    why: status.publicReleaseReady
      ? "All tracked release inputs are ready; the final strict gates should be the last check before building or publishing."
      : "No known priority rule matched, so the status dashboard should be reviewed directly.",
    command: status.publicReleaseReady ? "npm run release:preflight:strict && npm run release:build" : "npm run release:status",
    detail: `${status.summary.blockerCount} blocker(s), ${status.summary.warningCount} warning(s)`,
    blocksPublicRelease: !status.publicReleaseReady,
    afterThis: status.publicReleaseReady ? "Keep the release reports for private review." : "Use the first remaining TODO from release:status."
  });
}

function collectReleaseNextStep(input = {}) {
  const formalInputsPath = path.resolve(input.formalInputsPath || defaultFormalInputsPath);
  const status = input.releaseStatus || collectReleaseStatus({ noGit: input.noGit === true });
  const formalInputsExists = input.formalInputsExists !== undefined
    ? input.formalInputsExists
    : fs.existsSync(formalInputsPath);
  const formalResult = input.formalResult || (
    formalInputsExists ? collectFormalReleaseInputs(input.formalInputsData || readJson(formalInputsPath)) : null
  );

  if (!formalInputsExists) {
    return {
      ok: false,
      publicReleaseReady: false,
      statusSummary: status.summary,
      formalInputs: {
        exists: false,
        file: formalInputsPath
      },
      step: makeStep({
        stage: "formal-inputs-init",
        title: "Create the formal release input file",
        why: "The remaining public-release blockers are mostly external facts: domain, API, CDN, payment merchant, and signing certificate.",
        command: "npm run release:inputs -- --init",
        detail: ".secrets/formal-release-inputs.json is missing.",
        afterThis: "Fill the private file with real values, then run npm run release:inputs."
      })
    };
  }

  if (!formalResult.readyForPublicRelease) {
    const failed = firstFormalFailure(formalResult);
    return {
      ok: false,
      publicReleaseReady: false,
      statusSummary: status.summary,
      formalInputs: {
        exists: true,
        readyItems: formalResult.readyItems,
        totalItems: formalResult.totalItems,
        blockerCount: formalResult.blockerCount,
        warningCount: formalResult.warningCount
      },
      step: makeStep({
        stage: "formal-inputs-fill",
        title: "Finish the formal release input file",
        why: "Code cannot safely switch to public release until the real external facts are known.",
        command: "npm run release:inputs",
        detail: failed ? `${failed.label}: ${failed.detail}` : "Formal release input checks are not ready.",
        afterThis: failed && failed.nextStep ? failed.nextStep : "Run npm run release:inputs again after editing the file."
      })
    };
  }

  const step = nextFromStatus(status, formalResult);
  return {
    ok: status.publicReleaseReady,
    publicReleaseReady: status.publicReleaseReady,
    statusSummary: status.summary,
    formalInputs: {
      exists: true,
      readyItems: formalResult.readyItems,
      totalItems: formalResult.totalItems,
      blockerCount: formalResult.blockerCount,
      warningCount: formalResult.warningCount
    },
    step
  };
}

function printHuman(result) {
  console.log("ZeroLag next release step");
  console.log(`Public release ready: ${result.publicReleaseReady ? "yes" : "no"}`);
  console.log(`Tracked status: ${result.statusSummary.readyItems}/${result.statusSummary.totalItems} ready, ${result.statusSummary.blockerCount} blocker(s), ${result.statusSummary.warningCount} warning(s)`);
  console.log("");
  console.log(`Next: ${result.step.title}`);
  console.log(`Why: ${result.step.why}`);
  if (result.step.detail) console.log(`Detail: ${result.step.detail}`);
  if (result.step.command) console.log(`Command: ${result.step.command}`);
  if (result.step.afterThis) console.log(`After this: ${result.step.afterThis}`);
}

function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const result = collectReleaseNextStep({
    formalInputsPath: argValue("--formal-inputs", defaultFormalInputsPath),
    noGit: process.argv.includes("--no-git")
  });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHuman(result);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectReleaseNextStep
};
