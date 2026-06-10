import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, computeSelfHash } from "@ocas/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createFsStore, openStore } from "./store.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ocas-fs-dedup-"));
}

function readIndexLines(dir: string, typeHash: string): string[] {
  const path = join(dir, "_index", typeHash);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
}

// ──────────────────────────────────────────────────────────────────────────────
// Test group 1 — appendToTypeIndex dedup at the source
// ──────────────────────────────────────────────────────────────────────────────
describe("type-index dedup – append-side", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("T1.1 putting the same (typeHash, payload) twice does not duplicate the index line", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t" });
    const h1 = store.put(typeHash, { x: 1 });
    const h2 = store.put(typeHash, { x: 1 });
    expect(h1).toBe(h2);

    const lines = readIndexLines(dir, typeHash);
    expect(lines).toEqual([h1]);
    expect(lines.length).toBe(new Set(lines).size);
  });

  test("T1.2 calling bootstrap twice does not append duplicate entries", async () => {
    const store = await openStore(dir);
    const schemas = bootstrap(store);

    // Re-bootstrap explicitly. The first bootstrap was implicit during openStore.
    bootstrap(store);

    const schemaHash = schemas["@ocas/schema"] as string;
    const lines = readIndexLines(dir, schemaHash);
    // No duplicates.
    expect(lines.length).toBe(new Set(lines).size);
    // listByType should also report unique entries only.
    const list = store.cas.listByType(schemaHash).map((e) => e.hash);
    expect(list.length).toBe(new Set(list).size);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Test group 2 — delete() must rewrite the index file even when node is undecodable
// ──────────────────────────────────────────────────────────────────────────────
describe("type-index dedup – delete-side", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("T2.1 deleting a hash whose .bin file is missing still rewrites the index file", async () => {
    const store1 = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t-21" });
    const h = store1.put(typeHash, { x: 1 });

    // Remove the .bin behind the back of the store.
    unlinkSync(join(dir, "nodes", `${h}.bin`));

    // Re-open: cache is empty, node cannot be decoded.
    const store2 = createFsStore(dir);
    const removed = store2.delete(h);
    expect(removed).toBe(true);

    const lines = readIndexLines(dir, typeHash);
    expect(lines).not.toContain(h);
  });

  test("T2.2 deleting a hash whose .bin is corrupted still rewrites the index file", async () => {
    const store1 = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t-22" });
    const h = store1.put(typeHash, { x: 1 });

    // Corrupt the .bin file with garbage bytes.
    writeFileSync(
      join(dir, "nodes", `${h}.bin`),
      Buffer.from([0xff, 0xfe, 0xfd, 0xfc]),
    );

    // Re-open: loadNode(h) will return null due to decode failure.
    const store2 = createFsStore(dir);
    const removed = store2.delete(h);
    expect(removed).toBe(true);

    const lines = readIndexLines(dir, typeHash);
    expect(lines).not.toContain(h);
  });

  test("T2.3 gc-style delete + reopen + rebootstrap cycle does not leak stale entries", async () => {
    const store1 = await openStore(dir);
    const schemas = bootstrap(store1);
    const schemaHash = schemas["@ocas/schema"] as string;
    const stringSchemaHash = schemas["@ocas/string"] as string;

    // Delete one schema entry; the node file may or may not be present.
    store1.cas.delete(stringSchemaHash);

    // Re-open: bootstrap re-puts the deleted schema.
    const store2 = await openStore(dir);

    const list = store2.cas.listByType(schemaHash).map((e) => e.hash);
    expect(list.length).toBe(new Set(list).size);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Test group 3 — loadTypeIndex defensive dedup on read
// ──────────────────────────────────────────────────────────────────────────────
describe("type-index dedup – load-side defensive dedup", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("T3.1 corrupted index file with duplicate lines is deduped at load time", async () => {
    const store1 = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t-31" });
    const h = store1.put(typeHash, { x: 1 });

    // Manually corrupt the index file: write three duplicate lines.
    writeFileSync(join(dir, "_index", typeHash), `${h}\n${h}\n${h}\n`, "utf8");

    const store2 = createFsStore(dir);
    const list = store2.listByType(typeHash).map((e) => e.hash);
    expect(list).toEqual([h]);
  });

  test("T3.2 mixed duplicates with unique entries are deduped while preserving insertion order", async () => {
    const store1 = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t-32" });
    const h1 = store1.put(typeHash, { x: 1 });
    const h2 = store1.put(typeHash, { x: 2 });

    // Corrupt: h1, h2, h1, h2, h1
    writeFileSync(
      join(dir, "_index", typeHash),
      `${h1}\n${h2}\n${h1}\n${h2}\n${h1}\n`,
      "utf8",
    );

    // After load, the in-memory list should be deduped to [h1, h2] in
    // insertion order. listByType applies a default created-asc sort with
    // hash tiebreaker, so we can't rely on it for order. Instead, verify
    // the dedup via listByType length, and confirm the on-disk file is
    // rewritten to a deduped form when the next mutation runs.
    const store2 = createFsStore(dir);
    const list = store2.listByType(typeHash).map((e) => e.hash);
    expect(list).toHaveLength(2);
    expect(list).toContain(h1);
    expect(list).toContain(h2);

    // Trigger a delete to force a rewrite of the index file, then assert
    // the file is deduped.
    const h3 = store2.put(typeHash, { x: 3 });
    store2.delete(h3);
    const onDisk = readIndexLines(dir, typeHash);
    expect(onDisk).toHaveLength(2);
    expect(onDisk[0]).toBe(h1);
    expect(onDisk[1]).toBe(h2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Test group 4 — repro of the original bug from issue #116
// ──────────────────────────────────────────────────────────────────────────────
describe("type-index dedup – issue #116 repro", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("T4.1 bootstrap → gc → reopen → bootstrap cycle does not multiply the index", async () => {
    // Initial open + capture schema hashes.
    const initial = await openStore(dir);
    const schemas = bootstrap(initial);
    const schemaHash = schemas["@ocas/schema"] as string;
    const stringHash = schemas["@ocas/string"] as string;

    // Loop: delete one bootstrap hash then reopen (which re-bootstraps).
    for (let i = 0; i < 5; i++) {
      const s = await openStore(dir);
      s.cas.delete(stringHash);
    }

    // Final open: assert no duplicates anywhere.
    const final = await openStore(dir);
    for (const name of [
      "@ocas/schema",
      "@ocas/string",
      "@ocas/number",
      "@ocas/object",
      "@ocas/array",
      "@ocas/bool",
    ]) {
      const t = schemas[name] as string;
      const list = final.cas.listByType(t).map((e) => e.hash);
      expect(list.length).toBe(new Set(list).size);
    }
    // schemaHash list contains itself once, plus all derived schemas once.
    const schemaList = final.cas.listByType(schemaHash).map((e) => e.hash);
    expect(schemaList.length).toBe(new Set(schemaList).size);
  });

  test("T4.2 reopens of a non-empty store keep the index file at exactly one line per put", async () => {
    const typeHash = await computeSelfHash({ name: "t-42" });

    const store1 = createFsStore(dir);
    const h = store1.put(typeHash, { x: 1 });

    for (let i = 0; i < 10; i++) {
      const _s = createFsStore(dir);
      // Trigger no-op put with same payload to exercise the append path.
      _s.put(typeHash, { x: 1 });
    }

    const lines = readIndexLines(dir, typeHash);
    expect(lines).toEqual([h]);
  });

  test("T4.3 listByType count matches unique disk lines after multiple reopens", async () => {
    const typeHash = await computeSelfHash({ name: "t-43" });

    const store1 = createFsStore(dir);
    const h = store1.put(typeHash, { x: 1 });

    for (let i = 0; i < 5; i++) {
      const s = createFsStore(dir);
      s.put(typeHash, { x: 1 });
    }

    const lines = readIndexLines(dir, typeHash);
    const final = createFsStore(dir);
    const list = final.listByType(typeHash).map((e) => e.hash);

    expect(list).toEqual([h]);
    expect(lines).toEqual([h]);
    expect(list.length).toBe(lines.length);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Test group 5 — invariants that must continue to hold
// ──────────────────────────────────────────────────────────────────────────────
describe("type-index dedup – invariants", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("T5.2 listMeta and listSchemas are not duplicated across multiple reopens", async () => {
    // Open + bootstrap several times.
    let lastSchemas: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      const s = await openStore(dir);
      lastSchemas = bootstrap(s);
    }

    const final = await openStore(dir);
    const meta = final.cas.listMeta().map((e) => e.hash);
    expect(meta.length).toBe(new Set(meta).size);

    const schemaHashes = final.cas.listSchemas().map((e) => e.hash);
    expect(schemaHashes.length).toBe(new Set(schemaHashes).size);

    // sanity: all builtin schemas present.
    expect(schemaHashes).toContain(lastSchemas["@ocas/schema"] as string);
    expect(schemaHashes).toContain(lastSchemas["@ocas/string"] as string);
  });

  test("T5.3 delete returning false for unknown hash does not rewrite index files", async () => {
    const store = createFsStore(dir);
    const typeHash = await computeSelfHash({ name: "t-53" });
    store.put(typeHash, { x: 1 });

    const before = readFileSync(join(dir, "_index", typeHash), "utf8");
    const removed = store.delete("0000000000000");
    expect(removed).toBe(false);

    const after = readFileSync(join(dir, "_index", typeHash), "utf8");
    expect(after).toBe(before);
  });
});
