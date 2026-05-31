import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const pkgPath = resolve(import.meta.dir, "../package.json");

describe("ucas command alias", () => {
  test("T1: ucas bin entry exists in package.json", async () => {
    const pkg = await Bun.file(pkgPath).json();
    expect(pkg.bin.ucas).toBe("./src/index.ts");
  });

  test("T2: json-cas bin entry is preserved in package.json", async () => {
    const pkg = await Bun.file(pkgPath).json();
    expect(pkg.bin["json-cas"]).toBe("./src/index.ts");
  });

  test("T3: ucas command is executable and shows help", async () => {
    const entrypoint = resolve(import.meta.dir, "index.ts");
    const proc = Bun.spawn(["bun", entrypoint, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  test("T4: both commands point to the same entrypoint", async () => {
    const pkg = await Bun.file(pkgPath).json();
    expect(pkg.bin.ucas).toBe(pkg.bin["json-cas"]);
  });
});

// ---- @ Alias Resolution Tests ----

let testDir: string;
let storePath: string;
let cliPath: string;

beforeEach(() => {
  // Create unique temp directory for each test
  testDir = join(
    tmpdir(),
    `json-cas-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  storePath = join(testDir, "store");
  cliPath = join(import.meta.dir, "index.ts");

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
    ["bun", "run", cliPath, "--store", storePath, ...args],
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

describe("@ Alias Resolution - schema get", () => {
  test("ucas schema get @string should work", async () => {
    await runCli("init"); // Initialize store

    const { stdout, stderr, exitCode } = await runCli(
      "schema",
      "get",
      "@string",
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const schema = JSON.parse(stdout);
    expect(schema).toEqual({ type: "string" });
  });

  test("ucas schema get @number should work", async () => {
    await runCli("init");

    const { stdout, exitCode } = await runCli("schema", "get", "@number");

    expect(exitCode).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema).toEqual({ type: "number" });
  });

  test("ucas schema get @object should work", async () => {
    await runCli("init");

    const { stdout, exitCode } = await runCli("schema", "get", "@object");

    expect(exitCode).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema).toEqual({ type: "object" });
  });

  test("ucas schema get @array should work", async () => {
    await runCli("init");

    const { stdout, exitCode } = await runCli("schema", "get", "@array");

    expect(exitCode).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema).toEqual({ type: "array" });
  });

  test("ucas schema get @bool should work", async () => {
    await runCli("init");

    const { stdout, exitCode } = await runCli("schema", "get", "@bool");

    expect(exitCode).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema).toEqual({ type: "boolean" });
  });

  test("ucas schema get @schema should work", async () => {
    await runCli("init");

    const { stdout, exitCode } = await runCli("schema", "get", "@schema");

    expect(exitCode).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema).toHaveProperty("type", "object");
    expect(schema).toHaveProperty(
      "description",
      "json-cas JSON Schema meta-schema",
    );
  });

  test("ucas schema get @invalid should fail gracefully", async () => {
    await runCli("init");

    const { stderr, exitCode } = await runCli("schema", "get", "@invalid");

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Schema not found");
  });
});

describe("@ Alias Resolution - put", () => {
  test("ucas put @string <file> should resolve alias", async () => {
    await runCli("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, JSON.stringify("hello world"));

    const { stdout, stderr, exitCode } = await runCli(
      "put",
      "@string",
      payloadFile,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    // Should output a valid hash (13 chars)
    expect(stdout).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("ucas put @number <file> should resolve alias", async () => {
    await runCli("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, "42");

    const { stdout, exitCode } = await runCli("put", "@number", payloadFile);

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("ucas put @object <file> should resolve alias", async () => {
    await runCli("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, JSON.stringify({ foo: "bar" }));

    const { stdout, exitCode } = await runCli("put", "@object", payloadFile);

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("ucas put @invalid <file> should fail", async () => {
    await runCli("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, "{}");

    const { stderr, exitCode } = await runCli("put", "@invalid", payloadFile);

    expect(exitCode).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });
});

describe("@ Alias Resolution - hash", () => {
  test("ucas hash @string <file> should compute hash without storing", async () => {
    await runCli("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, JSON.stringify("test"));

    const { stdout, stderr, exitCode } = await runCli(
      "hash",
      "@string",
      payloadFile,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });
});
