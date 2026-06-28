# ZeroLag Tasks

## Test Build Completed

- Desktop prototype shell with sci-fi gaming dashboard.
- Custom ZeroLag SVG logo integrated into the header.
- Static official website landing page under `website/`.
- Native splash-window boot animation before the dashboard opens.
- One-click Boost entry point.
- Runtime-only performance mode that is restored and deleted when the app exits.
- Encrypted tuning package instead of a plain tuning template.
- Runtime watchdog process that restores and deletes runtime tuning if the desktop app is force killed.
- Signed runtime session file with machine binding, subscription-session marker, expiry timestamp, and tamper rejection.
- Temporary Task Scheduler guard fallback during Boost sessions; removed again when the session is restored or cleaned.
- Runtime authorization monitor that restores daily state when subscription or integrity validation is no longer valid.
- Startup orphan cleanup for stale runtime sessions.
- Local monthly membership prototype with signed license and machine binding.
- Membership purchase and activation UI.
- Membership expiry and renewal guidance in the desktop membership center.
- Administrator relaunch prompt on normal startup.
- VBS / HVCI / Credential Guard / Hypervisor disable flow.
- Windows gaming optimizations: Game Mode, Game DVR/background capture off, fullscreen interference reduction, power throttling off, game scheduling priority, GPU scheduling preference.
- Safe background load reduction after Boost using an internal non-critical process allowlist.
- One-click Boost memory optimization using a PCL-style system memory list purge plus aggressive working-set trim across accessible processes before gaming, without killing user processes.
- Startup update check with normal and forced update dialog states.
- Game toolbox version center for manual update checks, current version/channel display, and download handoff.
- Official website button that opens the future ZeroLag website.
- Background tray mode: closing the desktop window hides ZeroLag to the Windows tray, while tray exit performs real cleanup.
- Manual recovery control: topbar "restore daily mode" button stops the active Boost session and refreshes status without closing the app.
- Manual rescan control: topbar "rescan" button refreshes license, permission, performance, diagnostics, and memory status on demand.
- Game toolbox button that opens a dedicated toolbox dialog with local game library, add-game picker, one-click game launch, network latency check, DNS refresh, and Boost session timer.
- Support diagnostics export in the game toolbox for customer support, without exposing activation codes, tokens, protected tuning parameters, or game paths.
- Redacted local support log included in diagnostics, limited to recent user-facing events and filtered for activation codes, tokens, URLs, paths, and GUIDs.
- Official support/contact button in the game toolbox, driven by production `supportUrl` configuration.
- System detection panel for CPU, discrete GPU preference, live memory usage, and Game Mode status.
- Memory usage refresh every second with one decimal place.
- Anti-tamper integrity manifest for protected files.
- DevTools and common debug shortcuts disabled in the desktop window.
- Result output hides sensitive implementation details from normal users.

## Completed Research And Alignment

- Located the user's local PCL2 binary at `D:\Plain Craft Launcher 2.exe` and confirmed it is a .NET assembly.
- Confirmed PCL2 exposes memory optimization methods including `PCL.PageOtherTest.MemoryOptimize` and `MemoryOptimizeInternal`.
- Confirmed PCL2 memory optimization metadata references `NtSetSystemInformation`, `OpenProcessToken`, `AdjustTokenPrivileges`, and `SeProfileSingleProcessPrivilege`.
- Aligned ZeroLag's Boost memory optimization with the same style of effect: system memory list purge plus accessible process working-set trim.
- Kept the implementation independent instead of copying decompiled PCL2 code directly.
- Moved secondary accelerator features out of the main dashboard into a dedicated game toolbox dialog opened from the topbar button.
- Preserved the main dashboard focus on one-click Boost, status, results, and membership.

## Official Website Landing Page Content

- Hero positioning: "开游戏前，让电脑进入战斗状态" with one-click, game-ready messaging.
- Customer-facing promise: reduce setup friction before gaming, avoid tutorials/settings digging, and make the PC feel ready faster.
- Hero proof points: 1 button, 30 yuan per month, 4 key preparation actions.
- Product preview module: show Boost button, performance mode, system interference, live memory usage, and GPU status in a sci-fi desktop mockup.
- Problem-to-solution section: turn scattered tutorials and uncertain settings into one repeatable Boost action.
- Feature section: one-click high-performance state, reduced interference, resources focused on the current game, and easy-to-read readiness status.
- Audience section: competitive games, laptop gaming, and users who do not want to study PC settings.
- Diagnostics section: CPU, GPU, memory, and Game Mode readiness shown in plain language.
- Safe experience section: strong performance, simple operation, clear next-step prompts, and easier return to daily use after gaming.
- Pricing section: ZeroLag Pro at 30 yuan per month, framed as saving repeated setup time before every game session.
- Download section: first public experience preparation, with future installer, update notes, and purchase entry.
- FAQ section: no guaranteed fixed FPS increase, explains value as reducing friction/interference, clarifies after-use behavior, and reinforces why 30 yuan/month is worthwhile.
- Copywriting guardrails: use "you" instead of group labels, avoid internal protection/commercial strategy wording, avoid technical implementation details, and keep all messaging focused on customer value.

## Production Must Have

- Replace local demo license with server-side account, device, and subscription validation. First client contract and client-side integration seam are in place.
- Add Windows Service guard as the primary runtime tuning cleanup layer.
- Move the prototype Task Scheduler guard into the installer as a production fallback if service installation fails.
- Harden signed runtime sessions with server-issued session IDs and key rotation.
- Clean runtime tuning after app force kill, crash, logout, restart, subscription expiry, integrity failure, or server authorization failure.
- Add visible uninstall flow that removes service/task and restores the original power plan.
- Add payment integration for WeChat Pay / Alipay or another provider.
- Replace local update mock with server-hosted version manifest and signed update metadata.
- Deploy the official website, connect the final domain, and replace placeholder website/download URLs.
- Add production website download flow, purchase entry, update notes, customer support/contact entry, and basic analytics.
- Add server-backed network acceleration for paid release: game routing nodes, smart route selection, latency/loss monitoring, and regional game profiles.
- Add optional in-game overlay/FPS session view after the desktop app core is stable.
- Add release build packaging, code signing, installer, and auto-update strategy.
- Add production obfuscation and packaging hardening.
- Add recovery button for restoring the original power plan.
- Add logging suitable for support without exposing protected tuning details.

## Formal Version Development Started

- Added `assets/app-config.json` to separate development and production behavior.
- Added server-backed license activation and validation seams for `/v1/licenses/activate` and `/v1/licenses/validate`.
- Kept local demo activation available only for development mode.
- Moved website opening to production config instead of a hard-coded renderer URL.
- Added remote update manifest support while keeping local update JSON as development fallback.
- Added `scripts/production-check.js` and npm scripts for production readiness checks.
- Added `docs/server-api-contract.md` for backend implementation.
- Added runnable `server/` license-server MVP with activation-code creation, device binding, subscription validation, token rotation, update manifest endpoint, and self-test.
- Added `npm run dev:server-app` for local desktop-plus-license-server integration testing without mutating protected production config.
- Added admin-protected activation-code creation and summary endpoints for the future payment callback path.
- Added provider-neutral order flow MVP: create order, query order status, manually complete paid order, and issue a one-time activation code.
- Connected the desktop purchase dialog to server order creation and order-status refresh, with automatic activation after a paid order returns an activation code.
- Added admin order listing and `complete-latest` helper for local payment-flow testing.
- Added signed payment webhook MVP for payment-success callbacks, with HMAC verification, idempotent event handling, automatic order completion, and local `send-webhook` testing helper.
- Added refund handling for paid orders: signed refund webhook, admin refund helper, activation-code disablement, subscription revocation, and active token invalidation.
- Added same-device renewal handling so a newly paid monthly code extends the existing active subscription instead of creating duplicate membership records.
- Added admin membership support endpoints and CLI helpers for listing subscriptions, inspecting linked orders, filtering active memberships, and manually revoking access.
- Added operational audit events and admin audit log queries for order, payment, activation, renewal, refund, and manual revoke actions without exposing activation codes or tokens.
- Added server-side rate limiting for order creation, payment webhooks, activation, validation, and admin endpoints to reduce abuse before public release.
- Added public health and admin readiness checks for server deployment operations, including state, backup, update-manifest, secret, rate-limit, and maintenance status.
- Added automatic and admin-triggered maintenance cleanup for expired subscriptions and stale server tokens with audit logging.
- Added server production environment checks for required secrets, backups, rate limiting, maintenance, host, port, and storage paths.
- Added server secret generation tooling for private production environment variables.
- Added safer JSON-state persistence with atomic writes, rolling backups, corrupted-state fallback, and admin state export for migration or emergency recovery.
- Added signed update-manifest verification in the desktop client plus release tooling for generating, signing, and verifying update metadata.
- Added customer-support diagnostics bundle export from the desktop toolbox with redacted membership and runtime details.
- Added redacted support-event logging so exported diagnostics include recent user-facing operation history without sensitive codes or implementation details.
- Added a configurable official support/contact link in the desktop toolbox and production readiness checks for `supportUrl`.
- Added membership expiry and renewal guidance so users see remaining Pro time before access runs out.
- Added a desktop toolbox version center for manual update checks and user-visible version/channel status.
- Added automatic private server env-file loading for service startup, admin tools, activation-code creation, and production readiness checks.
- Added a safe server smoke-test command for checking health and admin readiness with isolated temporary state before deployment.

## Known Boundaries

- A determined user with administrator access may still inspect Windows runtime state while tuning is active.
- The prototype watchdog and temporary task guard improve cleanup, but production still requires an installer-managed Windows Service.
- Local-only license protection is not enough for paid release.
- Current prototype makes aggressive performance changes and may require reboot for full effect.
