import { describe, expect, test } from "bun:test";
import { BOOTSTRAP_STORE } from "./bootstrap-capable.js";
import { createMemoryStore } from "./store.js";

const HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/;

async function putN(
  store: ReturnType<typeof createMemoryStore>,
  type: string,
  n: number,
  delayMs = 2,
): Promise<string[]> {
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) {
    hashes.push(await store.put(type, { i }));
    if (delayMs > 0 && i < n - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return hashes;
}

describe("listByType - pagination + sort + timestamps", () => {
  test("A1. returns objects with hash/created/updated", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await putN(store, m, 3, 0);

    const list = store.listByType(m);
    for (const e of list) {
      expect(e.hash).toMatch(HASH_RE);
      expect(typeof e.created).toBe("number");
      expect(typeof e.updated).toBe("number");
      expect(e.created).toBe(e.updated);
    }
  });

  test("A2. default sort is created ASC", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await putN(store, m, 4);

    const list = store.listByType(m);
    for (let i = 1; i < list.length; i++) {
      expect((list[i] as { created: number }).created).toBeGreaterThanOrEqual(
        (list[i - 1] as { created: number }).created,
      );
    }
  });

  test("A3. desc:true reverses order", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await putN(store, m, 4);

    const list = store.listByType(m, { desc: true });
    for (let i = 1; i < list.length; i++) {
      expect((list[i] as { created: number }).created).toBeLessThanOrEqual(
        (list[i - 1] as { created: number }).created,
      );
    }
  });

  test("A4. sort: 'updated' is equivalent to 'created' for CAS nodes", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await putN(store, m, 4);

    const a = store.listByType(m, { sort: "created" });
    const b = store.listByType(m, { sort: "updated" });
    expect(a).toEqual(b);
  });

  test("A5. limit truncates", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await putN(store, m, 5, 0);
    expect(store.listByType(m, { limit: 2 })).toHaveLength(2);
  });

  test("A6. offset skips", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await putN(store, m, 5);

    const all = store.listByType(m);
    const skip = store.listByType(m, { offset: 2, limit: 10 });
    expect(skip).toHaveLength(all.length - 2);
    expect(skip[0]).toEqual(all[2] as (typeof all)[number]);
  });

  test("A7. limit:0 returns empty array", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await putN(store, m, 3, 0);
    expect(store.listByType(m, { limit: 0 })).toEqual([]);
  });

  test("A8. offset past end returns empty array", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await putN(store, m, 3, 0);
    expect(store.listByType(m, { offset: 100 })).toEqual([]);
  });

  test("A9. core has no default limit (returns all)", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await putN(store, m, 150, 0);
    // No CLI-layer cap; with 150 nodes of type m (plus m itself which is
    // self-typed), the full set is returned.
    expect(store.listByType(m)).toHaveLength(151);
  });

  test("A10. desc + offset + limit combined", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await putN(store, m, 5, 15);
    const all = store.listByType(m);
    const got = store.listByType(m, { desc: true, offset: 1, limit: 2 });
    expect(got).toHaveLength(2);
    // desc order is reverse of `all`; offset 1 + limit 2 → all[n-2], all[n-3]
    const n = all.length;
    expect(got[0]?.hash).toBe(all[n - 2]?.hash as string);
    expect(got[1]?.hash).toBe(all[n - 3]?.hash as string);
  });
});

describe("listMeta / listSchemas - pagination", () => {
  test("B1. listMeta returns {hash,created,updated}", async () => {
    const store = createMemoryStore().cas;
    const h = await store[BOOTSTRAP_STORE]({ type: "object" });
    const list = store.listMeta();
    expect(list).toHaveLength(1);
    const e = list[0] as { hash: string; created: number; updated: number };
    expect(e.hash).toBe(h);
    expect(typeof e.created).toBe("number");
    expect(typeof e.updated).toBe("number");
  });

  test("B2. listMeta has no default limit (returns all)", async () => {
    const store = createMemoryStore().cas;
    for (let i = 0; i < 150; i++) {
      await store[BOOTSTRAP_STORE]({ type: "object", i });
    }
    expect(store.listMeta()).toHaveLength(150);
  });

  test("B3. listMeta limit/offset/desc", async () => {
    const store = createMemoryStore().cas;
    for (let i = 0; i < 5; i++) {
      await store[BOOTSTRAP_STORE]({ type: "object", i });
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(store.listMeta({ limit: 2 })).toHaveLength(2);
    const all = store.listMeta();
    const desc = store.listMeta({ desc: true });
    expect(desc[0]).toEqual(all[all.length - 1] as (typeof all)[number]);
  });

  test("B4. listSchemas returns objects, supports limit", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    await store.put(m, { type: "string" });
    await store.put(m, { type: "number" });

    const list = store.listSchemas();
    for (const e of list) {
      expect(e.hash).toMatch(HASH_RE);
      expect(typeof e.created).toBe("number");
    }
    expect(store.listSchemas({ limit: 1 })).toHaveLength(1);
  });
});

describe("Determinism / edge cases", () => {
  test("I1. same-ms timestamps yield deterministic ordering across calls", async () => {
    const store = createMemoryStore().cas;
    const m = await store[BOOTSTRAP_STORE]({ type: "object" });
    // No delay → likely same millisecond
    await putN(store, m, 5, 0);
    const a = store.listByType(m);
    const b = store.listByType(m);
    expect(b).toEqual(a);
  });

  test("I2. empty store returns []", () => {
    const store = createMemoryStore().cas;
    expect(store.listByType("0000000000000")).toEqual([]);
    expect(store.listMeta()).toEqual([]);
    expect(store.listSchemas()).toEqual([]);
  });
});
