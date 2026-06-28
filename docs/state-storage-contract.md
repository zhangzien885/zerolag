# ZeroLag State Storage Contract

ZeroLag still uses the JSON file store by default. The server now accepts a synchronous `stateStore` option so a future database-backed implementation can replace file storage without changing every route at once.

## Contract

A custom store must provide:

```js
{
  kind: "sqlite",
  loadState() {
    return stateObjectOrNull;
  },
  saveState(state) {
    // Persist the full state object atomically.
  },
  listBackups() {
    return [];
  }
}
```

`kind` and `listBackups()` are optional. `kind` appears in admin readiness output. `listBackups()` lets readiness expose backup status when the store supports it.

## Current Boundary

This is a synchronous compatibility seam. It prepares the codebase for SQLite or another local database first. A fully remote PostgreSQL store should move the server routes to async storage methods in a later step.

## Built-In SQLite Prototype

The server includes an optional SQLite document store backed by Node's built-in `node:sqlite` module. It stores the full server state as one JSON document inside a SQLite table. This keeps the current route code stable while proving that storage can move away from loose JSON files.

Enable it with:

```powershell
$env:ZEROLAG_STATE_STORE="sqlite"
$env:ZEROLAG_SQLITE_STATE_PATH="D:\zerolag-data\server-state.sqlite"
npm run server:start
```

The default remains JSON file storage unless `ZEROLAG_STATE_STORE=sqlite` is set.

`npm run server:check:strict` validates the configured SQLite path, verifies the database can be read, confirms the `state_documents` table exists, and prints only safe state counts.

## JSON To SQLite Migration

Existing JSON state can be imported into SQLite before switching the server over:

```powershell
npm run server:migrate-sqlite -- --input D:\zerolag-data\server-state.json --output D:\zerolag-data\server-state.sqlite
```

The migration command refuses to update an existing SQLite file unless `--force` is provided. It reads the migrated state back and compares a SHA256 digest before reporting success.

## SQLite Backup Export

Before enabling SQLite for wider paid testing, export a private backup and verify it can be read back:

```powershell
npm run server:backup-sqlite -- --input D:\zerolag-data\server-state.sqlite --output D:\zerolag-backups\server-state-backup.sqlite
```

When `--output` is omitted, the command writes a timestamped SQLite backup under `ZEROLAG_SQLITE_BACKUP_DIR`, `ZEROLAG_SERVER_BACKUP_DIR`, or `server/data/backups`. It refuses to update an existing backup unless `--force` is provided, then compares a SHA256 digest after writing.

Backups can be inspected without printing activation codes, tokens, or order details:

```powershell
npm run server:check-sqlite-backups -- --dir D:\zerolag-backups --max-age-hours 24
```

Use `--all` when you want to verify every `.sqlite` backup in the folder instead of only the newest one.

## SQLite Restore

Private recovery can restore a verified backup into a new or existing SQLite state file:

```powershell
npm run server:restore-sqlite -- --input D:\zerolag-backups\server-state-backup.sqlite --output D:\zerolag-data\server-state.sqlite --force
```

The restore command requires `--input`, refuses to restore into the same file, and refuses to update an existing output unless `--force` is provided. It should be run only after the production server has been stopped.

## Safety Rules

- `loadState()` should return plain JSON data only.
- `saveState(state)` should behave atomically from the server's point of view.
- Do not store activation codes or tokens in logs.
- Keep backup/export tooling private because it may contain operational membership state.
