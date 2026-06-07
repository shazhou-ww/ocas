import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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
import { afterEach, beforeEach, describe, expect, test } from "vitest";

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
    const builtinSchemas = bootstrap(store);
    const hash = builtinSchemas["@ocas/schema"] ?? "";

    expect(hash).toHaveLength(13);
    expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);

    const node = store.cas.get(hash) as CasNode;
    expect(node.type).toBe(hash);
  });

  test("bootstrap is idempotent across calls", async () => {
    const store = await openStore(dir);
    const h1 = bootstrap(store);
    const h2 = bootstrap(store);

    expect(h1).toEqual(h2);
    expect(store.cas.listByType(h1["@ocas/schema"] ?? "")).toHaveLength(32);
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
    const builtinSchemas = bootstrap(store1);
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
    const builtinSchemas = bootstrap(store1);
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
    const builtinSchemas = bootstrap(store1);
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
    const builtinSchemas = bootstrap(store);
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
    const schemas1 = bootstrap(store1);
    const count1 = store1.cas.listAll().length;

    const store2 = await openStore(dir);
    const schemas2 = bootstrap(store2);
    const count2 = store2.cas.listAll().length;

    // Same schemas, same count
    expect(schemas1).toEqual(schemas2);
    expect(count1).toBe(count2);
  });

  test("openStore works on already-bootstrapped store", async () => {
    // Open + bootstrap
    const store1 = await openStore(dir);
    const schemas1 = bootstrap(store1);

    // Open again
    const store2 = await openStore(dir);
    const schemas2 = bootstrap(store2);

    expect(schemas1).toEqual(schemas2);
  });

  test("openStore auto-bootstraps old store without bootstrap", async () => {
    // Create a CAS store with some data but no bootstrap
    const cas1 = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "custom" });
    cas1.put(typeHash, { data: "old" });

    // Open with openStore - should auto-bootstrap
    const store2 = await openStore(dir);
    const schemas = bootstrap(store2);

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
// E2. Store shape from openStore
// ──────────────────────────────────────────────────────────────────────────────
describe("openStore – Store shape", () => {
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

// ──────────────────────────────────────────────────────────────────────────────
// nodes/ subdirectory layout (#84)
// ──────────────────────────────────────────────────────────────────────────────
describe("createFsStore – nodes/ subdirectory layout", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // A. New layout – nodes written to nodes/ subdirectory

  test("A1. put() writes .bin file to dir/nodes/, not dir/", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t" });
    const hash = await store.put(typeHash, { x: 1 });

    expect(existsSync(join(dir, "nodes", `${hash}.bin`))).toBe(true);
    expect(existsSync(join(dir, `${hash}.bin`))).toBe(false);
  });

  test("A2. putSelfReferencing (BOOTSTRAP_STORE) writes to dir/nodes/", async () => {
    const store = createFsStore(dir);
    const hash = await store[BOOTSTRAP_STORE]({ type: "object" });

    expect(existsSync(join(dir, "nodes", `${hash}.bin`))).toBe(true);
    expect(existsSync(join(dir, `${hash}.bin`))).toBe(false);
  });

  test("A3. nodes/ directory auto-created on first put", async () => {
    expect(existsSync(join(dir, "nodes"))).toBe(false);

    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t" });
    await store.put(typeHash, { x: 1 });

    expect(existsSync(join(dir, "nodes"))).toBe(true);
    expect(statSync(join(dir, "nodes")).isDirectory()).toBe(true);
  });

  // B. Round-trip with new layout

  test("B1. second createFsStore instance reads nodes from dir/nodes/", async () => {
    const typeHash = await computeSelfHash({ name: "B1" });

    const store1 = createFsStore(dir);
    const h1 = await store1.put(typeHash, { msg: "hello" });
    const h2 = await store1.put(typeHash, { msg: "world" });

    // Confirm files are in nodes/, not root
    expect(existsSync(join(dir, "nodes", `${h1}.bin`))).toBe(true);
    expect(existsSync(join(dir, "nodes", `${h2}.bin`))).toBe(true);

    const store2 = createFsStore(dir);
    expect(store2.has(h1)).toBe(true);
    expect(store2.has(h2)).toBe(true);
    expect(store2.listByType(typeHash)).toHaveLength(2);
  });

  test("B2. openStore round-trip: bootstrap + put + reload all intact", async () => {
    const store1 = await openStore(dir);
    const schemas1 = bootstrap(store1);
    const schemaHash = schemas1["@ocas/schema"] ?? "";
    const typeHash = await computeSelfHash({ name: "B2" });
    const userHash = store1.cas.put(typeHash, { x: 42 });

    // All node files should be in nodes/
    const nodeEntries = readdirSync(join(dir, "nodes"));
    expect(nodeEntries.some((e) => e === `${schemaHash}.bin`)).toBe(true);
    expect(nodeEntries.some((e) => e === `${userHash}.bin`)).toBe(true);

    const store2 = await openStore(dir);
    expect(store2.cas.has(schemaHash)).toBe(true);
    expect(store2.cas.has(userHash)).toBe(true);
  });

  // C. Migration from old flat layout

  test("C1. old-layout .bin files in dir/ root are moved to dir/nodes/ on createFsStore", async () => {
    // Manually build an "old" layout by writing nodes via a fresh store first
    // then renaming files from nodes/ back to root, simulating pre-#84 stores.
    const typeHash = await computeSelfHash({ name: "C1" });
    const tmp = createFsStore(dir);
    const h1 = await tmp.put(typeHash, { i: 1 });
    const h2 = await tmp.put(typeHash, { i: 2 });

    // Simulate old flat layout: move .bin files from nodes/ to root
    const nodesDir = join(dir, "nodes");
    for (const f of readdirSync(nodesDir)) {
      renameSync(join(nodesDir, f), join(dir, f));
    }
    rmSync(nodesDir, { recursive: true, force: true });

    expect(existsSync(join(dir, `${h1}.bin`))).toBe(true);
    expect(existsSync(join(dir, `${h2}.bin`))).toBe(true);
    expect(existsSync(nodesDir)).toBe(false);

    // Now open the store; migration should run
    const _store = createFsStore(dir);

    expect(existsSync(join(dir, "nodes", `${h1}.bin`))).toBe(true);
    expect(existsSync(join(dir, "nodes", `${h2}.bin`))).toBe(true);
  });

  test("C2. after migration, no .bin files remain in dir/ root", async () => {
    const typeHash = await computeSelfHash({ name: "C2" });
    const tmp = createFsStore(dir);
    await tmp.put(typeHash, { i: 1 });
    await tmp.put(typeHash, { i: 2 });

    // Simulate old flat layout
    const nodesDir = join(dir, "nodes");
    for (const f of readdirSync(nodesDir)) {
      renameSync(join(nodesDir, f), join(dir, f));
    }
    rmSync(nodesDir, { recursive: true, force: true });

    const _store = createFsStore(dir);

    const rootEntries = readdirSync(dir);
    const binFilesInRoot = rootEntries.filter((e) => e.endsWith(".bin"));
    expect(binFilesInRoot).toEqual([]);
  });

  test("C3. after migration, all nodes accessible via get() and listByType()", async () => {
    const typeHash = await computeSelfHash({ name: "C3" });
    const tmp = createFsStore(dir);
    const h1 = await tmp.put(typeHash, { i: 1 });
    const h2 = await tmp.put(typeHash, { i: 2 });
    const h3 = await tmp.put(typeHash, { i: 3 });

    // Simulate old flat layout: move .bin to root, drop _index so we re-build
    const nodesDir = join(dir, "nodes");
    for (const f of readdirSync(nodesDir)) {
      renameSync(join(nodesDir, f), join(dir, f));
    }
    rmSync(nodesDir, { recursive: true, force: true });
    rmSync(join(dir, "_index"), { recursive: true, force: true });

    const store = createFsStore(dir);
    expect(store.has(h1)).toBe(true);
    expect(store.has(h2)).toBe(true);
    expect(store.has(h3)).toBe(true);
    const listed = store.listByType(typeHash).map((e) => e.hash);
    expect(listed).toHaveLength(3);
    expect(listed).toContain(h1);
    expect(listed).toContain(h2);
    expect(listed).toContain(h3);
  });

  test("C4. migration is idempotent: re-opening already-migrated store is no-op", async () => {
    const typeHash = await computeSelfHash({ name: "C4" });
    const store1 = createFsStore(dir);
    const h1 = await store1.put(typeHash, { i: 1 });
    await store1.put(typeHash, { i: 2 });

    const nodesDirBefore = readdirSync(join(dir, "nodes")).sort();
    const rootEntriesBefore = readdirSync(dir).sort();

    // Re-open — should be a no-op (no migration occurs)
    const _store2 = createFsStore(dir);

    const nodesDirAfter = readdirSync(join(dir, "nodes")).sort();
    const rootEntriesAfter = readdirSync(dir).sort();

    expect(nodesDirAfter).toEqual(nodesDirBefore);
    expect(rootEntriesAfter).toEqual(rootEntriesBefore);
    // Sanity: file from before migration is still in nodes/
    expect(existsSync(join(dir, "nodes", `${h1}.bin`))).toBe(true);
  });

  test("C5. openStore on old layout: migrates, bootstraps, put/get all work", async () => {
    // Build an "old" store: bootstrap then move .bin to root
    const store1 = await openStore(dir);
    const schemas1 = bootstrap(store1);
    const schemaHash = schemas1["@ocas/schema"] ?? "";

    const nodesDir = join(dir, "nodes");
    for (const f of readdirSync(nodesDir)) {
      renameSync(join(nodesDir, f), join(dir, f));
    }
    rmSync(nodesDir, { recursive: true, force: true });

    expect(existsSync(join(dir, `${schemaHash}.bin`))).toBe(true);

    // Re-open with openStore — should migrate + bootstrap idempotently
    const store2 = await openStore(dir);
    expect(store2.cas.has(schemaHash)).toBe(true);
    expect(existsSync(join(dir, "nodes", `${schemaHash}.bin`))).toBe(true);
    expect(existsSync(join(dir, `${schemaHash}.bin`))).toBe(false);

    // put/get works after migration
    const typeHash = await computeSelfHash({ name: "C5" });
    const newHash = store2.cas.put(typeHash, { hello: "world" });
    expect(store2.cas.has(newHash)).toBe(true);
    expect(existsSync(join(dir, "nodes", `${newHash}.bin`))).toBe(true);
  });

  // D. Delete

  test("D1. delete() removes dir/nodes/<hash>.bin (not dir/<hash>.bin)", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "D1" });
    const hash = await store.put(typeHash, { x: 1 });

    expect(existsSync(join(dir, "nodes", `${hash}.bin`))).toBe(true);

    const removed = store.delete(hash);
    expect(removed).toBe(true);

    expect(existsSync(join(dir, "nodes", `${hash}.bin`))).toBe(false);
    expect(existsSync(join(dir, `${hash}.bin`))).toBe(false);
    expect(store.has(hash)).toBe(false);
  });

  // E. Metadata location unchanged

  test("E1. _index/ stays in dir/ (not inside nodes/)", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "E1" });
    await store.put(typeHash, { x: 1 });

    expect(existsSync(join(dir, "_index"))).toBe(true);
    expect(statSync(join(dir, "_index")).isDirectory()).toBe(true);
    expect(existsSync(join(dir, "nodes", "_index"))).toBe(false);
  });

  test("E2. _store.db stays in dir/ (not inside nodes/)", async () => {
    const store = await openStore(dir);
    const typeHash = await computeSelfHash({ name: "E2" });
    store.cas.put(typeHash, { x: 1 });

    expect(existsSync(join(dir, "_store.db"))).toBe(true);
    expect(existsSync(join(dir, "nodes", "_store.db"))).toBe(false);
  });

  // F. Index rebuild with new layout

  test("F1. removing _index/ then re-opening rebuilds index from dir/nodes/ .bin files", async () => {
    const typeHash = await computeSelfHash({ name: "F1" });
    const store1 = createFsStore(dir);
    const h1 = await store1.put(typeHash, { a: 1 });
    const h2 = await store1.put(typeHash, { a: 2 });

    rmSync(join(dir, "_index"), { recursive: true, force: true });
    expect(existsSync(join(dir, "_index"))).toBe(false);

    const store2 = createFsStore(dir);
    const list = store2.listByType(typeHash).map((e) => e.hash);
    expect(list).toHaveLength(2);
    expect(list).toContain(h1);
    expect(list).toContain(h2);
    expect(existsSync(join(dir, "_index", typeHash))).toBe(true);

    // sanity: .bin files still in nodes/
    expect(existsSync(join(dir, "nodes", `${h1}.bin`))).toBe(true);
    expect(existsSync(join(dir, "nodes", `${h2}.bin`))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Lazy loading (#85)
// ──────────────────────────────────────────────────────────────────────────────
describe("createFsStore – lazy loading (#85)", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("L1. createFsStore does NOT CBOR-decode nodes at startup", async () => {
    const typeHash = await computeSelfHash({ name: "L1" });

    const store1 = createFsStore(dir);
    const h1 = await store1.put(typeHash, { i: 1 });
    const h2 = await store1.put(typeHash, { i: 2 });
    const h3 = await store1.put(typeHash, { i: 3 });

    // Corrupt h2 by overwriting its .bin file with garbage CBOR
    const corruptedPath = join(dir, "nodes", `${h2}.bin`);
    writeFileSync(corruptedPath, Buffer.from([0xff, 0xfe, 0xfd, 0xfc]));

    // Opening the store should NOT throw, even though h2 is corrupted —
    // because nothing is decoded at startup.
    const store2 = createFsStore(dir);

    // has() should return true for all three (filename-based)
    expect(store2.has(h1)).toBe(true);
    expect(store2.has(h2)).toBe(true);
    expect(store2.has(h3)).toBe(true);

    // listAll() reads filenames, so all three appear
    const all = store2.listAll();
    expect(all).toContain(h1);
    expect(all).toContain(h2);
    expect(all).toContain(h3);

    // Non-corrupted nodes load fine
    expect(store2.get(h1)).not.toBeNull();
    expect(store2.get(h3)).not.toBeNull();

    // Corrupted node fails to load (returns null)
    expect(store2.get(h2)).toBeNull();
  });

  test("L2. get() loads node from disk on demand (cache miss)", async () => {
    const typeHash = await computeSelfHash({ name: "L2" });

    const store1 = createFsStore(dir);
    const hash = await store1.put(typeHash, { value: 42, label: "answer" });
    const original = store1.get(hash) as CasNode;

    // Lazy-load instance
    const store2 = createFsStore(dir);
    const loaded1 = store2.get(hash) as CasNode;
    expect(loaded1.type).toBe(typeHash);
    expect(loaded1.payload).toEqual({ value: 42, label: "answer" });
    expect(loaded1.timestamp).toBe(original.timestamp);

    // Second get should return the same data (from cache)
    const loaded2 = store2.get(hash) as CasNode;
    expect(loaded2).toEqual(loaded1);
  });

  test("L3. has() works without loading node data", async () => {
    const typeHash = await computeSelfHash({ name: "L3" });

    const store1 = createFsStore(dir);
    const hashes: string[] = [];
    for (let i = 0; i < 5; i++) {
      hashes.push(await store1.put(typeHash, { i }));
    }

    const store2 = createFsStore(dir);
    for (const hash of hashes) {
      expect(store2.has(hash)).toBe(true);
    }

    // Non-existent hash returns false
    expect(store2.has("0000000000000")).toBe(false);
  });

  test("L4. listAll() returns hashes from filenames without decoding", async () => {
    const typeHash = await computeSelfHash({ name: "L4" });

    const store1 = createFsStore(dir);
    const realHashes: string[] = [];
    for (let i = 0; i < 3; i++) {
      realHashes.push(await store1.put(typeHash, { i }));
    }

    // Add a corrupted .bin file with valid filename but garbage content
    const corruptedHash = "ABCDEFGHJKMNP";
    writeFileSync(
      join(dir, "nodes", `${corruptedHash}.bin`),
      Buffer.from([0xff, 0xee, 0xdd]),
    );

    const store2 = createFsStore(dir);
    const all = store2.listAll();
    expect(all).toHaveLength(realHashes.length + 1);
    for (const h of realHashes) {
      expect(all).toContain(h);
    }
    expect(all).toContain(corruptedHash);

    // Real nodes still readable
    for (const h of realHashes) {
      expect(store2.get(h)).not.toBeNull();
    }
    // Corrupted one returns null
    expect(store2.get(corruptedHash)).toBeNull();
  });

  test("L5. put() makes node immediately available without re-reading disk", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "L5" });

    const hash = await store.put(typeHash, { written: true });

    // Immediately available via get(), has(), and listAll()
    const node = store.get(hash) as CasNode;
    expect(node.type).toBe(typeHash);
    expect(node.payload).toEqual({ written: true });
    expect(store.has(hash)).toBe(true);
    expect(store.listAll()).toContain(hash);
  });

  test("L6. delete() removes node from cache and disk", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "L6" });

    const hash = await store.put(typeHash, { temporary: true });
    // populate cache by getting once
    expect(store.get(hash)).not.toBeNull();

    expect(store.delete(hash)).toBe(true);

    expect(store.get(hash)).toBeNull();
    expect(store.has(hash)).toBe(false);
    expect(store.listAll()).not.toContain(hash);
    expect(existsSync(join(dir, "nodes", `${hash}.bin`))).toBe(false);
  });

  test("L7. listByType works with lazy loading (loads timestamps on demand)", async () => {
    const typeA = await computeSelfHash({ name: "typeA-L7" });
    const typeB = await computeSelfHash({ name: "typeB-L7" });

    const store1 = createFsStore(dir);
    const aHashes: string[] = [];
    for (let i = 0; i < 3; i++) {
      aHashes.push(await store1.put(typeA, { i }));
    }
    const bHashes: string[] = [];
    for (let i = 0; i < 2; i++) {
      bHashes.push(await store1.put(typeB, { i }));
    }

    const store2 = createFsStore(dir);
    const aList = store2.listByType(typeA);
    expect(aList).toHaveLength(3);
    for (const e of aList) {
      expect(aHashes).toContain(e.hash);
      expect(typeof e.created).toBe("number");
      expect(e.created).toBeGreaterThan(0);
    }

    const bList = store2.listByType(typeB);
    expect(bList).toHaveLength(2);

    expect(store2.listByType("0000000000000")).toEqual([]);
  });

  test("L8. listMeta works with lazy loading", async () => {
    const store1 = createFsStore(dir);
    const m1 = await store1[BOOTSTRAP_STORE]({ type: "object", v: "L8a" });
    const m2 = await store1[BOOTSTRAP_STORE]({ type: "object", v: "L8b" });

    const store2 = createFsStore(dir);
    const meta = store2.listMeta();
    const metaHashes = meta.map((e) => e.hash);
    expect(metaHashes).toHaveLength(2);
    expect(metaHashes).toContain(m1);
    expect(metaHashes).toContain(m2);
    for (const e of meta) {
      expect(typeof e.created).toBe("number");
      expect(e.created).toBeGreaterThan(0);
    }
  });

  test("L9. listSchemas works with lazy loading", async () => {
    const store1 = createFsStore(dir);
    const m = await store1[BOOTSTRAP_STORE]({ type: "object" });
    const s1 = await store1.put(m, { type: "string" });
    const s2 = await store1.put(m, { type: "number" });

    const store2 = createFsStore(dir);
    const schemas = store2.listSchemas().map((e) => e.hash);
    expect(schemas).toHaveLength(3);
    expect(schemas).toContain(m);
    expect(schemas).toContain(s1);
    expect(schemas).toContain(s2);
  });

  test("L10. index migration still works with lazy loading", async () => {
    const typeHash = await computeSelfHash({ name: "L10" });

    const store1 = createFsStore(dir);
    const h1 = await store1.put(typeHash, { i: 1 });
    const h2 = await store1.put(typeHash, { i: 2 });

    rmSync(join(dir, "_index"), { recursive: true, force: true });

    // Re-open: should rebuild type index by scanning + decoding nodes on disk
    const store2 = createFsStore(dir);
    const list = store2.listByType(typeHash).map((e) => e.hash);
    expect(list).toHaveLength(2);
    expect(list).toContain(h1);
    expect(list).toContain(h2);
    expect(existsSync(join(dir, "_index", typeHash))).toBe(true);

    // Re-open again: index already on disk, no re-scan needed
    const store3 = createFsStore(dir);
    const list3 = store3.listByType(typeHash).map((e) => e.hash);
    expect(list3).toHaveLength(2);
  });

  test("L11. meta migration still works with lazy loading", async () => {
    const store1 = createFsStore(dir);
    const h1 = await store1[BOOTSTRAP_STORE]({ type: "object", v: "L11a" });
    const h2 = await store1[BOOTSTRAP_STORE]({ type: "object", v: "L11b" });

    const metaPath = join(dir, "_index", "_meta");
    rmSync(metaPath, { force: true });
    expect(existsSync(metaPath)).toBe(false);

    const store2 = createFsStore(dir);
    const meta = store2.listMeta().map((e) => e.hash);
    expect(meta).toHaveLength(2);
    expect(meta).toContain(h1);
    expect(meta).toContain(h2);
    expect(existsSync(metaPath)).toBe(true);
  });

  test("L12. bootstrap round-trip works with lazy store", async () => {
    const store1 = await openStore(dir);
    const schemas1 = bootstrap(store1);
    const typeHash = await computeSelfHash({ name: "L12-user" });
    const userHash = store1.cas.put(typeHash, { user: "data" });

    const store2 = await openStore(dir);
    // All bootstrap schemas accessible
    for (const name of [
      "@ocas/schema",
      "@ocas/string",
      "@ocas/number",
      "@ocas/object",
      "@ocas/array",
      "@ocas/bool",
    ]) {
      const h = schemas1[name] as string;
      expect(store2.cas.has(h)).toBe(true);
      expect(store2.cas.get(h)).not.toBeNull();
    }
    // User data still accessible
    expect(store2.cas.has(userHash)).toBe(true);
    const userNode = store2.cas.get(userHash) as CasNode;
    expect(userNode.payload).toEqual({ user: "data" });
  });
});
