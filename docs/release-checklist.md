# ZeroLag Release Checklist

Use this checklist before preparing a paid public build.

## 1. Desktop Release Config

- Set `assets/app-config.json` `releaseMode` to `production`.
- Set real HTTPS values for `websiteUrl`, `supportUrl`, `apiBaseUrl`, and `updateManifestUrl`.
- Set `allowLocalDemoLicense` to `false`.
- Add the production update public key to `updatePublicKeyPem`.

## 2. Server Readiness

- Generate private server secrets with `npm run server:secrets -- --write`.
- Keep `.secrets/server.env` private and outside Git.
- Run `npm run server:check:strict`.
- Run `npm run server:smoke`.
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
- Run `npm run dist:win` only after the strict release gates are satisfied.
- Configure Windows code signing in the build environment.
- Prefer CI secrets such as `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` for electron-builder signing.
- Keep signing certificates and passwords outside Git.

## 5. Final Gates

```powershell
npm run ci
npm run production:check:strict
npm run release:preflight:strict
```

Only cut a public release after all strict gates pass.
