import { describe, expect, test } from "bun:test";
import { BOOTSTRAP_STORE } from "./bootstrap-capable.js";
import { createMemoryStore } from "./store.js";

describe("A. createMemoryStore – shape", () => {
  test("A1. returns an object with cas, var, tag sub-stores", () => {
    const store = createMemoryStore();
    expect(typeof store.cas).toBe("object");
    expect(store.cas).not.toBeNull();
    expect(typeof store.var).toBe("object");
    expect(store.var).not.toBeNull();
    expect(typeof store.tag).toBe("object");
    expect(store.tag).not.toBeNull();
  });

  test("A2. cas/var/tag are independent objects", () => {
    const store = createMemoryStore();
    expect(store.cas).not.toBe(store.var as unknown as typeof store.cas);
    expect(store.cas).not.toBe(store.tag as unknown as typeof store.cas);
    expect(store.var).not.toBe(store.tag as unknown as typeof store.var);
  });
});

describe("B. cas sub-store – meta and schema indexes", () => {
  test("B1. listMeta and listSchemas are empty on a fresh store", () => {
    const store = createMemoryStore();
    expect(store.cas.listMeta()).toEqual([]);
    expect(store.cas.listSchemas()).toEqual([]);
  });

  test("B2. self-referencing put adds hash to metaSet and listSchemas", () => {
    const store = createMemoryStore();
    const hash = store.cas[BOOTSTRAP_STORE]({ type: "object" }) as string;
    expect(store.cas.listMeta().map((e) => e.hash)).toContain(hash);
    expect(store.cas.listSchemas().map((e) => e.hash)).toContain(hash);
  });

  test("B3. regular put does not add hash to metaSet", () => {
    const store = createMemoryStore();
    const metaHash = store.cas[BOOTSTRAP_STORE]({ type: "object" }) as string;
    const schemaHash = store.cas.put(metaHash, { type: "string" });
    expect(store.cas.listMeta().map((e) => e.hash)).not.toContain(schemaHash);
    expect(store.cas.listMeta().map((e) => e.hash)).toContain(metaHash);
  });

  test("B4. schema typed by meta-schema appears in listSchemas", () => {
    const store = createMemoryStore();
    const m = store.cas[BOOTSTRAP_STORE]({ type: "object" }) as string;
    const s = store.cas.put(m, { type: "string" });
    const schemas = store.cas.listSchemas().map((e) => e.hash);
    expect(schemas).toContain(m);
    expect(schemas).toContain(s);
    const meta = store.cas.listMeta().map((e) => e.hash);
    expect(meta).toContain(m);
    expect(meta).not.toContain(s);
  });

  test("B5. multiple meta-schemas (versioning)", () => {
    const store = createMemoryStore();
    const m1 = store.cas[BOOTSTRAP_STORE]({
      type: "object",
      title: "v1",
    }) as string;
    const m2 = store.cas[BOOTSTRAP_STORE]({
      type: "object",
      title: "v2",
    }) as string;
    const s1 = store.cas.put(m1, { type: "string" });
    const s2 = store.cas.put(m2, { type: "number" });
    const meta = store.cas.listMeta().map((e) => e.hash);
    expect(meta).toContain(m1);
    expect(meta).toContain(m2);
    expect(meta).toHaveLength(2);
    const schemas = store.cas.listSchemas().map((e) => e.hash);
    expect(schemas).toContain(m1);
    expect(schemas).toContain(m2);
    expect(schemas).toContain(s1);
    expect(schemas).toContain(s2);
  });

  test("B6. idempotent self-referencing put does not duplicate", () => {
    const store = createMemoryStore();
    const payload = { type: "object", title: "dup" };
    const h1 = store.cas[BOOTSTRAP_STORE](payload) as string;
    const h2 = store.cas[BOOTSTRAP_STORE](payload) as string;
    expect(h1).toBe(h2);
    const meta = store.cas.listMeta().map((e) => e.hash);
    expect(meta.filter((h) => h === h1)).toHaveLength(1);
  });

  test("B7. delete removes hash from metaSet and listSchemas", () => {
    const store = createMemoryStore();
    const m = store.cas[BOOTSTRAP_STORE]({ type: "object" }) as string;
    const s = store.cas.put(m, { type: "string" });
    expect(store.cas.listMeta().map((e) => e.hash)).toContain(m);
    expect(store.cas.listSchemas().map((e) => e.hash)).toContain(s);
    store.cas.delete(m);
    expect(store.cas.listMeta().map((e) => e.hash)).not.toContain(m);
    expect(store.cas.listSchemas().map((e) => e.hash)).not.toContain(s);
    expect(store.cas.listSchemas().map((e) => e.hash)).not.toContain(m);
  });

  test("B8. cas.put returns Hash synchronously (not a Promise)", () => {
    const store = createMemoryStore();
    const m = store.cas[BOOTSTRAP_STORE]({ type: "object" }) as string;
    const result = store.cas.put(m, { type: "string" });
    expect(typeof result).toBe("string");
    expect(result).toHaveLength(13);
  });

  test("B9. has/get/delete reflect put state", () => {
    const store = createMemoryStore();
    const m = store.cas[BOOTSTRAP_STORE]({ type: "object" }) as string;
    const h = store.cas.put(m, { type: "string" });
    expect(store.cas.has(h)).toBe(true);
    expect(store.cas.get(h)?.payload).toEqual({ type: "string" });
    expect(store.cas.has("0000000000000")).toBe(false);
    expect(store.cas.get("0000000000000")).toBeNull();
    expect(store.cas.delete(h)).toBe(true);
    expect(store.cas.delete(h)).toBe(false);
    expect(store.cas.has(h)).toBe(false);
  });
});

describe("E. cross-store independence", () => {
  test("E1. tagging a hash does not surface it in cas.listByType", () => {
    const store = createMemoryStore();
    const fakeTarget = "0000000000000";
    store.tag.tag(fakeTarget, [{ op: "set", key: "env", value: "prod" }]);
    expect(store.cas.listByType(fakeTarget)).toEqual([]);
  });

  test("E2. setting a variable does not mutate the CAS node", () => {
    const store = createMemoryStore();
    const m = store.cas[BOOTSTRAP_STORE]({ type: "object" }) as string;
    const s = store.cas.put(m, { type: "string" });
    const value = store.cas.put(s, "hello");
    const before = store.cas.get(value);
    store.var.set("@app/x", value);
    const after = store.cas.get(value);
    expect(after).toEqual(before);
  });

  test("E3. cas.delete does not cascade-delete a variable referencing it", () => {
    const store = createMemoryStore();
    const m = store.cas[BOOTSTRAP_STORE]({ type: "object" }) as string;
    const s = store.cas.put(m, { type: "string" });
    const value = store.cas.put(s, "hello");
    store.var.set("@app/x", value);
    store.cas.delete(value);
    const got = store.var.get("@app/x", s);
    expect(got).not.toBeNull();
    expect(got?.value).toBe(value);
  });
});
