import { describe, expect, test } from "bun:test";
import { bootstrap } from "./bootstrap.js";
import { gc } from "./gc.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";

describe("GC - Variable Model Refactoring", () => {
  test("GC preserves variable-referenced nodes", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const schemaHash = putSchema(store, schema);

    const hashRef = store.cas.put(schemaHash, { name: "referenced" });
    const hashOrphan = store.cas.put(schemaHash, { name: "orphan" });

    store.var.set("@test/config", hashRef);

    const stats = gc(store);

    expect(store.cas.has(hashRef)).toBe(true);
    expect(store.cas.has(hashOrphan)).toBe(false);
    expect(stats.scanned).toBeGreaterThanOrEqual(1);
    expect(stats.collected).toBeGreaterThanOrEqual(1);
  });

  test("GC preserves nodes from variables with same name, different schemas", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schemaA = { type: "object", properties: { x: { type: "number" } } };
    const schemaB = { type: "object", properties: { y: { type: "string" } } };
    const schemaAHash = putSchema(store, schemaA);
    const schemaBHash = putSchema(store, schemaB);

    const hashA = store.cas.put(schemaAHash, { x: 42 });
    const hashB = store.cas.put(schemaBHash, { y: "hello" });
    const hashOrphan = store.cas.put(schemaAHash, { x: 99 });

    store.var.set("@test/config", hashA);
    store.var.set("@test/config", hashB);

    gc(store);

    expect(store.cas.has(hashA)).toBe(true);
    expect(store.cas.has(hashB)).toBe(true);
    expect(store.cas.has(hashOrphan)).toBe(false);
  });

  test("GC removes nodes after variable deletion", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const schemaHash = putSchema(store, schema);

    const hashRef = store.cas.put(schemaHash, { name: "referenced" });

    store.var.set("@test/config", hashRef);
    store.var.remove("@test/config", schemaHash);

    gc(store);

    expect(store.cas.has(hashRef)).toBe(false);
  });

  test("GC is global across all variables", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schemaA = { type: "object", properties: { x: { type: "number" } } };
    const schemaB = { type: "object", properties: { y: { type: "string" } } };
    const schemaAHash = putSchema(store, schemaA);
    const schemaBHash = putSchema(store, schemaB);

    const hash1 = store.cas.put(schemaAHash, { x: 1 });
    const hash2 = store.cas.put(schemaAHash, { x: 2 });
    const hash3 = store.cas.put(schemaBHash, { y: "a" });
    const hashOrphan = store.cas.put(schemaAHash, { x: 999 });

    store.var.set("@test/uwf.thread", hash1);
    store.var.set("@test/uwf.workflow", hash2);
    store.var.set("@test/app.config", hash3);

    gc(store);

    expect(store.cas.has(hash1)).toBe(true);
    expect(store.cas.has(hash2)).toBe(true);
    expect(store.cas.has(hash3)).toBe(true);
    expect(store.cas.has(hashOrphan)).toBe(false);
  });

  test("GC integration with refactored variable store", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const schemaA = { type: "object", properties: { x: { type: "number" } } };
    const schemaB = { type: "object", properties: { y: { type: "string" } } };
    const schemaAHash = putSchema(store, schemaA);
    const schemaBHash = putSchema(store, schemaB);

    const hashA1 = store.cas.put(schemaAHash, { x: 1 });
    const hashA2 = store.cas.put(schemaAHash, { x: 2 });
    const hashB = store.cas.put(schemaBHash, { y: "hello" });
    store.cas.put(schemaAHash, { x: 999 });
    store.cas.put(schemaBHash, { y: "orphan" });

    store.var.set("@test/var1", hashA1);
    store.var.set("@test/var2", hashA2);
    store.var.set("@test/var3", hashB);

    gc(store);
    expect(store.cas.has(hashA1)).toBe(true);
    expect(store.cas.has(hashA2)).toBe(true);
    expect(store.cas.has(hashB)).toBe(true);

    store.var.remove("@test/var2", schemaAHash);

    gc(store);
    expect(store.cas.has(hashA1)).toBe(true);
    expect(store.cas.has(hashA2)).toBe(false);
    expect(store.cas.has(hashB)).toBe(true);
  });
});
