import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash, Store } from "@ocas/core";
import { bootstrap } from "@ocas/core";
import { createFsStore } from "@ocas/fs";

let testDir: string;
let storePath: string;
let varDbPath: string;
let cliPath: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `ocas-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  storePath = join(testDir, "store");
  varDbPath = join(testDir, "variables.db");
  cliPath = join(import.meta.dir, "../src/index.ts");

  mkdirSync(testDir, { recursive: true });
  mkdirSync(storePath, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
});

async function runCli(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      cliPath,
      "--home",
      storePath,
      "--var-db",
      varDbPath,
      ...args,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  await proc.exited;

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode: proc.exitCode ?? 0,
  };
}

async function setupSchemaAndValues(): Promise<{
  schema: Hash;
  values: Hash[];
}> {
  const store: Store = createFsStore(storePath);
  const aliases = await bootstrap(store);
  const numberHash = aliases["@ocas/number"] as Hash;
  const values: Hash[] = [];
  for (let i = 0; i < 4; i++) {
    values.push((await store.put(numberHash, i)) as Hash);
  }
  return { schema: numberHash, values };
}

describe("var history", () => {
  test("returns single entry after first set", async () => {
    const { schema, values } = await setupSchemaAndValues();
    const v1 = values[0] as Hash;

    let r = await runCli("var", "set", "x", v1);
    expect(r.exitCode).toBe(0);

    r = await runCli("var", "history", "x", "--schema", schema);
    expect(r.exitCode).toBe(0);
    const envelope = JSON.parse(r.stdout);
    expect(envelope.value.name).toBe("x");
    expect(envelope.value.schema).toBe(schema);
    expect(envelope.value.values).toEqual([v1]);
  });

  test("history grows with new sets, current is index 0", async () => {
    const { schema, values } = await setupSchemaAndValues();
    const [v1, v2, v3] = values as [Hash, Hash, Hash, Hash];

    await runCli("var", "set", "x", v1);
    await runCli("var", "set", "x", v2);
    await runCli("var", "set", "x", v3);

    const r = await runCli("var", "history", "x", "--schema", schema);
    expect(r.exitCode).toBe(0);
    const envelope = JSON.parse(r.stdout);
    expect(envelope.value.values).toEqual([v3, v2, v1]);
  });

  test("history works without --schema when only one variant", async () => {
    const { schema: _schema, values } = await setupSchemaAndValues();
    const [v1, v2] = values as [Hash, Hash, Hash, Hash];

    await runCli("var", "set", "x", v1);
    await runCli("var", "set", "x", v2);

    const r = await runCli("var", "history", "x");
    expect(r.exitCode).toBe(0);
    const envelope = JSON.parse(r.stdout);
    expect(envelope.value.values).toEqual([v2, v1]);
  });

  test("history fails for non-existent variable", async () => {
    const r = await runCli("var", "history", "missing");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Variable not found");
  });
});
