# ZeroLag Release Checklist

Use this checklist before preparing a paid public build.

Generate the current machine-readable checklist first:

```powershell
npm run deploy:checklist
npm run server:deployment-report:smoke
npm run server:deployment-report
npm run server:deployment-report:json
npm run server:deployment-report:strict
```

## 1. Desktop Release Config

- Set `assets/app-config.json` `releaseMode` to `production`.
- Prefer `npm run production:mode -- --mode production --write` so release mode is written only after required public release fields are ready.
- Set real HTTPS values for `websiteUrl`, `purchaseUrl`, `analyticsUrl`, `supportUrl`, `apiBaseUrl`, and `updateManifestUrl`.
- Use `npm run production:config -- --domain your-domain.example --write` to generate the production URL fields, then review them before building.
- Set `allowLocalDemoLicense` to `false`.
- Generate the runtime-session RSA keypair with `npm run runtime:keys -- --output-dir .secrets\runtime-session --key-version runtime-session-v1`.
- Generate the update-signing keypair with `npm run update:sign -- --generate-keypair .secrets\update-private.pem .secrets\update-public.pem --app-config-snippet .secrets\update-app-config-snippet.json`.
- Add the generated update public-key snippet to `updatePublicKeyPem`; never ship or commit the matching private key.
- Copy only the generated app config snippet public key to `runtimeSessionPublicKeyPem`; never ship the matching private key.
- Prefer `npm run app-config:snippet -- --snippet <snippet.json> --write` when applying public-key snippets so private key material is rejected automatically.

## 2. Server Readiness

- Generate private server secrets with `npm run server:secrets -- --write`.
- For the first paid-release server setup, prefer `npm run server:bootstrap`; it creates `.secrets/server.env`, runtime-session RSA keys, and a public-key app-config snippet without printing secrets.
- For SQLite paid testing, generate the private env template with `npm run server:secrets -- --profile sqlite --write`.
- Copy the generated `runtime-session-v1.server.env` values into the private server env file; keep the generated private PEM and env file outside Git.
- Run `npm run server:env-check -- --profile sqlite`; `npm run server:check:strict` also repeats this redacted env-file validation.
- Confirm `ZEROLAG_RUNTIME_SESSION_KEY_VERSION` is present in the private env file and matches the runtime-session signing strategy for this release.
- Confirm `ZEROLAG_RUNTIME_SESSION_PROOF_ALGORITHM=RSA-SHA256` before paid public release, with `ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_B64` or `ZEROLAG_RUNTIME_SESSION_PRIVATE_KEY_PEM` stored only on the server and matching `runtimeSessionPublicKeyPem` in the desktop config.
- Run `npm run server:deployment-report:smoke` to verify Markdown, JSON, strict failure behavior, and redaction before trusting deployment reports.
- Run `npm run server:deployment-report` to generate a private deployment summary for env, storage, payment, update, and public endpoint readiness without printing secret values.
- Run `npm run server:deployment-report:json` when CI, deployment scripts, or private dashboards need a machine-readable readiness result.
- Run `npm run server:deployment-report:strict` before a paid public release; it fails when production env, storage, payment, URLs, or runtime guards are not ready.
- Keep `.secrets/server.env` private and outside Git.
- If migrating existing JSON state, run `npm run server:migrate-sqlite -- --input <json> --output <sqlite>` before enabling SQLite mode.
- After migration, run `npm run server:backup-sqlite -- --input <sqlite> --output <sqlite-backup>` and keep the backup private.
- Run `npm run server:check-sqlite-backups -- --dir <sqlite-backup-dir> --max-age-hours 24` and confirm the newest backup is readable.
- Keep the recovery command documented for incidents: `npm run server:restore-sqlite -- --input <sqlite-backup> --output <sqlite> --force`.
- For wider paid testing, set `ZEROLAG_STATE_STORE=sqlite` and configure `ZEROLAG_SQLITE_STATE_PATH` on durable storage.
- Confirm `npm run server:check:strict` prints safe SQLite state and backup summaries and does not report SQLite storage issues.
- Configure `ZEROLAG_PAYMENT_PROVIDER`, `ZEROLAG_PAYMENT_ALLOWED_PROVIDERS`, `ZEROLAG_PAYMENT_URL_TEMPLATE`, and `ZEROLAG_PAYMENT_MESSAGE` for the real payment provider.
- For WeChat Pay, configure `ZEROLAG_WECHAT_PAY_MCH_ID`, `ZEROLAG_WECHAT_PAY_APP_ID`, `ZEROLAG_WECHAT_PAY_API_V3_KEY`, `ZEROLAG_WECHAT_PAY_SERIAL_NO`, and `ZEROLAG_WECHAT_PAY_PRIVATE_KEY_PATH`; for Alipay, configure `ZEROLAG_ALIPAY_APP_ID`, `ZEROLAG_ALIPAY_PRIVATE_KEY_PATH`, and `ZEROLAG_ALIPAY_PUBLIC_KEY_PATH`.
- Run `npm run server:check:strict`.
- Run `npm run server:smoke`; it should print `isolated-sqlite` when SQLite is configured and must not touch the live state path.
- Run `npm run server:smoke -- --live-state` only during a planned private maintenance window when you intentionally want to test the configured live state.
- Confirm backups, rate limiting, and maintenance cleanup are enabled.

## 3. Update Manifest

- Run `npm run release:version -- --version 1.0.0 --write` to synchronize `package.json` and `assets/update.json` before signing.
- Use `--min-supported 1.0.0` when a release should force very old clients to update.
- Replace placeholder download URLs with the final HTTPS download page.
- Prefer `npm run update:prepare -- --base-url https://cdn.your-domain.example/releases --private-key .secrets\update-private.pem --public-key .secrets\update-public.pem --write` after `npm run release:artifacts`.
- Keep `assets/update.json` public release notes customer-facing; do not mention internal protection strategy, watchdogs, Windows services, private keys, server env, or packaging helper details.
- Run `npm run update:smoke` to verify the signing toolchain with temporary keys.
- Sign the update manifest with the private update key.
- Verify the manifest with the public key.

```powershell
npm run update:sign -- --generate-keypair .\.secrets\update-private.pem .\.secrets\update-public.pem --app-config-snippet .\.secrets\update-app-config-snippet.json
npm run update:sign -- assets\update.json .\.secrets\update-private.pem
npm run update:sign -- --verify assets\update.json .\.secrets\update-public.pem
```

## 4. Installer And Signing

- Verify the Windows installer packaging config in `package.json`.
- Generate or replace the Windows icon at `build/icon.ico`.
- Run `npm run pack:dir` for an unpacked local build.
- Run `npm run package:smoke` to verify the unpacked build contains the executable, app archive, icon, and unpacked runtime watchdog.
- Run `npm run installer:guard:smoke` to verify the NSIS guard hook is present, gated, uninstall-aware, and service-first before Task Scheduler fallback.
- Run `npm run guard:service:smoke` to verify the Windows Service guard manifest, install script, uninstall script, and packaged resources.
- Run `npm run guard:install:smoke` to verify the service install script refuses accidental registration unless the private validation switch is passed with `-WhatIf`.
- Run `npm run guard:task:smoke` to verify the Task Scheduler fallback refuses accidental registration unless the private validation switch is passed with `-WhatIf`.
- Run `npm run guard:runtime:smoke` to verify the service worker can clean invalid runtime sessions in dry-run mode and write health/log state.
- Confirm the installer service command uses `ZeroLag.exe --runtime-guard-service` and that the native service wrapper warning is resolved before paid public release.
- Keep `ZEROLAG_ENABLE_GUARD_REGISTRATION` disabled for development installers; enable it only for private validation or the final signed build after the native service wrapper is ready.
- Run `npm run dist:win` only after the strict release gates are satisfied.
- Run `npm run installer:smoke` to verify the installer executable, blockmap, update metadata, and Windows installer settings.
- Run `npm run release:artifacts` to generate public checksum and artifact metadata files for the download page.
- Run `npm run release:report:smoke` to verify the release candidate report renders desktop readiness, server deployment gates, and redacted JSON safely.
- Run `npm run ci:reports:smoke` to verify CI report artifacts can be generated, parsed, and kept free of private env values.
- Run `npm run release:report` to generate a release candidate report with Git state, readiness checks, installer checksum status, and server deployment gate status.
- Run `npm run release:gate:smoke` to verify the final release gate fails safely for an unready isolated development configuration.
- Run `npm run release:gate` only after the strict server, desktop, installer, signing, and website release checks are expected to pass.
- Run `npm run website:release` to publish sanitized version, download, and checksum metadata to the static website.
- Run `npm run website:smoke` to verify the website download panel, release manifest, checksum display, and public copy guardrails.
- Run `npm run website:release:smoke` to simulate available and preparing website release publishing without touching the real website manifest.
- Run `npm run release:verify` when validating an existing installer output; it runs `release:gate` before publishing sanitized website release metadata.
- Run `npm run release:build` to build the installer and then run the gated verification chain.
- Download the `zerolag-ci-reports` artifact from the latest GitHub Actions run and review the redacted server deployment and release-candidate reports before publishing.
- Configure Windows code signing in the build environment.
- Run `npm run signing:check:strict` in the same shell or CI job that builds the installer.
- Prefer CI secrets such as `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` for electron-builder signing.
- Keep signing certificates and passwords outside Git.

## 5. Final Gates

```powershell
npm run ci
npm run release:gate
npm run production:check:strict
npm run release:preflight:strict
```

Only cut a public release after all strict gates pass.
