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
  create(scope: string, value: string): Variable {
    this.validateScope(scope);
    const schema = this.extractSchema(value);

    const id = ulid();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO variables (id, scope, value, schema, created, updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, scope, value, schema, now, now);

    return {
      id,
      scope,
      value,
      schema,
      created: now,
      updated: now,
    };
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

    return {
      id: row.id,
      scope: row.scope,
      value: row.value,
      schema: row.schema,
      created: row.created,
      updated: row.updated,
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
