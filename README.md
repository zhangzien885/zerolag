# ZeroLag

ZeroLag is a Windows extreme gaming performance optimizer.

## First version

- Desktop app shell built with Electron.
- High-fidelity gaming performance dashboard.
- One-click boost flow.
- Creates and activates a temporary runtime gaming power plan.
- Restores the original power plan and deletes the temporary plan when ZeroLag exits.
- Keeps the power plan temporary to support a monthly subscription model.
- Gates boost actions behind a local signed license prototype.
- Uses an encrypted tuning package instead of a plain tuning template.
- Starts a detached watchdog to restore and delete runtime tuning if the app is force killed.
- Signs runtime session files so the cleanup guard can reject tampered sessions.
- Adds a temporary Task Scheduler cleanup guard while Boost is active, then removes it after restore.
- Monitors runtime authorization and restores daily mode if the active session is no longer valid.
- Performs safe background load reduction after Boost using an internal non-critical process allowlist.
- Runs a Boost memory optimization pass that clears system memory lists and trims accessible process working sets before gaming without killing user processes.
- Checks for available updates on startup and supports normal / forced update prompts.
- Provides a game-toolbox version center for manual update checks and download handoff.
- Keeps running in the Windows tray when the main window is closed; use the tray menu to reopen or fully exit.
- Provides server health and admin readiness checks for private deployment operations.
- Provides automatic and admin-triggered maintenance cleanup for expired memberships and stale server tokens.
- Provides manual rescan and restore-daily-mode controls from the topbar.
- Shows a restore assurance card so users can see when Boost can safely return to daily mode.
- Includes a game toolbox button that opens local game library, one-click game launch, network latency check, DNS refresh, and Boost session timer tools.
- Exports a redacted support diagnostics bundle from the game toolbox for customer support.
- Reveals the saved diagnostics bundle location after export without exposing the full local path in the renderer.
- Keeps a local redacted support log so diagnostics include recent user-facing events without activation codes, tokens, paths, or tuning details.
- Opens a configured official support page from the game toolbox with safe handoff feedback for customer help and diagnostics.
- Prepares and copies a support handoff summary with case ID, membership, version, runtime, and readiness status before contacting support.
- Shows membership expiry and renewal guidance before Pro access runs out.
- Supports account binding foundations for WeChat, QQ, email, and phone accounts, with memberships linked to the signed-in account, paused when the account is signed out, usable on another computer after signing in again, and limited to the newest active computer login.
- Shows a production-style account-gated purchase flow with checkout handoff, official purchase fallback, order refresh, payment provider status, and activation-code copy only after payment completion.
- Lets users copy paid order IDs for support when payment status needs checking.
- Normalizes pasted activation codes so common whitespace, full-width, and copied label formats are easier to activate.
- Shows official service readiness in the toolbox for website, purchase, account, update, and support channels, with safe website handoff feedback.
- Includes an official website button with a placeholder URL for the future ZeroLag site.
- Writes VBS / HVCI / Credential Guard / Hypervisor disable configuration.
- Does not delete files.

## Paid release requirements

- Configure `assets/app-config.json` with the production website, API, update manifest, and demo-license switch.
- Implement the backend contract in `docs/server-api-contract.md`.
- Build and privately validate the native Windows Service wrapper before paid release.
- Keep Task Scheduler registration as the installer fallback if service installation fails.
- The guard must restore the original power plan and delete runtime tuning after crash, force kill, logout, restart, subscription expiry, or integrity failure.
- Deploy the static landing page in `website/` as the official ZeroLag website.
- Keep `docs/tasks.md` updated as prototype features move into the paid release roadmap.
- See `docs/production-guard-plan.md` for the production guard design.

## Production readiness

```powershell
npm run production:check
npm run production:check:strict
npm run server:check
npm run server:check:strict
npm run server:env-status
npm run server:sqlite-status
npm run server:smoke
npm run server:payment-loop
npm run server:deployment-pack
npm run server:provision-local
npm run server:secrets
npm run release:preflight
npm run release:preflight:strict
npm run release:version -- --version 1.0.0 --write
npm run signing:check:strict
npm run app-config:snippet -- --snippet .\.secrets\update-app-config-snippet.json --write
npm run app-config:snippet -- --snippet .\.secrets\runtime-session\runtime-session-v1.app-config-snippet.json --write
npm run update:prepare -- --base-url https://cdn.your-domain.example/releases --private-key .\.secrets\update-private.pem --public-key .\.secrets\update-public.pem --write
npm run production:mode -- --mode production --write
```

`production:check` validates desktop release config. `server:check` validates server deployment environment variables. Use the `:strict` variants before a real paid release.
`server:env-status` prints a redacted private env readiness summary and next commands without exposing secrets.
`server:sqlite-status` prints a read-only SQLite state and backup readiness summary with safe paths, freshness status, and next commands for migration, backup, or recovery.
`server:smoke` starts a temporary local license server, checks public health, and verifies the admin readiness endpoint with the loaded server secret configuration.
`server:payment-loop` starts an isolated temporary server and verifies the paid loop: account login, order creation, signed payment webhook, order activation, membership validation, refund webhook, and membership revocation.
`server:deployment-pack` writes a server-only deployment folder under `dist/server-deployment` with runtime server files, ops scripts, reverse-proxy examples, env template, and a manifest without shipping desktop app files or private secrets.
`server:provision-local` prepares the private local server environment with `.secrets/server.env`, runtime-session RSA keys, SQLite state, a verified SQLite backup, and a refreshed server deployment pack.
`server:secrets` prints strong private server secrets; use `npm run server:secrets -- --write` to save them under `.secrets/server.env`.

Server commands automatically load `.secrets/server.env` when it exists. Existing system environment variables stay higher priority, and `ZEROLAG_ENV_FILE` can point commands at another private env file for staging or deployment tests.

`release:preflight` summarizes the remaining packaging, signing, update, and production-config gates. Use `release:preflight:strict` only when preparing a real public build. See `docs/release-checklist.md`.
`release:version` synchronizes `package.json` and `assets/update.json` release versions; dry-run is default, and `--write` applies the change.
`signing:check:strict` verifies that the installer signing certificate and password are configured without printing secret values.
`app-config:snippet` safely applies public-key snippets to `assets/app-config.json` and rejects private key material.
`update:prepare` builds the signed public update manifest from verified release artifacts and a real CDN base URL.
`production:mode` switches `releaseMode` only after production URLs, public keys, update metadata, and demo-license settings are ready.

## Signed updates

Production update prompts should use signed metadata:

```powershell
npm run update:sign -- --generate-keypair .\.secrets\update-private.pem .\.secrets\update-public.pem --app-config-snippet .\.secrets\update-app-config-snippet.json
npm run app-config:snippet -- --snippet .\.secrets\update-app-config-snippet.json --write
npm run update:prepare -- --base-url https://cdn.your-domain.example/releases --private-key .\.secrets\update-private.pem --public-key .\.secrets\update-public.pem --write
npm run update:sign -- assets\update.json .\.secrets\update-private.pem
npm run update:sign -- --verify assets\update.json .\.secrets\update-public.pem
npm run update:smoke
```

Keep the private key outside Git. Put only the generated snippet's `updatePublicKeyPem` public key into `assets/app-config.json` for production builds.
`update:smoke` uses temporary keys and a copied manifest to verify the signing toolchain without touching real release keys or `assets/update.json`.

## License server MVP

```powershell
npm run server:test
npm run server:create-code -- ZL-PRO-TEST-001 30 1
npm run server:start
npm run dev:server-app
```

The local MVP server implements activation and validation endpoints used by the desktop app. See `server/README.md` and `docs/server-api-contract.md`.

`dev:server-app` starts the local license server, creates a test activation code, and opens the desktop app in server-backed membership mode without changing the protected production config file.

The server also includes a provider-neutral order flow so payment callbacks can later complete orders and issue one-time activation codes.

For local desktop purchase testing, run `npm run dev:server-app`, open the purchase dialog, then use `npm run server:admin -- complete-latest manual_trade_id` or `npm run server:admin -- send-webhook ord_xxx manual_trade_id` to simulate a successful payment.

The paid-flow MVP includes a signed `POST /v1/payments/webhook` endpoint for payment-success and refund events. Same-device renewals extend the existing subscription instead of creating a separate membership record. Production deployments must set a strong `ZEROLAG_PAYMENT_WEBHOOK_SECRET` and connect the final payment provider to that callback.

The server also includes admin membership support endpoints for listing subscriptions, inspecting linked orders, and manually revoking access during private testing or support.

Operational audit events are recorded for important order, payment, license, renewal, refund, and admin actions, without storing activation codes or tokens in the audit feed.

## Website

The first official website landing page is available under `website/`.

```powershell
Start-Process .\website\index.html
```

## Local demo license

Local demo activation is disabled in the default config so release builds do not accidentally ship a free activation path.
For development-only checks, launch with `ZEROLAG_ALLOW_LOCAL_DEMO=true` and use:

```text
ZL-PRO-DEMO-2026
```

The demo license binds to the current Windows machine and stores a signed local license under Electron's app data directory. Paid releases should use server-side account, device, and subscription validation instead.

## Run

```powershell
npm install
npm start
```

On Windows, the app automatically relaunches with an administrator UAC prompt because the boost flow needs registry, `bcdedit`, and power plan permissions.

For UI-only debugging without the administrator prompt or runtime power plan switch:

```powershell
cd C:\Users\Administrator\Documents\zerolag
.\node_modules\.bin\electron.cmd . --no-elevation --no-runtime-plan
```

## Check

```powershell
npm run check
npm run ci
```

`ci` runs the standard local verification set used by GitHub Actions: syntax checks, desktop production readiness, restore/support/payment/service UI smoke checks, server readiness, SQLite storage-status smoke checks, server self-test, server smoke test, CI report-artifact smoke checks, Windows Service guard asset, uninstall cleanup, worker checks, and integrity verification.
It also runs the non-strict release preflight so release gaps stay visible during normal development.

## Continuous Integration

GitHub Actions runs on pushes and pull requests to `main`. The workflow installs dependencies with `npm ci`, runs `npm run ci`, then performs strict SQLite server readiness, backup validation, and smoke testing against a temporary private env file. Each run also uploads a redacted `zerolag-ci-reports` artifact with server deployment and release-candidate reports for private review.

## Package

```powershell
npm run icon:generate
npm run pack:dir
npm run package:smoke
npm run package:verify
npm run dist:win
npm run installer:smoke
npm run installer:verify
npm run release:artifacts
npm run release:report
npm run release:gate
npm run website:release
npm run website:smoke
npm run website:release:smoke
npm run release:verify
npm run release:build
```

`icon:generate` creates the Windows icon from the ZeroLag visual style. `pack:dir` creates an unpacked desktop build for local verification. `package:smoke` checks the current unpacked build output. `package:verify` rebuilds the unpacked app and runs that smoke test. `dist:win` is the Windows NSIS installer entry point for release builds. `installer:smoke` checks the existing installer `.exe`, blockmap, update metadata, and Windows installer settings. `installer:verify` rebuilds the installer and then runs that smoke test. `release:artifacts` writes `dist/release-artifacts.json` and `dist/checksums.txt` for website downloads and support verification. `release:report` writes `dist/release-candidate-report.md` and `.json` with the release summary, Git state, installer checksum, server deployment gates, and remaining launch tasks. `release:gate` regenerates the release candidate report and fails until desktop readiness, server deployment gates, installer artifacts, signing, and Git cleanliness are ready. `website:release` publishes sanitized release metadata into `website/release.json` for the download page. `website:smoke` verifies the static website download panel, release manifest schema, checksum rules, and public-facing copy guardrails. `website:release:smoke` exercises website release publishing in isolated temporary fixtures for both available and preparing states. `release:verify` checks an existing installer, generates public release metadata, runs the final release gate, then publishes sanitized website release metadata only after the gate passes. `release:build` builds the installer and then runs the gated release verification chain. Before a public installer, configure real production URLs, sign update metadata, and set up Windows code signing.
