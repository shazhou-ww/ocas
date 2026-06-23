import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash, TagStore, VarStore } from "@ocas/core";
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
function dummyVar(): VarStore {
  const vars = new Map<
    string,
    {
      value: Hash;
      tags: Record<string, string>;
      labels: string[];
      created: number;
      updated: number;
    }
  >();
  return {
    set(name: string, hash: Hash) {
      const now = Date.now();
      vars.set(name, {
        value: hash,
        tags: {},
        labels: [],
        created: now,
        updated: now,
      });
      return {
        name,
        value: hash,
        schema: "0000000000000",
        created: now,
        updated: now,
        tags: {},
        labels: [],
      };
    },
    get(name: string) {
      const v = vars.get(name);
      if (!v) return null;
      return {
        name,
        value: v.value,
        schema: "0000000000000",
        created: v.created,
        updated: v.updated,
        tags: v.tags,
        labels: v.labels,
      };
    },
    remove() {
      return [];
    },
    update(name: string, hash: Hash) {
      return this.set(name, hash);
    },
    list() {
      return [];
    },
    history() {
      return [];
    },
    close() {},
  };
}

function dummyTag(): TagStore {
  const byTarget = new Map<
    Hash,
    Array<{ key: string; value: string | null; created: number }>
  >();
  return {
    tag(target: Hash, operations) {
      const now = Date.now();
      const current = [...(byTarget.get(target) ?? [])];
      for (const op of operations) {
        if (op.op === "delete") {
          const next = current.filter((t) => t.key !== op.key);
          byTarget.set(target, next);
          continue;
        }
        const existingIndex = current.findIndex((t) => t.key === op.key);
        const nextTag = {
          key: op.key,
          value: op.value ?? null,
          created: now,
        };
        if (existingIndex >= 0) {
          current[existingIndex] = nextTag;
        } else {
          current.push(nextTag);
        }
      }
      byTarget.set(target, current);
      return current.map((t) => ({
        key: t.key,
        value: t.value,
        created: t.created,
        target,
      }));
    },
    untag(target: Hash, keys: string[]) {
      const current = byTarget.get(target) ?? [];
      byTarget.set(
        target,
        current.filter((t) => !keys.includes(t.key)),
      );
    },
    tags(target: Hash) {
      return (byTarget.get(target) ?? []).map((t) => ({
        key: t.key,
        value: t.value,
        created: t.created,
        target,
      }));
    },
    listByTag(tag: string) {
      const [key, value] = tag.includes(":")
        ? (tag.split(":", 2) as [string, string])
        : [tag, null];
      const result: Hash[] = [];
      for (const [target, tags] of byTarget.entries()) {
        const has = tags.some(
          (t) => t.key === key && (value === null || t.value === value),
        );
        if (has) result.push(target);
      }
      return result;
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
