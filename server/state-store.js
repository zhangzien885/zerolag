const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const defaultSqlitePath = path.join(__dirname, "data", "server-state.sqlite");
const sqliteStoreCache = new Map();

function normalizeStoreKind(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

function sqlitePathFromOptions(options = {}) {
  const input = options.storage || {};
  return path.resolve(input.sqlitePath || options.sqliteStatePath || process.env.ZEROLAG_SQLITE_STATE_PATH || defaultSqlitePath);
}

function createSqliteStateStore(filePath = defaultSqlitePath) {
  const sqlite = require("node:sqlite");
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const database = new sqlite.DatabaseSync(resolvedPath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS state_documents (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  const selectState = database.prepare("SELECT value FROM state_documents WHERE key = ?");
  const upsertState = database.prepare(`
    INSERT INTO state_documents (key, value, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updatedAt = excluded.updatedAt;
  `);

  return {
    kind: "sqlite",
    path: resolvedPath,
    loadState() {
      const row = selectState.get("server");
      return row ? JSON.parse(row.value) : null;
    },
    saveState(state) {
      upsertState.run("server", JSON.stringify(state), new Date().toISOString());
    },
    listBackups() {
      return [];
    },
    close() {
      database.close();
    }
  };
}

function createConfiguredStateStore(options = {}) {
  const input = options.storage || {};
  const kind = normalizeStoreKind(input.kind || options.stateStoreKind || process.env.ZEROLAG_STATE_STORE || "json");
  if (!kind || kind === "json" || kind === "json_file" || kind === "file") return null;
  if (kind !== "sqlite") {
    throw new Error(`Unsupported state store kind: ${kind}`);
  }

  const sqlitePath = sqlitePathFromOptions(options);
  if (!sqliteStoreCache.has(sqlitePath)) {
    sqliteStoreCache.set(sqlitePath, createSqliteStateStore(sqlitePath));
  }

  return sqliteStoreCache.get(sqlitePath);
}

module.exports = {
  createConfiguredStateStore,
  createSqliteStateStore
};
