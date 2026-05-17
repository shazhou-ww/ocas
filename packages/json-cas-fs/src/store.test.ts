import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasNode } from "@uncaged/json-cas";
import {
  bootstrap,
  computeHash,
  computeSelfHash,
  verify,
} from "@uncaged/json-cas";

import { createFsStore } from "./store.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "json-cas-fs-test-"));
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
    expect(store.list()).toEqual([]);
  });

  test("store creates the directory on first put", async () => {
    const nested = join(dir, "sub", "store");
    const store = createFsStore(nested);
    const typeHash = await computeSelfHash({ name: "t" });
    await store.put(typeHash, { x: 1 });
    expect(store.list()).toHaveLength(1);
  });

  test("bootstrap returns a valid 13-char self-referencing hash", async () => {
    const store = createFsStore(dir);
    const hash = await bootstrap(store);

    expect(hash).toHaveLength(13);
    expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);

    const node = store.get(hash) as CasNode;
    expect(node.type).toBe(hash);
  });

  test("bootstrap is idempotent across calls", async () => {
    const store = createFsStore(dir);
    const h1 = await bootstrap(store);
    const h2 = await bootstrap(store);

    expect(h1).toBe(h2);
    expect(store.list()).toHaveLength(1);
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
    expect(store2.list()).toHaveLength(2);
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
    const store1 = createFsStore(dir);
    const hash = await bootstrap(store1);

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
    expect(store2.list()).toHaveLength(1);
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

  test("list returns all stored hashes", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t" });

    const h1 = await store.put(typeHash, { a: 1 });
    const h2 = await store.put(typeHash, { a: 2 });
    const h3 = await store.put(typeHash, { a: 3 });

    const all = store.list();
    expect(all).toHaveLength(3);
    expect(all).toContain(h1);
    expect(all).toContain(h2);
    expect(all).toContain(h3);
  });

  test("list returns empty array on fresh store", () => {
    const store = createFsStore(dir);
    expect(store.list()).toEqual([]);
  });

  test("get returns null for unknown hash", () => {
    const store = createFsStore(dir);
    expect(store.get("0000000000000")).toBeNull();
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
    const store1 = createFsStore(dir);
    const hash = await bootstrap(store1);

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
