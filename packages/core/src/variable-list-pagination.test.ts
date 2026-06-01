import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "./bootstrap.js";
import { createMemoryStore } from "./store.js";
import type { Hash } from "./types.js";
import { createVariableStore, type VariableStore } from "./variable-store.js";

let dbDir: string;
let dbPath: string;
let casStore: ReturnType<typeof createMemoryStore>;
let varStore: VariableStore;
let stringHash: Hash;

beforeEach(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "ocas-var-pagination-"));
  dbPath = join(dbDir, "vars.db");
  casStore = createMemoryStore();
  const aliases = await bootstrap(casStore);
  stringHash = aliases["@ocas/string"] as Hash;
  varStore = createVariableStore(dbPath, casStore);
});

afterEach(() => {
  varStore.close();
  rmSync(dbDir, { recursive: true, force: true });
});

async function setN(prefix: string, n: number, delayMs = 2): Promise<Hash[]> {
  const hashes: Hash[] = [];
  for (let i = 0; i < n; i++) {
    const h = await casStore.put(stringHash, `${prefix}-${i}`);
    varStore.set(`${prefix}-${i}`, h);
    hashes.push(h);
    if (delayMs > 0 && i < n - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return hashes;
}

describe("VariableStore.list - pagination + sort", () => {
  test("D1. default sort = created ASC", async () => {
    await setN("v", 3);
    const list = varStore.list({ namePrefix: "v-" });
    for (let i = 1; i < list.length; i++) {
      expect((list[i] as { created: number }).created).toBeGreaterThanOrEqual(
        (list[i - 1] as { created: number }).created,
      );
    }
  });

  test("D2. sort: 'updated' differs after re-set", async () => {
    await setN("u", 3);
    await new Promise((r) => setTimeout(r, 5));
    // Re-set u-0 with a NEW value so updated changes
    const newHash = await casStore.put(stringHash, "u-0-new");
    varStore.set("u-0", newHash);

    const byUpdated = varStore.list({
      namePrefix: "u-",
      sort: "updated",
    });
    // u-0 should be last when sorted updated ASC
    const last = byUpdated[byUpdated.length - 1] as { name: string };
    expect(last.name).toBe("u-0");
  });

  test("D3. desc reverses both sort modes", async () => {
    await setN("d", 3);
    const asc = varStore.list({ namePrefix: "d-" });
    const desc = varStore.list({ namePrefix: "d-", desc: true });
    expect(desc[0]).toEqual(asc[asc.length - 1] as (typeof asc)[number]);
  });

  test("D4. limit/offset honored", async () => {
    await setN("p", 5);
    expect(varStore.list({ namePrefix: "p-", limit: 2 })).toHaveLength(2);
    expect(
      varStore.list({ namePrefix: "p-", offset: 2, limit: 10 }),
    ).toHaveLength(3);
  });

  test("D5. core has no default limit (returns all)", async () => {
    await setN("big", 105, 0);
    const list = varStore.list({ namePrefix: "big-" });
    expect(list).toHaveLength(105);
  });

  test("D6. pagination applied AFTER namePrefix/schema filters", async () => {
    await setN("filt", 5);
    const list = varStore.list({
      namePrefix: "filt-",
      schema: stringHash,
      limit: 2,
    });
    expect(list).toHaveLength(2);
    for (const v of list) {
      expect((v as { name: string }).name.startsWith("filt-")).toBe(true);
    }
  });

  test("limit: 0 returns empty array", async () => {
    await setN("z", 3, 0);
    expect(varStore.list({ namePrefix: "z-", limit: 0 })).toEqual([]);
  });
});
