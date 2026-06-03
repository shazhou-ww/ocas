import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;
let storePath: string;
let cliPath: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `ocas-list-tag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    // ignore
  }
});

function runCli(...rawArgs: (string | string[])[]): { stdout: string; stderr: string; exitCode: number } {
  const args = rawArgs.flat();
  try {
    const stdout = execFileSync("node", [cliPath, "--home", storePath, ...args], {
      encoding: "utf-8",
      timeout: 10000,
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (err.stdout ?? "").trim(), stderr: (err.stderr ?? "").trim(), exitCode: err.status ?? 1 };
  }
}

function putString(value: string): string {
  try {
    const out = execFileSync("node", [cliPath, "--home", storePath, "put", "@ocas/string", "--pipe"], {
      input: JSON.stringify(value),
      encoding: "utf-8",
      timeout: 10000,
    });
    return JSON.parse(out.trim()).value as string;
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    throw new Error(`put failed: ${err.stderr ?? ""}`);
  }
}

async function tag(target: string, ...tagSpecs: string[]): Promise<void> {
  const { exitCode, stderr } = await runCli("tag", target, ...tagSpecs);
  if (exitCode !== 0) {
    throw new Error(`tag failed: ${stderr}`);
  }
}

async function varSet(
  name: string,
  hash: string,
  ...tagSpecs: string[]
): Promise<void> {
  const args = ["var", "set", name, hash];
  for (const t of tagSpecs) {
    args.push("--tag", t);
  }
  const { exitCode, stderr } = await runCli(...args);
  if (exitCode !== 0) {
    throw new Error(`var set failed: ${stderr}`);
  }
}

function parseListHashes(stdout: string): string[] {
  const env = JSON.parse(stdout);
  const value = env.value as Array<{ hash: string }>;
  return value.map((e) => e.hash);
}

function parseVarNames(stdout: string): string[] {
  const env = JSON.parse(stdout);
  const value = env.value as Array<{ name: string }>;
  return value.map((v) => v.name);
}

describe("ocas list --tag", () => {
  test("A1. filter by single key-value tag", async () => {
    const n1 = await putString("a1-1");
    const n2 = await putString("a1-2");
    const n3 = await putString("a1-3");
    await tag(n1, "env:prod");
    await tag(n2, "env:prod");
    await tag(n3, "env:staging");

    const { stdout, exitCode } = await runCli(
      "list",
      "--type",
      "@ocas/string",
      "--tag",
      "env:prod",
    );
    expect(exitCode).toBe(0);
    const hashes = parseListHashes(stdout);
    expect(hashes.sort()).toEqual([n1, n2].sort());
  });

  test("A2. filter by single bare label", async () => {
    const n1 = await putString("a2-1");
    const n2 = await putString("a2-2");
    await tag(n1, "featured");

    const { stdout, exitCode } = await runCli(
      "list",
      "--type",
      "@ocas/string",
      "--tag",
      "featured",
    );
    expect(exitCode).toBe(0);
    const hashes = parseListHashes(stdout);
    expect(hashes).toEqual([n1]);
    expect(hashes).not.toContain(n2);
  });

  test("A3. multiple --tag flags = AND", async () => {
    const n1 = await putString("a3-1");
    const n2 = await putString("a3-2");
    const n3 = await putString("a3-3");
    await tag(n1, "env:prod", "tier:gold");
    await tag(n2, "env:prod", "tier:silver");
    await tag(n3, "env:staging", "tier:gold");

    const { stdout, exitCode } = await runCli(
      "list",
      "--type",
      "@ocas/string",
      "--tag",
      "env:prod",
      "--tag",
      "tier:gold",
    );
    expect(exitCode).toBe(0);
    const hashes = parseListHashes(stdout);
    expect(hashes).toEqual([n1]);
  });

  test("A4. mix tag and label (AND)", async () => {
    const n1 = await putString("a4-1");
    const n2 = await putString("a4-2");
    await tag(n1, "env:prod", "featured");
    await tag(n2, "env:prod");

    const { stdout, exitCode } = await runCli(
      "list",
      "--type",
      "@ocas/string",
      "--tag",
      "env:prod",
      "--tag",
      "featured",
    );
    expect(exitCode).toBe(0);
    const hashes = parseListHashes(stdout);
    expect(hashes).toEqual([n1]);
  });

  test("A5. no matching nodes returns empty list", async () => {
    const n1 = await putString("a5-1");
    await tag(n1, "env:prod");

    const { stdout, exitCode } = await runCli(
      "list",
      "--type",
      "@ocas/string",
      "--tag",
      "env:nope",
    );
    expect(exitCode).toBe(0);
    const hashes = parseListHashes(stdout);
    expect(hashes).toEqual([]);
  });

  test("A6. no --tag flag → existing behavior unchanged", async () => {
    const n1 = await putString("a6-1");
    const n2 = await putString("a6-2");

    const { stdout, exitCode } = await runCli("list", "--type", "@ocas/string");
    expect(exitCode).toBe(0);
    const hashes = parseListHashes(stdout);
    expect(hashes).toContain(n1);
    expect(hashes).toContain(n2);
  });

  test("A7. --tag with --limit", async () => {
    const n1 = await putString("a7-1");
    const n2 = await putString("a7-2");
    const n3 = await putString("a7-3");
    await tag(n1, "env:prod");
    await tag(n2, "env:prod");
    await tag(n3, "env:prod");

    const { stdout, exitCode } = await runCli(
      "list",
      "--type",
      "@ocas/string",
      "--tag",
      "env:prod",
      "--limit",
      "2",
    );
    expect(exitCode).toBe(0);
    const hashes = parseListHashes(stdout);
    expect(hashes).toHaveLength(2);
    for (const h of hashes) {
      expect([n1, n2, n3]).toContain(h);
    }
  });

  test("A8. filter restricts to requested type", async () => {
    const n1 = await putString("a8-1");
    await tag(n1, "env:prod");
    // Tag a non-string node (a schema) with the same tag
    // Use @ocas/schema as a known schema-typed node
    const { stdout: schemaListStdout } = await runCli(
      "list-schema",
      "--limit",
      "1000",
    );
    const schemaEntries = JSON.parse(schemaListStdout).value as Array<{
      hash: string;
    }>;
    expect(schemaEntries.length).toBeGreaterThan(0);
    const otherTypeHash = schemaEntries[0]!.hash;
    await tag(otherTypeHash, "env:prod");

    const { stdout, exitCode } = await runCli(
      "list",
      "--type",
      "@ocas/string",
      "--tag",
      "env:prod",
    );
    expect(exitCode).toBe(0);
    const hashes = parseListHashes(stdout);
    expect(hashes).toContain(n1);
    expect(hashes).not.toContain(otherTypeHash);
  });
});

describe("ocas var list --tag", () => {
  test("B1. filter by key-value tag", async () => {
    const h1 = await putString("b1-1");
    const h2 = await putString("b1-2");
    await varSet("@app/db1", h1, "env:prod");
    await varSet("@app/db2", h2, "env:staging");

    const { stdout, exitCode } = await runCli(
      "var",
      "list",
      "--tag",
      "env:prod",
    );
    expect(exitCode).toBe(0);
    const names = parseVarNames(stdout);
    expect(names).toContain("@app/db1");
    expect(names).not.toContain("@app/db2");
  });

  test("B2. filter by bare label", async () => {
    const h1 = await putString("b2-1");
    const h2 = await putString("b2-2");
    await varSet("@app/v1", h1, "stable");
    await varSet("@app/v2", h2);

    const { stdout, exitCode } = await runCli("var", "list", "--tag", "stable");
    expect(exitCode).toBe(0);
    const names = parseVarNames(stdout);
    expect(names).toContain("@app/v1");
    expect(names).not.toContain("@app/v2");
  });

  test("B3. multiple --tag flags = AND", async () => {
    const h1 = await putString("b3-1");
    const h2 = await putString("b3-2");
    const h3 = await putString("b3-3");
    await varSet("@app/v1", h1, "env:prod", "stable");
    await varSet("@app/v2", h2, "env:prod");
    await varSet("@app/v3", h3, "stable");

    const { stdout, exitCode } = await runCli(
      "var",
      "list",
      "--tag",
      "env:prod",
      "--tag",
      "stable",
    );
    expect(exitCode).toBe(0);
    const names = parseVarNames(stdout);
    expect(names.filter((n) => n.startsWith("@app/"))).toEqual(["@app/v1"]);
  });

  test("B4. no --tag → existing behavior unchanged", async () => {
    const h1 = await putString("b4-1");
    await varSet("@app/v1", h1);

    const { stdout, exitCode } = await runCli("var", "list", "@app/");
    expect(exitCode).toBe(0);
    const names = parseVarNames(stdout);
    expect(names).toContain("@app/v1");
  });

  test("B5. --tag combined with namePrefix", async () => {
    const h1 = await putString("b5-1");
    const h2 = await putString("b5-2");
    await varSet("@app/db1", h1, "env:prod");
    await varSet("@other/db1", h2, "env:prod");

    const { stdout, exitCode } = await runCli(
      "var",
      "list",
      "@app/",
      "--tag",
      "env:prod",
    );
    expect(exitCode).toBe(0);
    const names = parseVarNames(stdout);
    expect(names).toContain("@app/db1");
    expect(names).not.toContain("@other/db1");
  });

  test("B6. empty result when no matching variables", async () => {
    const h1 = await putString("b6-1");
    await varSet("@app/v1", h1);

    const { stdout, exitCode } = await runCli(
      "var",
      "list",
      "--tag",
      "missing",
    );
    expect(exitCode).toBe(0);
    const names = parseVarNames(stdout);
    expect(names.filter((n) => n.startsWith("@app/"))).toEqual([]);
  });
});
