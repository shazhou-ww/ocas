import { Database } from "bun:sqlite";
import type { Hash, ListSort, Store } from "./types.js";
import type { Variable } from "./variable.js";

/**
 * Maximum number of historical values retained per (variable_name, variable_schema).
 * Position 0 is current; positions 1..MAX_HISTORY-1 are previous values (LRU).
 */
export const MAX_HISTORY = 10;

/**
 * Custom error types for variable operations
 */
export class VariableNotFoundError extends Error {
  constructor(
    public variableName: string,
    public variableSchema: Hash,
  ) {
    super(`Variable not found: name=${variableName}, schema=${variableSchema}`);
    this.name = "VariableNotFoundError";
  }
}

export class InvalidVariableNameError extends Error {
  constructor(
    public variableName: string,
    public reason: string,
  ) {
    super(`Invalid variable name "${variableName}": ${reason}`);
    this.name = "InvalidVariableNameError";
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

export class CasNodeNotFoundError extends Error {
  constructor(
    public readonly hash: string,
    message?: string,
  ) {
    super(message ?? `CAS node not found: ${hash}`);
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
    // Enable foreign keys
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initDb();
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS variables (
        name TEXT NOT NULL,
        schema TEXT NOT NULL,
        value TEXT NOT NULL,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        PRIMARY KEY (name, schema)
      );

      CREATE INDEX IF NOT EXISTS idx_var_name ON variables(name);
      CREATE INDEX IF NOT EXISTS idx_var_value ON variables(value);
      CREATE INDEX IF NOT EXISTS idx_var_schema ON variables(schema);

      CREATE TABLE IF NOT EXISTS variable_tags (
        variable_name TEXT NOT NULL,
        variable_schema TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (variable_name, variable_schema, key),
        FOREIGN KEY (variable_name, variable_schema) REFERENCES variables(name, schema) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS variable_labels (
        variable_name TEXT NOT NULL,
        variable_schema TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (variable_name, variable_schema, name),
        FOREIGN KEY (variable_name, variable_schema) REFERENCES variables(name, schema) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_var_tag_key ON variable_tags(key);
      CREATE INDEX IF NOT EXISTS idx_var_tag_key_value ON variable_tags(key, value);
      CREATE INDEX IF NOT EXISTS idx_var_label_name ON variable_labels(name);

      CREATE TABLE IF NOT EXISTS variable_history (
        variable_name TEXT NOT NULL,
        variable_schema TEXT NOT NULL,
        value TEXT NOT NULL,
        position INTEGER NOT NULL,
        set_at INTEGER NOT NULL,
        PRIMARY KEY (variable_name, variable_schema, position),
        FOREIGN KEY (variable_name, variable_schema) REFERENCES variables(name, schema) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_var_history_value ON variable_history(value);
    `);
  }

  /**
   * Validate variable name format
   * @ is allowed at the start of the first segment (system-reserved)
   */
  private validateName(name: string): void {
    // Rule 1: Cannot be empty
    if (name === "") {
      throw new InvalidVariableNameError(name, "Name cannot be empty");
    }

    // Rule 2: No leading slash
    if (name.startsWith("/")) {
      throw new InvalidVariableNameError(
        name,
        "Name cannot start with leading slash",
      );
    }

    // Rule 3: No trailing slash
    if (name.endsWith("/")) {
      throw new InvalidVariableNameError(
        name,
        "Name cannot end with trailing slash",
      );
    }

    // Rule 4: Each segment must match [a-zA-Z0-9._-]+ (with @ allowed at start of first segment)
    const segments = name.split("/");
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as string;
      if (segment === "") {
        throw new InvalidVariableNameError(
          name,
          "Name contains empty segment (consecutive slashes //)",
        );
      }

      // Check for invalid characters
      // First segment can start with @, all segments can contain [a-zA-Z0-9._-]
      const regex = i === 0 ? /^@?[a-zA-Z0-9._-]+$/ : /^[a-zA-Z0-9._-]+$/;
      if (!regex.test(segment)) {
        throw new InvalidVariableNameError(
          name,
          `Segment "${segment}" contains invalid characters (only ${i === 0 ? "@, " : ""}a-z, A-Z, 0-9, ., _, - allowed)`,
        );
      }
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
   * Load tags for a variable
   */
  private loadTags(name: string, schema: Hash): Record<string, string> {
    const stmt = this.db.prepare(`
      SELECT key, value
      FROM variable_tags
      WHERE variable_name = ? AND variable_schema = ?
    `);

    const rows = stmt.all(name, schema) as Array<{
      key: string;
      value: string;
    }>;
    const tags: Record<string, string> = {};
    for (const row of rows) {
      tags[row.key] = row.value;
    }
    return tags;
  }

  /**
   * Load labels for a variable
   */
  private loadLabels(name: string, schema: Hash): string[] {
    const stmt = this.db.prepare(`
      SELECT name
      FROM variable_labels
      WHERE variable_name = ? AND variable_schema = ?
      ORDER BY name ASC
    `);

    const rows = stmt.all(name, schema) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  /**
   * Manage history for a variable on set().
   *
   * Rules:
   *  - If new value equals current (position 0), no-op (idempotent).
   *  - If new value already exists in history at position N, remove it; entries
   *    with position < N shift +1; insert new value at position 0.
   *  - Otherwise shift all entries +1, insert new at position 0, prune any
   *    entries at position >= MAX_HISTORY.
   *
   * Caller must invoke inside a transaction.
   * Returns true if history changed (i.e. value differs from current),
   * false if it was a no-op.
   */
  private recordHistory(
    name: string,
    schema: Hash,
    value: Hash,
    now: number,
  ): boolean {
    // Check current value at position 0
    const currentRow = this.db
      .prepare(
        `SELECT value FROM variable_history WHERE variable_name = ? AND variable_schema = ? AND position = 0`,
      )
      .get(name, schema) as { value: string } | undefined | null;

    if (currentRow && currentRow.value === value) {
      // Idempotent: same value as current; do nothing
      return false;
    }

    // Find existing position of this value (if any)
    const existingRow = this.db
      .prepare(
        `SELECT position FROM variable_history WHERE variable_name = ? AND variable_schema = ? AND value = ?`,
      )
      .get(name, schema, value) as { position: number } | undefined | null;

    if (existingRow) {
      const existingPos = existingRow.position;
      // Delete the existing entry first to free its position
      this.db
        .prepare(
          `DELETE FROM variable_history WHERE variable_name = ? AND variable_schema = ? AND position = ?`,
        )
        .run(name, schema, existingPos);

      // Shift positions [0, existingPos) up by 1.
      // Use a temporary offset to avoid PK conflicts during the shift.
      this.db
        .prepare(
          `UPDATE variable_history SET position = position + 1000000 WHERE variable_name = ? AND variable_schema = ? AND position < ?`,
        )
        .run(name, schema, existingPos);
      this.db
        .prepare(
          `UPDATE variable_history SET position = position - 1000000 + 1 WHERE variable_name = ? AND variable_schema = ? AND position >= 1000000`,
        )
        .run(name, schema);
    } else {
      // New value: shift everything +1 (using temp offset to avoid PK conflicts)
      this.db
        .prepare(
          `UPDATE variable_history SET position = position + 1000000 WHERE variable_name = ? AND variable_schema = ?`,
        )
        .run(name, schema);
      this.db
        .prepare(
          `UPDATE variable_history SET position = position - 1000000 + 1 WHERE variable_name = ? AND variable_schema = ? AND position >= 1000000`,
        )
        .run(name, schema);

      // Prune any entries that ended up at position >= MAX_HISTORY
      this.db
        .prepare(
          `DELETE FROM variable_history WHERE variable_name = ? AND variable_schema = ? AND position >= ?`,
        )
        .run(name, schema, MAX_HISTORY);
    }

    // Insert new value at position 0
    this.db
      .prepare(
        `INSERT INTO variable_history (variable_name, variable_schema, value, position, set_at) VALUES (?, ?, ?, 0, ?)`,
      )
      .run(name, schema, value, now);

    return true;
  }

  /**
   * Set a variable (upsert: create or update)
   */
  set(
    name: string,
    value: string,
    options?: {
      tags?: Record<string, string>;
      labels?: string[];
    },
  ): Variable {
    // Validate name format
    this.validateName(name);

    const schema = this.extractSchema(value);

    // Check if variable exists
    const existing = this.get(name, schema);

    if (existing !== null) {
      // Update existing variable
      const now = Date.now();

      // If options provided, use them; otherwise preserve existing
      const tags = options?.tags ?? existing.tags;
      const labels = options?.labels ?? existing.labels;

      // Check for tag/label conflicts when updating with new options
      if (options !== undefined) {
        const tagKeys = Object.keys(tags);
        for (const key of tagKeys) {
          if (labels.includes(key)) {
            throw new TagLabelConflictError(key, "label", "tag");
          }
        }
      }

      this.db.exec("BEGIN TRANSACTION");

      let changed = false;
      try {
        // Manage history (also detects idempotent same-value sets)
        changed = this.recordHistory(name, schema, value, now);

        // Update value and timestamp only if value changed
        if (changed) {
          const updateStmt = this.db.prepare(`
            UPDATE variables
            SET value = ?, updated = ?
            WHERE name = ? AND schema = ?
          `);
          updateStmt.run(value, now, name, schema);
        }

        // If options provided, update tags/labels
        if (options !== undefined) {
          // Delete existing tags and labels
          this.db
            .prepare(`
            DELETE FROM variable_tags WHERE variable_name = ? AND variable_schema = ?
          `)
            .run(name, schema);

          this.db
            .prepare(`
            DELETE FROM variable_labels WHERE variable_name = ? AND variable_schema = ?
          `)
            .run(name, schema);

          // Insert new tags
          const tagKeys = Object.keys(tags);
          if (tagKeys.length > 0) {
            const tagStmt = this.db.prepare(`
              INSERT INTO variable_tags (variable_name, variable_schema, key, value)
              VALUES (?, ?, ?, ?)
            `);
            for (const [key, val] of Object.entries(tags)) {
              tagStmt.run(name, schema, key, val);
            }
          }

          // Insert new labels
          if (labels.length > 0) {
            const labelStmt = this.db.prepare(`
              INSERT INTO variable_labels (variable_name, variable_schema, name)
              VALUES (?, ?, ?)
            `);
            for (const labelName of labels) {
              labelStmt.run(name, schema, labelName);
            }
          }
        }

        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }

      return {
        name,
        schema,
        value,
        created: existing.created,
        updated: changed ? now : existing.updated,
        tags,
        labels: [...labels],
      };
    }

    // Create new variable
    const tags = options?.tags ?? {};
    const labels = options?.labels ?? [];

    // Check for tag/label conflicts
    const tagKeys = Object.keys(tags);
    for (const key of tagKeys) {
      if (labels.includes(key)) {
        throw new TagLabelConflictError(key, "label", "tag");
      }
    }

    const now = Date.now();

    this.db.exec("BEGIN TRANSACTION");

    try {
      const stmt = this.db.prepare(`
        INSERT INTO variables (name, schema, value, created, updated)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(name, schema, value, now, now);

      // Initialise history with this value at position 0
      this.db
        .prepare(
          `INSERT INTO variable_history (variable_name, variable_schema, value, position, set_at) VALUES (?, ?, ?, 0, ?)`,
        )
        .run(name, schema, value, now);

      // Insert tags
      if (tagKeys.length > 0) {
        const tagStmt = this.db.prepare(`
          INSERT INTO variable_tags (variable_name, variable_schema, key, value)
          VALUES (?, ?, ?, ?)
        `);
        for (const [key, val] of Object.entries(tags)) {
          tagStmt.run(name, schema, key, val);
        }
      }

      // Insert labels
      if (labels.length > 0) {
        const labelStmt = this.db.prepare(`
          INSERT INTO variable_labels (variable_name, variable_schema, name)
          VALUES (?, ?, ?)
        `);
        for (const labelName of labels) {
          labelStmt.run(name, schema, labelName);
        }
      }

      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }

    return {
      name,
      schema,
      value,
      created: now,
      updated: now,
      tags,
      labels: [...labels],
    };
  }

  /**
   * Get a variable by name, optionally with schema
   */
  /**
   * Get a variable by name and schema
   * @param name - Variable name
   * @param schema - Schema hash (required)
   * @returns Variable if found, null otherwise
   */
  get(name: string, schema: Hash): Variable | null {
    // Precise match with schema
    const stmt = this.db.prepare(`
      SELECT name, schema, value, created, updated
      FROM variables
      WHERE name = ? AND schema = ?
    `);

    const row = stmt.get(name, schema) as
      | {
          name: string;
          schema: string;
          value: string;
          created: number;
          updated: number;
        }
      | undefined
      | null;

    if (row === undefined || row === null) {
      return null;
    }

    const tags = this.loadTags(row.name, row.schema);
    const labels = this.loadLabels(row.name, row.schema);

    return {
      name: row.name,
      schema: row.schema,
      value: row.value,
      created: row.created,
      updated: row.updated,
      tags,
      labels,
    };
  }

  /**
   * Update a variable's value (with schema validation)
   */
  update(name: string, schema: Hash, value: string): Variable {
    // Validate name format
    this.validateName(name);

    const existing = this.get(name, schema);
    if (existing === null) {
      throw new VariableNotFoundError(name, schema);
    }

    const newSchema = this.extractSchema(value);
    if (newSchema !== existing.schema) {
      throw new SchemaMismatchError(existing.schema, newSchema);
    }

    const now = Date.now();

    const stmt = this.db.prepare(`
      UPDATE variables
      SET value = ?, updated = ?
      WHERE name = ? AND schema = ?
    `);

    stmt.run(value, now, name, schema);

    return {
      ...existing,
      value,
      updated: now,
    };
  }

  /**
   * Remove a variable (or all variants if schema omitted)
   */
  remove(name: string): Variable[];
  remove(name: string, schema: Hash): Variable;
  remove(name: string, schema?: Hash): Variable | Variable[] {
    if (schema !== undefined) {
      // Remove specific (name, schema) variant
      const existing = this.get(name, schema);
      if (existing === null) {
        throw new VariableNotFoundError(name, schema);
      }

      const stmt = this.db.prepare(`
        DELETE FROM variables WHERE name = ? AND schema = ?
      `);

      stmt.run(name, schema);

      return existing;
    }

    // Remove all schema variants for this name
    const variants = this.list({
      exactName: name,
    });

    if (variants.length === 0) {
      return [];
    }

    const stmt = this.db.prepare(`
      DELETE FROM variables WHERE name = ?
    `);

    stmt.run(name);

    return variants;
  }

  /**
   * List variables with optional filters
   */
  list(options?: {
    namePrefix?: string;
    exactName?: string;
    schema?: Hash;
    tags?: Record<string, string>;
    labels?: string[];
    sort?: ListSort;
    desc?: boolean;
    limit?: number;
    offset?: number;
  }): Variable[] {
    // Validate mutually exclusive options
    if (options?.namePrefix !== undefined && options?.exactName !== undefined) {
      throw new Error(
        "namePrefix and exactName are mutually exclusive - cannot specify both",
      );
    }

    const namePrefix = options?.namePrefix ?? "";
    const exactName = options?.exactName;
    const schema = options?.schema;
    const filterTags = options?.tags ?? {};
    const filterLabels = options?.labels ?? [];
    const sort = options?.sort ?? "created";
    const desc = options?.desc ?? false;
    const limit = options?.limit;
    const offset = options?.offset ?? 0;

    if (limit !== undefined && limit <= 0) return [];

    // Build query with filters
    let query = `
      SELECT DISTINCT v.name, v.schema, v.value, v.created, v.updated
      FROM variables v
    `;

    const params: (string | number)[] = [];

    // Tag filters (AND logic)
    const tagKeys = Object.keys(filterTags);
    for (let i = 0; i < tagKeys.length; i++) {
      const key = tagKeys[i] as string;
      const value = filterTags[key] as string;
      query += `
        INNER JOIN variable_tags t${i} ON v.name = t${i}.variable_name
          AND v.schema = t${i}.variable_schema
          AND t${i}.key = ? AND t${i}.value = ?
      `;
      params.push(key, value);
    }

    // Label filters (AND logic)
    for (let i = 0; i < filterLabels.length; i++) {
      const label = filterLabels[i] as string;
      query += `
        INNER JOIN variable_labels l${i} ON v.name = l${i}.variable_name
          AND v.schema = l${i}.variable_schema
          AND l${i}.name = ?
      `;
      params.push(label);
    }

    // WHERE clause for name filters and schema
    const whereClauses: string[] = [];

    if (exactName !== undefined) {
      whereClauses.push("v.name = ?");
      params.push(exactName);
    } else if (namePrefix !== "") {
      whereClauses.push("v.name LIKE ? || '%'");
      params.push(namePrefix);
    }

    if (schema !== undefined) {
      whereClauses.push("v.schema = ?");
      params.push(schema);
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(" AND ")}`;
    }

    const sortColumn = sort === "updated" ? "v.updated" : "v.created";
    const direction = desc ? "DESC" : "ASC";
    // Tiebreaker: name ASC for stable ordering across same-ms timestamps
    query += ` ORDER BY ${sortColumn} ${direction}, v.name ASC`;
    if (limit !== undefined) {
      query += " LIMIT ? OFFSET ?";
      params.push(limit, offset);
    } else if (offset > 0) {
      // SQLite requires LIMIT when using OFFSET; use -1 to mean "no limit".
      query += " LIMIT -1 OFFSET ?";
      params.push(offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      name: string;
      schema: string;
      value: string;
      created: number;
      updated: number;
    }>;

    return rows.map((row) => ({
      name: row.name,
      schema: row.schema,
      value: row.value,
      created: row.created,
      updated: row.updated,
      tags: this.loadTags(row.name, row.schema),
      labels: this.loadLabels(row.name, row.schema),
    }));
  }

  /**
   * Add/update/delete tags and labels
   */
  tag(
    name: string,
    schema: Hash,
    operations: {
      add?: Record<string, string>; // tags to add/update
      addLabels?: string[]; // labels to add
      delete?: string[]; // tag keys or label names to delete
    },
  ): Variable {
    // Validate name format
    this.validateName(name);

    const existing = this.get(name, schema);
    if (existing === null) {
      throw new VariableNotFoundError(name, schema);
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

    for (const labelName of addLabels) {
      // Check if this name is being added as a tag in the same operation
      if (newTagKeys.includes(labelName)) {
        throw new TagLabelConflictError(labelName, "tag", "label");
      }
      // Check if this name already exists as a tag key (and not being deleted)
      if (
        existing.tags[labelName] !== undefined &&
        !deleteNames.includes(labelName)
      ) {
        throw new TagLabelConflictError(labelName, "tag", "label");
      }
    }

    const now = Date.now();

    this.db.exec("BEGIN TRANSACTION");

    try {
      // Update timestamp
      const updateStmt = this.db.prepare(`
        UPDATE variables SET updated = ? WHERE name = ? AND schema = ?
      `);
      updateStmt.run(now, name, schema);

      // Delete tags and labels
      if (deleteNames.length > 0) {
        const deleteTagStmt = this.db.prepare(`
          DELETE FROM variable_tags WHERE variable_name = ? AND variable_schema = ? AND key = ?
        `);
        const deleteLabelStmt = this.db.prepare(`
          DELETE FROM variable_labels WHERE variable_name = ? AND variable_schema = ? AND name = ?
        `);
        for (const deleteName of deleteNames) {
          deleteTagStmt.run(name, schema, deleteName);
          deleteLabelStmt.run(name, schema, deleteName);
        }
      }

      // Add or update tags
      if (newTagKeys.length > 0) {
        const tagStmt = this.db.prepare(`
          INSERT OR REPLACE INTO variable_tags (variable_name, variable_schema, key, value)
          VALUES (?, ?, ?, ?)
        `);
        for (const [key, value] of Object.entries(addTags)) {
          tagStmt.run(name, schema, key, value);
        }
      }

      // Add labels (with conflict handling)
      if (addLabels.length > 0) {
        const labelStmt = this.db.prepare(`
          INSERT OR IGNORE INTO variable_labels (variable_name, variable_schema, name)
          VALUES (?, ?, ?)
        `);
        for (const labelName of addLabels) {
          labelStmt.run(name, schema, labelName);
        }
      }

      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }

    // Return updated variable
    const updated = this.get(name, schema);
    if (updated === null) {
      throw new VariableNotFoundError(name, schema);
    }
    return updated;
  }

  /**
   * Get the value history for a variable, ordered by position.
   * Index 0 is the current value; subsequent entries are older.
   * Returns an empty array if the variable does not exist.
   */
  history(name: string, schema: Hash): Hash[] {
    const rows = this.db
      .prepare(
        `SELECT value, position FROM variable_history WHERE variable_name = ? AND variable_schema = ? ORDER BY position ASC`,
      )
      .all(name, schema) as Array<{ value: string; position: number }>;
    return rows.map((r) => r.value as Hash);
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
