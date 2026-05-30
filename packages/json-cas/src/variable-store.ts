import { Database } from "bun:sqlite";
import type { Hash, Store } from "./types.js";
import type { Variable } from "./variable.js";

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

export class VariableDuplicateError extends Error {
  constructor(
    public variableName: string,
    public variableSchema: Hash,
  ) {
    super(
      `Variable already exists: name=${variableName}, schema=${variableSchema}`,
    );
    this.name = "VariableDuplicateError";
  }
}

export class InvalidVariableNameError extends Error {
  constructor(public variableName: string) {
    super(`Variable name cannot be empty`);
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
    `);
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
   * Create a new variable
   */
  create(
    name: string,
    value: string,
    options?: {
      tags?: Record<string, string>;
      labels?: string[];
    },
  ): Variable {
    // Validate name is not empty
    if (name === "") {
      throw new InvalidVariableNameError(name);
    }

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

    const now = Date.now();

    this.db.exec("BEGIN TRANSACTION");

    try {
      const stmt = this.db.prepare(`
        INSERT INTO variables (name, schema, value, created, updated)
        VALUES (?, ?, ?, ?, ?)
      `);

      try {
        stmt.run(name, schema, value, now, now);
      } catch (e: any) {
        if (e?.message?.includes("UNIQUE constraint failed")) {
          throw new VariableDuplicateError(name, schema);
        }
        throw e;
      }

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
   * Get a variable by (name, schema)
   */
  get(name: string, schema: Hash): Variable | null {
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
   * Delete a variable
   */
  delete(name: string, schema: Hash): Variable {
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

  /**
   * List variables with optional filters
   */
  list(options?: {
    namePrefix?: string;
    schema?: Hash;
    tags?: Record<string, string>;
    labels?: string[];
  }): Variable[] {
    const namePrefix = options?.namePrefix ?? "";
    const schema = options?.schema;
    const filterTags = options?.tags ?? {};
    const filterLabels = options?.labels ?? [];

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

    // WHERE clause for namePrefix and schema
    const whereClauses: string[] = [];

    if (namePrefix !== "") {
      whereClauses.push("v.name LIKE ? || '%'");
      params.push(namePrefix);
    }

    if (schema !== undefined) {
      whereClauses.push("v.schema = ?");
      params.push(schema);
    }

    if (whereClauses.length > 0) {
      query += " WHERE " + whereClauses.join(" AND ");
    }

    query += " ORDER BY v.created ASC";

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
