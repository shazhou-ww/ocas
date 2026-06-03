import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- @ Alias Resolution Tests ----

let testDir: string;
let storePath: string;
let cliPath: string;

beforeEach(() => {
  // Create unique temp directory for each test
  testDir = join(
    tmpdir(),
    `ocas-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  storePath = join(testDir, "store");
  cliPath = join(import.meta.dirname, "../dist/index.js");

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
function runCliAlias(...rawArgs: (string | string[])[]): { stdout: string; stderr: string; exitCode: number } {
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

/** Extract the `value` field from a { type, value } envelope JSON string. */
function envValue(json: string): unknown {
  return (JSON.parse(json.trim()) as { value: unknown }).value;
}

describe("@ Alias Resolution - put", () => {
  test("ocas put @ocas/string <file> should resolve alias", async () => {
    await runCliAlias("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, JSON.stringify("hello world"));

    const { stdout, stderr, exitCode } = await runCliAlias(
      "put",
      "@ocas/string",
      payloadFile,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    // Should output an envelope whose value is a valid hash (13 chars)
    expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("ocas put @ocas/number <file> should resolve alias", async () => {
    await runCliAlias("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, "42");

    const { stdout, exitCode } = await runCliAlias(
      "put",
      "@ocas/number",
      payloadFile,
    );

    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("ocas put @ocas/object <file> should resolve alias", async () => {
    await runCliAlias("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, JSON.stringify({ foo: "bar" }));

    const { stdout, exitCode } = await runCliAlias(
      "put",
      "@ocas/object",
      payloadFile,
    );

    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("ocas put @invalid <file> should fail", async () => {
    await runCliAlias("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, "{}");

    const { stderr, exitCode } = await runCliAlias(
      "put",
      "@invalid",
      payloadFile,
    );

    expect(exitCode).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });

  test("ocas put @ocas/schema with nested type constraints should succeed", async () => {
    await runCliAlias("init");

    const schemaFile = join(testDir, "constrained-schema.json");
    writeFileSync(
      schemaFile,
      JSON.stringify({
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 50 },
          age: { type: "number", minimum: 0, maximum: 150 },
          tags: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            uniqueItems: true,
          },
        },
        required: ["name"],
      }),
    );

    const { stdout, stderr, exitCode } = await runCliAlias(
      "put",
      "@ocas/schema",
      schemaFile,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });
});

describe("@ Alias Resolution - hash", () => {
  test("ocas hash @ocas/string <file> should compute hash without storing", async () => {
    await runCliAlias("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, JSON.stringify("test"));

    const { stdout, stderr, exitCode } = await runCliAlias(
      "hash",
      "@ocas/string",
      payloadFile,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });
});

describe("@ Alias Resolution - hash params (Phase 3)", () => {
  test("ocas get @ocas/string should resolve name to hash", async () => {
    await runCliAlias("init");

    const { stdout, stderr, exitCode } = await runCliAlias(
      "get",
      "@ocas/string",
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const value = envValue(stdout) as { type: string; payload: unknown };
    expect(value).toHaveProperty("type");
    expect(value).toHaveProperty("payload");
  });

  test("ocas has @ocas/string should resolve name and return true", async () => {
    await runCliAlias("init");

    const { stdout, stderr, exitCode } = await runCliAlias(
      "has",
      "@ocas/string",
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(envValue(stdout)).toBe(true);
  });

  test("ocas verify @ocas/string should resolve name", async () => {
    await runCliAlias("init");

    const { stdout, stderr, exitCode } = await runCliAlias(
      "verify",
      "@ocas/string",
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(envValue(stdout)).toBe("ok");
  });

  test("ocas refs @ocas/string should resolve name", async () => {
    await runCliAlias("init");

    const { stdout, stderr, exitCode } = await runCliAlias(
      "refs",
      "@ocas/string",
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(Array.isArray(envValue(stdout))).toBe(true);
  });

  test("ocas walk @ocas/string should resolve name", async () => {
    await runCliAlias("init");

    const { stdout, stderr, exitCode } = await runCliAlias(
      "walk",
      "@ocas/string",
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const value = envValue(stdout);
    expect(Array.isArray(value)).toBe(true);
    expect((value as string[]).length).toBeGreaterThan(0);
  });

  test("ocas list --type @ocas/string should resolve name", async () => {
    await runCliAlias("init");

    const { stdout, stderr, exitCode } = await runCliAlias(
      "list",
      "--type",
      "@ocas/string",
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(Array.isArray(envValue(stdout))).toBe(true);
  });

  test("ocas get with non-existent name should fail with Error", async () => {
    await runCliAlias("init");

    const { stderr, exitCode } = await runCliAlias("get", "@nonexistent/name");

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Schema not found:");
  });
});
