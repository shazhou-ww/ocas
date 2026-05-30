import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "./bootstrap.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";
import type { Store } from "./types.js";
import type { Variable } from "./variable.js";
import {
  CasNodeNotFoundError,
  InvalidVariableNameError,
  SchemaMismatchError,
  TagLabelConflictError,
  VariableNotFoundError,
  VariableStore,
} from "./variable-store.js";

const tmpDbPath = () =>
  join(
    tmpdir(),
    `test-var-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );

describe("VariableStore - Database Schema", () => {
  test("Database schema has (name, schema) composite primary key", () => {
    const store = createMemoryStore();
    const dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Query schema from SQLite
    const db = (varStore as unknown as { db: unknown }).db as {
      prepare: (sql: string) => {
        all: () => unknown[];
      };
    };
    const tableInfo = db.prepare("PRAGMA table_info(variables)").all();

    // Check columns
    const columns = tableInfo.map(
      (col: unknown) => (col as { name: string }).name,
    );
    expect(columns).toContain("name");
    expect(columns).toContain("schema");
    expect(columns).not.toContain("id");
    expect(columns).not.toContain("scope");

    // Check primary key
    const pkColumns = tableInfo
      .filter((col: unknown) => (col as { pk: number }).pk > 0)
      .sort(
        (a: unknown, b: unknown) =>
          (a as { pk: number }).pk - (b as { pk: number }).pk,
      )
      .map((col: unknown) => (col as { name: string }).name);
    expect(pkColumns).toEqual(["name", "schema"]);

    varStore.close();
    unlinkSync(dbPath);
  });

  test("Database indexes reference name instead of id/scope", () => {
    const store = createMemoryStore();
    const dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const db = (varStore as unknown as { db: unknown }).db as {
      prepare: (sql: string) => {
        all: () => unknown[];
      };
    };
    const indexes = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='variables'",
      )
      .all();

    // Should have indexes on name, value, schema
    const indexNames = indexes.map(
      (idx: unknown) => (idx as { name: string }).name,
    );
    expect(indexNames).toContain("idx_var_name");
    expect(indexNames).toContain("idx_var_value");
    expect(indexNames).toContain("idx_var_schema");

    // Should NOT have scope index
    expect(indexNames).not.toContain("idx_var_scope");

    varStore.close();
    unlinkSync(dbPath);
  });

  test("variable_tags table has composite foreign key", () => {
    const store = createMemoryStore();
    const dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const db = (varStore as unknown as { db: unknown }).db as {
      prepare: (sql: string) => {
        all: () => unknown[];
      };
    };
    const tableInfo = db.prepare("PRAGMA table_info(variable_tags)").all();

    const columns = tableInfo.map(
      (col: unknown) => (col as { name: string }).name,
    );
    expect(columns).toContain("variable_name");
    expect(columns).toContain("variable_schema");
    expect(columns).not.toContain("variable_id");

    varStore.close();
    unlinkSync(dbPath);
  });
});

describe("VariableStore - set() Upsert Method", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  test("set() creates new variable when (name, schema) doesn't exist", async () => {
    // Setup: store with schema and data node
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const dataHash = await store.put(schemaHash, { x: 42 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Action: set() for new variable
    const variable = varStore.set("config", dataHash);

    // Assertions
    expect(variable.name).toBe("config");
    expect(variable.schema).toBe(schemaHash);
    expect(variable.value).toBe(dataHash);
    expect(variable.created).toBeGreaterThan(0);
    expect(variable.updated).toBe(variable.created);
    expect(variable.tags).toEqual({});
    expect(variable.labels).toEqual([]);

    // Verify in database
    const retrieved = varStore.get("config", schemaHash);
    expect(retrieved).not.toBeNull();
    expect((retrieved as Variable).value).toBe(dataHash);

    varStore.close();
  });

  test("set() updates value when (name, schema) already exists", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const hash1 = await store.put(schemaHash, { x: 42 });
    const hash2 = await store.put(schemaHash, { x: 99 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Create initial variable
    const created = varStore.set("config", hash1);
    const createdTime = created.created;

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Update via set()
    const updated = varStore.set("config", hash2);

    // Assertions
    expect(updated.name).toBe("config");
    expect(updated.schema).toBe(schemaHash);
    expect(updated.value).toBe(hash2); // Updated value
    expect(updated.created).toBe(createdTime); // Created time unchanged
    expect(updated.updated).toBeGreaterThan(createdTime); // Updated time changed

    // Verify in database
    const retrieved = varStore.get("config", schemaHash);
    expect((retrieved as Variable).value).toBe(hash2);

    varStore.close();
  });

  test("set() creates variable with tags and labels", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const variable = varStore.set("config", dataHash, {
      tags: { env: "prod", region: "us-east" },
      labels: ["critical", "monitored"],
    });

    expect(variable.tags).toEqual({ env: "prod", region: "us-east" });
    expect(variable.labels).toEqual(["critical", "monitored"]);

    varStore.close();
  });

  test("set() preserves tags/labels when updating without options", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const hash1 = await store.put(schemaHash, { x: 1 });
    const hash2 = await store.put(schemaHash, { x: 2 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Create with tags/labels
    varStore.set("config", hash1, {
      tags: { env: "prod" },
      labels: ["critical"],
    });

    // Update value only (no options)
    const updated = varStore.set("config", hash2);

    // Tags/labels should be preserved
    expect(updated.value).toBe(hash2);
    expect(updated.tags).toEqual({ env: "prod" });
    expect(updated.labels).toEqual(["critical"]);

    varStore.close();
  });

  test("set() allows same name with different schemas", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const schemaB = await putSchema(store, {
      type: "object",
      properties: { y: { type: "string" } },
    });
    const hashA = await store.put(schemaA, { x: 42 });
    const hashB = await store.put(schemaB, { y: "hello" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Create two variables with same name, different schemas
    const varA = varStore.set("config", hashA);
    const varB = varStore.set("config", hashB);

    expect(varA.name).toBe("config");
    expect(varA.schema).toBe(schemaA);
    expect(varB.name).toBe("config");
    expect(varB.schema).toBe(schemaB);
    expect(varA.value).not.toBe(varB.value);

    // Verify both exist independently
    expect((varStore.get("config", schemaA) as Variable).value).toBe(hashA);
    expect((varStore.get("config", schemaB) as Variable).value).toBe(hashB);

    varStore.close();
  });

  test("set() validates variable name", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Empty name
    expect(() => varStore.set("", dataHash)).toThrow(InvalidVariableNameError);

    // Invalid characters
    expect(() => varStore.set("hello world", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("hello@world", dataHash)).toThrow(
      InvalidVariableNameError,
    );

    // Empty segments
    expect(() => varStore.set("a//b", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("/ab", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("ab/", dataHash)).toThrow(
      InvalidVariableNameError,
    );

    varStore.close();
  });

  test("set() extracts schema from value hash internally", async () => {
    // Given: Two different schemas
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, { type: "number" });
    const schemaB = await putSchema(store, { type: "string" });
    const valueA = await store.put(schemaA, 42);
    const valueB = await store.put(schemaB, "hello");

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // When: set() with same name but different value schemas
    const varA = varStore.set("config", valueA);
    const varB = varStore.set("config", valueB);

    // Then: Both variables created with correct extracted schemas
    expect(varA.schema).toBe(schemaA);
    expect(varB.schema).toBe(schemaB);

    // Verify they coexist independently
    const retrievedA = varStore.get("config", schemaA);
    const retrievedB = varStore.get("config", schemaB);
    expect((retrievedA as Variable).value).toBe(valueA);
    expect((retrievedB as Variable).value).toBe(valueB);

    varStore.close();
  });

  test("set() upserts based on extracted schema", async () => {
    // Given: Existing variable with schemaA
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, { type: "number" });
    const value1 = await store.put(schemaA, 42);
    const value2 = await store.put(schemaA, 99);

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", value1);

    // When: set() with same name and same schema (extracted)
    const updated = varStore.set("config", value2);

    // Then: Updates existing variable, not creates new
    expect(updated.value).toBe(value2);
    expect(varStore.list().length).toBe(1); // Still only 1 variable

    varStore.close();
  });

  test("set() throws CasNodeNotFoundError for invalid hash", async () => {
    store = createMemoryStore();
    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const fakeHash = "FAKEHASH00000";

    expect(() => varStore.set("config", fakeHash)).toThrow(
      CasNodeNotFoundError,
    );
    expect(() => varStore.set("config", fakeHash)).toThrow(
      `CAS node not found: ${fakeHash}`,
    );

    varStore.close();
  });
});

describe("VariableStore - get() with Optional Schema", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore
    }
  });

  test("get(name, schema) returns Variable when exists", async () => {
    // Given: Variable with (name, schema)
    store = createMemoryStore();
    await bootstrap(store);
    const schema = await putSchema(store, { type: "number" });
    const value = await store.put(schema, 42);

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", value);

    // When: get() with exact (name, schema)
    const result = varStore.get("config", schema);

    // Then: Returns Variable object
    expect(result).not.toBeNull();
    expect((result as Variable).name).toBe("config");
    expect((result as Variable).schema).toBe(schema);
    expect((result as Variable).value).toBe(value);

    varStore.close();
  });

  test("get(name, schema) returns null when name doesn't exist", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schema = await putSchema(store, { type: "number" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // When: Query non-existent name
    const result = varStore.get("nonexistent", schema);

    // Then: Returns null
    expect(result).toBeNull();

    varStore.close();
  });

  test("get(name, schema) returns null when schema doesn't match", async () => {
    // Given: Variable with schemaA
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, { type: "number" });
    const schemaB = await putSchema(store, { type: "string" });
    const value = await store.put(schemaA, 42);

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", value);

    // When: Query with wrong schema
    const result = varStore.get("config", schemaB);

    // Then: Returns null (schema mismatch)
    expect(result).toBeNull();

    varStore.close();
  });

  test("get(name, schema) returns correct variant when multiple schemas exist", async () => {
    // Given: Same name with two different schemas
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, { type: "number" });
    const schemaB = await putSchema(store, { type: "string" });
    const valueA = await store.put(schemaA, 42);
    const valueB = await store.put(schemaB, "hello");

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", valueA);
    varStore.set("config", valueB);

    // When: Query each schema explicitly
    const resultA = varStore.get("config", schemaA);
    const resultB = varStore.get("config", schemaB);

    // Then: Returns correct variant for each schema
    expect(resultA).not.toBeNull();
    expect((resultA as Variable).schema).toBe(schemaA);
    expect((resultA as Variable).value).toBe(valueA);

    expect(resultB).not.toBeNull();
    expect((resultB as Variable).schema).toBe(schemaB);
    expect((resultB as Variable).value).toBe(valueB);

    varStore.close();
  });

  test("get(name, schema) includes tags and labels", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schema = await putSchema(store, { type: "object" });
    const value = await store.put(schema, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", value, {
      tags: { env: "prod" },
      labels: ["critical"],
    });

    const result = varStore.get("config", schema);

    expect(result).not.toBeNull();
    expect((result as Variable).tags).toEqual({ env: "prod" });
    expect((result as Variable).labels).toEqual(["critical"]);

    varStore.close();
  });

  test("get(name, schema) returns exact match", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const schemaB = await putSchema(store, {
      type: "object",
      properties: { y: { type: "string" } },
    });
    const hashA = await store.put(schemaA, { x: 42 });
    const hashB = await store.put(schemaB, { y: "hello" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", hashA);
    varStore.set("config", hashB);

    const resultA = varStore.get("config", schemaA);
    const resultB = varStore.get("config", schemaB);

    // Should return exact matches, not arrays
    expect(resultA).not.toBeNull();
    expect(Array.isArray(resultA)).toBe(false);
    expect((resultA as Variable).schema).toBe(schemaA);
    expect((resultA as Variable).value).toBe(hashA);

    expect(resultB).not.toBeNull();
    expect(Array.isArray(resultB)).toBe(false);
    expect((resultB as Variable).schema).toBe(schemaB);
    expect((resultB as Variable).value).toBe(hashB);

    varStore.close();
  });

  test("get(name, schema) returns null when combination doesn't exist", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const schemaB = await putSchema(store, {
      type: "object",
      properties: { y: { type: "string" } },
    });
    const hashA = await store.put(schemaA, { x: 42 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", hashA);

    // Query with wrong schema
    const result = varStore.get("config", schemaB);

    expect(result).toBeNull();

    varStore.close();
  });
});

describe("VariableStore - remove() with Optional Schema", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore
    }
  });

  test("remove(name) deletes all schema variants", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const schemaB = await putSchema(store, {
      type: "object",
      properties: { y: { type: "string" } },
    });
    const hashA = await store.put(schemaA, { x: 42 });
    const hashB = await store.put(schemaB, { y: "hello" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", hashA);
    varStore.set("config", hashB);

    // Remove all variants
    const deleted = varStore.remove("config");

    // Should return array of 2 deleted variables
    expect(Array.isArray(deleted)).toBe(true);
    expect(deleted.length).toBe(2);

    const deletedSchemas = deleted.map((v) => v.schema).sort();
    expect(deletedSchemas).toContain(schemaA);
    expect(deletedSchemas).toContain(schemaB);

    // Verify both are gone
    expect(varStore.get("config", schemaA)).toBeNull();
    expect(varStore.get("config", schemaB)).toBeNull();

    varStore.close();
  });

  test("remove(name) returns empty array when variable doesn't exist", async () => {
    store = createMemoryStore();
    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const deleted = varStore.remove("nonexistent");

    expect(Array.isArray(deleted)).toBe(true);
    expect(deleted.length).toBe(0);

    varStore.close();
  });

  test("remove(name, schema) deletes only specified variant", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const schemaB = await putSchema(store, {
      type: "object",
      properties: { y: { type: "string" } },
    });
    const hashA = await store.put(schemaA, { x: 42 });
    const hashB = await store.put(schemaB, { y: "hello" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", hashA);
    varStore.set("config", hashB);

    // Remove only schemaA variant
    const deleted = varStore.remove("config", schemaA);

    // Should return single deleted Variable (not array)
    expect(deleted).not.toBeNull();
    expect(Array.isArray(deleted)).toBe(false);
    expect((deleted as Variable).name).toBe("config");
    expect((deleted as Variable).schema).toBe(schemaA);
    expect((deleted as Variable).value).toBe(hashA);

    // Verify schemaA is gone but schemaB remains
    expect(varStore.get("config", schemaA)).toBeNull();
    expect(varStore.get("config", schemaB)).not.toBeNull();

    varStore.close();
  });

  test("remove(name, schema) throws VariableNotFoundError when not found", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    expect(() => varStore.remove("nonexistent", schemaHash)).toThrow(
      VariableNotFoundError,
    );

    varStore.close();
  });

  test("remove() cascades deletion to tags and labels", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", dataHash, {
      tags: { env: "prod" },
      labels: ["critical"],
    });

    // Remove variable
    varStore.remove("config");

    // Verify tags/labels are also deleted
    const db = (varStore as unknown as { db: unknown }).db as {
      prepare: (sql: string) => {
        all: (...params: unknown[]) => unknown[];
      };
    };
    const tags = db
      .prepare(
        "SELECT * FROM variable_tags WHERE variable_name = ? AND variable_schema = ?",
      )
      .all("config", schemaHash);
    const labels = db
      .prepare(
        "SELECT * FROM variable_labels WHERE variable_name = ? AND variable_schema = ?",
      )
      .all("config", schemaHash);

    expect(tags).toHaveLength(0);
    expect(labels).toHaveLength(0);

    varStore.close();
  });

  test("remove(name) returns array even with single variant", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", dataHash);

    // Remove with name only (no schema)
    const deleted = varStore.remove("config");

    // Should return array with 1 element
    expect(Array.isArray(deleted)).toBe(true);
    expect(deleted.length).toBe(1);
    expect(deleted[0]?.name).toBe("config");

    varStore.close();
  });
});

describe("VariableStore - Name Validation", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore
    }
  });

  test("validateName accepts valid variable names", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // All these should succeed
    expect(() => varStore.set("simple", dataHash)).not.toThrow();
    expect(() => varStore.set("with_underscore", dataHash)).not.toThrow();
    expect(() => varStore.set("with-dash", dataHash)).not.toThrow();
    expect(() => varStore.set("with.dot", dataHash)).not.toThrow();
    expect(() => varStore.set("number123", dataHash)).not.toThrow();
    expect(() => varStore.set("path/to/var", dataHash)).not.toThrow();
    expect(() =>
      varStore.set("deeply/nested/path/to/var", dataHash),
    ).not.toThrow();
    expect(() => varStore.set("uwf.thread.id_123", dataHash)).not.toThrow();

    varStore.close();
  });

  test("validateName rejects empty name", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    expect(() => varStore.set("", dataHash)).toThrow(InvalidVariableNameError);
    expect(() => varStore.set("", dataHash)).toThrow(/empty/i);

    varStore.close();
  });

  test("validateName rejects invalid characters", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Space
    expect(() => varStore.set("hello world", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("hello world", dataHash)).toThrow(
      /invalid character/i,
    );

    // Special characters
    expect(() => varStore.set("hello@world", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("hello#world", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("hello$world", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("hello%world", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("hello&world", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("hello*world", dataHash)).toThrow(
      InvalidVariableNameError,
    );

    varStore.close();
  });

  test("validateName rejects empty segments", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Double slash
    expect(() => varStore.set("a//b", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("a//b", dataHash)).toThrow(/empty segment/i);

    // Triple slash
    expect(() => varStore.set("a///b", dataHash)).toThrow(
      InvalidVariableNameError,
    );

    varStore.close();
  });

  test("validateName rejects leading or trailing slashes", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Leading slash
    expect(() => varStore.set("/abc", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("/abc", dataHash)).toThrow(/leading slash/i);

    // Trailing slash
    expect(() => varStore.set("abc/", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.set("abc/", dataHash)).toThrow(/trailing slash/i);

    // Both
    expect(() => varStore.set("/abc/", dataHash)).toThrow(
      InvalidVariableNameError,
    );

    varStore.close();
  });

  test("InvalidVariableNameError includes specific violation reason", () => {
    // Test error construction with reason
    const error1 = new InvalidVariableNameError("", "Name cannot be empty");
    expect(error1.name).toBe("InvalidVariableNameError");
    expect(error1.variableName).toBe("");
    expect(error1.message).toContain("empty");

    const error2 = new InvalidVariableNameError(
      "a//b",
      "Name contains empty segment",
    );
    expect(error2.variableName).toBe("a//b");
    expect(error2.message).toContain("empty segment");

    const error3 = new InvalidVariableNameError(
      "/abc",
      "Name starts with slash",
    );
    expect(error3.variableName).toBe("/abc");
    expect(error3.message).toContain("slash");
  });
});

describe("VariableStore - validateName() Error Messages", () => {
  let store: Store;
  let dbPath: string;
  let varStore: VariableStore;
  let schemaHash: string;
  let dataHash: string;

  afterEach(() => {
    try {
      varStore.close();
    } catch {
      // ignore
    }
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  test("validateName error message mentions 'empty' for empty string", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    schemaHash = await putSchema(store, { type: "object" });
    dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    varStore = new VariableStore(dbPath, store);

    try {
      varStore.set("", dataHash);
      throw new Error("Expected InvalidVariableNameError");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidVariableNameError);
      expect((e as InvalidVariableNameError).reason).toMatch(/empty/i);
      expect((e as InvalidVariableNameError).message).toContain('""'); // Shows the invalid name
    }
  });

  test("validateName error message identifies specific invalid segment", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    schemaHash = await putSchema(store, { type: "object" });
    dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    varStore = new VariableStore(dbPath, store);

    try {
      varStore.set("valid/segment/bad@segment/more", dataHash);
      throw new Error("Expected InvalidVariableNameError");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidVariableNameError);
      const error = e as InvalidVariableNameError;
      expect(error.reason).toContain("bad@segment"); // Specific segment mentioned
      expect(error.reason).toMatch(/invalid|characters/i);
    }
  });

  test("validateName error message explains consecutive slashes", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    schemaHash = await putSchema(store, { type: "object" });
    dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    varStore = new VariableStore(dbPath, store);

    try {
      varStore.set("a//b", dataHash);
      throw new Error("Expected InvalidVariableNameError");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidVariableNameError);
      const error = e as InvalidVariableNameError;
      expect(error.reason).toMatch(/empty segment|consecutive.*slash|\/\//i);
    }
  });

  test("validateName error message distinguishes leading vs trailing slash", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    schemaHash = await putSchema(store, { type: "object" });
    dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    varStore = new VariableStore(dbPath, store);

    // Leading slash
    try {
      varStore.set("/abc", dataHash);
      throw new Error("Expected InvalidVariableNameError");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidVariableNameError);
      const error = e as InvalidVariableNameError;
      expect(error.reason).toMatch(/leading|start|begins/i);
      expect(error.reason).not.toMatch(/trailing|end/i);
    }

    // Trailing slash
    try {
      varStore.set("abc/", dataHash);
      throw new Error("Expected InvalidVariableNameError");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidVariableNameError);
      const error = e as InvalidVariableNameError;
      expect(error.reason).toMatch(/trailing|end/i);
      expect(error.reason).not.toMatch(/leading|start|begins/i);
    }
  });

  test("validateName accepts valid names with dots, underscores, hyphens", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    schemaHash = await putSchema(store, { type: "object" });
    dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    varStore = new VariableStore(dbPath, store);

    // All these should succeed
    expect(() => varStore.set("app.config", dataHash)).not.toThrow();
    expect(() => varStore.set("my_variable", dataHash)).not.toThrow();
    expect(() => varStore.set("test-name", dataHash)).not.toThrow();
    expect(() => varStore.set("path/to/config.json", dataHash)).not.toThrow();
    expect(() => varStore.set("v1.2.3-alpha_001", dataHash)).not.toThrow();
  });
});

describe("VariableStore - Integration Tests", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore
    }
  });

  test("Complete workflow: set, get, remove with multiple schemas", async () => {
    store = createMemoryStore();
    await bootstrap(store);

    const schemaConfig = await putSchema(store, {
      type: "object",
      properties: { host: { type: "string" }, port: { type: "number" } },
    });
    const schemaState = await putSchema(store, {
      type: "object",
      properties: { status: { type: "string" } },
    });

    const configHash1 = await store.put(schemaConfig, {
      host: "localhost",
      port: 8080,
    });
    const configHash2 = await store.put(schemaConfig, {
      host: "0.0.0.0",
      port: 3000,
    });
    const stateHash1 = await store.put(schemaState, { status: "running" });
    const stateHash2 = await store.put(schemaState, { status: "stopped" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // 1. Set initial config
    const var1 = varStore.set("app/server", configHash1);
    expect(var1.value).toBe(configHash1);

    // 2. Set state with same name, different schema
    const var2 = varStore.set("app/server", stateHash1);
    expect(var2.schema).toBe(schemaState);

    // 3. List all variants with exactName
    const result = varStore.list({ exactName: "app/server" });
    expect(result.length).toBe(2);

    // 4. Get with schema returns single variable
    const config = varStore.get("app/server", schemaConfig);
    expect(config).not.toBeNull();
    expect((config as Variable).value).toBe(configHash1);

    // 5. Update config via set
    const updated = varStore.set("app/server", configHash2);
    expect(updated.value).toBe(configHash2);

    // 6. Update state via set
    varStore.set("app/server", stateHash2);

    // 7. Remove specific schema
    const deletedState = varStore.remove("app/server", schemaState);
    expect((deletedState as Variable).schema).toBe(schemaState);

    // 8. Verify only config remains
    const remaining = varStore.list({ exactName: "app/server" });
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.schema).toBe(schemaConfig);

    // 9. Remove all remaining
    const deletedAll = varStore.remove("app/server");
    expect(Array.isArray(deletedAll)).toBe(true);
    expect(deletedAll.length).toBe(1);

    // 10. Verify all gone
    expect(varStore.get("app/server", schemaConfig)).toBeNull();

    varStore.close();
  });

  test("Upsert workflow preserves and updates tags", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { version: { type: "string" } },
    });
    const v1 = await store.put(schemaHash, { version: "1.0.0" });
    const v2 = await store.put(schemaHash, { version: "2.0.0" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Initial set with tags
    varStore.set("app/version", v1, {
      tags: { env: "dev", region: "us" },
      labels: ["beta"],
    });

    // Upsert without options preserves tags
    const updated1 = varStore.set("app/version", v2);
    expect(updated1.value).toBe(v2);
    expect(updated1.tags).toEqual({ env: "dev", region: "us" });
    expect(updated1.labels).toEqual(["beta"]);

    // Upsert with new tags replaces them
    const updated2 = varStore.set("app/version", v2, {
      tags: { env: "prod" },
      labels: ["stable"],
    });
    expect(updated2.tags).toEqual({ env: "prod" });
    expect(updated2.labels).toEqual(["stable"]);

    varStore.close();
  });
});

describe("VariableStore - Legacy Update Method", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore
    }
  });

  test("update() is distinct from set() and fails when variable doesn't exist", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // update() should fail when variable doesn't exist
    expect(() => varStore.update("config", schemaHash, dataHash)).toThrow(
      VariableNotFoundError,
    );

    // set() creates it
    varStore.set("config", dataHash);

    // Now update() should work
    const newHash = await store.put(schemaHash, {});
    const updated = varStore.update("config", schemaHash, newHash);
    expect(updated.value).toBe(newHash);

    varStore.close();
  });

  test("update() throws SchemaMismatchError when schema changes", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, { type: "object" });
    const schemaB = await putSchema(store, { type: "string" });
    const dataA = await store.put(schemaA, {});
    const dataB = await store.put(schemaB, "hello");

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", dataA);

    expect(() => varStore.update("config", schemaA, dataB)).toThrow(
      SchemaMismatchError,
    );

    varStore.close();
  });
});

describe("VariableStore - List Operation", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore
    }
  });

  test("list() returns all variables", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const data1 = await store.put(schemaHash, { a: 1 });
    const data2 = await store.put(schemaHash, { a: 2 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("var1", data1);
    varStore.set("var2", data2);

    const vars = varStore.list();

    expect(vars.length).toBe(2);
    expect(vars.map((v) => v.name).sort()).toEqual(["var1", "var2"]);

    varStore.close();
  });

  test("list() with namePrefix filters results", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const data = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("app/config", data);
    varStore.set("app/state", data);
    varStore.set("sys/config", data);

    const vars = varStore.list({ namePrefix: "app/" });

    expect(vars.length).toBe(2);
    expect(vars.every((v) => v.name.startsWith("app/"))).toBe(true);

    varStore.close();
  });
});

describe("VariableStore - list() with exactName", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore
    }
  });

  test("list({ exactName }) returns all schema variants for name", async () => {
    // Given: Same name with multiple schemas
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, { type: "number" });
    const schemaB = await putSchema(store, { type: "string" });
    const schemaC = await putSchema(store, { type: "boolean" });
    const valueA = await store.put(schemaA, 42);
    const valueB = await store.put(schemaB, "hello");
    const valueC = await store.put(schemaC, true);

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", valueA);
    varStore.set("config", valueB);
    varStore.set("config", valueC);
    varStore.set("other", valueA); // Different name, same schema

    // When: list with exactName
    const results = varStore.list({ exactName: "config" });

    // Then: Returns all 3 schema variants, not "other"
    expect(results.length).toBe(3);
    const schemas = results.map((v) => v.schema).sort();
    expect(schemas).toContain(schemaA);
    expect(schemas).toContain(schemaB);
    expect(schemas).toContain(schemaC);
    expect(results.every((v) => v.name === "config")).toBe(true);

    varStore.close();
  });

  test("list({ exactName }) returns empty array when name doesn't exist", async () => {
    store = createMemoryStore();
    await bootstrap(store);

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const results = varStore.list({ exactName: "nonexistent" });
    expect(results).toEqual([]);

    varStore.close();
  });

  test("list({ exactName, schema }) filters to specific variant", async () => {
    // Given: Same name with two schemas
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, { type: "number" });
    const schemaB = await putSchema(store, { type: "string" });
    const valueA = await store.put(schemaA, 42);
    const valueB = await store.put(schemaB, "hello");

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", valueA);
    varStore.set("config", valueB);

    // When: Filter by both exactName and schema
    const results = varStore.list({ exactName: "config", schema: schemaA });

    // Then: Returns only schemaA variant
    expect(results.length).toBe(1);
    expect(results[0]?.schema).toBe(schemaA);

    varStore.close();
  });

  test("list({ exactName }) with tags filters variants", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, { type: "number" });
    const schemaB = await putSchema(store, { type: "string" });
    const valueA = await store.put(schemaA, 42);
    const valueB = await store.put(schemaB, "hello");

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", valueA, { tags: { env: "dev" } });
    varStore.set("config", valueB, { tags: { env: "prod" } });

    // When: Filter by exactName + tags
    const results = varStore.list({
      exactName: "config",
      tags: { env: "prod" },
    });

    // Then: Returns only prod variant
    expect(results.length).toBe(1);
    expect(results[0]?.schema).toBe(schemaB);

    varStore.close();
  });

  test("exactName and namePrefix are mutually exclusive", async () => {
    store = createMemoryStore();
    await bootstrap(store);

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // When: Both provided
    expect(() => {
      varStore.list({ exactName: "config", namePrefix: "app/" });
    }).toThrow(/mutually exclusive|cannot specify both/i);

    varStore.close();
  });

  test("list({ namePrefix }) does match partial exact names", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schema = await putSchema(store, { type: "number" });
    const value = await store.put(schema, 42);

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("app", value);
    varStore.set("app/config", value);
    varStore.set("application", value);

    // When: namePrefix without trailing slash
    const results = varStore.list({ namePrefix: "app" });

    // Then: Matches all three (prefix match)
    expect(results.length).toBe(3);
    expect(results.map((v) => v.name).sort()).toEqual([
      "app",
      "app/config",
      "application",
    ]);

    varStore.close();
  });

  test("exactName replaces get(name) multi-schema query use case", async () => {
    // This test demonstrates that list({ exactName }) provides
    // the functionality previously available via get(name) → Variable[]

    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = await putSchema(store, { type: "number" });
    const schemaB = await putSchema(store, { type: "string" });
    const valueA = await store.put(schemaA, 42);
    const valueB = await store.put(schemaB, "hello");

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", valueA);
    varStore.set("config", valueB);

    // Old way: get("config") → Variable | Variable[]
    // New way: list({ exactName: "config" }) → Variable[]
    const results = varStore.list({ exactName: "config" });

    expect(results.length).toBe(2);
    expect(results.every((v) => v.name === "config")).toBe(true);

    varStore.close();
  });
});

describe("VariableStore - Tag/Label Management", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore
    }
  });

  test("tag() adds tags to existing variable", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", dataHash);

    const updated = varStore.tag("config", schemaHash, {
      add: { env: "prod", region: "us" },
    });

    expect(updated.tags).toEqual({ env: "prod", region: "us" });

    varStore.close();
  });

  test("tag() throws error for conflicting tag/label names", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.set("config", dataHash, { labels: ["critical"] });

    expect(() =>
      varStore.tag("config", schemaHash, {
        add: { critical: "yes" },
      }),
    ).toThrow(TagLabelConflictError);

    varStore.close();
  });
});
