# ZeroLag Website

Static landing page for the future ZeroLag official website.

Open locally:

```powershell
cd C:\Users\Administrator\Documents\zerolag
Start-Process .\website\index.html
```

The download panel reads `website/release.json`. After building and verifying a Windows installer, run:

```powershell
npm run website:release
npm run website:smoke
npm run website:release:smoke
```

This publishes sanitized release metadata for the static website, including version, download readiness, installer filename, installer size, SHA256 checksum, checksum-copy support, and public release notes. `website:smoke` verifies the download panel wiring and public release metadata before deployment. `website:release:smoke` tests the publishing flow in temporary fixtures without changing `website/release.json`.
