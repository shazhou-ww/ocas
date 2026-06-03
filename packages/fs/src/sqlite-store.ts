import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type {
  CasStore,
  Hash,
  HistoryEntry,
  ListEntry,
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
  checkTagLabelConflict,
  extractSchema,
  MAX_HISTORY,
  SchemaMismatchError,
  VariableNotFoundError,
  validateName,
} from "@ocas/core";

const DB_FILE = "_store.db";

function openDb(dir: string): InstanceType<typeof Database> {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, DB_FILE));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function initVarTables(db: InstanceType<typeof Database>): void {
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
  `);
}

function initTagTables(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      target   TEXT NOT NULL,
      key      TEXT NOT NULL,
      value    TEXT,
      created  INTEGER NOT NULL,
      PRIMARY KEY (target, key)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_key ON tags(key);
  `);
}

function toVariable(row: Record<string, unknown>): Variable {
  return {
    name: row["name"] as string,
    schema: row["schema"] as Hash,
    value: row["value"] as Hash,
    created: row["created"] as number,
    updated: row["updated"] as number,
    tags: JSON.parse(row["tags"] as string) as Record<string, string>,
    labels: JSON.parse(row["labels"] as string) as string[],
  };
}

export function createSqliteVarStore(
  dir: string,
  cas: CasStore,
): { var: VarStore; tag: TagStore; close: () => void } {
  const db = openDb(dir);
  initVarTables(db);
  initTagTables(db);

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
  const stmtTruncateHistory = db.prepare(
    "DELETE FROM var_history WHERE name = ? AND schema = ? AND position < (SELECT MAX(position) - ? + 1 FROM var_history WHERE name = ? AND schema = ?)",
  );

  // ── Prepared statements (tag) ──
  const stmtGetTag = db.prepare(
    "SELECT * FROM tags WHERE target = ? AND key = ?",
  );
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
  const stmtGetTagsByKey = db.prepare("SELECT * FROM tags WHERE key = ?");
  const stmtGetTagsByKeyValue = db.prepare(
    "SELECT * FROM tags WHERE key = ? AND value = ?",
  );

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

        // Check if value changed
        if (v.value !== hash) {
          const maxRow = stmtMaxPosition.get(name, schema) as {
            max_pos: number | null;
          };
          const nextPos = (maxRow.max_pos ?? -1) + 1;
          stmtInsertHistory.run(name, schema, hash, nextPos, now);
          stmtTruncateHistory.run(name, schema, MAX_HISTORY, name, schema);
          stmtUpdateVar.run(
            hash,
            now,
            JSON.stringify(options !== undefined ? tags : v.tags),
            JSON.stringify(options !== undefined ? labels : v.labels),
            name,
            schema,
          );
        } else if (options !== undefined) {
          stmtUpdateVar.run(
            v.value,
            v.updated,
            JSON.stringify(tags),
            JSON.stringify(labels),
            name,
            schema,
          );
        }

        return {
          name,
          schema,
          value: hash,
          created: v.created,
          updated: v.value !== hash ? now : v.updated,
          tags: options !== undefined ? { ...tags } : { ...v.tags },
          labels: options !== undefined ? [...labels] : [...v.labels],
        };
      }

      // New variable
      const tags = options?.tags ?? {};
      const labels = options?.labels ?? [];
      checkTagLabelConflict(tags, labels);
      stmtInsertVar.run(
        name,
        schema,
        hash,
        now,
        now,
        JSON.stringify(tags),
        JSON.stringify(labels),
      );
      stmtInsertHistory.run(name, schema, hash, 0, now);
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
        // Schema mismatch
        const first = toVariable(rows[0]!);
        throw new SchemaMismatchError(first.schema, newSchema);
      }

      const v = toVariable(existing);
      const now = Date.now();
      const tags = options?.tags ?? v.tags;
      const labels = options?.labels ?? v.labels;
      if (options !== undefined) checkTagLabelConflict(tags, labels);

      if (v.value !== hash) {
        const maxRow = stmtMaxPosition.get(name, newSchema) as {
          max_pos: number | null;
        };
        const nextPos = (maxRow.max_pos ?? -1) + 1;
        stmtInsertHistory.run(name, newSchema, hash, nextPos, now);
        stmtTruncateHistory.run(name, newSchema, MAX_HISTORY, name, newSchema);
        stmtUpdateVar.run(
          hash,
          now,
          JSON.stringify(options !== undefined ? tags : v.tags),
          JSON.stringify(options !== undefined ? labels : v.labels),
          name,
          newSchema,
        );
      } else if (options !== undefined) {
        stmtUpdateVar.run(
          v.value,
          v.updated,
          JSON.stringify(tags),
          JSON.stringify(labels),
          name,
          newSchema,
        );
      }

      return {
        name,
        schema: newSchema,
        value: hash,
        created: v.created,
        updated: v.value !== hash ? now : v.updated,
        tags: options !== undefined ? { ...tags } : { ...v.tags },
        labels: options !== undefined ? [...labels] : [...v.labels],
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
        conditions.push("name LIKE ?");
        // Escape % and _ in the prefix for LIKE
        const escaped = options.namePrefix
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        params.push(`${escaped}%`);
      }
      if (options?.schema !== undefined) {
        conditions.push("schema = ?");
        params.push(options.schema);
      }

      const sortCol =
        options?.sort === "updated" ? "updated" : "created";
      const sortDir = options?.desc ? "DESC" : "ASC";
      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      let sql = `SELECT * FROM vars ${where} ORDER BY ${sortCol} ${sortDir}, name ASC`;
      if (limit !== undefined || (options?.offset ?? 0) > 0) {
        sql += ` LIMIT ${limit ?? -1} OFFSET ${options?.offset ?? 0}`;
      }

      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

      // Post-filter by tags and labels (stored as JSON)
      const filterTags = options?.tags ?? {};
      const filterLabels = options?.labels ?? [];
      const needsPostFilter =
        Object.keys(filterTags).length > 0 || filterLabels.length > 0;

      if (!needsPostFilter) return rows.map(toVariable);

      const results: Variable[] = [];
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
      return results;
    },

    history(name: string, schema?: Hash): HistoryEntry[] {
      if (schema !== undefined) {
        const rows = stmtGetHistory.all(name, schema) as Record<
          string,
          unknown
        >[];
        return rows.map((r) => ({
          value: r["value"] as Hash,
          position: r["position"] as number,
          setAt: r["set_at"] as number,
        }));
      }
      // No schema: if exactly one variant, return its history
      const vars = stmtGetByName.all(name) as Record<string, unknown>[];
      if (vars.length !== 1) return [];
      const v = vars[0]!;
      const rows = stmtGetHistory.all(
        v["name"] as string,
        v["schema"] as string,
      ) as Record<string, unknown>[];
      return rows.map((r) => ({
        value: r["value"] as Hash,
        position: r["position"] as number,
        setAt: r["set_at"] as number,
      }));
    },

    close(): void {
      db.close();
    },
  };

  // ── TagStore implementation ──
  const tagStore: TagStore = {
    tag(target: Hash, operations: TagOp[]): Tag[] {
      const now = Date.now();
      for (const op of operations) {
        if (op.op === "set") {
          const existing = stmtGetTag.get(target, op.key) as
            | Record<string, unknown>
            | undefined;
          const created = (existing?.["created"] as number) ?? now;
          stmtUpsertTag.run(target, op.key, op.value ?? null, created);
        } else {
          stmtDeleteTag.run(target, op.key);
        }
      }
      const rows = stmtGetTagsByTarget.all(target) as Record<
        string,
        unknown
      >[];
      return rows.map((r) => ({
        key: r["key"] as string,
        value: r["value"] as string | null,
        target,
        created: r["created"] as number,
      }));
    },

    untag(target: Hash, keys: string[]): void {
      for (const k of keys) {
        stmtDeleteTag.run(target, k);
      }
    },

    tags(target: Hash): Tag[] {
      const rows = stmtGetTagsByTarget.all(target) as Record<
        string,
        unknown
      >[];
      return rows.map((r) => ({
        key: r["key"] as string,
        value: r["value"] as string | null,
        target,
        created: r["created"] as number,
      }));
    },

    listByTag(tag: string, options?: ListOptions): Hash[] {
      let key = tag;
      let value: string | null | undefined;
      const eqIdx = tag.indexOf("=");
      if (eqIdx >= 0) {
        key = tag.slice(0, eqIdx);
        value = tag.slice(eqIdx + 1);
      }

      const rows = (
        value !== undefined
          ? stmtGetTagsByKeyValue.all(key, value)
          : stmtGetTagsByKey.all(key)
      ) as Record<string, unknown>[];

      let entries: ListEntry[] = rows.map((r) => ({
        hash: r["target"] as Hash,
        created: r["created"] as number,
        updated: r["created"] as number,
      }));

      // Apply sort/limit/offset from ListOptions
      const sort = options?.sort ?? "created";
      const desc = options?.desc ?? false;
      entries.sort((a, b) => {
        const av = sort === "updated" ? a.updated : a.created;
        const bv = sort === "updated" ? b.updated : b.created;
        return desc ? bv - av : av - bv;
      });
      const offset = options?.offset ?? 0;
      if (offset > 0) entries = entries.slice(offset);
      const limit = options?.limit;
      if (limit !== undefined) entries = entries.slice(0, limit);

      return entries.map((e) => e.hash);
    },
  };

  return {
    var: varStore,
    tag: tagStore,
    close: () => db.close(),
  };
}
