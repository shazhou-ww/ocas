import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash } from "@ocas/core";
import { bootstrap, validate } from "@ocas/core";
import { openStore as openFsStore } from "@ocas/fs";

let testDir: string;
let storePath: string;
let cliPath: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `ocas-get-tag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

async function createTestNode(value = "hello-world"): Promise<Hash> {
  const store = await openFsStore(storePath);
  const aliases = bootstrap(store);
  const typeHash = aliases["@ocas/string"];
  if (!typeHash) throw new Error("@ocas/string not found");
  return store.cas.put(typeHash, value);
}

describe("get/var-get with tags", () => {
  test("G1: ocas get on untagged node — output unchanged (no tags field)", async () => {
    const hash = await createTestNode("hello");
    const { stdout, exitCode } = await runCli("get", hash);
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(typeof envelope.value.type).toBe("string");
    expect(envelope.value.payload).toBe("hello");
    expect(typeof envelope.value.timestamp).toBe("number");
    expect("tags" in envelope.value).toBe(false);
  });

  test("G2: ocas get on tagged node — includes tags array", async () => {
    const hash = await createTestNode("tagged");
    await runCli("tag", hash, "env:prod", "stable", "owner:alice");

    const { stdout, exitCode } = await runCli("get", hash);
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.value.payload).toBe("tagged");
    expect(typeof envelope.value.timestamp).toBe("number");
    expect(Array.isArray(envelope.value.tags)).toBe(true);
    expect(envelope.value.tags).toHaveLength(3);

    const pairs = new Set(
      envelope.value.tags.map(
        (t: { key: string; value: string | null }) => `${t.key}=${t.value}`,
      ),
    );
    expect(pairs.has("env=prod")).toBe(true);
    expect(pairs.has("stable=null")).toBe(true);
    expect(pairs.has("owner=alice")).toBe(true);

    for (const t of envelope.value.tags) {
      expect(t.target).toBe(hash);
      expect(typeof t.created).toBe("number");
    }
  });

  test("G3: ocas get after untag removes all tags — no tags key (empty array not serialized)", async () => {
    const hash = await createTestNode("u3");
    await runCli("tag", hash, "k:v");
    await runCli("untag", hash, "k");

    const { stdout, exitCode } = await runCli("get", hash);
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect("tags" in envelope.value).toBe(false);
  });

  test("V1: ocas var get when value hash untagged — output unchanged (no valueTags)", async () => {
    const hash = await createTestNode("hello");
    await runCli("var", "set", "@user/foo", hash);

    const { stdout, exitCode } = await runCli(
      "var",
      "get",
      "@user/foo",
      "--schema",
      "@ocas/string",
    );
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.value.name).toBe("@user/foo");
    expect(envelope.value.value).toBe(hash);
    expect(envelope.value.tags).toEqual({});
    expect(envelope.value.labels).toEqual([]);
    expect("valueTags" in envelope.value).toBe(false);
  });

  test("V2: ocas var get when value hash tagged — includes valueTags array", async () => {
    const hash = await createTestNode("hello");
    await runCli("var", "set", "@user/foo", hash);
    await runCli("tag", hash, "env:prod", "stable");

    const { stdout, exitCode } = await runCli(
      "var",
      "get",
      "@user/foo",
      "--schema",
      "@ocas/string",
    );
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.value.tags).toEqual({});
    expect(envelope.value.labels).toEqual([]);
    expect(Array.isArray(envelope.value.valueTags)).toBe(true);
    expect(envelope.value.valueTags).toHaveLength(2);

    const pairs = new Set(
      envelope.value.valueTags.map(
        (t: { key: string; value: string | null }) => `${t.key}=${t.value}`,
      ),
    );
    expect(pairs.has("env=prod")).toBe(true);
    expect(pairs.has("stable=null")).toBe(true);
    for (const t of envelope.value.valueTags) {
      expect(t.target).toBe(hash);
      expect(typeof t.created).toBe("number");
    }
  });

  test("V3: variable tags vs valueTags don't collide", async () => {
    const hash = await createTestNode("hello");
    await runCli("var", "set", "@user/foo", hash, "--tag", "a:1", "--tag", "x");
    await runCli("tag", hash, "owner:bob");

    const { stdout, exitCode } = await runCli(
      "var",
      "get",
      "@user/foo",
      "--schema",
      "@ocas/string",
    );
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.value.tags).toEqual({ a: "1" });
    expect(envelope.value.labels).toEqual(["x"]);
    expect(Array.isArray(envelope.value.valueTags)).toBe(true);
    expect(envelope.value.valueTags).toHaveLength(1);
    expect(envelope.value.valueTags[0]).toMatchObject({
      key: "owner",
      value: "bob",
      target: hash,
    });
  });

  test("S1: @ocas/output/get schema validates with and without tags", async () => {
    const store = await openFsStore(storePath);
    const aliases = bootstrap(store);
    const getSchemaHash = aliases["@ocas/output/get"];
    if (!getSchemaHash) throw new Error("schema not found");
    const stringHash = aliases["@ocas/string"];
    if (!stringHash) throw new Error("string schema not found");

    const untagged = {
      type: getSchemaHash,
      payload: { type: stringHash, payload: "hi", timestamp: 1 },
      timestamp: 2,
    };
    expect(validate(store, untagged)).toBe(true);

    const tagged = {
      type: getSchemaHash,
      payload: {
        type: stringHash,
        payload: "hi",
        timestamp: 1,
        tags: [
          {
            key: "env",
            value: "prod",
            target: stringHash,
            created: 123,
          },
        ],
      },
      timestamp: 2,
    };
    expect(validate(store, tagged)).toBe(true);
  });

  test("S2: @ocas/output/var-get schema validates with and without valueTags", async () => {
    const store = await openFsStore(storePath);
    const aliases = bootstrap(store);
    const varGetSchemaHash = aliases["@ocas/output/var-get"];
    if (!varGetSchemaHash) throw new Error("schema not found");
    const stringHash = aliases["@ocas/string"];
    if (!stringHash) throw new Error("string schema not found");

    const untagged = {
      type: varGetSchemaHash,
      payload: {
        name: "@user/foo",
        schema: stringHash,
        value: stringHash,
        created: 1,
        updated: 2,
        tags: {},
        labels: [],
      },
      timestamp: 3,
    };
    expect(validate(store, untagged)).toBe(true);

    const tagged = {
      type: varGetSchemaHash,
      payload: {
        name: "@user/foo",
        schema: stringHash,
        value: stringHash,
        created: 1,
        updated: 2,
        tags: {},
        labels: [],
        valueTags: [
          {
            key: "env",
            value: "prod",
            target: stringHash,
            created: 123,
          },
        ],
      },
      timestamp: 3,
    };
    expect(validate(store, tagged)).toBe(true);
  });
});
