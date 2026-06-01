import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash, Store } from "@ocas/core";
import { bootstrap, putSchema } from "@ocas/core";
import { createFsStore } from "@ocas/fs";

// ---- Test helpers ----

let testDir: string;
let storePath: string;
let varDbPath: string;
let cliPath: string;

beforeEach(() => {
  // Create unique temp directory for each test
  testDir = join(
    tmpdir(),
    `ocas-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  storePath = join(testDir, "store");
  varDbPath = join(testDir, "variables.db");
  cliPath = join(import.meta.dir, "../src/index.ts");

  mkdirSync(testDir, { recursive: true });
  mkdirSync(storePath, { recursive: true });
});

afterEach(() => {
  // Clean up test directory
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

/**
 * Run CLI command and return stdout, stderr, and exit code
 */
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

/**
 * Create a test CAS node and return its hash
 */
async function createTestNode(
  store: Store,
  typeHash: Hash,
  payload: unknown,
): Promise<Hash> {
  return await store.put(typeHash, payload);
}

/**
 * Get bootstrap type hash
 */
async function getBootstrapHash(store: Store): Promise<Hash> {
  const builtinSchemas = await bootstrap(store);
  return builtinSchemas["@ocas/schema"] ?? "";
}

// ---- Tests ----

describe("var set", () => {
  test("create new variable without tags/labels", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    const { stdout, stderr, exitCode } = await runCli(
      "var",
      "set",
      "workflow/config/agent",
      hash,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const envelope = JSON.parse(stdout);
    expect(envelope).toHaveProperty("type");
    expect(envelope).toHaveProperty("value");
    expect(envelope.value.name).toBe("workflow/config/agent");
    expect(envelope.value.schema).toBe(typeHash);
    expect(envelope.value.value).toBe(hash);
    expect(envelope.value.tags).toEqual({});
    expect(envelope.value.labels).toEqual([]);
    expect(envelope.value.created).toBeGreaterThan(0);
    expect(envelope.value.updated).toBeGreaterThan(0);
  });

  test("create with tags", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    const { stdout, exitCode } = await runCli(
      "var",
      "set",
      "my/var",
      hash,
      "--tag",
      "env:prod",
      "--tag",
      "version:1.0",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.tags).toEqual({ env: "prod", version: "1.0" });
    expect(envelope.value.labels).toEqual([]);
  });

  test("create with labels", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    const { stdout, exitCode } = await runCli(
      "var",
      "set",
      "my/var",
      hash,
      "--tag",
      "stable",
      "--tag",
      "production",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.tags).toEqual({});
    expect(envelope.value.labels.sort()).toEqual(["production", "stable"]);
  });

  test("update existing variable (same schema)", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash, { test: "data2" });

    // Create initial variable
    await runCli("var", "set", "config", hash1);

    // Wait a bit to ensure updated > created
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Update with hash2
    const { stdout, exitCode } = await runCli("var", "set", "config", hash2);

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.value).toBe(hash2);
    expect(envelope.value.updated).toBeGreaterThan(envelope.value.created);
  });

  test("create variant with different schema", async () => {
    const store = createFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const typeHash2 = await putSchema(store, { title: "Test", type: "object" });
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash2, { test: "data2" });

    // Create first variant
    await runCli("var", "set", "config", hash1);

    // Create second variant with different schema
    const { stdout, exitCode } = await runCli("var", "set", "config", hash2);

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.schema).toBe(typeHash2);

    // Verify both variants exist
    const { stdout: listOut } = await runCli("var", "list", "config");
    const listEnvelope = JSON.parse(listOut);
    expect(listEnvelope.value.length).toBe(2);
  });

  test("update with new tags replaces old tags", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create with initial tags/labels
    await runCli("var", "set", "x", hash, "--tag", "a:1", "--tag", "b");

    // Update with new tags
    const { stdout, exitCode } = await runCli(
      "var",
      "set",
      "x",
      hash,
      "--tag",
      "c:2",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.tags).toEqual({ c: "2" });
    expect(envelope.value.labels).toEqual([]);
  });

  test("error when CAS node not found", async () => {
    const { stderr, exitCode } = await runCli(
      "var",
      "set",
      "my/var",
      "NONEXISTENT_HASH",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error: CAS node not found: NONEXISTENT_HASH");
  });

  test("error on invalid name format", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Leading slash
    let result = await runCli("var", "set", "/leading", hash);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Error: Invalid variable name");

    // Trailing slash
    result = await runCli("var", "set", "trailing/", hash);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Error: Invalid variable name");

    // Empty segment
    result = await runCli("var", "set", "a//b", hash);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Error: Invalid variable name");

    // Invalid char @
    result = await runCli("var", "set", "a/b@c", hash);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Error: Invalid variable name");
  });

  test("error on tag/label name conflict", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    const { stderr, exitCode } = await runCli(
      "var",
      "set",
      "x",
      hash,
      "--tag",
      "env:prod",
      "--tag",
      "env",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error: Conflict: 'env' already exists as a");
  });
});

describe("var get", () => {
  test("retrieve existing variable by name + schema", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable first
    await runCli("var", "set", "config", hash);

    // Get it back
    const { stdout, exitCode } = await runCli(
      "var",
      "get",
      "config",
      "--schema",
      typeHash,
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.name).toBe("config");
    expect(envelope.value.schema).toBe(typeHash);
  });

  test("error when variable not found", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);

    const { stderr, exitCode } = await runCli(
      "var",
      "get",
      "nonexistent",
      "--schema",
      typeHash,
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      `Error: Variable not found: name=nonexistent, schema=${typeHash}`,
    );
  });

  test("error when --schema missing", async () => {
    const { stderr, exitCode } = await runCli("var", "get", "config");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: ocas var get <name> --schema <hash>");
  });

  test("distinguish variants by schema", async () => {
    const store = createFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const typeHash2 = await putSchema(store, { title: "Test", type: "object" });
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash2, { test: "data2" });

    // Create two variants
    await runCli("var", "set", "config", hash1);
    await runCli("var", "set", "config", hash2);

    // Get first variant
    const result1 = await runCli("var", "get", "config", "--schema", typeHash1);
    expect(result1.exitCode).toBe(0);
    const envelope1 = JSON.parse(result1.stdout);
    expect(envelope1.value.value).toBe(hash1);

    // Get second variant
    const result2 = await runCli("var", "get", "config", "--schema", typeHash2);
    expect(result2.exitCode).toBe(0);
    const envelope2 = JSON.parse(result2.stdout);
    expect(envelope2.value.value).toBe(hash2);
  });
});

describe("var delete", () => {
  test("remove all schema variants", async () => {
    const store = createFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const typeHash2 = await putSchema(store, { title: "Test", type: "object" });
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash2, { test: "data2" });

    // Create two variants
    await runCli("var", "set", "config", hash1);
    await runCli("var", "set", "config", hash2);

    // Delete all
    const { stdout, exitCode } = await runCli("var", "delete", "config");

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);
    expect(envelope.value.length).toBe(2);

    // Verify both are deleted
    const result1 = await runCli("var", "get", "config", "--schema", typeHash1);
    expect(result1.exitCode).toBe(1);

    const result2 = await runCli("var", "get", "config", "--schema", typeHash2);
    expect(result2.exitCode).toBe(1);
  });

  test("remove specific variant by schema", async () => {
    const store = createFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const typeHash2 = await putSchema(store, { title: "Test", type: "object" });
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash2, { test: "data2" });

    // Create two variants
    await runCli("var", "set", "config", hash1);
    await runCli("var", "set", "config", hash2);

    // Delete only first variant
    const { stdout, exitCode } = await runCli(
      "var",
      "delete",
      "config",
      "--schema",
      typeHash1,
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.schema).toBe(typeHash1);

    // Verify first is deleted
    const result1 = await runCli("var", "get", "config", "--schema", typeHash1);
    expect(result1.exitCode).toBe(1);

    // Verify second still exists
    const result2 = await runCli("var", "get", "config", "--schema", typeHash2);
    expect(result2.exitCode).toBe(0);
  });

  test("return empty array when name not found", async () => {
    const { stdout, exitCode } = await runCli("var", "delete", "nonexistent");

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);
    expect(envelope.value.length).toBe(0);
  });

  test("error when specific variant not found", async () => {
    const { stderr, exitCode } = await runCli(
      "var",
      "delete",
      "config",
      "--schema",
      "NONEXISTENT_SCHEMA",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "Error: Variable not found: name=config, schema=NONEXISTENT_SCHEMA",
    );
  });

  test("cascade delete tags and labels", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable with tags and labels
    await runCli("var", "set", "x", hash, "--tag", "a:1", "--tag", "b");

    // Delete it
    const { exitCode } = await runCli(
      "var",
      "delete",
      "x",
      "--schema",
      typeHash,
    );

    expect(exitCode).toBe(0);

    // Verify it's gone
    const result = await runCli("var", "get", "x", "--schema", typeHash);
    expect(result.exitCode).toBe(1);
  });
});

describe("var list", () => {
  test("list all variables", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash, { test: "data2" });
    const hash3 = await createTestNode(store, typeHash, { test: "data3" });

    // Create three variables
    await runCli("var", "set", "a", hash1);
    await runCli("var", "set", "b", hash2);
    await runCli("var", "set", "c", hash3);

    // List all
    const { stdout, exitCode } = await runCli("var", "list");

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);
    expect(envelope.value.length).toBe(3);
  });

  test("filter by name prefix", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash, { test: "data2" });
    const hash3 = await createTestNode(store, typeHash, { test: "data3" });

    // Create variables with different prefixes
    await runCli("var", "set", "workflow/config/agent", hash1);
    await runCli("var", "set", "workflow/config/model", hash2);
    await runCli("var", "set", "other/var", hash3);

    // List with prefix
    const { stdout, exitCode } = await runCli("var", "list", "workflow/");

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.length).toBe(2);
    expect(envelope.value[0].name).toContain("workflow/");
    expect(envelope.value[1].name).toContain("workflow/");
  });

  test("filter by schema", async () => {
    const store = createFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const typeHash2 = await putSchema(store, { title: "Test", type: "object" });
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash2, { test: "data2" });

    // Create variables with different schemas
    await runCli("var", "set", "a", hash1);
    await runCli("var", "set", "b", hash2);

    // List with schema filter
    const { stdout, exitCode } = await runCli(
      "var",
      "list",
      "--schema",
      typeHash1,
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.length).toBe(1);
    expect(envelope.value[0].schema).toBe(typeHash1);
  });

  test("filter by tags (AND logic)", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash, { test: "data2" });
    const hash3 = await createTestNode(store, typeHash, { test: "data3" });

    // Create variables with different tags
    await runCli(
      "var",
      "set",
      "a",
      hash1,
      "--tag",
      "env:prod",
      "--tag",
      "region:us",
    );
    await runCli(
      "var",
      "set",
      "b",
      hash2,
      "--tag",
      "env:prod",
      "--tag",
      "region:eu",
    );
    await runCli("var", "set", "c", hash3, "--tag", "env:dev");

    // List with tag filter (AND logic)
    const { stdout, exitCode } = await runCli(
      "var",
      "list",
      "--tag",
      "env:prod",
      "--tag",
      "region:us",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.length).toBe(1);
    expect(envelope.value[0].name).toBe("a");
  });

  test("filter by labels", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash, { test: "data2" });

    // Create variables with different labels
    await runCli(
      "var",
      "set",
      "a",
      hash1,
      "--tag",
      "stable",
      "--tag",
      "production",
    );
    await runCli("var", "set", "b", hash2, "--tag", "stable");

    // List with single label
    const result1 = await runCli("var", "list", "--tag", "stable");
    expect(result1.exitCode).toBe(0);
    let envelope = JSON.parse(result1.stdout);
    expect(envelope.value.length).toBe(2);

    // List with multiple labels (AND logic)
    const result2 = await runCli(
      "var",
      "list",
      "--tag",
      "stable",
      "--tag",
      "production",
    );
    expect(result2.exitCode).toBe(0);
    envelope = JSON.parse(result2.stdout);
    expect(envelope.value.length).toBe(1);
    expect(envelope.value[0].name).toBe("a");
  });

  test("combined filters", async () => {
    const store = createFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash1, { test: "data2" });
    const hash3 = await createTestNode(store, typeHash1, { test: "data3" });

    // Create variables
    await runCli("var", "set", "workflow/a", hash1, "--tag", "env:prod");
    await runCli("var", "set", "workflow/b", hash2, "--tag", "env:dev");
    await runCli("var", "set", "other/c", hash3, "--tag", "env:prod");

    // List with combined filters
    const { stdout, exitCode } = await runCli(
      "var",
      "list",
      "workflow/",
      "--schema",
      typeHash1,
      "--tag",
      "env:prod",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.length).toBe(1);
    expect(envelope.value[0].name).toBe("workflow/a");
  });

  test("empty result when no matches", async () => {
    const { stdout, exitCode } = await runCli(
      "var",
      "list",
      "nonexistent/prefix/",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);
    expect(envelope.value.length).toBe(0);
  });

  test("error on deletion syntax in filter", async () => {
    const { stderr, exitCode } = await runCli("var", "list", "--tag", ":env");

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "Error: Cannot use deletion syntax (:name) in var list filters",
    );
  });
});

describe("var tag", () => {
  test("add new tag", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable without tags
    await runCli("var", "set", "x", hash);

    // Add tag
    const { stdout, exitCode } = await runCli(
      "var",
      "tag",
      "x",
      "--schema",
      typeHash,
      "env:prod",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.tags).toEqual({ env: "prod" });
  });

  test("update existing tag value", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable with tag
    await runCli("var", "set", "x", hash, "--tag", "env:dev");

    // Update tag
    const { stdout, exitCode } = await runCli(
      "var",
      "tag",
      "x",
      "--schema",
      typeHash,
      "env:prod",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.tags).toEqual({ env: "prod" });
  });

  test("add label", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable without labels
    await runCli("var", "set", "x", hash);

    // Add label
    const { stdout, exitCode } = await runCli(
      "var",
      "tag",
      "x",
      "--schema",
      typeHash,
      "stable",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.labels).toEqual(["stable"]);
  });

  test("delete tag", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable with tags
    await runCli(
      "var",
      "set",
      "x",
      hash,
      "--tag",
      "env:prod",
      "--tag",
      "version:1.0",
    );

    // Delete tag
    const { stdout, exitCode } = await runCli(
      "var",
      "tag",
      "x",
      "--schema",
      typeHash,
      ":env",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.tags).toEqual({ version: "1.0" });
  });

  test("delete label", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable with labels
    await runCli("var", "set", "x", hash, "--tag", "stable", "--tag", "beta");

    // Delete label
    const { stdout, exitCode } = await runCli(
      "var",
      "tag",
      "x",
      "--schema",
      typeHash,
      ":stable",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.labels).toEqual(["beta"]);
  });

  test("mixed add and delete operations", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable with tags and labels
    await runCli("var", "set", "x", hash, "--tag", "a:1", "--tag", "b");

    // Mixed operations
    const { stdout, exitCode } = await runCli(
      "var",
      "tag",
      "x",
      "--schema",
      typeHash,
      "c:3",
      ":a",
      "d",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.tags).toEqual({ c: "3" });
    expect(envelope.value.labels.sort()).toEqual(["b", "d"]);
  });

  test("error on tag/label conflict", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable with tag
    await runCli("var", "set", "x", hash, "--tag", "env:prod");

    // Try to add same name as label
    const { stderr, exitCode } = await runCli(
      "var",
      "tag",
      "x",
      "--schema",
      typeHash,
      "env",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error: Conflict: 'env' already exists as a");
  });

  test("error when variable not found", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);

    const { stderr, exitCode } = await runCli(
      "var",
      "tag",
      "nonexistent",
      "--schema",
      typeHash,
      "env:prod",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      `Error: Variable not found: name=nonexistent, schema=${typeHash}`,
    );
  });

  test("error when --schema missing", async () => {
    const { stderr, exitCode } = await runCli("var", "tag", "x", "env:prod");

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "Usage: ocas var tag <name> --schema <hash> <operations...>",
    );
  });

  test("error when no operations provided", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);

    const { stderr, exitCode } = await runCli(
      "var",
      "tag",
      "x",
      "--schema",
      typeHash,
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "Usage: ocas var tag <name> --schema <hash> <operations...>",
    );
  });
});

describe("global options", () => {
  test("--json flag for compact output", async () => {
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    await runCli("var", "set", "x", hash);

    const { stdout } = await runCli(
      "--json",
      "var",
      "get",
      "x",
      "--schema",
      typeHash,
    );

    // Compact JSON should not have newlines (except trailing)
    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    expect(lines.length).toBe(1);
  });

  test("--home flag for custom store path", async () => {
    const customStorePath = join(testDir, "custom-store");
    mkdirSync(customStorePath, { recursive: true });

    const store = createFsStore(customStorePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Override with custom store path
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        cliPath,
        "--home",
        customStorePath,
        "--var-db",
        varDbPath,
        "var",
        "set",
        "x",
        hash,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    await proc.exited;
    expect(proc.exitCode).toBe(0);
  });

  test("--var-db flag for custom database path", async () => {
    const customDbPath = join(testDir, "custom.db");
    const store = createFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Override with custom db path
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        cliPath,
        "--home",
        storePath,
        "--var-db",
        customDbPath,
        "var",
        "set",
        "x",
        hash,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    await proc.exited;
    expect(proc.exitCode).toBe(0);
  });
});

describe("old commands removed", () => {
  test("var create command removed", async () => {
    const { stderr, exitCode } = await runCli(
      "var",
      "create",
      "--scope",
      "x",
      "--value",
      "HASH",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown var subcommand: create");
  });

  test("var update command removed", async () => {
    const { stderr, exitCode } = await runCli("var", "update", "ID", "HASH");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown var subcommand: update");
  });
});
