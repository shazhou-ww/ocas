import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "./store.js";
import type { Hash } from "./types.js";
import {
  CasNodeNotFoundError,
  InvalidVariableNameError,
  MAX_HISTORY,
  SchemaMismatchError,
  TagLabelConflictError,
  VariableNotFoundError,
} from "./variable-store.js";

function makeStoreWithSchema(): {
  store: ReturnType<typeof createMemoryStore>;
  schema: Hash;
  meta: Hash;
  put: (payload: unknown) => Hash;
} {
  const store = createMemoryStore();
  const meta = store.cas[Symbol.for("@ocas/core/bootstrap-store")]({
    type: "object",
  }) as Hash;
  const schema = store.cas.put(meta, { type: "string" });
  return {
    store,
    schema,
    meta,
    put: (payload) => store.cas.put(schema, payload),
  };
}

describe("In-memory VarStore", () => {
  test("C1. set + get round-trip", () => {
    const { store, schema, put } = makeStoreWithSchema();
    const h = put("hello");
    const v = store.var.set("@app/x", h);
    expect(v.name).toBe("@app/x");
    expect(v.value).toBe(h);
    expect(v.schema).toBe(schema);
    expect(typeof v.created).toBe("number");
    expect(typeof v.updated).toBe("number");
    expect(v.tags).toEqual({});
    expect(v.labels).toEqual([]);

    const got = store.var.get("@app/x", schema);
    expect(got).not.toBeNull();
    expect(got?.value).toBe(h);
    expect(got?.schema).toBe(schema);
  });

  test("C2. name validation", () => {
    const { store, put } = makeStoreWithSchema();
    const h = put("v");
    expect(() => store.var.set("x", h)).toThrow(InvalidVariableNameError);
    expect(() => store.var.set("@/x", h)).toThrow(InvalidVariableNameError);
    expect(() => store.var.set("@app/", h)).toThrow(InvalidVariableNameError);
    expect(() => store.var.set("@app//x", h)).toThrow(InvalidVariableNameError);
    expect(() => store.var.set("@app/x.y_z-1", h)).not.toThrow();
  });

  test("C3. set throws CasNodeNotFoundError if hash not in cas", () => {
    const { store } = makeStoreWithSchema();
    expect(() => store.var.set("@app/x", "ZZZZZZZZZZZZZ")).toThrow(
      CasNodeNotFoundError,
    );
  });

  test("C4. idempotent same-value set", async () => {
    const { store, schema, put } = makeStoreWithSchema();
    const h = put("v");
    const v1 = store.var.set("@app/x", h);
    await new Promise((r) => setTimeout(r, 5));
    const v2 = store.var.set("@app/x", h);
    expect(v2.updated).toBe(v1.updated);
    expect(store.var.history("@app/x", schema)).toHaveLength(1);
  });

  test("C5. update via re-set with new value bumps updated and history", async () => {
    const { store, schema, put } = makeStoreWithSchema();
    const h1 = put("v1");
    const h2 = put("v2");
    const v1 = store.var.set("@app/x", h1);
    await new Promise((r) => setTimeout(r, 5));
    const v2 = store.var.set("@app/x", h2);
    expect(v2.updated).toBeGreaterThan(v1.updated);
    const hist = store.var.history("@app/x", schema);
    expect(hist.map((e) => e.value)).toEqual([h2, h1]);
    expect(hist[0]?.position).toBe(0);
    expect(hist[1]?.position).toBe(1);
  });

  test("C6. history bound to MAX_HISTORY (10)", () => {
    const { store, schema, put } = makeStoreWithSchema();
    const hashes: Hash[] = [];
    for (let i = 0; i < 12; i++) {
      const h = put(`v${i}`);
      hashes.push(h);
      store.var.set("@app/x", h);
    }
    const hist = store.var.history("@app/x", schema);
    expect(hist).toHaveLength(MAX_HISTORY);
    expect(hist[0]?.value).toBe(hashes[11] as string);
  });

  test("C7. history rotation when re-setting an older value", () => {
    const { store, schema, put } = makeStoreWithSchema();
    const h1 = put("v1");
    const h2 = put("v2");
    const h3 = put("v3");
    store.var.set("@app/x", h1);
    store.var.set("@app/x", h2);
    store.var.set("@app/x", h3);
    expect(store.var.history("@app/x", schema).map((e) => e.value)).toEqual([
      h3,
      h2,
      h1,
    ]);
    store.var.set("@app/x", h1);
    expect(store.var.history("@app/x", schema).map((e) => e.value)).toEqual([
      h1,
      h3,
      h2,
    ]);
  });

  test("C8. tags + labels round-trip", () => {
    const { store, schema, put } = makeStoreWithSchema();
    const h = put("v");
    store.var.set("@app/x", h, {
      tags: { env: "prod" },
      labels: ["pinned"],
    });
    const got = store.var.get("@app/x", schema);
    expect(got?.tags).toEqual({ env: "prod" });
    expect(got?.labels).toEqual(["pinned"]);
  });

  test("C9. tag/label conflict throws TagLabelConflictError", () => {
    const { store, put } = makeStoreWithSchema();
    const h = put("v");
    expect(() =>
      store.var.set("@app/x", h, {
        tags: { x: "y" },
        labels: ["x"],
      }),
    ).toThrow(TagLabelConflictError);
  });

  test("C10. update requires existing variable and matching schema", () => {
    const { store, put } = makeStoreWithSchema();
    const h = put("v");
    expect(() => store.var.update("@app/x", h)).toThrow(VariableNotFoundError);
    store.var.set("@app/x", h);

    // Different schema for new value
    const meta = store.cas[Symbol.for("@ocas/core/bootstrap-store")]({
      type: "object",
    }) as Hash;
    const otherSchema = store.cas.put(meta, { type: "number" });
    const h2 = store.cas.put(otherSchema, 42);
    expect(() => store.var.update("@app/x", h2)).toThrow(SchemaMismatchError);
  });

  test("C11. remove with and without schema", () => {
    const { store, schema, put } = makeStoreWithSchema();
    const h = put("v");
    store.var.set("@app/x", h);
    const removed = store.var.remove("@app/x", schema);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.value).toBe(h);
    expect(store.var.get("@app/x", schema)).toBeNull();

    // remove(name) without schema returns array; empty if none
    expect(store.var.remove("@app/none")).toEqual([]);

    store.var.set("@app/y", put("y1"));
    const removedAll = store.var.remove("@app/y");
    expect(Array.isArray(removedAll)).toBe(true);
    expect(removedAll).toHaveLength(1);
  });

  test("C12. list filters and ListOptions", () => {
    const { store, schema, put } = makeStoreWithSchema();
    const h1 = put("v1");
    const h2 = put("v2");
    store.var.set("@app/a", h1, { tags: { env: "prod" } });
    store.var.set("@app/b", h2, { labels: ["pinned"] });

    expect(() =>
      store.var.list({ namePrefix: "@app", exactName: "@app/a" }),
    ).toThrow();

    const byPrefix = store.var.list({ namePrefix: "@app/" });
    expect(byPrefix.map((v) => v.name).sort()).toEqual(["@app/a", "@app/b"]);

    const exact = store.var.list({ exactName: "@app/a" });
    expect(exact).toHaveLength(1);

    const byTag = store.var.list({ tags: { env: "prod" } });
    expect(byTag.map((v) => v.name)).toEqual(["@app/a"]);

    const byLabel = store.var.list({ labels: ["pinned"] });
    expect(byLabel.map((v) => v.name)).toEqual(["@app/b"]);

    const bySchema = store.var.list({ schema });
    expect(bySchema).toHaveLength(2);

    const limited = store.var.list({ limit: 1 });
    expect(limited).toHaveLength(1);
  });

  test("C13. close() is a no-op", () => {
    const { store } = makeStoreWithSchema();
    expect(() => store.var.close()).not.toThrow();
  });

  test("C14. cas.delete does NOT cascade-delete the variable", () => {
    const { store, schema, put } = makeStoreWithSchema();
    const h = put("v");
    store.var.set("@app/x", h);
    store.cas.delete(h);
    const got = store.var.get("@app/x", schema);
    expect(got).not.toBeNull();
    expect(got?.value).toBe(h);
  });
});
