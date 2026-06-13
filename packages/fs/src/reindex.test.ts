import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash } from "@ocas/core";
import { bootstrap, putSchema } from "@ocas/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createFsStore } from "./store.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ocas-fs-reindex-"));
}

/** Create a bootstrapped FsCasStore with a test schema and return both. */
function createBootstrappedStore(dir: string) {
  const cas = createFsStore(dir);
  bootstrap({ cas, var: dummyVar(), tag: dummyTag() });
  const typeHash = putSchema(
    { cas, var: dummyVar(), tag: dummyTag() },
    {
      type: "object",
      title: "TestNode",
      properties: { value: { type: "string" } },
    },
  );
  return { cas, typeHash };
}

/** Minimal no-op VarStore for bootstrap (store-level var not needed for CAS). */
function dummyVar() {
  const vars = new Map<
    string,
    { value: Hash; tags: Record<string, string>; labels: string[] }
  >();
  return {
    set(name: string, hash: Hash) {
      vars.set(name, { value: hash, tags: {}, labels: [] });
      return {
        name,
        value: hash,
        schema: null,
        tags: {},
        labels: [],
        position: 0,
        setAt: Date.now(),
      };
    },
    get(name: string) {
      const v = vars.get(name);
      if (!v) return null;
      return {
        name,
        value: v.value,
        schema: null,
        tags: v.tags,
        labels: v.labels,
        position: 0,
        setAt: Date.now(),
      };
    },
    remove() {
      return [];
    },
    list() {
      return [];
    },
    history() {
      return [];
    },
  };
}

function dummyTag() {
  return {
    tag() {
      return true;
    },
    untag() {
      return true;
    },
    list() {
      return [];
    },
  };
}

describe("FsCasStore.reindex()", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reindex on a clean store returns zero removed", () => {
    const { cas, typeHash } = createBootstrappedStore(dir);
    const h1 = cas.put(typeHash, { value: "one" });
    const h2 = cas.put(typeHash, { value: "two" });

    const result = cas.reindex();

    expect(result.rebuilt).toBe(true);
    expect(result.removed).toBe(0);
    expect(result.nodes).toBeGreaterThanOrEqual(3);
    expect(result.types).toBeGreaterThan(0);
    expect(cas.get(h1)).not.toBeNull();
    expect(cas.get(h2)).not.toBeNull();
  });

  test("reindex removes duplicate entries from corrupted index", () => {
    const { cas, typeHash } = createBootstrappedStore(dir);
    const h1 = cas.put(typeHash, { value: "one" });
    const h2 = cas.put(typeHash, { value: "two" });

    // Corrupt the index file by adding duplicate lines
    const indexPath = join(dir, "_index", typeHash);
    const content = readFileSync(indexPath, "utf8");
    writeFileSync(indexPath, `${content}${h1}\n${h1}\n${h2}\n`, "utf8");

    // Re-open to pick up corruption in memory
    const cas2 = createFsStore(dir);
    const result = cas2.reindex();

    expect(result.rebuilt).toBe(true);
    expect(result.removed).toBeGreaterThan(0);
    // After reindex, no duplicates
    const listed = cas2.listByType(typeHash);
    const hashes = listed.map((e) => e.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  test("reindex removes stale entries pointing to deleted nodes", () => {
    const { cas, typeHash } = createBootstrappedStore(dir);
    const h1 = cas.put(typeHash, { value: "one" });
    const h2 = cas.put(typeHash, { value: "two" });

    // Delete h1's .bin file manually to simulate corruption
    try {
      rmSync(join(dir, "nodes", `${h1}.bin`));
    } catch {
      // ignore
    }

    // Re-open — stale h1 in index but no .bin on disk
    const cas2 = createFsStore(dir);
    const result = cas2.reindex();

    expect(result.rebuilt).toBe(true);
    const listed = cas2.listByType(typeHash);
    const hashes = listed.map((e) => e.hash);
    expect(hashes).not.toContain(h1);
    expect(hashes).toContain(h2);
  });

  test("reindex on empty store works", () => {
    const cas = createFsStore(dir);
    const result = cas.reindex();

    expect(result.rebuilt).toBe(true);
    expect(result.nodes).toBe(0);
    expect(result.types).toBe(0);
    expect(result.removed).toBe(0);
  });

  test("reindex preserves all data integrity", () => {
    const { cas, typeHash } = createBootstrappedStore(dir);
    const h1 = cas.put(typeHash, { value: "alpha" });
    const h2 = cas.put(typeHash, { value: "beta" });
    const h3 = cas.put(typeHash, { value: "gamma" });

    const beforeNodes = cas.listAll().sort();
    cas.reindex();
    const afterNodes = cas.listAll().sort();

    expect(afterNodes).toEqual(beforeNodes);
    expect(cas.get(h1)).not.toBeNull();
    expect(cas.get(h2)).not.toBeNull();
    expect(cas.get(h3)).not.toBeNull();
  });
});
