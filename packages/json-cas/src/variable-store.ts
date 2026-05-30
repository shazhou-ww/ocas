import { Database } from "bun:sqlite";
import { ulid } from "ulidx";
import type { Store } from "./types.js";
import type { Variable, VariableId } from "./variable.js";

/**
 * Custom error types for variable operations
 */
export class VariableNotFoundError extends Error {
  constructor(id: VariableId) {
    super(`Variable not found: ${id}`);
    this.name = "VariableNotFoundError";
  }
}

export class SchemaMismatchError extends Error {
  constructor(
    public expected: string,
    public actual: string,
  ) {
    super(`Schema mismatch: expected ${expected}, got ${actual}`);
    this.name = "SchemaMismatchError";
  }
}

export class InvalidScopeError extends Error {
  constructor(scope: string) {
    super(`Invalid scope: scope must end with / (got: ${scope})`);
    this.name = "InvalidScopeError";
  }
}

export class CasNodeNotFoundError extends Error {
  constructor(hash: string) {
    super(`CAS node not found: ${hash}`);
    this.name = "CasNodeNotFoundError";
  }
}

export class TagLabelConflictError extends Error {
  constructor(
    public conflictName: string,
    public existingType: "tag" | "label",
    public attemptedType: "tag" | "label",
  ) {
    super(`Conflict: '${conflictName}' already exists as a ${existingType}`);
    this.name = "TagLabelConflictError";
  }
}

export class InvalidTagFormatError extends Error {
  constructor(tag: string) {
    super(`Invalid tag format: ${tag}`);
    this.name = "InvalidTagFormatError";
  }
}

/**
 * Variable store with SQLite backend
 */
export class VariableStore {
  private db: Database;

  constructor(
    dbPath: string,
    private casStore: Store,
  ) {
    this.db = new Database(dbPath, { create: true });
    this.initDb();
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS variables (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        value TEXT NOT NULL,
        schema TEXT NOT NULL,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_var_scope ON variables(scope);
      CREATE INDEX IF NOT EXISTS idx_var_value ON variables(value);
      CREATE INDEX IF NOT EXISTS idx_var_schema ON variables(schema);

      CREATE TABLE IF NOT EXISTS variable_tags (
        variable_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (variable_id, key),
        FOREIGN KEY (variable_id) REFERENCES variables(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS variable_labels (
        variable_id TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (variable_id, name),
        FOREIGN KEY (variable_id) REFERENCES variables(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_var_tag_key ON variable_tags(key);
      CREATE INDEX IF NOT EXISTS idx_var_tag_key_value ON variable_tags(key, value);
      CREATE INDEX IF NOT EXISTS idx_var_label_name ON variable_labels(name);
    `);
  }

  /**
   * Validate that scope ends with /
   */
  private validateScope(scope: string): void {
    if (!scope.endsWith("/")) {
      throw new InvalidScopeError(scope);
    }
  }

  /**
   * Extract schema hash from CAS node
   */
  private extractSchema(hash: string): string {
    const node = this.casStore.get(hash);
    if (node === null) {
      throw new CasNodeNotFoundError(hash);
    }
    return node.type;
  }

  /**
   * Create a new variable
   */
  create(
    scope: string,
    value: string,
    options?: {
      tags?: Record<string, string>;
      labels?: string[];
    },
  ): Variable {
    this.validateScope(scope);
    const schema = this.extractSchema(value);

    const tags = options?.tags ?? {};
    const labels = options?.labels ?? [];

    // Check for tag/label conflicts
    const tagKeys = Object.keys(tags);
    for (const key of tagKeys) {
      if (labels.includes(key)) {
        throw new TagLabelConflictError(key, "label", "tag");
      }
    }

    const id = ulid();
    const now = Date.now();

    this.db.exec("BEGIN TRANSACTION");

    try {
      const stmt = this.db.prepare(`
        INSERT INTO variables (id, scope, value, schema, created, updated)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(id, scope, value, schema, now, now);

      // Insert tags
      if (tagKeys.length > 0) {
        const tagStmt = this.db.prepare(`
          INSERT INTO variable_tags (variable_id, key, value)
          VALUES (?, ?, ?)
        `);
        for (const [key, val] of Object.entries(tags)) {
          tagStmt.run(id, key, val);
        }
      }

      // Insert labels
      if (labels.length > 0) {
        const labelStmt = this.db.prepare(`
          INSERT INTO variable_labels (variable_id, name)
          VALUES (?, ?)
        `);
        for (const name of labels) {
          labelStmt.run(id, name);
        }
      }

      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }

    return {
      id,
      scope,
      value,
      schema,
      created: now,
      updated: now,
      tags,
      labels: [...labels],
    };
  }

  /**
   * Load tags for a variable
   */
  private loadTags(id: VariableId): Record<string, string> {
    const stmt = this.db.prepare(`
      SELECT key, value
      FROM variable_tags
      WHERE variable_id = ?
    `);

    const rows = stmt.all(id) as Array<{ key: string; value: string }>;
    const tags: Record<string, string> = {};
    for (const row of rows) {
      tags[row.key] = row.value;
    }
    return tags;
  }

  /**
   * Load labels for a variable
   */
  private loadLabels(id: VariableId): string[] {
    const stmt = this.db.prepare(`
      SELECT name
      FROM variable_labels
      WHERE variable_id = ?
      ORDER BY name ASC
    `);

    const rows = stmt.all(id) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  /**
   * Get a variable by ID
   */
  get(id: VariableId): Variable | null {
    const stmt = this.db.prepare(`
      SELECT id, scope, value, schema, created, updated
      FROM variables
      WHERE id = ?
    `);

    const row = stmt.get(id) as
      | {
          id: string;
          scope: string;
          value: string;
          schema: string;
          created: number;
          updated: number;
        }
      | undefined
      | null;

    if (row === undefined || row === null) {
      return null;
    }

    const tags = this.loadTags(row.id);
    const labels = this.loadLabels(row.id);

    return {
      id: row.id,
      scope: row.scope,
      value: row.value,
      schema: row.schema,
      created: row.created,
      updated: row.updated,
      tags,
      labels,
    };
  }

  /**
   * Update a variable's value (with schema validation)
   */
  update(id: VariableId, value: string): Variable {
    const existing = this.get(id);
    if (existing === null) {
      throw new VariableNotFoundError(id);
    }

    const newSchema = this.extractSchema(value);
    if (newSchema !== existing.schema) {
      throw new SchemaMismatchError(existing.schema, newSchema);
    }

    const now = Date.now();

    const stmt = this.db.prepare(`
      UPDATE variables
      SET value = ?, updated = ?
      WHERE id = ?
    `);

    stmt.run(value, now, id);

    return {
      ...existing,
      value,
      updated: now,
    };
  }

  /**
   * Delete a variable
   */
  delete(id: VariableId): Variable {
    const existing = this.get(id);
    if (existing === null) {
      throw new VariableNotFoundError(id);
    }

    const stmt = this.db.prepare(`
      DELETE FROM variables WHERE id = ?
    `);

    stmt.run(id);

    return existing;
  }

  /**
   * List variables matching a scope prefix
   */
  list(options?: {
    scope?: string;
    tags?: Record<string, string>;
    labels?: string[];
  }): Variable[] {
    const scope = options?.scope ?? "";
    const filterTags = options?.tags ?? {};
    const filterLabels = options?.labels ?? [];

    // Validate scope format (must end with / if non-empty)
    if (scope !== "" && !scope.endsWith("/")) {
      throw new InvalidScopeError(scope);
    }

    // Build query with tag/label filtering
    let query = `
      SELECT DISTINCT v.id, v.scope, v.value, v.schema, v.created, v.updated
      FROM variables v
    `;

    const params: (string | number)[] = [];

    // Tag filters (AND logic)
    const tagKeys = Object.keys(filterTags);
    for (let i = 0; i < tagKeys.length; i++) {
      const key = tagKeys[i] as string;
      const value = filterTags[key] as string;
      query += `
        INNER JOIN variable_tags t${i} ON v.id = t${i}.variable_id
          AND t${i}.key = ? AND t${i}.value = ?
      `;
      params.push(key, value);
    }

    // Label filters (AND logic)
    for (let i = 0; i < filterLabels.length; i++) {
      const label = filterLabels[i] as string;
      query += `
        INNER JOIN variable_labels l${i} ON v.id = l${i}.variable_id
          AND l${i}.name = ?
      `;
      params.push(label);
    }

    // Scope filter (always present)
    query += " WHERE v.scope LIKE ? || '%'";
    params.push(scope);
    query += " ORDER BY v.created ASC";

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      id: string;
      scope: string;
      value: string;
      schema: string;
      created: number;
      updated: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      value: row.value,
      schema: row.schema,
      created: row.created,
      updated: row.updated,
      tags: this.loadTags(row.id),
      labels: this.loadLabels(row.id),
    }));
  }

  /**
   * Add/update/delete tags and labels
   */
  tag(
    id: VariableId,
    operations: {
      add?: Record<string, string>; // tags to add/update
      addLabels?: string[]; // labels to add
      delete?: string[]; // tag keys or label names to delete
    },
  ): Variable {
    const existing = this.get(id);
    if (existing === null) {
      throw new VariableNotFoundError(id);
    }

    const addTags = operations.add ?? {};
    const addLabels = operations.addLabels ?? [];
    const deleteNames = operations.delete ?? [];

    // Check for conflicts between tags and labels
    const newTagKeys = Object.keys(addTags);
    for (const key of newTagKeys) {
      // Check if this key is being added as a label in the same operation
      if (addLabels.includes(key)) {
        throw new TagLabelConflictError(key, "label", "tag");
      }
      // Check if this key already exists as a label (and not being deleted)
      if (existing.labels.includes(key) && !deleteNames.includes(key)) {
        throw new TagLabelConflictError(key, "label", "tag");
      }
    }

    for (const name of addLabels) {
      // Check if this name is being added as a tag in the same operation
      if (newTagKeys.includes(name)) {
        throw new TagLabelConflictError(name, "tag", "label");
      }
      // Check if this name already exists as a tag key (and not being deleted)
      if (existing.tags[name] !== undefined && !deleteNames.includes(name)) {
        throw new TagLabelConflictError(name, "tag", "label");
      }
    }

    const now = Date.now();

    this.db.exec("BEGIN TRANSACTION");

    try {
      // Update timestamp
      const updateStmt = this.db.prepare(`
        UPDATE variables SET updated = ? WHERE id = ?
      `);
      updateStmt.run(now, id);

      // Delete tags and labels
      if (deleteNames.length > 0) {
        const deleteTagStmt = this.db.prepare(`
          DELETE FROM variable_tags WHERE variable_id = ? AND key = ?
        `);
        const deleteLabelStmt = this.db.prepare(`
          DELETE FROM variable_labels WHERE variable_id = ? AND name = ?
        `);
        for (const name of deleteNames) {
          deleteTagStmt.run(id, name);
          deleteLabelStmt.run(id, name);
        }
      }

      // Add or update tags
      if (newTagKeys.length > 0) {
        const tagStmt = this.db.prepare(`
          INSERT OR REPLACE INTO variable_tags (variable_id, key, value)
          VALUES (?, ?, ?)
        `);
        for (const [key, value] of Object.entries(addTags)) {
          tagStmt.run(id, key, value);
        }
      }

      // Add labels (with conflict handling)
      if (addLabels.length > 0) {
        const labelStmt = this.db.prepare(`
          INSERT OR IGNORE INTO variable_labels (variable_id, name)
          VALUES (?, ?)
        `);
        for (const name of addLabels) {
          labelStmt.run(id, name);
        }
      }

      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }

    // Return updated variable
    const updated = this.get(id);
    if (updated === null) {
      throw new VariableNotFoundError(id);
    }
    return updated;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Create a variable store
 */
export function createVariableStore(
  dbPath: string,
  casStore: Store,
): VariableStore {
  return new VariableStore(dbPath, casStore);
}
