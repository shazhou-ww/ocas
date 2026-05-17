import { describe, expect, test } from "bun:test";

import { bootstrap } from "./bootstrap.js";
import { cborEncode } from "./cbor.js";
import { computeHash, computeSelfHash } from "./hash.js";
import { createMemoryStore } from "./store.js";
import type { CasNode } from "./types.js";
import { verify } from "./verify.js";

// ──────────────────────────────────────────────────────────────────────────────
// Step 1: CBOR deterministic encoding
// ──────────────────────────────────────────────────────────────────────────────
describe("cborEncode", () => {
  test("produces identical bytes for the same value", () => {
    const a = cborEncode({ x: 1, y: 2 });
    const b = cborEncode({ x: 1, y: 2 });
    expect(a).toEqual(b);
  });

  test("is deterministic regardless of insertion order", () => {
    const a = cborEncode({ b: 2, a: 1 });
    const b = cborEncode({ a: 1, b: 2 });
    expect(a).toEqual(b);
  });

  test("encodes primitives consistently", () => {
    expect(cborEncode(42)).toEqual(cborEncode(42));
    expect(cborEncode("hello")).toEqual(cborEncode("hello"));
    expect(cborEncode(null)).toEqual(cborEncode(null));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 2: XXH64 → 13-char Crockford Base32
// ──────────────────────────────────────────────────────────────────────────────
describe("computeHash", () => {
  test("returns a 13-character uppercase string", async () => {
    const hash = await computeHash("SOMETYPE00000", { value: 1 });
    expect(hash).toHaveLength(13);
    expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("is deterministic: same inputs → same hash", async () => {
    const h1 = await computeHash("SOMETYPE00000", { value: 1 });
    const h2 = await computeHash("SOMETYPE00000", { value: 1 });
    expect(h1).toBe(h2);
  });

  test("differs for different type hashes", async () => {
    const h1 = await computeHash("AAAAAAAAAAAAA", { value: 1 });
    const h2 = await computeHash("BBBBBBBBBBBBB", { value: 1 });
    expect(h1).not.toBe(h2);
  });

  test("differs for different payloads", async () => {
    const h1 = await computeHash("SOMETYPE00000", { value: 1 });
    const h2 = await computeHash("SOMETYPE00000", { value: 2 });
    expect(h1).not.toBe(h2);
  });

  test("computeSelfHash matches payload-only hash", async () => {
    const payload = { foo: "bar" };
    const h1 = await computeSelfHash(payload);
    const h2 = await computeSelfHash(payload);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(13);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 3: store.put() and store.get()
// ──────────────────────────────────────────────────────────────────────────────
describe("createMemoryStore – put and get", () => {
  test("put returns a hash and get retrieves the node", async () => {
    const store = createMemoryStore();
    const typeHash = await computeSelfHash({ name: "my-type" });
    const hash = await store.put(typeHash, { greeting: "hello" });

    expect(hash).toHaveLength(13);

    const node = store.get(hash);
    expect(node).not.toBeNull();
    expect(node?.type).toBe(typeHash);
    expect(node?.payload).toEqual({ greeting: "hello" });
    expect(typeof node?.timestamp).toBe("number");
  });

  test("get returns null for unknown hash", () => {
    const store = createMemoryStore();
    expect(store.get("0000000000000")).toBeNull();
  });

  test("put is idempotent: same type+payload → same hash, no duplicate", async () => {
    const store = createMemoryStore();
    const typeHash = await computeSelfHash({ name: "my-type" });

    const h1 = await store.put(typeHash, { n: 42 });
    const h2 = await store.put(typeHash, { n: 42 });
    expect(h1).toBe(h2);
    expect(store.list()).toHaveLength(1);
  });

  test("timestamp is preserved on second put (idempotency)", async () => {
    const store = createMemoryStore();
    const typeHash = await computeSelfHash({ name: "my-type" });

    const h1 = await store.put(typeHash, { v: 1 });
    const ts1 = store.get(h1)?.timestamp;

    await new Promise((r) => setTimeout(r, 5));
    await store.put(typeHash, { v: 1 });
    const ts2 = store.get(h1)?.timestamp;

    expect(ts1).toBe(ts2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 4: store.has() and store.list()
// ──────────────────────────────────────────────────────────────────────────────
describe("createMemoryStore – has and list", () => {
  test("has returns false before put, true after", async () => {
    const store = createMemoryStore();
    const typeHash = await computeSelfHash({ name: "t" });
    const hash = await computeHash(typeHash, { x: 1 });

    expect(store.has(hash)).toBe(false);
    await store.put(typeHash, { x: 1 });
    expect(store.has(hash)).toBe(true);
  });

  test("list returns all stored hashes", async () => {
    const store = createMemoryStore();
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
    const store = createMemoryStore();
    expect(store.list()).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 5: verify()
// ──────────────────────────────────────────────────────────────────────────────
describe("verify", () => {
  test("returns true for a correctly stored node", async () => {
    const store = createMemoryStore();
    const typeHash = await computeSelfHash({ name: "my-type" });
    const hash = await store.put(typeHash, { data: 123 });
    const node = store.get(hash) as CasNode;

    expect(await verify(hash, node)).toBe(true);
  });

  test("returns false when payload is tampered", async () => {
    const store = createMemoryStore();
    const typeHash = await computeSelfHash({ name: "my-type" });
    const hash = await store.put(typeHash, { data: 123 });

    const tampered: CasNode = {
      type: typeHash,
      payload: { data: 999 },
      timestamp: Date.now(),
    };
    expect(await verify(hash, tampered)).toBe(false);
  });

  test("returns false when type is tampered", async () => {
    const store = createMemoryStore();
    const typeHash = await computeSelfHash({ name: "my-type" });
    const hash = await store.put(typeHash, { data: 123 });
    const node = store.get(hash) as CasNode;

    const tampered: CasNode = { ...node, type: "AAAAAAAAAAAAA" };
    expect(await verify(hash, tampered)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 6: bootstrap()
// ──────────────────────────────────────────────────────────────────────────────
describe("bootstrap", () => {
  test("returns a valid 13-char hash", async () => {
    const store = createMemoryStore();
    const hash = await bootstrap(store);
    expect(hash).toHaveLength(13);
    expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("node is stored and retrievable", async () => {
    const store = createMemoryStore();
    const hash = await bootstrap(store);

    expect(store.has(hash)).toBe(true);
    const node = store.get(hash);
    expect(node).not.toBeNull();
  });

  test("node is self-referencing: type === hash", async () => {
    const store = createMemoryStore();
    const hash = await bootstrap(store);
    const node = store.get(hash) as CasNode;

    expect(node.type).toBe(hash);
  });

  test("bootstrap node passes verify()", async () => {
    const store = createMemoryStore();
    const hash = await bootstrap(store);
    const node = store.get(hash) as CasNode;

    expect(await verify(hash, node)).toBe(true);
  });

  test("bootstrap is idempotent: same hash on repeated calls", async () => {
    const store = createMemoryStore();
    const h1 = await bootstrap(store);
    const h2 = await bootstrap(store);

    expect(h1).toBe(h2);
    expect(store.list()).toHaveLength(1);
  });
});
