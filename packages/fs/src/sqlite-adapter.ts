/**
 * SQLite adapter — uses bun:sqlite when running under Bun,
 * falls back to better-sqlite3 for Node.js.
 *
 * Exports a minimal interface matching the subset both libraries share.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type Statement = {
  run(...params: unknown[]): void;
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
};

export type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  transaction<T>(fn: () => T): () => T;
  close(): void;
};

const IS_BUN = "Bun" in globalThis;

export function openSqlite(path: string): SqliteDb {
  if (IS_BUN) {
    return openBunSqlite(path);
  }
  return openBetterSqlite(path);
}

function openBunSqlite(path: string): SqliteDb {
  // Dynamic require to avoid bundler issues
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { Database } = require("bun:sqlite");
  const db = new Database(path);

  return {
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string): Statement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]) {
          stmt.run(...params);
        },
        get(...params: unknown[]): Row | undefined {
          return stmt.get(...params) ?? undefined;
        },
        all(...params: unknown[]): Row[] {
          return stmt.all(...params);
        },
      };
    },
    transaction<T>(fn: () => T): () => T {
      const wrapped = db.transaction(fn);
      return wrapped;
    },
    close() {
      db.close();
    },
  };
}

function openBetterSqlite(path: string): SqliteDb {
  // Dynamic require to avoid bundler issues when running under Bun
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const BetterSqlite3 = require("better-sqlite3");
  const db = new BetterSqlite3(path);

  return {
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string): Statement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]) {
          stmt.run(...params);
        },
        get(...params: unknown[]): Row | undefined {
          return stmt.get(...params) ?? undefined;
        },
        all(...params: unknown[]): Row[] {
          return stmt.all(...params);
        },
      };
    },
    transaction<T>(fn: () => T): () => T {
      const wrapped = db.transaction(fn);
      return wrapped;
    },
    close() {
      db.close();
    },
  };
}
