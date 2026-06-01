import { describe, expect, test } from "bun:test";
import { BOOTSTRAP_STORE } from "./bootstrap-capable.js";
import { createMemoryStore } from "./store.js";

describe("createMemoryStore – meta and schema indexes", () => {
  test("B1. listMeta and listSchemas are empty on a fresh store", () => {
    const store = createMemoryStore();
    expect(store.listMeta()).toEqual([]);
    expect(store.listSchemas()).toEqual([]);
  });

  test("B2. self-referencing put adds hash to metaSet and listSchemas", async () => {
    const store = createMemoryStore();
    const hash = await store[BOOTSTRAP_STORE]({ type: "object" });

    expect(store.listMeta().map((e) => e.hash)).toContain(hash);
    expect(store.listSchemas().map((e) => e.hash)).toContain(hash);
  });

  test("B3. regular put does not add hash to metaSet", async () => {
    const store = createMemoryStore();
    const metaHash = await store[BOOTSTRAP_STORE]({ type: "object" });
    const schemaHash = await store.put(metaHash, { type: "string" });

    expect(store.listMeta().map((e) => e.hash)).not.toContain(schemaHash);
    expect(store.listMeta().map((e) => e.hash)).toContain(metaHash);
  });

  test("B4. schema typed by meta-schema appears in listSchemas", async () => {
    const store = createMemoryStore();
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    const s = await store.put(m, { type: "string" });

    const schemas = store.listSchemas().map((e) => e.hash);
    expect(schemas).toContain(m);
    expect(schemas).toContain(s);

    const meta = store.listMeta().map((e) => e.hash);
    expect(meta).toContain(m);
    expect(meta).not.toContain(s);
  });

  test("B5. multiple meta-schemas (versioning)", async () => {
    const store = createMemoryStore();
    const m1 = await store[BOOTSTRAP_STORE]({ type: "object", title: "v1" });
    const m2 = await store[BOOTSTRAP_STORE]({ type: "object", title: "v2" });
    const s1 = await store.put(m1, { type: "string" });
    const s2 = await store.put(m2, { type: "number" });

    const meta = store.listMeta().map((e) => e.hash);
    expect(meta).toContain(m1);
    expect(meta).toContain(m2);
    expect(meta).toHaveLength(2);

    const schemas = store.listSchemas().map((e) => e.hash);
    expect(schemas).toContain(m1);
    expect(schemas).toContain(m2);
    expect(schemas).toContain(s1);
    expect(schemas).toContain(s2);
  });

  test("B6. idempotent self-referencing put does not duplicate", async () => {
    const store = createMemoryStore();
    const payload = { type: "object", title: "dup" };
    const h1 = await store[BOOTSTRAP_STORE](payload);
    const h2 = await store[BOOTSTRAP_STORE](payload);
    expect(h1).toBe(h2);

    const meta = store.listMeta().map((e) => e.hash);
    const occurrences = meta.filter((h) => h === h1).length;
    expect(occurrences).toBe(1);
  });

  test("B7. delete removes hash from metaSet and listSchemas", async () => {
    const store = createMemoryStore();
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    const s = await store.put(m, { type: "string" });

    expect(store.listMeta().map((e) => e.hash)).toContain(m);
    expect(store.listSchemas().map((e) => e.hash)).toContain(s);

    store.delete(m);

    expect(store.listMeta().map((e) => e.hash)).not.toContain(m);
    // schemas typed by deleted meta no longer surface
    expect(store.listSchemas().map((e) => e.hash)).not.toContain(s);
    expect(store.listSchemas().map((e) => e.hash)).not.toContain(m);
  });
});
