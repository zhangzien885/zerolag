# ZeroLag Production Guard Plan

This document records the production-only guard layer that must be added before paid release.

## Requirement

ZeroLag must prevent users from keeping runtime-only tuning after the paid session ends, even when the desktop app is force killed from Task Manager.

The current prototype already has an in-process cleanup hook and a detached watchdog process. Production builds must add an OS-level guard that survives normal app process termination.

## Required Production Guard

Use a Windows Service as the primary guard.

- Install during ZeroLag setup with administrator permission.
- Run under a restricted local service account where possible.
- Watch the active ZeroLag session file.
- Verify the desktop app process heartbeat.
- Restore the original power plan when the paid session ends or the app disappears.
- Delete ZeroLag runtime power plans after restore.
- Remove stale session files after cleanup.
- Refuse to apply protected tuning when subscription validation fails.

Use Windows Task Scheduler as a fallback guard.

- Create a task during installation if service installation fails.
- Trigger on user logon and at short periodic intervals.
- Run the cleanup helper with highest privileges.
- Clean orphan runtime plans from previous crashes, forced kills, or power loss.

## Cleanup Triggers

The production guard must clean up when any of these happen:

- Desktop app exits normally.
- Desktop app is killed from Task Manager.
- Desktop app crashes.
- User logs out.
- Windows restarts after a crash or power loss.
- Subscription expires while runtime tuning is active.
- Integrity check fails.
- Server authorization check fails.

## Session Data

The session file should contain only what the guard needs:

- Parent app PID.
- Runtime power plan GUID.
- Original power plan GUID.
- Device ID hash.
- Subscription session ID.
- Creation timestamp.
- Signed payload signature.

The guard must reject unsigned or tampered session files.

## Security Notes

This is a paid-product control, not malware behavior.

- Do not hide the service from Windows service tools.
- Do not block Task Manager.
- Do not kill user processes.
- Do not delete user files.
- Do not disable security tools.
- Provide a visible uninstall path that removes the service/task and restores the original plan.

## Prototype Status

Implemented in prototype:

- Runtime-only power plan.
- Normal-exit cleanup.
- Startup orphan cleanup.
- Detached watchdog process cleanup after app force kill.
- Signed runtime session file with tamper rejection.
- Runtime-session expiry cleanup.
- Temporary Task Scheduler fallback while Boost is active.
- Encrypted tuning package instead of a plain JSON template.
- Integrity verification for protected files.
- Windows Service guard manifest plus install/uninstall script assets.
- Runtime guard core and service worker that reuse the same signed-session cleanup flow as the desktop watchdog.
- Desktop entry mode `--runtime-guard-service`, allowing the installed ZeroLag executable to run the guard worker without opening the UI.
- Service install script registration is blocked by default and requires an explicit private-validation switch until the native wrapper exists.
- CI smoke test for transparent service-guard packaging and prohibited behavior guardrails.
- CI smoke test for service-worker cleanup behavior in dry-run mode.

Still required for paid production:

- Native Windows Service wrapper executable.
- Installer service registration without the private-validation guard after the native wrapper is ready.
- Installer-managed Task Scheduler fallback.
- Server-issued signed session IDs and key rotation.
- Server-side subscription/session validation.
- Installer invocation of the service install/uninstall scripts with the native service wrapper once it is available.
- Uninstaller cleanup.
