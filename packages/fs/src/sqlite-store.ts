import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type {
  CasStore,
  Hash,
  HistoryEntry,
  ListOptions,
  Tag,
  TagOp,
  TagStore,
  Variable,
  VarListOptions,
  VarSetOptions,
  VarStore,
} from "@ocas/core";
import {
  addNameIndex,
  checkTagLabelConflict,
  extractSchema,
  MAX_HISTORY,
  removeNameIndex,
  SchemaMismatchError,
  VariableNotFoundError,
  type VarRecord,
  validateName,
  varKey,
} from "@ocas/core";

const DB_FILE = "_store.db";
const VARS_FILE = "_vars.jsonl";
const TAGS_FILE = "_tags.jsonl";

function openDb(dir: string): Database.Database {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, DB_FILE));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function initVarTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vars (
      name     TEXT NOT NULL,
      schema   TEXT NOT NULL,
      value    TEXT NOT NULL,
      created  INTEGER NOT NULL,
      updated  INTEGER NOT NULL,
      tags     TEXT NOT NULL DEFAULT '{}',
      labels   TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (name, schema)
    );
    CREATE TABLE IF NOT EXISTS var_history (
      name     TEXT NOT NULL,
      schema   TEXT NOT NULL,
      value    TEXT NOT NULL,
      position INTEGER NOT NULL,
      set_at   INTEGER NOT NULL,
      PRIMARY KEY (name, schema, position),
      FOREIGN KEY (name, schema) REFERENCES vars(name, schema) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_vars_name ON vars(name);
    CREATE INDEX IF NOT EXISTS idx_vars_created ON vars(created);
    CREATE INDEX IF NOT EXISTS idx_vars_updated ON vars(updated);
    CREATE INDEX IF NOT EXISTS idx_var_history_pos_desc ON var_history(name, schema, position DESC);
  `);
}

function initTagTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      target   TEXT NOT NULL,
      key      TEXT NOT NULL,
      value    TEXT,
      created  INTEGER NOT NULL,
      PRIMARY KEY (target, key)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_key ON tags(key);
    CREATE INDEX IF NOT EXISTS idx_tags_key_value ON tags(key, value);
  `);
}

// ── JSONL migration ──

type StoredTag = {
  key: string;
  value: string | null;
  target: Hash;
  created: number;
};

function migrateJsonlVars(
  db: Database.Database,
  dir: string,
  _cas: CasStore,
): void {
  const path = join(dir, VARS_FILE);
  if (!existsSync(path)) return;

  const records = new Map<string, VarRecord>();
  const byName = new Map<string, Set<string>>();

  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    try {
      const rec = JSON.parse(line) as VarRecord & { __op?: string };
      if (rec.__op === "remove") {
        const k = varKey(rec.name, rec.schema);
        records.delete(k);
        removeNameIndex(byName, rec.name, k);
      } else {
        const k = varKey(rec.name, rec.schema);
        records.set(k, rec);
        addNameIndex(byName, rec.name, k);
      }
    } catch {
      // skip malformed
    }
  }

  if (records.size === 0) return;

  const insertVar = db.prepare(`
    INSERT OR REPLACE INTO vars (name, schema, value, created, updated, tags, labels)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertHistory = db.prepare(`
    INSERT OR REPLACE INTO var_history (name, schema, value, position, set_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const migrate = db.transaction(() => {
    for (const rec of records.values()) {
      insertVar.run(
        rec.name,
        rec.schema,
        rec.value,
        rec.created,
        rec.updated,
        JSON.stringify(rec.tags),
        JSON.stringify(rec.labels),
      );
      for (const h of rec.history) {
        insertHistory.run(rec.name, rec.schema, h.value, h.position, h.setAt);
      }
    }
  });
  migrate();
}

function migrateJsonlTags(db: Database.Database, dir: string): void {
  const path = join(dir, TAGS_FILE);
  if (!existsSync(path)) return;

  const byTarget = new Map<Hash, Map<string, Tag>>();

  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    try {
      const ent = JSON.parse(line) as
        | (StoredTag & { __op?: "set" | "untag" })
        | { __op: "untag"; target: Hash; key: string };
      if ((ent as { __op?: string }).__op === "untag") {
        const e = ent as { target: Hash; key: string };
        const tm = byTarget.get(e.target);
        if (tm) {
          tm.delete(e.key);
          if (tm.size === 0) byTarget.delete(e.target);
        }
      } else {
        const t = ent as StoredTag;
        let tm = byTarget.get(t.target);
        if (!tm) {
          tm = new Map();
          byTarget.set(t.target, tm);
        }
        tm.set(t.key, {
          key: t.key,
          value: t.value,
          target: t.target,
          created: t.created,
        });
      }
    } catch {
      // skip
    }
  }

  if (byTarget.size === 0) return;

  const insertTag = db.prepare(`
    INSERT OR REPLACE INTO tags (target, key, value, created)
    VALUES (?, ?, ?, ?)
  `);

  const migrate = db.transaction(() => {
    for (const tm of byTarget.values()) {
      for (const tag of tm.values()) {
        insertTag.run(tag.target, tag.key, tag.value, tag.created);
      }
    }
  });
  migrate();
}

// ── Row helpers ──

function toVariable(row: Record<string, unknown>): Variable {
  return {
    name: row.name as string,
    schema: row.schema as Hash,
    value: row.value as Hash,
    created: row.created as number,
    updated: row.updated as number,
    tags: JSON.parse(row.tags as string) as Record<string, string>,
    labels: JSON.parse(row.labels as string) as string[],
  };
}

function toHistoryEntry(r: Record<string, unknown>): HistoryEntry {
  return {
    value: r.value as Hash,
    position: r.position as number,
    setAt: r.set_at as number,
  };
}

function toTag(r: Record<string, unknown>, target: Hash): Tag {
  return {
    key: r.key as string,
    value: r.value as string | null,
    target,
    created: r.created as number,
  };
}

// ── Main factory ──

export function createSqliteVarStore(
  dir: string,
  cas: CasStore,
): { var: VarStore; tag: TagStore; close: () => void } {
  const db = openDb(dir);
  initVarTables(db);
  initTagTables(db);

  // Migrate JSONL if present (one-time, idempotent)
  migrateJsonlVars(db, dir, cas);
  migrateJsonlTags(db, dir);

  let closed = false;

  // ── Prepared statements (var) ──
  const stmtGetVar = db.prepare(
    "SELECT * FROM vars WHERE name = ? AND schema = ?",
  );
  const stmtGetByName = db.prepare("SELECT * FROM vars WHERE name = ?");
  const stmtInsertVar = db.prepare(`
    INSERT INTO vars (name, schema, value, created, updated, tags, labels)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtUpdateVar = db.prepare(`
    UPDATE vars SET value = ?, updated = ?, tags = ?, labels = ?
    WHERE name = ? AND schema = ?
  `);
  const stmtDeleteVar = db.prepare(
    "DELETE FROM vars WHERE name = ? AND schema = ?",
  );
  const stmtDeleteVarByName = db.prepare("DELETE FROM vars WHERE name = ?");
  const stmtInsertHistory = db.prepare(`
    INSERT INTO var_history (name, schema, value, position, set_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const stmtGetHistory = db.prepare(
    "SELECT value, position, set_at FROM var_history WHERE name = ? AND schema = ? ORDER BY position DESC",
  );
  const stmtMaxPosition = db.prepare(
    "SELECT MAX(position) as max_pos FROM var_history WHERE name = ? AND schema = ?",
  );
  const stmtDeleteOldHistory = db.prepare(
    "DELETE FROM var_history WHERE name = ? AND schema = ? AND position NOT IN (SELECT position FROM var_history WHERE name = ? AND schema = ? ORDER BY position DESC LIMIT ?)",
  );

  // ── Prepared statements (tag) ──
  const stmtUpsertTag = db.prepare(`
    INSERT INTO tags (target, key, value, created) VALUES (?, ?, ?, ?)
    ON CONFLICT(target, key) DO UPDATE SET value = excluded.value
  `);
  const stmtDeleteTag = db.prepare(
    "DELETE FROM tags WHERE target = ? AND key = ?",
  );
  const stmtGetTagsByTarget = db.prepare(
    "SELECT * FROM tags WHERE target = ? ORDER BY key",
  );
  const stmtGetTagsByKey = db.prepare(
    "SELECT target, key, value, created FROM tags WHERE key = ? ORDER BY created ASC",
  );
  const stmtGetTagsByKeyValue = db.prepare(
    "SELECT target, key, value, created FROM tags WHERE key = ? AND value = ? ORDER BY created ASC",
  );

  // ── Transactional helpers ──

  const txnSetVar = db.transaction(
    (
      name: string,
      schema: Hash,
      hash: Hash,
      now: number,
      tagsJson: string,
      labelsJson: string,
      isNew: boolean,
      valueChanged: boolean,
    ) => {
      if (isNew) {
        stmtInsertVar.run(name, schema, hash, now, now, tagsJson, labelsJson);
        stmtInsertHistory.run(name, schema, hash, 0, now);
      } else if (valueChanged) {
        const maxRow = stmtMaxPosition.get(name, schema) as {
          max_pos: number | null;
        };
        const nextPos = (maxRow.max_pos ?? -1) + 1;
        stmtInsertHistory.run(name, schema, hash, nextPos, now);
        stmtDeleteOldHistory.run(name, schema, name, schema, MAX_HISTORY);
        stmtUpdateVar.run(hash, now, tagsJson, labelsJson, name, schema);
      } else {
        stmtUpdateVar.run(hash, now, tagsJson, labelsJson, name, schema);
      }
    },
  );

  const txnTagOps = db.transaction(
    (target: Hash, operations: TagOp[], now: number) => {
      for (const op of operations) {
        if (op.op === "set") {
          // Use ON CONFLICT to preserve created time — but we need existing created
          const existing = db
            .prepare("SELECT created FROM tags WHERE target = ? AND key = ?")
            .get(target, op.key) as { created: number } | undefined;
          const created = existing?.created ?? now;
          stmtUpsertTag.run(target, op.key, op.value ?? null, created);
        } else {
          stmtDeleteTag.run(target, op.key);
        }
      }
    },
  );

  const txnUntag = db.transaction((target: Hash, keys: string[]) => {
    for (const k of keys) {
      stmtDeleteTag.run(target, k);
    }
  });

  // ── VarStore implementation ──
  const varStore: VarStore = {
    set(name: string, hash: Hash, options?: VarSetOptions): Variable {
      validateName(name);
      const schema = extractSchema(cas, hash);
      const existing = stmtGetVar.get(name, schema) as
        | Record<string, unknown>
        | undefined;
      const now = Date.now();

      if (existing) {
        const v = toVariable(existing);
        const tags = options?.tags ?? v.tags;
        const labels = options?.labels ?? v.labels;
        if (options !== undefined) checkTagLabelConflict(tags, labels);

        const valueChanged = v.value !== hash;
        const newTags = options !== undefined ? tags : v.tags;
        const newLabels = options !== undefined ? labels : v.labels;

        if (valueChanged || options !== undefined) {
          txnSetVar(
            name,
            schema,
            hash,
            valueChanged ? now : v.updated,
            JSON.stringify(newTags),
            JSON.stringify(newLabels),
            false,
            valueChanged,
          );
        }

        return {
          name,
          schema,
          value: hash,
          created: v.created,
          updated: valueChanged ? now : v.updated,
          tags: { ...newTags },
          labels: [...newLabels],
        };
      }

      // New variable
      const tags = options?.tags ?? {};
      const labels = options?.labels ?? [];
      checkTagLabelConflict(tags, labels);
      txnSetVar(
        name,
        schema,
        hash,
        now,
        JSON.stringify(tags),
        JSON.stringify(labels),
        true,
        false,
      );
      return {
        name,
        schema,
        value: hash,
        created: now,
        updated: now,
        tags: { ...tags },
        labels: [...labels],
      };
    },

    get(name: string, schema?: Hash): Variable | null {
      if (schema !== undefined) {
        const row = stmtGetVar.get(name, schema) as
          | Record<string, unknown>
          | undefined;
        return row ? toVariable(row) : null;
      }
      const rows = stmtGetByName.all(name) as Record<string, unknown>[];
      if (rows.length !== 1) return null;
      return toVariable(rows[0]!);
    },

    remove(name: string, schema?: Hash): Variable[] {
      if (schema !== undefined) {
        const row = stmtGetVar.get(name, schema) as
          | Record<string, unknown>
          | undefined;
        if (!row) return [];
        const v = toVariable(row);
        stmtDeleteVar.run(name, schema);
        return [v];
      }
      const rows = stmtGetByName.all(name) as Record<string, unknown>[];
      if (rows.length === 0) return [];
      const removed = rows.map(toVariable);
      stmtDeleteVarByName.run(name);
      return removed;
    },

    update(name: string, hash: Hash, options?: VarSetOptions): Variable {
      validateName(name);
      const newSchema = extractSchema(cas, hash);
      const rows = stmtGetByName.all(name) as Record<string, unknown>[];
      if (rows.length === 0) throw new VariableNotFoundError(name, newSchema);

      const existing = stmtGetVar.get(name, newSchema) as
        | Record<string, unknown>
        | undefined;
      if (!existing) {
        const first = toVariable(rows[0]!);
        throw new SchemaMismatchError(first.schema, newSchema);
      }

      const v = toVariable(existing);
      const now = Date.now();
      const tags = options?.tags ?? v.tags;
      const labels = options?.labels ?? v.labels;
      if (options !== undefined) checkTagLabelConflict(tags, labels);

      const valueChanged = v.value !== hash;
      const newTags = options !== undefined ? tags : v.tags;
      const newLabels = options !== undefined ? labels : v.labels;

      if (valueChanged || options !== undefined) {
        txnSetVar(
          name,
          newSchema,
          hash,
          valueChanged ? now : v.updated,
          JSON.stringify(newTags),
          JSON.stringify(newLabels),
          false,
          valueChanged,
        );
      }

      return {
        name,
        schema: newSchema,
        value: hash,
        created: v.created,
        updated: valueChanged ? now : v.updated,
        tags: { ...newTags },
        labels: [...newLabels],
      };
    },

    list(options?: VarListOptions): Variable[] {
      if (
        options?.namePrefix !== undefined &&
        options?.exactName !== undefined
      ) {
        throw new Error(
          "namePrefix and exactName are mutually exclusive - cannot specify both",
        );
      }

      const limit = options?.limit;
      if (limit !== undefined && limit <= 0) return [];

      // Build dynamic query
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (options?.exactName !== undefined) {
        conditions.push("name = ?");
        params.push(options.exactName);
      }
      if (options?.namePrefix !== undefined) {
        conditions.push("name LIKE ? ESCAPE '\\'");
        const escaped = options.namePrefix
          .replace(/\\/g, "\\\\")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        params.push(`${escaped}%`);
      }
      if (options?.schema !== undefined) {
        conditions.push("schema = ?");
        params.push(options.schema);
      }

      const sortCol = options?.sort === "updated" ? "updated" : "created";
      const sortDir = options?.desc ? "DESC" : "ASC";
      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Post-filter by tags and labels (stored as JSON)
      const filterTags = options?.tags ?? {};
      const filterLabels = options?.labels ?? [];
      const needsPostFilter =
        Object.keys(filterTags).length > 0 || filterLabels.length > 0;

      // When post-filtering, fetch all matching rows (no SQL LIMIT)
      // then apply limit/offset after filtering
      let sql: string;
      if (needsPostFilter) {
        sql = `SELECT * FROM vars ${where} ORDER BY ${sortCol} ${sortDir}, name ASC`;
      } else {
        sql = `SELECT * FROM vars ${where} ORDER BY ${sortCol} ${sortDir}, name ASC`;
        if (limit !== undefined || (options?.offset ?? 0) > 0) {
          sql += ` LIMIT ${limit ?? -1} OFFSET ${options?.offset ?? 0}`;
        }
      }

      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

      if (!needsPostFilter) return rows.map(toVariable);

      let results: Variable[] = [];
      for (const row of rows) {
        const v = toVariable(row);
        let ok = true;
        for (const [tk, tv] of Object.entries(filterTags)) {
          if (v.tags[tk] !== tv) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        for (const lb of filterLabels) {
          if (!v.labels.includes(lb)) {
            ok = false;
            break;
          }
        }
        if (ok) results.push(v);
      }

      // Apply limit/offset after post-filter
      const offset = options?.offset ?? 0;
      if (offset > 0) results = results.slice(offset);
      if (limit !== undefined) results = results.slice(0, limit);

      return results;
    },

    history(name: string, schema?: Hash): HistoryEntry[] {
      if (schema !== undefined) {
        return (
          stmtGetHistory.all(name, schema) as Record<string, unknown>[]
        ).map(toHistoryEntry);
      }
      const vars = stmtGetByName.all(name) as Record<string, unknown>[];
      if (vars.length !== 1) return [];
      const v = vars[0]!;
      return (
        stmtGetHistory.all(v.name as string, v.schema as string) as Record<
          string,
          unknown
        >[]
      ).map(toHistoryEntry);
    },

    close(): void {
      if (closed) return;
      closed = true;
      db.close();
    },
  };

  // ── TagStore implementation ──
  const tagStore: TagStore = {
    tag(target: Hash, operations: TagOp[]): Tag[] {
      const now = Date.now();
      txnTagOps(target, operations, now);
      return (stmtGetTagsByTarget.all(target) as Record<string, unknown>[]).map(
        (r) => toTag(r, target),
      );
    },

    untag(target: Hash, keys: string[]): void {
      txnUntag(target, keys);
    },

    tags(target: Hash): Tag[] {
      return (stmtGetTagsByTarget.all(target) as Record<string, unknown>[]).map(
        (r) => toTag(r, target),
      );
    },

    listByTag(tag: string, options?: ListOptions): Hash[] {
      let key = tag;
      let value: string | null | undefined;
      const eqIdx = tag.indexOf("=");
      if (eqIdx >= 0) {
        key = tag.slice(0, eqIdx);
        value = tag.slice(eqIdx + 1);
      }

      // Build SQL with sort/limit/offset pushed down
      const sortCol = "created"; // tags only have created
      const sortDir = options?.desc ? "DESC" : "ASC";
      const offset = options?.offset ?? 0;
      const limit = options?.limit;

      let sql: string;
      const params: unknown[] = [key];
      if (value !== undefined) {
        sql = `SELECT target FROM tags WHERE key = ? AND value = ? ORDER BY ${sortCol} ${sortDir}`;
        params.push(value);
      } else {
        sql = `SELECT target FROM tags WHERE key = ? ORDER BY ${sortCol} ${sortDir}`;
      }
      if (limit !== undefined || offset > 0) {
        sql += ` LIMIT ${limit ?? -1} OFFSET ${offset}`;
      }

      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
      return rows.map((r) => r.target as Hash);
    },
  };

  return {
    var: varStore,
    tag: tagStore,
    close: () => {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
