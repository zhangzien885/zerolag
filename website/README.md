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
```

This publishes sanitized release metadata for the static website, including version, download readiness, installer filename, and SHA256 checksum.
