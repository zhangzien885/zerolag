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
- `build/native-service/ZeroLag.RuntimeGuard.Service.csproj`
- `build/native-service/Program.cs`
- `scripts/runtime-guard-core.js`
- `scripts/runtime-guard-service.js`

The native service wrapper source lives under `build/native-service`. Build it with `npm run guard:wrapper:build` after installing the .NET 8 SDK, then package the generated `build/native-service/dist/ZeroLag.RuntimeGuard.Service.exe` as the service binary for private validation. The wrapper starts the installed `ZeroLag.exe` in `--runtime-guard-service` mode without opening the desktop UI.

Service and Task Scheduler registration are blocked by default until their installer paths are explicitly enabled; use the `-Allow...` switches only for private validation. The NSIS guard hook is also gated by `ZEROLAG_ENABLE_GUARD_REGISTRATION`, so default development installers do not register OS-level guard entries. Run `npm run installer:guard:smoke`, `npm run guard:service:smoke`, `npm run guard:install:smoke`, `npm run guard:task:smoke`, `npm run guard:runtime:smoke`, and `npm run guard:wrapper:smoke` before packaging to verify the guard assets remain visible, gated, uninstallable, and limited to runtime-state cleanup.
