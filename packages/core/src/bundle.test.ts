import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { bootstrap } from "./bootstrap.js";
import { exportBundle, importBundle, loadBundleStore } from "./bundle.js";
import { cborEncode } from "./cbor.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ocas-bundle-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("exportBundle / importBundle / loadBundleStore", () => {
  test("2.1 export: tar file structure includes cas/, vars.jsonl, tags.jsonl", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schemaHash = putSchema(store, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const aHash = store.cas.put(schemaHash, { x: 42 });
    store.var.set("@test/config", aHash);
    store.tag.tag(aHash, [{ op: "set", key: "env", value: "prod" }]);

    const out = join(tmpDir, "bundle.tar");
    const stats = await exportBundle(store, ["@test/config"], out);

    const buf = readFileSync(out);
    // Standard tar should have 512-byte aligned blocks.
    expect(buf.length % 512).toBe(0);

    // Parse out the entry names from the tar.
    const names = listTarEntries(buf);
    expect(names.some((n) => n === `cas/${aHash}.bin`)).toBe(true);
    expect(names.some((n) => n === `cas/${schemaHash}.bin`)).toBe(true);
    expect(names).toContain("vars.jsonl");
    expect(names).toContain("tags.jsonl");

    expect(stats.nodes).toBeGreaterThanOrEqual(2);
    expect(stats.vars).toBeGreaterThanOrEqual(1);
    expect(stats.tags).toBeGreaterThanOrEqual(1);
  });

  test("2.2 export: CAS node binary identity is preserved", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schemaHash = putSchema(store, { type: "string" });
    const aHash = store.cas.put(schemaHash, "hello");
    store.var.set("@test/h", aHash);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(store, ["@test/h"], out);

    const buf = readFileSync(out);
    const entries = readTarEntries(buf);
    const casEntry = entries.find((e) => e.name === `cas/${aHash}.bin`);
    expect(casEntry).toBeDefined();

    const node = store.cas.get(aHash);
    expect(node).not.toBeNull();
    if (!node) return;
    const expected = cborEncode({
      type: node.type,
      payload: node.payload,
      timestamp: node.timestamp,
    });
    expect(casEntry?.content).toEqual(expected);
  });

  test("2.3 export: vars.jsonl contains parseable JSON lines", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schemaHash = putSchema(store, { type: "string" });
    const aHash = store.cas.put(schemaHash, "a");
    const bHash = store.cas.put(schemaHash, "b");
    store.var.set("@test/a", aHash);
    store.var.set("@test/b", bHash);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(store, ["@test/a", "@test/b"], out);

    const entries = readTarEntries(readFileSync(out));
    const vars = entries.find((e) => e.name === "vars.jsonl");
    expect(vars).toBeDefined();
    const text = new TextDecoder().decode(vars?.content);
    const lines = text.split("\n").filter((l) => l.length > 0);
    const records = lines.map(
      (l) => JSON.parse(l) as { name: string; value: string },
    );
    const names = records.map((r) => r.name);
    expect(names).toContain("@test/a");
    expect(names).toContain("@test/b");
    const aRec = records.find((r) => r.name === "@test/a");
    expect(aRec?.value).toBe(aHash);
  });

  test("2.4 export: tags.jsonl contains target/key/value records", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schemaHash = putSchema(store, { type: "string" });
    const aHash = store.cas.put(schemaHash, "tagged");
    store.var.set("@test/t", aHash);
    store.tag.tag(aHash, [
      { op: "set", key: "env", value: "prod" },
      { op: "set", key: "stable" },
    ]);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(store, ["@test/t"], out);

    const entries = readTarEntries(readFileSync(out));
    const tagEntry = entries.find((e) => e.name === "tags.jsonl");
    expect(tagEntry).toBeDefined();
    const text = new TextDecoder().decode(tagEntry?.content);
    const lines = text.split("\n").filter((l) => l.length > 0);
    const records = lines.map(
      (l) =>
        JSON.parse(l) as {
          target: string;
          key: string;
          value: string | null;
        },
    );
    const env = records.find((r) => r.key === "env");
    expect(env?.value).toBe("prod");
    expect(env?.target).toBe(aHash);
    const stable = records.find((r) => r.key === "stable");
    expect(stable?.value).toBeNull();
  });

  test("2.5 export: accepts variable names and raw hashes as roots", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    const schemaHash = putSchema(store, { type: "string" });
    const aHash = store.cas.put(schemaHash, "x");
    store.var.set("@test/c", aHash);

    const out1 = join(tmpDir, "by-name.tar");
    const out2 = join(tmpDir, "by-hash.tar");
    await exportBundle(store, ["@test/c"], out1);
    await exportBundle(store, [aHash], out2);

    const names1 = listTarEntries(readFileSync(out1));
    const names2 = listTarEntries(readFileSync(out2));
    expect(names1).toContain(`cas/${aHash}.bin`);
    expect(names2).toContain(`cas/${aHash}.bin`);
  });

  test("2.6 export: non-existent root throws", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const out = join(tmpDir, "bundle.tar");
    await expect(
      exportBundle(store, ["@test/nonexistent"], out),
    ).rejects.toThrow();
  });

  test("2.7 import: nodes are written to target store", async () => {
    const src = createMemoryStore();
    bootstrap(src);
    const schemaHash = putSchema(src, {
      type: "object",
      properties: { x: { type: "number" } },
    });
    const aHash = src.cas.put(schemaHash, { x: 1 });
    src.var.set("@test/c", aHash);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(src, ["@test/c"], out);

    const dst = createMemoryStore();
    bootstrap(dst);
    await importBundle(out, dst);

    expect(dst.cas.has(aHash)).toBe(true);
    const node = dst.cas.get(aHash);
    expect(node?.type).toBe(schemaHash);
    expect(node?.payload).toEqual({ x: 1 });
  });

  test("2.8 import: skip existing nodes (content-addressed dedup)", async () => {
    const src = createMemoryStore();
    bootstrap(src);
    const schemaHash = putSchema(src, { type: "string" });
    const aHash = src.cas.put(schemaHash, "a");
    src.var.set("@test/c", aHash);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(src, ["@test/c"], out);

    const dst = createMemoryStore();
    bootstrap(dst);
    // Pre-populate destination with the same node
    dst.cas.put(schemaHash, "a"); // wait — schemaHash may not exist in dst
    // To deduplicate, we need to ensure the same hash is computed.
    // Re-import the schema first via import.
    const stats = await importBundle(out, dst);

    // After two imports the second's nodes.skipped should equal nodes.imported of the first.
    const stats2 = await importBundle(out, dst);
    expect(stats2.nodes.skipped).toBeGreaterThan(0);
    expect(stats2.nodes.imported).toBe(0);
    void stats;
  });

  test("2.9 import: variables created without scope use original names", async () => {
    const src = createMemoryStore();
    bootstrap(src);
    const schemaHash = putSchema(src, { type: "string" });
    const aHash = src.cas.put(schemaHash, "v");
    src.var.set("@test/config", aHash);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(src, ["@test/config"], out);

    const dst = createMemoryStore();
    bootstrap(dst);
    await importBundle(out, dst);

    const v = dst.var.get("@test/config");
    expect(v?.value).toBe(aHash);
  });

  test("2.10 import: scope remapping rewrites variable names", async () => {
    const src = createMemoryStore();
    bootstrap(src);
    const schemaHash = putSchema(src, { type: "string" });
    const aHash = src.cas.put(schemaHash, "v");
    src.var.set("@test/config", aHash);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(src, ["@test/config"], out);

    const dst = createMemoryStore();
    bootstrap(dst);
    await importBundle(out, dst, { scope: "@imported" });

    const remapped = dst.var.get("@imported/config");
    expect(remapped?.value).toBe(aHash);
    const original = dst.var.get("@test/config");
    expect(original).toBeNull();
  });

  test("2.11 import: @ocas/* builtin variables are NOT remapped", async () => {
    const src = createMemoryStore();
    bootstrap(src);
    const schemaHash = putSchema(src, { type: "string" });
    const aHash = src.cas.put(schemaHash, "v");
    src.var.set("@test/config", aHash);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(src, ["@test/config"], out);

    const dst = createMemoryStore();
    bootstrap(dst);
    await importBundle(out, dst, { scope: "@imported" });

    // @ocas/schema, @ocas/string etc. should still be reachable as-is.
    expect(dst.var.get("@ocas/schema")).not.toBeNull();
    // No variant under the remapped scope.
    expect(dst.var.get("@imported/schema")).toBeNull();
  });

  test("2.12 import: variable conflict — overwrite with stats marking 'updated'", async () => {
    const src = createMemoryStore();
    bootstrap(src);
    const schemaHash = putSchema(src, { type: "string" });
    const aHash = src.cas.put(schemaHash, "imported");
    src.var.set("@test/config", aHash);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(src, ["@test/config"], out);

    const dst = createMemoryStore();
    bootstrap(dst);
    // Pre-populate destination with same name → different value.
    const dstSchema = putSchema(dst, { type: "string" });
    const bHash = dst.cas.put(dstSchema, "preexisting");
    dst.var.set("@test/config", bHash);

    const stats = await importBundle(out, dst);
    expect(stats.vars.updated).toBeGreaterThanOrEqual(1);
    // Value should now point at the imported hash.
    const v = dst.var.get("@test/config", schemaHash);
    expect(v?.value).toBe(aHash);
  });

  test("2.13 import: tags are applied to imported nodes", async () => {
    const src = createMemoryStore();
    bootstrap(src);
    const schemaHash = putSchema(src, { type: "string" });
    const aHash = src.cas.put(schemaHash, "tagged");
    src.var.set("@test/c", aHash);
    src.tag.tag(aHash, [{ op: "set", key: "env", value: "prod" }]);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(src, ["@test/c"], out);

    const dst = createMemoryStore();
    bootstrap(dst);
    await importBundle(out, dst);

    const tags = dst.tag.tags(aHash);
    expect(tags.some((t) => t.key === "env" && t.value === "prod")).toBe(true);
  });

  test("2.14 import: stats report nodes/vars/tags counts", async () => {
    const src = createMemoryStore();
    bootstrap(src);
    const schemaHash = putSchema(src, { type: "string" });
    const aHash = src.cas.put(schemaHash, "v");
    src.var.set("@test/c", aHash);
    src.tag.tag(aHash, [{ op: "set", key: "env", value: "prod" }]);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(src, ["@test/c"], out);

    const dst = createMemoryStore();
    bootstrap(dst);
    const stats = await importBundle(out, dst);

    expect(stats.nodes.imported).toBeGreaterThan(0);
    expect(stats.nodes.skipped).toBeGreaterThanOrEqual(0);
    expect(stats.vars.created + stats.vars.updated).toBeGreaterThan(0);
    expect(stats.tags).toBeGreaterThanOrEqual(1);
  });

  test("2.15 loadBundleStore: read-only Store from tar", async () => {
    const src = createMemoryStore();
    bootstrap(src);
    const schemaHash = putSchema(src, { type: "string" });
    const aHash = src.cas.put(schemaHash, "v");
    src.var.set("@test/config", aHash);
    src.tag.tag(aHash, [{ op: "set", key: "env", value: "prod" }]);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(src, ["@test/config"], out);

    const bundleStore = await loadBundleStore(out);
    expect(bundleStore.cas.get(aHash)).not.toBeNull();
    expect(bundleStore.cas.has(aHash)).toBe(true);
    const v = bundleStore.var.get("@test/config");
    expect(v?.value).toBe(aHash);
    const tags = bundleStore.tag.tags(aHash);
    expect(tags.some((t) => t.key === "env" && t.value === "prod")).toBe(true);
  });

  test("2.16 loadBundleStore: walk works against bundle store", async () => {
    const src = createMemoryStore();
    bootstrap(src);
    const refSchema = putSchema(src, {
      type: "object",
      properties: { next: { type: "string", format: "ocas_ref" } },
    });
    const stringSchema = putSchema(src, { type: "string" });
    const bHash = src.cas.put(stringSchema, "b-content");
    const aHash = src.cas.put(refSchema, { next: bHash });
    src.var.set("@test/root", aHash);

    const out = join(tmpDir, "bundle.tar");
    await exportBundle(src, ["@test/root"], out);

    const bundleStore = await loadBundleStore(out);
    const { walk } = await import("./schema.js");
    const visited: string[] = [];
    walk(bundleStore, aHash, (h) => visited.push(h));
    expect(visited).toContain(aHash);
    expect(visited).toContain(bHash);
  });
});

// ---- Tar parser (minimal POSIX/ustar reader) used by tests ----

type TarEntry = { name: string; content: Uint8Array };

function readTarEntries(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    // End-of-archive: two consecutive zero blocks.
    if (header.every((b) => b === 0)) break;

    const name = readCString(header, 0, 100);
    const sizeStr = readCString(header, 124, 12).trim();
    const size = sizeStr === "" ? 0 : parseInt(sizeStr, 8);

    offset += 512;
    const content = buf.subarray(offset, offset + size);
    entries.push({ name, content: new Uint8Array(content) });
    // Pad to 512-byte boundary.
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

function listTarEntries(buf: Buffer): string[] {
  return readTarEntries(buf).map((e) => e.name);
}

function readCString(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  let end = slice.length;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) {
      end = i;
      break;
    }
  }
  return slice.subarray(0, end).toString("utf8");
}

// Suppress unused import warnings.
void writeFileSync;
