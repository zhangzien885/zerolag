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

Run `npm run guard:service:smoke` before packaging to verify the guard assets remain visible, uninstallable, and limited to runtime-state cleanup.
