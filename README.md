# ZeroLag

ZeroLag is a Windows gaming performance optimizer prototype.

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
- Keeps running in the Windows tray when the main window is closed; use the tray menu to reopen or fully exit.
- Provides manual rescan and restore-daily-mode controls from the topbar.
- Includes a game toolbox button that opens local game library, one-click game launch, network latency check, DNS refresh, and Boost session timer tools.
- Exports a redacted support diagnostics bundle from the game toolbox for customer support.
- Keeps a local redacted support log so diagnostics include recent user-facing events without activation codes, tokens, paths, or tuning details.
- Opens a configured official support page from the game toolbox for customer help and diagnostics handoff.
- Includes an official website button with a placeholder URL for the future ZeroLag site.
- Writes VBS / HVCI / Credential Guard / Hypervisor disable configuration.
- Does not delete files.

## Paid release requirements

- Configure `assets/app-config.json` with the production website, API, update manifest, and demo-license switch.
- Implement the backend contract in `docs/server-api-contract.md`.
- Add a Windows Service guard before paid release.
- Move the prototype Task Scheduler guard into the installer as a production fallback if service installation fails.
- The guard must restore the original power plan and delete runtime tuning after crash, force kill, logout, restart, subscription expiry, or integrity failure.
- Deploy the static landing page in `website/` as the official ZeroLag website.
- Keep `docs/tasks.md` updated as prototype features move into the paid release roadmap.
- See `docs/production-guard-plan.md` for the production guard design.

## Production readiness

```powershell
npm run production:check
npm run production:check:strict
```

`production:check` gives a readiness report. `production:check:strict` should be used before a real paid release.

## Signed updates

Production update prompts should use signed metadata:

```powershell
npm run update:sign -- --generate-keypair .\.secrets\update-private.pem .\.secrets\update-public.pem
npm run update:sign -- assets\update.json .\.secrets\update-private.pem
npm run update:sign -- --verify assets\update.json .\.secrets\update-public.pem
```

Keep the private key outside Git. Put only the public key into `assets/app-config.json` as `updatePublicKeyPem` for production builds.

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

## Prototype license

Current local demo activation code:

```text
ZL-PRO-DEMO-2026
```

The prototype binds the license to the current Windows machine and stores a signed local license under Electron's app data directory. For a paid release, replace this with server-side account, device, and subscription validation.

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
```
