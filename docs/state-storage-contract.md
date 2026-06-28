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

## Safety Rules

- `loadState()` should return plain JSON data only.
- `saveState(state)` should behave atomically from the server's point of view.
- Do not store activation codes or tokens in logs.
- Keep backup/export tooling private because it may contain operational membership state.
