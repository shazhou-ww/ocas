import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "./bootstrap.js";
import { gc } from "./gc.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";
import type { Store } from "./types.js";
import { VariableStore } from "./variable-store.js";

const tmpDbPath = () =>
  join(
    tmpdir(),
    `test-gc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );

describe("GC - Variable Model Refactoring", () => {
  let store: Store;
  let dbPath: string;

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  test("GC preserves variable-referenced nodes", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const schemaHash = await putSchema(store, schema);

    const hashRef = await store.put(schemaHash, { name: "referenced" });
    const hashOrphan = await store.put(schemaHash, { name: "orphan" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("config", hashRef);

    const stats = gc(store, varStore);

    expect(store.has(hashRef)).toBe(true);
    expect(store.has(hashOrphan)).toBe(false);
    expect(stats.scanned).toBe(1);
    expect(stats.collected).toBeGreaterThanOrEqual(1);

    varStore.close();
  });

  test("GC preserves nodes from variables with same name, different schemas", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = { type: "object", properties: { x: { type: "number" } } };
    const schemaB = { type: "object", properties: { y: { type: "string" } } };
    const schemaAHash = await putSchema(store, schemaA);
    const schemaBHash = await putSchema(store, schemaB);

    const hashA = await store.put(schemaAHash, { x: 42 });
    const hashB = await store.put(schemaBHash, { y: "hello" });
    const hashOrphan = await store.put(schemaAHash, { x: 99 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("config", hashA);
    varStore.create("config", hashB);

    const stats = gc(store, varStore);

    expect(store.has(hashA)).toBe(true);
    expect(store.has(hashB)).toBe(true);
    expect(store.has(hashOrphan)).toBe(false);
    expect(stats.scanned).toBe(2);

    varStore.close();
  });

  test("GC removes nodes after variable deletion", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const schemaHash = await putSchema(store, schema);

    const hashRef = await store.put(schemaHash, { name: "referenced" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("config", hashRef);
    varStore.delete("config", schemaHash);

    const stats = gc(store, varStore);

    expect(store.has(hashRef)).toBe(false);
    expect(stats.scanned).toBe(0);

    varStore.close();
  });

  test("GC is global across all variables", async () => {
    store = createMemoryStore();
    await bootstrap(store);
    const schemaA = { type: "object", properties: { x: { type: "number" } } };
    const schemaB = { type: "object", properties: { y: { type: "string" } } };
    const schemaAHash = await putSchema(store, schemaA);
    const schemaBHash = await putSchema(store, schemaB);

    const hash1 = await store.put(schemaAHash, { x: 1 });
    const hash2 = await store.put(schemaAHash, { x: 2 });
    const hash3 = await store.put(schemaBHash, { y: "a" });
    const hashOrphan = await store.put(schemaAHash, { x: 999 });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    varStore.create("uwf.thread", hash1);
    varStore.create("uwf.workflow", hash2);
    varStore.create("app.config", hash3);

    const stats = gc(store, varStore);

    expect(store.has(hash1)).toBe(true);
    expect(store.has(hash2)).toBe(true);
    expect(store.has(hash3)).toBe(true);
    expect(store.has(hashOrphan)).toBe(false);
    expect(stats.scanned).toBe(3);

    varStore.close();
  });

  test("GC integration with refactored variable store", async () => {
    store = createMemoryStore();
    await bootstrap(store);

    const schemaA = { type: "object", properties: { x: { type: "number" } } };
    const schemaB = { type: "object", properties: { y: { type: "string" } } };
    const schemaAHash = await putSchema(store, schemaA);
    const schemaBHash = await putSchema(store, schemaB);

    const hashA1 = await store.put(schemaAHash, { x: 1 });
    const hashA2 = await store.put(schemaAHash, { x: 2 });
    const hashB = await store.put(schemaBHash, { y: "hello" });
    const hashOrphan1 = await store.put(schemaAHash, { x: 999 });
    const hashOrphan2 = await store.put(schemaBHash, { y: "orphan" });

    dbPath = tmpDbPath();
    const varStore = new VariableStore(dbPath, store);

    // Create variables
    varStore.create("var1", hashA1);
    varStore.create("var2", hashA2);
    varStore.create("var3", hashB);

    // First GC: orphans removed
    let stats = gc(store, varStore);
    expect(store.has(hashA1)).toBe(true);
    expect(store.has(hashA2)).toBe(true);
    expect(store.has(hashB)).toBe(true);
    expect(store.has(hashOrphan1)).toBe(false);
    expect(store.has(hashOrphan2)).toBe(false);
    expect(stats.scanned).toBe(3);

    // Delete one variable
    varStore.delete("var2", schemaAHash);

    // Second GC: hashA2 removed
    stats = gc(store, varStore);
    expect(store.has(hashA1)).toBe(true);
    expect(store.has(hashA2)).toBe(false);
    expect(store.has(hashB)).toBe(true);
    expect(stats.scanned).toBe(2);

    varStore.close();
  });
});
