import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "./bootstrap.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";
import type { Store } from "./types.js";
import {
  CasNodeNotFoundError,
  InvalidVariableNameError,
  SchemaMismatchError,
  TagLabelConflictError,
  VariableDuplicateError,
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
    const db = (varStore as any).db;
    const tableInfo = db.prepare("PRAGMA table_info(variables)").all();

    // Check columns
    const columns = tableInfo.map((col: any) => col.name);
    expect(columns).toContain("name");
    expect(columns).toContain("schema");
    expect(columns).not.toContain("id");
    expect(columns).not.toContain("scope");

    // Check primary key
    const pkColumns = tableInfo
      .filter((col: any) => col.pk > 0)
      .sort((a: any, b: any) => a.pk - b.pk)
      .map((col: any) => col.name);
    expect(pkColumns).toEqual(["name", "schema"]);

    varStore.close();
    unlinkSync(dbPath);
  });

  test("Database indexes reference name instead of id/scope", () => {
    const store = createMemoryStore();
    const dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const db = (varStore as any).db;
    const indexes = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='variables'",
      )
      .all();

    // Should have indexes on name, value, schema
    const indexNames = indexes.map((idx: any) => idx.name);
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

    const db = (varStore as any).db;
    const tableInfo = db.prepare("PRAGMA table_info(variable_tags)").all();

    const columns = tableInfo.map((col: any) => col.name);
    expect(columns).toContain("variable_name");
    expect(columns).toContain("variable_schema");
    expect(columns).not.toContain("variable_id");

    varStore.close();
    unlinkSync(dbPath);
  });
});

describe("VariableStore - Create Operation", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  test("Create variable with unique (name, schema)", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const dataHash = await store.put(schemaHash, { x: 42 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const variable = varStore.create("config", dataHash);

    expect(variable.name).toBe("config");
    expect(variable.schema).toBe(schemaHash);
    expect(variable.value).toBe(dataHash);
    expect(variable.created).toBeGreaterThan(0);
    expect(variable.updated).toBe(variable.created);
    expect(variable.tags).toEqual({});
    expect(variable.labels).toEqual([]);

    varStore.close();
  });

  test("Create fails for duplicate (name, schema)", async () => {
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

    varStore.create("config", hash1);

    expect(() => varStore.create("config", hash2)).toThrow(
      VariableDuplicateError,
    );
    expect(() => varStore.create("config", hash2)).toThrow(
      "Variable already exists: name=config, schema=",
    );

    varStore.close();
  });

  test("Create allows same name with different schemas", async () => {
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

    const varA = varStore.create("config", hashA);
    const varB = varStore.create("config", hashB);

    expect(varA.name).toBe("config");
    expect(varA.schema).toBe(schemaA);
    expect(varB.name).toBe("config");
    expect(varB.schema).toBe(schemaB);
    expect(varA.value).not.toBe(varB.value);

    varStore.close();
  });

  test("Create variable with tags and labels", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const dataHash = await store.put(schemaHash, { x: 42 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const variable = varStore.create("config", dataHash, {
      tags: { env: "prod", region: "us-east" },
      labels: ["critical", "monitored"],
    });

    expect(variable.tags).toEqual({ env: "prod", region: "us-east" });
    expect(variable.labels).toEqual(["critical", "monitored"]);

    varStore.close();
  });

  test("Create fails for non-existent CAS node", async () => {
    store = createMemoryStore();
    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const fakeHash = "FAKEHASH00000";

    expect(() => varStore.create("config", fakeHash)).toThrow(
      CasNodeNotFoundError,
    );
    expect(() => varStore.create("config", fakeHash)).toThrow(
      `CAS node not found: ${fakeHash}`,
    );

    varStore.close();
  });

  test("Create validates name is non-empty", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    expect(() => varStore.create("", dataHash)).toThrow(
      InvalidVariableNameError,
    );
    expect(() => varStore.create("", dataHash)).toThrow(
      "Variable name cannot be empty",
    );

    varStore.close();
  });
});

describe("VariableStore - Get Operation", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  test("Get variable by (name, schema)", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const dataHash = await store.put(schemaHash, { x: 42 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const created = varStore.create("config", dataHash);
    const retrieved = varStore.get("config", schemaHash);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe("config");
    expect(retrieved?.schema).toBe(schemaHash);
    expect(retrieved?.value).toBe(dataHash);
    expect(retrieved?.created).toBe(created.created);

    varStore.close();
  });

  test("Get returns null for non-existent variable", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const result = varStore.get("nonexistent", schemaHash);

    expect(result).toBeNull();

    varStore.close();
  });

  test("Get distinguishes variables by schema", async () => {
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

    varStore.create("config", hashA);
    varStore.create("config", hashB);

    const varA = varStore.get("config", schemaA);
    const varB = varStore.get("config", schemaB);

    expect(varA?.value).toBe(hashA);
    expect(varB?.value).toBe(hashB);
    expect(varA?.value).not.toBe(varB?.value);

    varStore.close();
  });
});

describe("VariableStore - Update Operation", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  test("Update variable with matching schema", async () => {
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

    const created = varStore.create("config", hash1);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = varStore.update("config", schemaHash, hash2);

    expect(updated.name).toBe("config");
    expect(updated.schema).toBe(schemaHash);
    expect(updated.value).toBe(hash2);
    expect(updated.created).toBe(created.created);
    expect(updated.updated).toBeGreaterThan(created.updated);

    varStore.close();
  });

  test("Update fails with schema mismatch", async () => {
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

    varStore.create("config", hashA);

    expect(() => varStore.update("config", schemaA, hashB)).toThrow(
      SchemaMismatchError,
    );

    const retrieved = varStore.get("config", schemaA);
    expect(retrieved?.value).toBe(hashA); // unchanged

    varStore.close();
  });

  test("Update fails for non-existent variable", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    expect(() => varStore.update("nonexistent", schemaHash, dataHash)).toThrow(
      VariableNotFoundError,
    );

    varStore.close();
  });
});

describe("VariableStore - Delete Operation", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  test("Delete variable by (name, schema)", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const dataHash = await store.put(schemaHash, { x: 42 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("config", dataHash);
    const deleted = varStore.delete("config", schemaHash);

    expect(deleted.name).toBe("config");
    expect(deleted.value).toBe(dataHash);

    const retrieved = varStore.get("config", schemaHash);
    expect(retrieved).toBeNull();

    varStore.close();
  });

  test("Delete fails for non-existent variable", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    expect(() => varStore.delete("nonexistent", schemaHash)).toThrow(
      VariableNotFoundError,
    );

    varStore.close();
  });

  test("Delete cascades to tags and labels", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("config", dataHash, {
      tags: { env: "prod" },
      labels: ["critical"],
    });

    varStore.delete("config", schemaHash);

    // Verify tags/labels are also deleted
    const db = (varStore as any).db;
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

  test("Delete only affects specified (name, schema)", async () => {
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

    varStore.create("config", hashA);
    varStore.create("config", hashB);

    varStore.delete("config", schemaA);

    expect(varStore.get("config", schemaA)).toBeNull();
    expect(varStore.get("config", schemaB)).not.toBeNull();

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
      // Ignore cleanup errors
    }
  });

  test("List all variables", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const hash1 = await store.put(schemaHash, { x: 1 });
    const hash2 = await store.put(schemaHash, { x: 2 });
    const hash3 = await store.put(schemaHash, { x: 3 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("var1", hash1);
    varStore.create("var2", hash2);
    varStore.create("var3", hash3);

    const variables = varStore.list();

    expect(variables).toHaveLength(3);
    expect(variables.map((v) => v.name).sort()).toEqual([
      "var1",
      "var2",
      "var3",
    ]);

    varStore.close();
  });

  test("List filters by name prefix", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const hash1 = await store.put(schemaHash, { a: 1 });
    const hash2 = await store.put(schemaHash, { b: 2 });
    const hash3 = await store.put(schemaHash, { c: 3 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("uwf.thread.123", hash1);
    varStore.create("uwf.workflow.456", hash2);
    varStore.create("app.config", hash3);

    const filtered = varStore.list({ namePrefix: "uwf." });

    expect(filtered).toHaveLength(2);
    expect(filtered.map((v) => v.name).sort()).toEqual([
      "uwf.thread.123",
      "uwf.workflow.456",
    ]);

    varStore.close();
  });

  test("List filters by schema", async () => {
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
    const hashA1 = await store.put(schemaA, { x: 1 });
    const hashA2 = await store.put(schemaA, { x: 2 });
    const hashB = await store.put(schemaB, { y: "hello" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("var1", hashA1);
    varStore.create("var2", hashA2);
    varStore.create("var3", hashB);

    const filtered = varStore.list({ schema: schemaA });

    expect(filtered).toHaveLength(2);
    expect(filtered.map((v) => v.name).sort()).toEqual(["var1", "var2"]);
    expect(filtered.every((v) => v.schema === schemaA)).toBe(true);

    varStore.close();
  });

  test("List filters by tags (AND logic)", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const hash1 = await store.put(schemaHash, { n: 1 });
    const hash2 = await store.put(schemaHash, { n: 2 });
    const hash3 = await store.put(schemaHash, { n: 3 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("var1", hash1, { tags: { env: "prod", region: "us" } });
    varStore.create("var2", hash2, { tags: { env: "prod", region: "eu" } });
    varStore.create("var3", hash3, { tags: { env: "dev", region: "us" } });

    const filtered = varStore.list({ tags: { env: "prod", region: "us" } });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("var1");

    varStore.close();
  });

  test("List filters by labels (AND logic)", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const hash1 = await store.put(schemaHash, { n: 1 });
    const hash2 = await store.put(schemaHash, { n: 2 });
    const hash3 = await store.put(schemaHash, { n: 3 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("var1", hash1, { labels: ["critical", "monitored"] });
    varStore.create("var2", hash2, { labels: ["critical"] });
    varStore.create("var3", hash3, { labels: ["monitored"] });

    const filtered = varStore.list({ labels: ["critical", "monitored"] });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("var1");

    varStore.close();
  });

  test("List combines namePrefix, schema, tags, and labels", async () => {
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
    const hashA1 = await store.put(schemaA, { x: 1 });
    const hashA2 = await store.put(schemaA, { x: 2 });
    const hashB = await store.put(schemaB, { y: "hello" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("uwf.var1", hashA1, {
      tags: { env: "prod" },
      labels: ["critical"],
    });
    varStore.create("uwf.var2", hashA2, {
      tags: { env: "dev" },
      labels: ["critical"],
    });
    varStore.create("app.var3", hashB, {
      tags: { env: "prod" },
      labels: ["critical"],
    });

    const filtered = varStore.list({
      namePrefix: "uwf.",
      schema: schemaA,
      tags: { env: "prod" },
      labels: ["critical"],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("uwf.var1");

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
      // Ignore cleanup errors
    }
  });

  test("Tag operation adds tags and labels", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    const created = varStore.create("config", dataHash);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = varStore.tag("config", schemaHash, {
      add: { env: "prod", region: "us" },
      addLabels: ["critical", "monitored"],
    });

    expect(updated.tags).toEqual({ env: "prod", region: "us" });
    expect(updated.labels.sort()).toEqual(["critical", "monitored"]);
    expect(updated.updated).toBeGreaterThan(created.updated);

    varStore.close();
  });

  test("Tag operation deletes tags and labels", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("config", dataHash, {
      tags: { env: "prod", region: "us" },
      labels: ["critical", "monitored"],
    });

    const updated = varStore.tag("config", schemaHash, {
      delete: ["env", "monitored"],
    });

    expect(updated.tags).toEqual({ region: "us" });
    expect(updated.labels).toEqual(["critical"]);

    varStore.close();
  });

  test("Tag operation prevents tag/label conflicts", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, { type: "object" });
    const dataHash = await store.put(schemaHash, {});

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("config", dataHash, {
      tags: { env: "prod" },
    });

    // Try to add label with same name as existing tag
    expect(() =>
      varStore.tag("config", schemaHash, {
        addLabels: ["env"],
      }),
    ).toThrow(TagLabelConflictError);

    varStore.close();
  });
});

describe("VariableStore - Error Types", () => {
  test("VariableDuplicateError includes name and schema", () => {
    const error = new VariableDuplicateError("config", "ABC123");

    expect(error.name).toBe("VariableDuplicateError");
    expect(error.variableName).toBe("config");
    expect(error.variableSchema).toBe("ABC123");
    expect(error.message).toContain("config");
    expect(error.message).toContain("ABC123");
  });

  test("InvalidVariableNameError for empty name", () => {
    const error = new InvalidVariableNameError("");

    expect(error.name).toBe("InvalidVariableNameError");
    expect(error.variableName).toBe("");
    expect(error.message).toContain("empty");
  });

  test("VariableNotFoundError references name and schema", () => {
    const error = new VariableNotFoundError("config", "ABC123");

    expect(error.name).toBe("VariableNotFoundError");
    expect(error.variableName).toBe("config");
    expect(error.variableSchema).toBe("ABC123");
    expect(error.message).toContain("config");
    expect(error.message).toContain("ABC123");
  });
});

describe("VariableStore - Integration Tests", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  test("Complete CRUD lifecycle with (name, schema) composite key", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaHash = await putSchema(store, {
      type: "object",
      properties: { counter: { type: "number" } },
    });
    const hash1 = await store.put(schemaHash, { counter: 1 });
    const hash2 = await store.put(schemaHash, { counter: 2 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Create
    const created = varStore.create("counter", hash1, {
      tags: { env: "dev" },
      labels: ["test"],
    });
    expect(created.name).toBe("counter");
    expect(created.value).toBe(hash1);

    // Read
    let retrieved = varStore.get("counter", schemaHash);
    expect(retrieved?.value).toBe(hash1);

    // Update
    const updated = varStore.update("counter", schemaHash, hash2);
    expect(updated.value).toBe(hash2);

    // Tag
    const tagged = varStore.tag("counter", schemaHash, {
      add: { version: "2.0" },
      addLabels: ["stable"],
    });
    expect(tagged.tags).toEqual({ env: "dev", version: "2.0" });
    expect(tagged.labels.sort()).toEqual(["stable", "test"]);

    // List
    const list1 = varStore.list({ namePrefix: "count" });
    expect(list1).toHaveLength(1);

    const list2 = varStore.list({ tags: { env: "dev" } });
    expect(list2).toHaveLength(1);

    // Delete
    varStore.delete("counter", schemaHash);
    retrieved = varStore.get("counter", schemaHash);
    expect(retrieved).toBeNull();

    varStore.close();
  });

  test("Manage variables with same name across multiple schemas", async () => {
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

    const configHash = await store.put(schemaConfig, {
      host: "localhost",
      port: 8080,
    });
    const stateHash = await store.put(schemaState, { status: "running" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Create variables with same name but different schemas
    const varConfig = varStore.create("app.server", configHash);
    const varState = varStore.create("app.server", stateHash);

    expect(varConfig.name).toBe("app.server");
    expect(varConfig.schema).toBe(schemaConfig);
    expect(varState.name).toBe("app.server");
    expect(varState.schema).toBe(schemaState);

    // List by schema
    const configVars = varStore.list({ schema: schemaConfig });
    expect(configVars).toHaveLength(1);
    expect(configVars[0]?.schema).toBe(schemaConfig);

    const stateVars = varStore.list({ schema: schemaState });
    expect(stateVars).toHaveLength(1);
    expect(stateVars[0]?.schema).toBe(schemaState);

    // Update only affects correct variable
    const newStateHash = await store.put(schemaState, { status: "stopped" });
    varStore.update("app.server", schemaState, newStateHash);

    const updatedState = varStore.get("app.server", schemaState);
    const unchangedConfig = varStore.get("app.server", schemaConfig);

    expect(updatedState?.value).toBe(newStateHash);
    expect(unchangedConfig?.value).toBe(configHash);

    // Delete only affects correct variable
    varStore.delete("app.server", schemaState);

    expect(varStore.get("app.server", schemaState)).toBeNull();
    expect(varStore.get("app.server", schemaConfig)).not.toBeNull();

    varStore.close();
  });
});
