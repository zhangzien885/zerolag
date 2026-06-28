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
- `scripts/runtime-guard-core.js`
- `scripts/runtime-guard-service.js`

The installer service script points the installed `ZeroLag.exe` at `--runtime-guard-service`, which starts the guard worker without opening the desktop UI. Service registration is blocked by default until the native Windows Service wrapper exists; use `-AllowElectronWorkerService` only for private validation. Run `npm run guard:service:smoke`, `npm run guard:install:smoke`, and `npm run guard:runtime:smoke` before packaging to verify the guard assets remain visible, gated, uninstallable, and limited to runtime-state cleanup.
