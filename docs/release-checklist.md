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
- Set real HTTPS values for `websiteUrl`, `purchaseUrl`, `analyticsUrl`, `supportUrl`, `apiBaseUrl`, and `updateManifestUrl`.
- Set `allowLocalDemoLicense` to `false`.
- Add the production update public key to `updatePublicKeyPem`.

## 2. Server Readiness

- Generate private server secrets with `npm run server:secrets -- --write`.
- For SQLite paid testing, generate the private env template with `npm run server:secrets -- --profile sqlite --write`.
- Run `npm run server:env-check -- --profile sqlite`; `npm run server:check:strict` also repeats this redacted env-file validation.
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
- Run `npm run server:check:strict`.
- Run `npm run server:smoke`; it should print `isolated-sqlite` when SQLite is configured and must not touch the live state path.
- Run `npm run server:smoke -- --live-state` only during a planned private maintenance window when you intentionally want to test the configured live state.
- Confirm backups, rate limiting, and maintenance cleanup are enabled.

## 3. Update Manifest

- Update `assets/update.json` `latest` to match `package.json` version.
- Replace placeholder download URLs with the final HTTPS download page.
- Run `npm run update:smoke` to verify the signing toolchain with temporary keys.
- Sign the update manifest with the private update key.
- Verify the manifest with the public key.

```powershell
npm run update:sign -- assets\update.json .\.secrets\update-private.pem
npm run update:sign -- --verify assets\update.json .\.secrets\update-public.pem
```

## 4. Installer And Signing

- Verify the Windows installer packaging config in `package.json`.
- Generate or replace the Windows icon at `build/icon.ico`.
- Run `npm run pack:dir` for an unpacked local build.
- Run `npm run package:smoke` to verify the unpacked build contains the executable, app archive, icon, and unpacked runtime watchdog.
- Run `npm run guard:service:smoke` to verify the Windows Service guard manifest, install script, uninstall script, and packaged resources.
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
