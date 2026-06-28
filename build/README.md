# ZeroLag Build Resources

This directory is reserved for Electron Builder release assets.

Before a public Windows release, add the final application icon as:

```text
build/icon.ico
```

The current icon can be regenerated with:

```powershell
npm run icon:generate
```

Do not store signing certificates or certificate passwords in this directory.

Formal Windows builds also carry the transparent runtime guard service assets:

- `build/service-guard.json`
- `build/install-runtime-guard-service.ps1`
- `build/uninstall-runtime-guard-service.ps1`
- `build/install-runtime-guard-task.ps1`
- `build/uninstall-runtime-guard-task.ps1`
- `build/installer-guard.nsh`
- `scripts/runtime-guard-core.js`
- `scripts/runtime-guard-service.js`

The installer service script points the installed `ZeroLag.exe` at `--runtime-guard-service`, which starts the guard worker without opening the desktop UI. Service and Task Scheduler registration are blocked by default until their installer paths are explicitly enabled; use the `-Allow...` switches only for private validation. The NSIS guard hook is also gated by `ZEROLAG_ENABLE_GUARD_REGISTRATION`, so default development installers do not register OS-level guard entries. Run `npm run installer:guard:smoke`, `npm run guard:service:smoke`, `npm run guard:install:smoke`, `npm run guard:task:smoke`, and `npm run guard:runtime:smoke` before packaging to verify the guard assets remain visible, gated, uninstallable, and limited to runtime-state cleanup.
