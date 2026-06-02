import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash, OcasStore } from "@ocas/core";
import {
  CasNodeNotFoundError,
  InvalidVariableNameError,
  MAX_HISTORY,
  SchemaMismatchError,
  TagLabelConflictError,
  VariableNotFoundError,
} from "@ocas/core";
import { openStore } from "./store.js";

const META_TYPE_KEY = Symbol.for("@ocas/core/bootstrap-store");

async function setupStore(dir: string): Promise<{
  store: OcasStore;
  schema: Hash;
  put: (payload: unknown) => Hash;
}> {
  const store = await openStore(dir);
  // biome-ignore lint/suspicious/noExplicitAny: bootstrap symbol access
  const meta = (store.cas as any)[META_TYPE_KEY]({ type: "object" }) as Hash;
  const schema = store.cas.put(meta, { type: "string" });
  return {
    store,
    schema,
    put: (payload) => store.cas.put(schema, payload),
  };
}

describe("FsVarStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ocas-fs-var-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("A1. set + get round-trip persists to JSONL", async () => {
    const { store, schema, put } = await setupStore(dir);
    const h = put("hello");
    const v = store.var.set("@app/x", h);
    expect(v.name).toBe("@app/x");
    expect(v.value).toBe(h);
    expect(v.schema).toBe(schema);

    const got = store.var.get("@app/x", schema);
    expect(got?.value).toBe(h);

    const jsonl = join(dir, "_vars.jsonl");
    expect(existsSync(jsonl)).toBe(true);
    const content = readFileSync(jsonl, "utf8");
    expect(content.length).toBeGreaterThan(0);
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const matching = lines
      .map((l) => JSON.parse(l) as { name?: string; value?: Hash })
      .find((r) => r.name === "@app/x");
    expect(matching).toBeDefined();
    expect(matching?.value).toBe(h);
  });

  test("A2. name validation", async () => {
    const { store, put } = await setupStore(dir);
    const h = put("v");
    expect(() => store.var.set("x", h)).toThrow(InvalidVariableNameError);
    expect(() => store.var.set("@/x", h)).toThrow(InvalidVariableNameError);
    expect(() => store.var.set("@app/", h)).toThrow(InvalidVariableNameError);
    expect(() => store.var.set("@app//x", h)).toThrow(InvalidVariableNameError);
    expect(() => store.var.set("@app/x.y_z-1", h)).not.toThrow();
  });

  test("A3. set throws CasNodeNotFoundError if hash absent", async () => {
    const { store } = await setupStore(dir);
    expect(() => store.var.set("@app/x", "ZZZZZZZZZZZZZ")).toThrow(
      CasNodeNotFoundError,
    );
  });

  test("A4. idempotent same-value set", async () => {
    const { store, schema, put } = await setupStore(dir);
    const h = put("v");
    const v1 = store.var.set("@app/x", h);
    await new Promise((r) => setTimeout(r, 5));
    const v2 = store.var.set("@app/x", h);
    expect(v2.updated).toBe(v1.updated);
    expect(store.var.history("@app/x", schema)).toHaveLength(1);
  });

  test("A5. update via re-set bumps updated and appends history", async () => {
    const { store, schema, put } = await setupStore(dir);
    const h1 = put("v1");
    const h2 = put("v2");
    const v1 = store.var.set("@app/x", h1);
    await new Promise((r) => setTimeout(r, 5));
    const v2 = store.var.set("@app/x", h2);
    expect(v2.updated).toBeGreaterThan(v1.updated);
    const hist = store.var.history("@app/x", schema);
    expect(hist.map((e) => e.value)).toEqual([h2, h1]);
  });

  test("A6. SchemaMismatchError on update with different schema", async () => {
    const { store, put } = await setupStore(dir);
    const h = put("v");
    store.var.set("@app/x", h);
    // biome-ignore lint/suspicious/noExplicitAny: bootstrap symbol access
    const meta = (store.cas as any)[META_TYPE_KEY]({ type: "object" }) as Hash;
    const otherSchema = store.cas.put(meta, { type: "number" });
    const h2 = store.cas.put(otherSchema, 42);
    expect(() => store.var.update("@app/x", h2)).toThrow(SchemaMismatchError);
  });

  test("A7. remove clears get and list", async () => {
    const { store, schema, put } = await setupStore(dir);
    const h = put("v");
    store.var.set("@app/x", h);
    const removed = store.var.remove("@app/x", schema);
    expect(removed).toHaveLength(1);
    expect(store.var.get("@app/x", schema)).toBeNull();
    const listed = store.var.list({ exactName: "@app/x" });
    expect(listed).toHaveLength(0);
  });

  test("A8. list with ListOptions: sort/limit/offset/desc", async () => {
    const { store, put } = await setupStore(dir);
    const h1 = put("v1");
    const h2 = put("v2");
    store.var.set("@user/a", h1);
    await new Promise((r) => setTimeout(r, 5));
    store.var.set("@user/b", h2);

    const limited = store.var.list({ namePrefix: "@user/", limit: 1 });
    expect(limited).toHaveLength(1);

    const offset = store.var.list({ namePrefix: "@user/", offset: 1 });
    expect(offset.map((v) => v.name)).toContain("@user/b");

    const desc = store.var.list({ namePrefix: "@user/", desc: true });
    expect(desc[0]?.name).toBe("@user/b");
  });

  test("A9. persistence across reopen", async () => {
    const { store, put } = await setupStore(dir);
    const h = put("v-persist");
    store.var.set("@app/p", h);
    store.var.close();

    const reopened = await openStore(dir);
    const got = reopened.var.list({ exactName: "@app/p" });
    expect(got).toHaveLength(1);
    expect(got[0]?.value).toBe(h);
  });

  test("A10. MAX_HISTORY truncation", async () => {
    const { store, schema, put } = await setupStore(dir);
    for (let i = 0; i < MAX_HISTORY + 3; i++) {
      const h = put(`v${i}`);
      store.var.set("@app/x", h);
    }
    const hist = store.var.history("@app/x", schema);
    expect(hist).toHaveLength(MAX_HISTORY);
  });

  test("A11. labels round-trip", async () => {
    const { store, schema, put } = await setupStore(dir);
    const h = put("v");
    store.var.set("@app/x", h, { labels: ["pinned"] });
    const got = store.var.get("@app/x", schema);
    expect(got?.labels).toEqual(["pinned"]);
  });

  test("A12. TagLabelConflictError when labels and tags overlap", async () => {
    const { store, put } = await setupStore(dir);
    const h = put("v");
    expect(() =>
      store.var.set("@app/x", h, {
        tags: { env: "prod" },
        labels: ["env"],
      }),
    ).toThrow(TagLabelConflictError);
  });

  test("A13. update on missing variable throws VariableNotFoundError", async () => {
    const { store, put } = await setupStore(dir);
    const h = put("v");
    expect(() => store.var.update("@app/missing", h)).toThrow(
      VariableNotFoundError,
    );
  });
});
