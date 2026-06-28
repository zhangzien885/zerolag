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
