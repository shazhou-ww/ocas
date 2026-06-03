import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash, Store } from "@ocas/core";
import { bootstrap, putSchema } from "@ocas/core";
import { openStore as openFsStore } from "@ocas/fs";

// ---- Test helpers ----

let testDir: string;
let storePath: string;
let cliPath: string;

beforeEach(() => {
  // Create unique temp directory for each test
  testDir = join(
    tmpdir(),
    `ocas-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  storePath = join(testDir, "store");
  cliPath = join(import.meta.dirname, "../src/index.ts");

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
function runCli(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
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

/**
 * Create a test CAS node and return its hash
 */
async function createTestNode(
  store: Store,
  typeHash: Hash,
  payload: unknown,
): Promise<Hash> {
  return store.cas.put(typeHash, payload);
}

/**
 * Get bootstrap type hash
 */
async function getBootstrapHash(store: Store): Promise<Hash> {
  const builtinSchemas = bootstrap(store);
  return builtinSchemas["@ocas/schema"] ?? "";
}

// ---- Tests ----

describe("var set", () => {
  test("create new variable without tags/labels", async () => {
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    const { stdout, stderr, exitCode } = await runCli(
      "var",
      "set",
      "@test/workflow/config/agent",
      hash,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const envelope = JSON.parse(stdout);
    expect(envelope).toHaveProperty("type");
    expect(envelope).toHaveProperty("value");
    expect(envelope.value.name).toBe("@test/workflow/config/agent");
    expect(envelope.value.schema).toBe(typeHash);
    expect(envelope.value.value).toBe(hash);
    expect(envelope.value.tags).toEqual({});
    expect(envelope.value.labels).toEqual([]);
    expect(envelope.value.created).toBeGreaterThan(0);
    expect(envelope.value.updated).toBeGreaterThan(0);
  });

  test("create with tags", async () => {
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    const { stdout, exitCode } = await runCli(
      "var",
      "set",
      "@test/my/var",
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
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    const { stdout, exitCode } = await runCli(
      "var",
      "set",
      "@test/my/var",
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
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash, { test: "data2" });

    // Create initial variable
    await runCli("var", "set", "@test/config", hash1);

    // Wait a bit to ensure updated > created
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Update with hash2
    const { stdout, exitCode } = await runCli(
      "var",
      "set",
      "@test/config",
      hash2,
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.value).toBe(hash2);
    expect(envelope.value.updated).toBeGreaterThan(envelope.value.created);
  });

  test("create variant with different schema", async () => {
    const store = await openFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const typeHash2 = putSchema(store, { title: "Test", type: "object" });
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash2, { test: "data2" });

    // Create first variant
    await runCli("var", "set", "@test/config", hash1);

    // Create second variant with different schema
    const { stdout, exitCode } = await runCli(
      "var",
      "set",
      "@test/config",
      hash2,
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.schema).toBe(typeHash2);

    // Verify both variants exist
    const { stdout: listOut } = await runCli("var", "list", "@test/config");
    const listEnvelope = JSON.parse(listOut);
    expect(listEnvelope.value.length).toBe(2);
  });

  test("update with new tags replaces old tags", async () => {
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create with initial tags/labels
    await runCli("var", "set", "@test/x", hash, "--tag", "a:1", "--tag", "b");

    // Update with new tags
    const { stdout, exitCode } = await runCli(
      "var",
      "set",
      "@test/x",
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
      "@test/my/var",
      "NONEXISTENT_HASH",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error: CAS node not found: NONEXISTENT_HASH");
  });

  test("error on invalid name format", async () => {
    const store = await openFsStore(storePath);
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
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    const { stderr, exitCode } = await runCli(
      "var",
      "set",
      "@test/x",
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
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable first
    await runCli("var", "set", "@test/config", hash);

    // Get it back
    const { stdout, exitCode } = await runCli(
      "var",
      "get",
      "@test/config",
      "--schema",
      typeHash,
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.name).toBe("@test/config");
    expect(envelope.value.schema).toBe(typeHash);
  });

  test("error when variable not found", async () => {
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);

    const { stderr, exitCode } = await runCli(
      "var",
      "get",
      "@test/nonexistent",
      "--schema",
      typeHash,
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      `Error: Variable not found: name=@test/nonexistent, schema=${typeHash}`,
    );
  });

  test("error when --schema missing", async () => {
    const { stderr, exitCode } = await runCli("var", "get", "@test/config");

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "Usage: ocas var get <name> --schema <hash-or-name>",
    );
  });

  test("distinguish variants by schema", async () => {
    const store = await openFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const typeHash2 = putSchema(store, { title: "Test", type: "object" });
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash2, { test: "data2" });

    // Create two variants
    await runCli("var", "set", "@test/config", hash1);
    await runCli("var", "set", "@test/config", hash2);

    // Get first variant
    const result1 = await runCli(
      "var",
      "get",
      "@test/config",
      "--schema",
      typeHash1,
    );
    expect(result1.exitCode).toBe(0);
    const envelope1 = JSON.parse(result1.stdout);
    expect(envelope1.value.value).toBe(hash1);

    // Get second variant
    const result2 = await runCli(
      "var",
      "get",
      "@test/config",
      "--schema",
      typeHash2,
    );
    expect(result2.exitCode).toBe(0);
    const envelope2 = JSON.parse(result2.stdout);
    expect(envelope2.value.value).toBe(hash2);
  });
});

describe("var delete", () => {
  test("remove all schema variants", async () => {
    const store = await openFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const typeHash2 = putSchema(store, { title: "Test", type: "object" });
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash2, { test: "data2" });

    // Create two variants
    await runCli("var", "set", "@test/config", hash1);
    await runCli("var", "set", "@test/config", hash2);

    // Delete all
    const { stdout, exitCode } = await runCli("var", "delete", "@test/config");

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);
    expect(envelope.value.length).toBe(2);

    // Verify both are deleted
    const result1 = await runCli(
      "var",
      "get",
      "@test/config",
      "--schema",
      typeHash1,
    );
    expect(result1.exitCode).toBe(1);

    const result2 = await runCli(
      "var",
      "get",
      "@test/config",
      "--schema",
      typeHash2,
    );
    expect(result2.exitCode).toBe(1);
  });

  test("remove specific variant by schema", async () => {
    const store = await openFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const typeHash2 = putSchema(store, { title: "Test", type: "object" });
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash2, { test: "data2" });

    // Create two variants
    await runCli("var", "set", "@test/config", hash1);
    await runCli("var", "set", "@test/config", hash2);

    // Delete only first variant
    const { stdout, exitCode } = await runCli(
      "var",
      "delete",
      "@test/config",
      "--schema",
      typeHash1,
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.schema).toBe(typeHash1);

    // Verify first is deleted
    const result1 = await runCli(
      "var",
      "get",
      "@test/config",
      "--schema",
      typeHash1,
    );
    expect(result1.exitCode).toBe(1);

    // Verify second still exists
    const result2 = await runCli(
      "var",
      "get",
      "@test/config",
      "--schema",
      typeHash2,
    );
    expect(result2.exitCode).toBe(0);
  });

  test("return empty array when name not found", async () => {
    const { stdout, exitCode } = await runCli(
      "var",
      "delete",
      "@test/nonexistent",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);
    expect(envelope.value.length).toBe(0);
  });

  test("error when specific variant not found", async () => {
    const { stderr, exitCode } = await runCli(
      "var",
      "delete",
      "@test/config",
      "--schema",
      "00000000000ZZ",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "Error: Variable not found: name=@test/config, schema=00000000000ZZ",
    );
  });

  test("cascade delete tags and labels", async () => {
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Create variable with tags and labels
    await runCli("var", "set", "@test/x", hash, "--tag", "a:1", "--tag", "b");

    // Delete it
    const { exitCode } = await runCli(
      "var",
      "delete",
      "@test/x",
      "--schema",
      typeHash,
    );

    expect(exitCode).toBe(0);

    // Verify it's gone
    const result = await runCli("var", "get", "@test/x", "--schema", typeHash);
    expect(result.exitCode).toBe(1);
  });
});

describe("var list", () => {
  test("list all variables", async () => {
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash, { test: "data2" });
    const hash3 = await createTestNode(store, typeHash, { test: "data3" });

    // Create three variables (use a prefix to filter out builtin @ocas/* vars
    // that bootstrap writes into the varStore)
    await runCli("var", "set", "@test/test/a", hash1);
    await runCli("var", "set", "@test/test/b", hash2);
    await runCli("var", "set", "@test/test/c", hash3);

    // List all under our prefix
    const { stdout, exitCode } = await runCli("var", "list", "@test/test/");

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.value)).toBe(true);
    expect(envelope.value.length).toBe(3);
  });

  test("filter by name prefix", async () => {
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash, { test: "data2" });
    const hash3 = await createTestNode(store, typeHash, { test: "data3" });

    // Create variables with different prefixes
    await runCli("var", "set", "@test/workflow/config/agent", hash1);
    await runCli("var", "set", "@test/workflow/config/model", hash2);
    await runCli("var", "set", "@test/other/var", hash3);

    // List with prefix
    const { stdout, exitCode } = await runCli("var", "list", "@test/workflow/");

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.length).toBe(2);
    expect(envelope.value[0].name).toContain("@test/workflow/");
    expect(envelope.value[1].name).toContain("@test/workflow/");
  });

  test("filter by schema", async () => {
    const store = await openFsStore(storePath);
    const bootstrapHash = await getBootstrapHash(store);
    const typeHash1 = putSchema(store, {
      title: "TypeA",
      type: "object",
    });
    const typeHash2 = putSchema(store, {
      title: "TypeB",
      type: "object",
    });
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash2, { test: "data2" });
    // bootstrapHash is the meta-schema, used implicitly when bootstrap runs
    void bootstrapHash;

    // Create variables with different schemas
    await runCli("var", "set", "@test/a", hash1);
    await runCli("var", "set", "@test/b", hash2);

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
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash, { test: "data2" });
    const hash3 = await createTestNode(store, typeHash, { test: "data3" });

    // Create variables with different tags
    await runCli(
      "var",
      "set",
      "@test/a",
      hash1,
      "--tag",
      "env:prod",
      "--tag",
      "region:us",
    );
    await runCli(
      "var",
      "set",
      "@test/b",
      hash2,
      "--tag",
      "env:prod",
      "--tag",
      "region:eu",
    );
    await runCli("var", "set", "@test/c", hash3, "--tag", "env:dev");

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
    expect(envelope.value[0].name).toBe("@test/a");
  });

  test("filter by labels", async () => {
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash, { test: "data2" });

    // Create variables with different labels
    await runCli(
      "var",
      "set",
      "@test/a",
      hash1,
      "--tag",
      "stable",
      "--tag",
      "production",
    );
    await runCli("var", "set", "@test/b", hash2, "--tag", "stable");

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
    expect(envelope.value[0].name).toBe("@test/a");
  });

  test("combined filters", async () => {
    const store = await openFsStore(storePath);
    const typeHash1 = await getBootstrapHash(store);
    const hash1 = await createTestNode(store, typeHash1, { test: "data1" });
    const hash2 = await createTestNode(store, typeHash1, { test: "data2" });
    const hash3 = await createTestNode(store, typeHash1, { test: "data3" });

    // Create variables
    await runCli("var", "set", "@test/workflow/a", hash1, "--tag", "env:prod");
    await runCli("var", "set", "@test/workflow/b", hash2, "--tag", "env:dev");
    await runCli("var", "set", "@test/other/c", hash3, "--tag", "env:prod");

    // List with combined filters
    const { stdout, exitCode } = await runCli(
      "var",
      "list",
      "@test/workflow/",
      "--schema",
      typeHash1,
      "--tag",
      "env:prod",
    );

    expect(exitCode).toBe(0);

    const envelope = JSON.parse(stdout);
    expect(envelope.value.length).toBe(1);
    expect(envelope.value[0].name).toBe("@test/workflow/a");
  });

  test("empty result when no matches", async () => {
    const { stdout, exitCode } = await runCli(
      "var",
      "list",
      "@test/nonexistent/prefix/",
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

describe("global options", () => {
  test("--json flag for compact output", async () => {
    const store = await openFsStore(storePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    await runCli("var", "set", "@test/x", hash);

    const { stdout } = await runCli(
      "--json",
      "var",
      "get",
      "@test/x",
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

    const store = await openFsStore(customStorePath);
    const typeHash = await getBootstrapHash(store);
    const hash = await createTestNode(store, typeHash, { test: "data" });

    // Override with custom store path
    execFileSync("node", [cliPath, "--home", customStorePath, "var", "set", "@test/x", hash], {
      encoding: "utf-8",
      timeout: 10000,
    });
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

  test("var tag subcommand removed", async () => {
    const { stderr, exitCode } = await runCli(
      "var",
      "tag",
      "@any/name",
      "--schema",
      "@ocas/string",
      "foo",
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown var subcommand: tag");
  });
});
