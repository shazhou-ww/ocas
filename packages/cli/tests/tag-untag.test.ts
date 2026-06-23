import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash } from "@ocas/core";
import { bootstrap } from "@ocas/core";
import { openStore as openFsStore } from "@ocas/fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let testDir: string;
let storePath: string;
let cliPath: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `ocas-tag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

function runCli(...rawArgs: (string | string[])[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const args = rawArgs.flat();
  const finalArgs = args.includes("--json") ? args : [...args, "--json"];
  try {
    const stdout = execFileSync(
      "node",
      [cliPath, "--home", storePath, ...finalArgs],
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

async function createTestNode(): Promise<Hash> {
  const store = await openFsStore(storePath);
  const aliases = bootstrap(store);
  const typeHash = aliases["@ocas/string"];
  if (!typeHash) throw new Error("@ocas/string not found");
  const hash = store.cas.put(typeHash, `test-value-${Math.random()}`);
  return hash;
}

async function readTags(target: Hash) {
  const store = await openFsStore(storePath);
  return store.tag.tags(target);
}

describe("ocas tag", () => {
  test("Test 1: tag <hash> applies key:value tags and labels", async () => {
    const hash = await createTestNode();

    const { stdout, exitCode } = await runCli(
      "tag",
      hash,
      "env:prod",
      "stable",
    );
    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);
    const value = envelope.value as Array<{
      key: string;
      value: string | null;
      target: string;
    }>;
    const byKey = (k: string) => value.find((t) => t.key === k);
    expect(byKey("env")).toMatchObject({
      key: "env",
      value: "prod",
      target: hash,
    });
    expect(byKey("stable")).toMatchObject({
      key: "stable",
      value: null,
      target: hash,
    });

    const tags = await readTags(hash);
    expect(tags.find((t) => t.key === "env")?.value).toBe("prod");
    expect(tags.find((t) => t.key === "stable")?.value).toBeNull();
  });

  test("Test 2: tag @scope/name resolves variable to its value hash", async () => {
    const hash = await createTestNode();

    await runCli("var", "set", "@user/foo", hash);
    const { exitCode } = await runCli("tag", "@user/foo", "reviewed");
    expect(exitCode).toBe(0);

    const tagsOnHash = await readTags(hash);
    expect(tagsOnHash.find((t) => t.key === "reviewed")).toBeDefined();
  });

  test("Test 3: untag <hash> env removes tag by key", async () => {
    const hash = await createTestNode();

    await runCli("tag", hash, "env:prod", "stable");
    const { stdout, exitCode } = await runCli("untag", hash, "env");
    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    const keys = (envelope.value as Array<{ key: string }>).map((t) => t.key);
    expect(keys).toContain("stable");
    expect(keys).not.toContain("env");

    const remaining = await readTags(hash);
    expect(remaining.map((t) => t.key)).toEqual(["stable"]);
  });

  test("Test 4: untag accepts key:value form (uses key only)", async () => {
    const hash = await createTestNode();

    await runCli("tag", hash, "env:prod");
    const { exitCode } = await runCli("untag", hash, "env:prod");
    expect(exitCode).toBe(0);

    expect(await readTags(hash)).toEqual([]);
  });

  test("Test 5: untag removes labels", async () => {
    const hash = await createTestNode();

    await runCli("tag", hash, "pinned");
    const { exitCode } = await runCli("untag", hash, "pinned");
    expect(exitCode).toBe(0);

    expect(await readTags(hash)).toEqual([]);
  });

  test("Test 6: tag without tag args errors", async () => {
    const hash = await createTestNode();
    const { stderr, exitCode } = await runCli("tag", hash);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage: ocas tag <target> <tag>...");
  });

  test("Test 7: tag with no args errors", async () => {
    const { stderr, exitCode } = await runCli("tag");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  test("Test 8: untag missing args errors", async () => {
    const hash = await createTestNode();

    const r1 = await runCli("untag");
    expect(r1.exitCode).not.toBe(0);

    const r2 = await runCli("untag", hash);
    expect(r2.exitCode).not.toBe(0);
    expect(r2.stderr).toContain("Usage: ocas untag <target> <tag>...");
  });

  test("Test 9: tag with unknown variable name errors", async () => {
    const { stderr, exitCode } = await runCli("tag", "@user/missing", "label");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Unknown hash or variable: @user/missing");
  });

  test("Test 10: var tag is removed", async () => {
    const { stderr, exitCode } = await runCli(
      "var",
      "tag",
      "@any/name",
      "--schema",
      "@ocas/string",
      "foo",
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Unknown var subcommand: tag");
  });

  test("Test 11: envelope schema name is @ocas/output/tag and @ocas/output/untag", async () => {
    const hash = await createTestNode();

    const r1 = await runCli("tag", hash, "stable");
    const env1 = JSON.parse(r1.stdout);
    expect(env1.type).toBe("@ocas/output/tag");

    const r2 = await runCli("untag", hash, "stable");
    const env2 = JSON.parse(r2.stdout);
    expect(env2.type).toBe("@ocas/output/untag");
  });

  test("Test 12: idempotent re-tag updates existing key value", async () => {
    const hash = await createTestNode();

    await runCli("tag", hash, "env:dev");
    await runCli("tag", hash, "env:prod");

    const tags = await readTags(hash);
    const envTags = tags.filter((t) => t.key === "env");
    expect(envTags).toHaveLength(1);
    expect(envTags[0]?.value).toBe("prod");
  });

  test("Test 15: bootstrap registers @ocas/output/tag and @ocas/output/untag", async () => {
    const store = await openFsStore(storePath);
    const aliases = bootstrap(store);
    expect(aliases["@ocas/output/tag"]).toBeDefined();
    expect(aliases["@ocas/output/untag"]).toBeDefined();

    const tagVar = store.var.list({ exactName: "@ocas/output/tag" });
    expect(tagVar.length).toBeGreaterThan(0);

    const untagVar = store.var.list({ exactName: "@ocas/output/untag" });
    expect(untagVar.length).toBeGreaterThan(0);
  });
});
