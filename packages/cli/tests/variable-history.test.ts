import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash, Store } from "@ocas/core";
import { bootstrap } from "@ocas/core";
import { openStore as openFsStore } from "@ocas/fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let testDir: string;
let storePath: string;
let cliPath: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `ocas-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  storePath = join(testDir, "store");
  cliPath = join(import.meta.dirname, "../dist/index.js");

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

function runCli(...rawArgs: (string | string[])[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const args = rawArgs.flat();
  try {
    const stdout = execFileSync(
      "node",
      [cliPath, "--home", storePath, ...args],
      {
        encoding: "utf-8",
        timeout: 10000,
      },
    );
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? "").trim(),
      exitCode: err.status ?? 1,
    };
  }
}

async function setupSchemaAndValues(): Promise<{
  schema: Hash;
  values: Hash[];
}> {
  const store: Store = await openFsStore(storePath);
  const aliases = bootstrap(store);
  const numberHash = aliases["@ocas/number"] as Hash;
  const values: Hash[] = [];
  for (let i = 0; i < 4; i++) {
    values.push(store.cas.put(numberHash, i) as Hash);
  }
  return { schema: numberHash, values };
}

describe("var history", () => {
  test("returns single entry after first set", async () => {
    const { schema, values } = await setupSchemaAndValues();
    const v1 = values[0] as Hash;

    let r = await runCli("var", "set", "@test/x", v1);
    expect(r.exitCode).toBe(0);

    r = await runCli("var", "history", "@test/x", "--schema", schema);
    expect(r.exitCode).toBe(0);
    const envelope = JSON.parse(r.stdout);
    expect(envelope.value.name).toBe("@test/x");
    expect(envelope.value.schema).toBe(schema);
    expect(envelope.value.values).toEqual([v1]);
  });

  test("history grows with new sets, current is index 0", async () => {
    const { schema, values } = await setupSchemaAndValues();
    const [v1, v2, v3] = values as [Hash, Hash, Hash, Hash];

    await runCli("var", "set", "@test/x", v1);
    await runCli("var", "set", "@test/x", v2);
    await runCli("var", "set", "@test/x", v3);

    const r = await runCli("var", "history", "@test/x", "--schema", schema);
    expect(r.exitCode).toBe(0);
    const envelope = JSON.parse(r.stdout);
    expect(envelope.value.values).toEqual([v3, v2, v1]);
  });

  test("history works without --schema when only one variant", async () => {
    const { schema: _schema, values } = await setupSchemaAndValues();
    const [v1, v2] = values as [Hash, Hash, Hash, Hash];

    await runCli("var", "set", "@test/x", v1);
    await runCli("var", "set", "@test/x", v2);

    const r = await runCli("var", "history", "@test/x");
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
