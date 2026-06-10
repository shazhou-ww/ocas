import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash } from "@ocas/core";
import { bootstrap, putSchema } from "@ocas/core";
import { openStore as openFsStore } from "@ocas/fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { envValue, runCli } from "./helpers";

let tmpStore: string;
let rootHash: string;
let leafHash: string;
let refSchema: string;
let leafSchema: string;
let metaHash: string;

beforeAll(async () => {
  tmpStore = mkdtempSync(join(tmpdir(), "ocas-walk-follow-type-"));

  const store = await openFsStore(tmpStore);
  const aliases = bootstrap(store);
  metaHash = aliases["@ocas/schema"] as string;

  // Create schemas
  leafSchema = putSchema(store, {
    type: "object",
    properties: { val: { type: "number" } },
  });
  refSchema = putSchema(store, {
    type: "object",
    properties: {
      next: { type: "string", format: "ocas_ref" },
      val: { type: "number" },
    },
  });

  // Create data nodes
  const leafFile = join(tmpStore, "leaf.json");
  writeFileSync(leafFile, JSON.stringify({ val: 99 }));
  leafHash = store.cas.put(leafSchema as Hash, { val: 99 });

  const rootFile = join(tmpStore, "root.json");
  writeFileSync(rootFile, JSON.stringify({ next: leafHash, val: 1 }));
  rootHash = store.cas.put(refSchema as Hash, { next: leafHash, val: 1 });
});

afterAll(() => {
  rmSync(tmpStore, { recursive: true, force: true });
});

describe("ocas walk --follow-type (#135)", () => {
  test("default (no --follow-type): excludes schema chain from output", () => {
    const { stdout, exitCode } = runCli(["walk", rootHash], tmpStore);
    expect(exitCode).toBe(0);

    const hashes = envValue(stdout) as string[];
    expect(hashes).toContain(rootHash);
    expect(hashes).toContain(leafHash);
    expect(hashes).not.toContain(refSchema);
    expect(hashes).not.toContain(leafSchema);
    expect(hashes).not.toContain(metaHash);
  });

  test("default walk output is exactly [rootHash, leafHash]", () => {
    const { stdout, exitCode } = runCli(["walk", rootHash], tmpStore);
    expect(exitCode).toBe(0);

    const hashes = envValue(stdout) as string[];
    expect(hashes).toHaveLength(2);
    expect(hashes).toContain(rootHash);
    expect(hashes).toContain(leafHash);
  });

  test("--follow-type: includes the full schema chain", () => {
    const { stdout, exitCode } = runCli(
      ["walk", rootHash, "--follow-type"],
      tmpStore,
    );
    expect(exitCode).toBe(0);

    const hashes = envValue(stdout) as string[];
    expect(hashes).toContain(rootHash);
    expect(hashes).toContain(leafHash);
    expect(hashes).toContain(refSchema);
    expect(hashes).toContain(leafSchema);
    expect(hashes).toContain(metaHash);
  });

  test("--format tree without --follow-type: only data nodes", () => {
    const { stdout, exitCode } = runCli(
      ["walk", rootHash, "--format", "tree"],
      tmpStore,
    );
    expect(exitCode).toBe(0);

    const output = envValue(stdout) as string;
    expect(output).toContain(rootHash);
    expect(output).toContain(leafHash);
    expect(output).not.toContain(refSchema);
    expect(output).not.toContain(leafSchema);
    expect(output).not.toContain(metaHash);
  });

  test("--format tree --follow-type: includes schema nodes", () => {
    const { stdout, exitCode } = runCli(
      ["walk", rootHash, "--format", "tree", "--follow-type"],
      tmpStore,
    );
    expect(exitCode).toBe(0);

    const output = envValue(stdout) as string;
    expect(output).toContain(rootHash);
    expect(output).toContain(leafHash);
    expect(output).toContain(refSchema);
    expect(output).toContain(leafSchema);
  });
});
