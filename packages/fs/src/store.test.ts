import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasNode } from "@ocas/core";
import {
  BOOTSTRAP_STORE,
  bootstrap,
  computeHash,
  computeSelfHash,
  verify,
} from "@ocas/core";

import { createFsStore, openStore } from "./store.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ocas-fs-test-"));
}

// ──────────────────────────────────────────────────────────────────────────────
// init and bootstrap
// ──────────────────────────────────────────────────────────────────────────────
describe("createFsStore – init and bootstrap", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("store opens against an existing empty dir", () => {
    const store = createFsStore(dir);
    expect(store.listByType("0000000000000")).toEqual([]);
  });

  test("store creates the directory on first put", async () => {
    const nested = join(dir, "sub", "store");
    const store = createFsStore(nested);
    const typeHash = await computeSelfHash({ name: "t" });
    const hash = await store.put(typeHash, { x: 1 });
    expect(store.has(hash)).toBe(true);
  });

  test("bootstrap returns a valid 13-char self-referencing hash", async () => {
    const store = await openStore(dir);
    const builtinSchemas = await bootstrap(store);
    const hash = builtinSchemas["@ocas/schema"] ?? "";

    expect(hash).toHaveLength(13);
    expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);

    const node = store.cas.get(hash) as CasNode;
    expect(node.type).toBe(hash);
  });

  test("bootstrap is idempotent across calls", async () => {
    const store = await openStore(dir);
    const h1 = await bootstrap(store);
    const h2 = await bootstrap(store);

    expect(h1).toEqual(h2);
    expect(store.cas.listByType(h1["@ocas/schema"] ?? "")).toHaveLength(29);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// persistence round-trip
// ──────────────────────────────────────────────────────────────────────────────
describe("createFsStore – persistence round-trip", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("second store instance reads nodes written by first", async () => {
    const typeHash = await computeSelfHash({ name: "my-type" });

    const store1 = createFsStore(dir);
    const h1 = await store1.put(typeHash, { msg: "hello" });
    const h2 = await store1.put(typeHash, { msg: "world" });

    const store2 = createFsStore(dir);
    expect(store2.has(h1)).toBe(true);
    expect(store2.has(h2)).toBe(true);
    expect(store2.listByType(typeHash)).toHaveLength(2);
  });

  test("round-trip preserves type, payload, and timestamp", async () => {
    const typeHash = await computeSelfHash({ name: "round-trip" });

    const store1 = createFsStore(dir);
    const hash = await store1.put(typeHash, { value: 42 });
    const original = store1.get(hash) as CasNode;

    const store2 = createFsStore(dir);
    const loaded = store2.get(hash) as CasNode;

    expect(loaded.type).toBe(original.type);
    expect(loaded.payload).toEqual(original.payload);
    expect(loaded.timestamp).toBe(original.timestamp);
  });

  test("bootstrap survives round-trip: self-referencing node reloads correctly", async () => {
    const store1 = await openStore(dir);
    const builtinSchemas = await bootstrap(store1);
    const hash = builtinSchemas["@ocas/schema"] ?? "";

    const store2 = createFsStore(dir);
    const node = store2.get(hash) as CasNode;
    expect(node.type).toBe(hash);
  });

  test("put is idempotent across instances: timestamp unchanged on second put", async () => {
    const typeHash = await computeSelfHash({ name: "idempotent" });

    const store1 = createFsStore(dir);
    const hash = await store1.put(typeHash, { n: 7 });
    const ts1 = store1.get(hash)?.timestamp;

    await new Promise((r) => setTimeout(r, 5));

    const store2 = createFsStore(dir);
    await store2.put(typeHash, { n: 7 });
    const ts2 = store2.get(hash)?.timestamp;

    expect(ts1).toBe(ts2);
    expect(store2.listByType(typeHash)).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// has and list
// ──────────────────────────────────────────────────────────────────────────────
describe("createFsStore – has and list", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("has returns false before put, true after", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t" });
    const hash = await computeHash(typeHash, { x: 1 });

    expect(store.has(hash)).toBe(false);
    await store.put(typeHash, { x: 1 });
    expect(store.has(hash)).toBe(true);
  });

  test("listByType returns all stored hashes for a type", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t" });

    const h1 = await store.put(typeHash, { a: 1 });
    const h2 = await store.put(typeHash, { a: 2 });
    const h3 = await store.put(typeHash, { a: 3 });

    const all = store.listByType(typeHash).map((e) => e.hash);
    expect(all).toHaveLength(3);
    expect(all).toContain(h1);
    expect(all).toContain(h2);
    expect(all).toContain(h3);
  });

  test("listByType returns empty array on fresh store", () => {
    const store = createFsStore(dir);
    expect(store.listByType("0000000000000")).toEqual([]);
  });

  test("get returns null for unknown hash", () => {
    const store = createFsStore(dir);
    expect(store.get("0000000000000")).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// listByType and index migration
// ──────────────────────────────────────────────────────────────────────────────
describe("createFsStore – listByType", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns empty array for unknown type", () => {
    const store = createFsStore(dir);
    expect(store.listByType("0000000000000")).toEqual([]);
  });

  test("returns all hashes for the given type", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t" });
    const otherType = await computeSelfHash({ name: "other" });

    const h1 = await store.put(typeHash, { a: 1 });
    const h2 = await store.put(typeHash, { a: 2 });
    await store.put(otherType, { b: 1 });

    const byType = store.listByType(typeHash).map((e) => e.hash);
    expect(byType).toHaveLength(2);
    expect(byType).toContain(h1);
    expect(byType).toContain(h2);
  });

  test("listByType survives round-trip across store instances", async () => {
    const typeHash = await computeSelfHash({ name: "persist-by-type" });

    const store1 = createFsStore(dir);
    const h1 = await store1.put(typeHash, { x: 1 });
    const h2 = await store1.put(typeHash, { x: 2 });

    const store2 = createFsStore(dir);
    const byType = store2.listByType(typeHash).map((e) => e.hash);
    expect(byType).toHaveLength(2);
    expect(byType).toContain(h1);
    expect(byType).toContain(h2);
  });

  test("idempotent put does not duplicate in listByType", async () => {
    const typeHash = await computeSelfHash({ name: "idempotent-index" });

    const store1 = createFsStore(dir);
    const hash = await store1.put(typeHash, { n: 7 });
    await store1.put(typeHash, { n: 7 });

    const store2 = createFsStore(dir);
    expect(store2.listByType(typeHash).map((e) => e.hash)).toEqual([hash]);
  });

  test("rebuilds _index from .bin files when index is missing", async () => {
    const typeHash = await computeSelfHash({ name: "migrate" });

    const store1 = createFsStore(dir);
    const h1 = await store1.put(typeHash, { a: 1 });
    const h2 = await store1.put(typeHash, { a: 2 });

    rmSync(join(dir, "_index"), { recursive: true, force: true });

    const store2 = createFsStore(dir);
    expect(store2.listByType(typeHash).map((e) => e.hash)).toEqual([h1, h2]);
    expect(existsSync(join(dir, "_index", typeHash))).toBe(true);
    expect(readdirSync(join(dir, "_index"))).toContain(typeHash);
  });

  test("bootstrap node is listed under its self type after reload", async () => {
    const store1 = await openStore(dir);
    const builtinSchemas = await bootstrap(store1);
    const hash = builtinSchemas["@ocas/schema"] ?? "";

    const store2 = createFsStore(dir);
    expect(store2.listByType(hash).map((e) => e.hash)).toContain(hash);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// verify on disk-loaded nodes
// ──────────────────────────────────────────────────────────────────────────────
describe("createFsStore – verify on disk-loaded nodes", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("verify passes on a normal disk-loaded node", async () => {
    const typeHash = await computeSelfHash({ name: "verifiable" });

    const store1 = createFsStore(dir);
    const hash = await store1.put(typeHash, { data: 123 });

    const store2 = createFsStore(dir);
    const node = store2.get(hash) as CasNode;

    expect(await verify(hash, node)).toBe(true);
  });

  test("verify passes on a disk-loaded bootstrap node", async () => {
    const store1 = await openStore(dir);
    const builtinSchemas = await bootstrap(store1);
    const hash = builtinSchemas["@ocas/schema"] ?? "";

    const store2 = createFsStore(dir);
    const node = store2.get(hash) as CasNode;

    expect(await verify(hash, node)).toBe(true);
  });

  test("verify passes for multiple disk-loaded nodes", async () => {
    const typeHash = await computeSelfHash({ name: "multi" });

    const store1 = createFsStore(dir);
    const hashes: string[] = [];
    for (let i = 0; i < 5; i++) {
      hashes.push(await store1.put(typeHash, { i }));
    }

    const store2 = createFsStore(dir);
    for (const hash of hashes) {
      const node = store2.get(hash) as CasNode;
      expect(await verify(hash, node)).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// openStore – async with auto-bootstrap
// ──────────────────────────────────────────────────────────────────────────────
describe("openStore – async with auto-bootstrap", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("openStore returns Promise<Store>", async () => {
    const store = await openStore(dir);
    expect(store).toBeDefined();
    expect(typeof store.cas.put).toBe("function");
    expect(typeof store.cas.get).toBe("function");
  });

  test("openStore auto-creates directory when it doesn't exist", async () => {
    const nested = join(dir, "sub", "nested", "store");
    expect(existsSync(nested)).toBe(false);

    const store = await openStore(nested);
    expect(existsSync(nested)).toBe(true);

    // Verify store works
    const typeHash = await computeSelfHash({ name: "t" });
    const hash = store.cas.put(typeHash, { x: 1 });
    expect(store.cas.has(hash)).toBe(true);
  });

  test("openStore works when directory already exists", async () => {
    // Pre-create the directory
    const store1 = await openStore(dir);
    const typeHash = await computeSelfHash({ name: "t" });
    store1.cas.put(typeHash, { x: 1 });

    // Open again
    const store2 = await openStore(dir);
    expect(store2.cas.listByType(typeHash)).toHaveLength(1);
  });

  test("openStore throws error when path exists but is not a directory", async () => {
    const filePath = join(dir, "not-a-dir");
    writeFileSync(filePath, "test");

    await expect(openStore(filePath)).rejects.toThrow();
  });

  test("openStore auto-bootstraps on first open (empty directory)", async () => {
    const store = await openStore(dir);

    // Check that bootstrap schemas exist
    const builtinSchemas = await bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"];

    expect(metaHash).toBeDefined();
    expect(store.cas.has(metaHash as string)).toBe(true);

    // Verify all core schemas exist
    expect(store.cas.has(builtinSchemas["@ocas/string"] as string)).toBe(true);
    expect(store.cas.has(builtinSchemas["@ocas/number"] as string)).toBe(true);
    expect(store.cas.has(builtinSchemas["@ocas/object"] as string)).toBe(true);
    expect(store.cas.has(builtinSchemas["@ocas/array"] as string)).toBe(true);
    expect(store.cas.has(builtinSchemas["@ocas/bool"] as string)).toBe(true);
    expect(store.cas.has(builtinSchemas["@ocas/schema"] as string)).toBe(true);
  });

  test("openStore bootstrap is idempotent on subsequent opens", async () => {
    const store1 = await openStore(dir);
    const schemas1 = await bootstrap(store1);
    const count1 = store1.cas.listAll().length;

    const store2 = await openStore(dir);
    const schemas2 = await bootstrap(store2);
    const count2 = store2.cas.listAll().length;

    // Same schemas, same count
    expect(schemas1).toEqual(schemas2);
    expect(count1).toBe(count2);
  });

  test("openStore works on already-bootstrapped store", async () => {
    // Open + bootstrap
    const store1 = await openStore(dir);
    const schemas1 = await bootstrap(store1);

    // Open again
    const store2 = await openStore(dir);
    const schemas2 = await bootstrap(store2);

    expect(schemas1).toEqual(schemas2);
  });

  test("openStore auto-bootstraps old store without bootstrap", async () => {
    // Create a CAS store with some data but no bootstrap
    const cas1 = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "custom" });
    cas1.put(typeHash, { data: "old" });

    // Open with openStore - should auto-bootstrap
    const store2 = await openStore(dir);
    const schemas = await bootstrap(store2);

    expect(store2.cas.has(schemas["@ocas/schema"] as string)).toBe(true);
    // Old data still exists
    expect(store2.cas.listByType(typeHash)).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// listMeta and listSchemas (FS persistence)
// ──────────────────────────────────────────────────────────────────────────────
describe("createFsStore – listMeta and listSchemas", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ocas-fs-meta-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("C1. _index/_meta exists and contains hash after self-referencing put", async () => {
    const store = createFsStore(dir);
    const hash = await store[BOOTSTRAP_STORE]({ type: "object" });

    const metaPath = join(dir, "_index", "_meta");
    expect(existsSync(metaPath)).toBe(true);
    const content = readFileSync(metaPath, "utf8");
    expect(content).toBe(`${hash}\n`);
  });

  test("C2. multiple meta puts append, no duplicates", async () => {
    const store = createFsStore(dir);
    const h1 = await store[BOOTSTRAP_STORE]({ type: "object", v: 1 });
    const h2 = await store[BOOTSTRAP_STORE]({ type: "object", v: 2 });
    // re-put first (idempotent)
    await store[BOOTSTRAP_STORE]({ type: "object", v: 1 });

    const content = readFileSync(join(dir, "_index", "_meta"), "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(lines).toContain(h1);
    expect(lines).toContain(h2);
  });

  test("C3. reload from disk preserves listMeta", async () => {
    const store1 = createFsStore(dir);
    const h1 = await store1[BOOTSTRAP_STORE]({ type: "object", v: "a" });
    const h2 = await store1[BOOTSTRAP_STORE]({ type: "object", v: "b" });

    const store2 = createFsStore(dir);
    const meta = store2.listMeta().map((e) => e.hash);
    expect(meta).toContain(h1);
    expect(meta).toContain(h2);
    expect(meta).toHaveLength(2);
  });

  test("C4. migrates from existing nodes when _meta is missing", async () => {
    const store1 = createFsStore(dir);
    const h1 = await store1[BOOTSTRAP_STORE]({ type: "object", v: "mig" });
    const t = await computeSelfHash({ name: "regular" });
    await store1.put(h1, { type: "string" });

    // Remove _index/_meta but keep _index/* and .bin files
    const metaPath = join(dir, "_index", "_meta");
    rmSync(metaPath, { force: true });
    expect(existsSync(metaPath)).toBe(false);

    const store2 = createFsStore(dir);
    expect(store2.listMeta().map((e) => e.hash)).toContain(h1);
    expect(existsSync(metaPath)).toBe(true);
    const content = readFileSync(metaPath, "utf8");
    expect(content).toContain(h1);

    // unrelated type hash not in meta
    expect(store2.listMeta().map((e) => e.hash)).not.toContain(t);
  });

  test("C5. existing _meta is not overwritten", async () => {
    const store1 = createFsStore(dir);
    const h1 = await store1[BOOTSTRAP_STORE]({ type: "object", v: "keep" });

    const metaPath = join(dir, "_index", "_meta");
    const before = readFileSync(metaPath, "utf8");

    // Reopen and confirm content unchanged
    const _store2 = createFsStore(dir);
    const after = readFileSync(metaPath, "utf8");
    expect(after).toBe(before);
    expect(after).toContain(h1);
  });

  test("C6. listSchemas returns union of typeIndex[m] for m in metaSet", async () => {
    const store = createFsStore(dir);
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    const s1 = await store.put(m, { type: "string" });
    const s2 = await store.put(m, { type: "number" });
    const s3 = await store.put(m, { type: "array" });

    const schemas = store.listSchemas().map((e) => e.hash);
    expect(schemas).toHaveLength(4);
    expect(schemas).toContain(m);
    expect(schemas).toContain(s1);
    expect(schemas).toContain(s2);
    expect(schemas).toContain(s3);
  });

  test("C7. delete persists removal from _meta", async () => {
    const store1 = createFsStore(dir);
    const h1 = await store1[BOOTSTRAP_STORE]({ type: "object", v: 1 });
    const h2 = await store1[BOOTSTRAP_STORE]({ type: "object", v: 2 });

    store1.delete(h1);

    const metaPath = join(dir, "_index", "_meta");
    const content = readFileSync(metaPath, "utf8");
    expect(content).not.toContain(h1);
    expect(content).toContain(h2);

    const store2 = createFsStore(dir);
    expect(store2.listMeta().map((e) => e.hash)).not.toContain(h1);
    expect(store2.listMeta().map((e) => e.hash)).toContain(h2);
  });

  test("C8. fresh store with no self-ref puts has empty listMeta", () => {
    const store = createFsStore(dir);
    expect(store.listMeta()).toEqual([]);
    // _meta may be absent; that's fine
    const metaPath = join(dir, "_index", "_meta");
    if (existsSync(metaPath)) {
      const content = readFileSync(metaPath, "utf8");
      expect(content).toBe("");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// E2. OcasStore shape from openStore
// ──────────────────────────────────────────────────────────────────────────────
describe("openStore – OcasStore shape", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("E2. returns object with cas, var, tag sub-stores", async () => {
    const store = await openStore(dir);
    expect(typeof store.cas).toBe("object");
    expect(typeof store.var).toBe("object");
    expect(typeof store.tag).toBe("object");
    expect(typeof store.cas.put).toBe("function");
    expect(typeof store.cas.get).toBe("function");
    expect(typeof store.cas.has).toBe("function");
    expect(typeof store.var.set).toBe("function");
    expect(typeof store.var.get).toBe("function");
    expect(typeof store.var.list).toBe("function");
    expect(typeof store.var.history).toBe("function");
    expect(typeof store.tag.tag).toBe("function");
    expect(typeof store.tag.tags).toBe("function");
    expect(typeof store.tag.listByTag).toBe("function");
  });
});
