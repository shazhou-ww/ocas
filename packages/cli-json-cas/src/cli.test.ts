import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { JSONSchema } from "@uncaged/json-cas";
import { bootstrap, putSchema } from "@uncaged/json-cas";
import { createFsStore, openStore as openFsStore } from "@uncaged/json-cas-fs";

const pkgPath = resolve(import.meta.dir, "../package.json");
const entrypoint = resolve(import.meta.dir, "index.ts");

/** Extract the `value` field from a { type, value } envelope JSON string. */
function envValue(json: string): unknown {
  return (JSON.parse(json.trim()) as { value: unknown }).value;
}

/**
 * Register a schema directly via the library (CLI schema put was removed).
 * Returns the type hash.
 */
async function putSchemaFile(
  storePath: string,
  schemaFilePath: string,
): Promise<string> {
  const store = await openFsStore(storePath);
  const schema = JSON.parse(
    readFileSync(schemaFilePath, "utf-8"),
  ) as JSONSchema;
  const hash = await putSchema(store, schema);
  return hash;
}

async function runCli(
  args: string[],
  storePath?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const finalArgs = storePath
    ? ["bun", entrypoint, "--store", storePath, ...args]
    : ["bun", entrypoint, ...args];
  const proc = Bun.spawn(finalArgs, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode };
}

async function runCliWithStdin(
  args: string[],
  storePath: string,
  stdin: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const finalArgs = ["bun", entrypoint, "--store", storePath, ...args];
  const proc = Bun.spawn(finalArgs, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin.write(stdin);
  proc.stdin.end();
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode };
}

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
async function runCliAlias(...args: string[]): Promise<{
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

describe("@ Alias Resolution - put", () => {
  test("ucas put @string <file> should resolve alias", async () => {
    await runCliAlias("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, JSON.stringify("hello world"));

    const { stdout, stderr, exitCode } = await runCliAlias(
      "put",
      "@string",
      payloadFile,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    // Should output an envelope whose value is a valid hash (13 chars)
    expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("ucas put @number <file> should resolve alias", async () => {
    await runCliAlias("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, "42");

    const { stdout, exitCode } = await runCliAlias(
      "put",
      "@number",
      payloadFile,
    );

    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("ucas put @object <file> should resolve alias", async () => {
    await runCliAlias("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, JSON.stringify({ foo: "bar" }));

    const { stdout, exitCode } = await runCliAlias(
      "put",
      "@object",
      payloadFile,
    );

    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("ucas put @invalid <file> should fail", async () => {
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
});

describe("@ Alias Resolution - hash", () => {
  test("ucas hash @string <file> should compute hash without storing", async () => {
    await runCliAlias("init");

    const payloadFile = join(testDir, "payload.json");
    writeFileSync(payloadFile, JSON.stringify("test"));

    const { stdout, stderr, exitCode } = await runCliAlias(
      "hash",
      "@string",
      payloadFile,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });
});

describe("ucas render command", () => {
  test("R1: render requires hash argument", async () => {
    const { exitCode, stderr } = await runCli(["render"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage");
  });

  test("R2: render with missing hash shows error", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);
      const { exitCode, stderr } = await runCli(
        ["render", "ZZZZZZZZZZZZZ"],
        tmpStore,
      );
      // Missing hash should exit with error
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Node not found");
      expect(stderr).toContain("ZZZZZZZZZZZZZ");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("R3: render with invalid numeric flag fails", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);
      const { exitCode, stderr } = await runCli(
        ["render", "AAAAAAAAAAAAA", "--resolution", "invalid"],
        tmpStore,
      );
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("valid number");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });
});

// ---- Issue #50: Schema Validation in put Command ----

describe("Issue #50: Schema Validation in put", () => {
  describe("Test Group 1: Valid Data (Regression Tests)", () => {
    test("T1.1: Valid data matching schema should be accepted", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Create schema with required name property
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Create valid payload
        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({ name: "test" }));

        const { stdout, stderr, exitCode } = await runCli(
          ["put", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);

        // Verify node was stored
        const hash = envValue(stdout) as string;
        const { exitCode: hasExitCode } = await runCli(["has", hash], tmpStore);
        expect(hasExitCode).toBe(0);
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T1.2: Valid data with optional properties should be accepted", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Schema with optional property
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "number" },
            },
            required: ["name"],
            additionalProperties: false,
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Payload with only required properties
        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({ name: "test" }));

        const { exitCode, stdout } = await runCli(
          ["put", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(exitCode).toBe(0);
        expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T1.3: Valid data with nested objects should be accepted", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Schema with nested structure
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: {
              name: { type: "string" },
              address: {
                type: "object",
                properties: {
                  street: { type: "string" },
                  city: { type: "string" },
                },
              },
            },
            additionalProperties: false,
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Payload with nested structure
        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(
          payloadFile,
          JSON.stringify({
            name: "test",
            address: { street: "123 Main", city: "NYC" },
          }),
        );

        const { exitCode, stdout } = await runCli(
          ["put", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(exitCode).toBe(0);
        expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T1.4: Valid data using @ alias for type-hash should be accepted", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify("hello world"));

        const { exitCode, stdout } = await runCli(
          ["put", "@string", payloadFile],
          tmpStore,
        );

        expect(exitCode).toBe(0);
        expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });
  });

  describe("Test Group 2: Type Mismatches (New Validation)", () => {
    test("T2.1: Wrong property type should be rejected", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Schema with name as string
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Payload with name as number
        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({ name: 123 }));

        const { exitCode, stdout, stderr } = await runCli(
          ["put", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(exitCode).toBe(1);
        expect(stdout).toBe("");
        expect(stderr).toContain("Validation failed");
        expect(stderr).toContain(schemaHash.trim());
        expect(stderr).toContain(payloadFile);

        // Verify no node was stored
        const { stdout: hasOutput } = await runCli(
          ["has", "0000000000000"],
          tmpStore,
        );
        expect(envValue(hasOutput)).toBe(false);
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T2.2: Missing required property should be rejected", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Schema with required name
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Empty payload
        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({}));

        const { exitCode, stderr } = await runCli(
          ["put", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Validation failed");
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T2.3: Additional properties when disallowed should be rejected", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Schema with additionalProperties: false
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: { name: { type: "string" } },
            additionalProperties: false,
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Payload with extra property
        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(
          payloadFile,
          JSON.stringify({ name: "test", extra: "not allowed" }),
        );

        const { exitCode, stderr } = await runCli(
          ["put", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Validation failed");
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T2.4: Wrong root type should be rejected", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Schema expecting array
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "array",
            items: { type: "string" },
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Payload is an object
        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({}));

        const { exitCode, stderr } = await runCli(
          ["put", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Validation failed");
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T2.5: Nested type mismatch should be rejected", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Schema with nested object
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: {
              user: {
                type: "object",
                properties: {
                  age: { type: "number" },
                },
              },
            },
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Payload with wrong nested type
        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(
          payloadFile,
          JSON.stringify({ user: { age: "not a number" } }),
        );

        const { exitCode, stderr } = await runCli(
          ["put", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Validation failed");
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });
  });

  describe("Test Group 3: Schema Errors (Edge Cases)", () => {
    test("T3.1: Non-existent type-hash should fail gracefully", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({ name: "test" }));

        const { exitCode, stderr } = await runCli(
          ["put", "ZZZZZZZZZZZZZ", payloadFile],
          tmpStore,
        );

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Schema not found");
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T3.3: Invalid @ alias should fail before validation", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({}));

        const { exitCode, stderr } = await runCli(
          ["put", "@nonexistent", payloadFile],
          tmpStore,
        );

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Schema not found");
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });
  });

  describe("Test Group 4: Integration with Existing Features", () => {
    test("T4.1: Hash command should not validate (dry-run consistency)", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Create schema
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Invalid payload
        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({ name: 123 }));

        // Hash command should succeed even with invalid data
        const { exitCode, stdout } = await runCli(
          ["hash", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(exitCode).toBe(0);
        expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T4.2: Validation respects cas_ref format in schemas", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Schema with cas_ref format
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: {
              ref: { type: "string", format: "cas_ref" },
            },
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Valid cas_ref
        const validFile = join(tmpStore, "valid.json");
        writeFileSync(validFile, JSON.stringify({ ref: "0000000000000" }));

        const { exitCode: validExitCode } = await runCli(
          ["put", schemaHash.trim(), validFile],
          tmpStore,
        );
        expect(validExitCode).toBe(0);

        // Invalid cas_ref (wrong length)
        const invalidFile = join(tmpStore, "invalid.json");
        writeFileSync(invalidFile, JSON.stringify({ ref: "short" }));

        const { exitCode: invalidExitCode, stderr } = await runCli(
          ["put", schemaHash.trim(), invalidFile],
          tmpStore,
        );
        expect(invalidExitCode).not.toBe(0);
        expect(stderr).toContain("Validation failed");
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T4.3: Schema self-validation still works", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Valid schema
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: { name: { type: "string" } },
          }),
        );

        const hash = await putSchemaFile(tmpStore, schemaFile);
        expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });
  });

  describe("Test Group 5: Error Message Quality", () => {
    test("T5.1: Error message should be helpful", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({ name: 123 }));

        const { stderr } = await runCli(
          ["put", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(stderr).toContain("Validation failed");
        expect(stderr).toContain(schemaHash.trim());
        expect(stderr).toContain(payloadFile);
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });

    test("T5.2: Error should go to stderr, not stdout", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
      try {
        await runCli(["init"], tmpStore);

        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: { name: { type: "string" } },
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({ name: 123 }));

        const { stdout, stderr } = await runCli(
          ["put", schemaHash.trim(), payloadFile],
          tmpStore,
        );

        expect(stdout).toBe("");
        expect(stderr.length).toBeGreaterThan(0);
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });
  });
});

describe("Suite 6: CLI Integration with Templates", () => {
  test("6.1 CLI with Template (Default Parameters)", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      // Initialize store
      await runCli(["init"], tmpStore);

      // Create schema
      const schemaFile = join(tmpStore, "schema.json");
      writeFileSync(
        schemaFile,
        JSON.stringify({
          type: "object",
          properties: { name: { type: "string" } },
        }),
      );
      const schemaHash = await putSchemaFile(tmpStore, schemaFile);

      // Create node
      const nodeFile = join(tmpStore, "node.json");
      writeFileSync(nodeFile, JSON.stringify({ name: "Alice" }));
      const { stdout: nodeOut } = await runCli(
        ["put", schemaHash.trim(), nodeFile],
        tmpStore,
      );
      const nodeHash = envValue(nodeOut) as string;

      // Create template file (JSON-encoded string)
      const templateFile = join(tmpStore, "template.json");
      writeFileSync(templateFile, JSON.stringify("Hello {{ payload.name }}!"));
      const { stdout: tmplOut } = await runCli(
        ["put", "@string", templateFile],
        tmpStore,
      );
      const tmplHash = envValue(tmplOut) as string;

      // Register template
      await runCli(
        ["var", "set", `@ucas/template/text/${schemaHash.trim()}`, tmplHash],
        tmpStore,
      );

      // Render with template
      const { stdout: output, exitCode } = await runCli(
        ["render", nodeHash],
        tmpStore,
      );

      expect(exitCode).toBe(0);
      expect(output).toBe("Hello Alice!");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("6.2 CLI with Template + Custom Decay", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      // Create schema with child ref
      const schemaFile = join(tmpStore, "schema.json");
      writeFileSync(
        schemaFile,
        JSON.stringify({
          type: "object",
          properties: {
            value: { type: "string" },
            child: {
              anyOf: [{ type: "string", format: "cas_ref" }, { type: "null" }],
            },
          },
        }),
      );
      const schemaHash = await putSchemaFile(tmpStore, schemaFile);

      // Create child node
      const childFile = join(tmpStore, "child.json");
      writeFileSync(childFile, JSON.stringify({ value: "child", child: null }));
      const { stdout: childOut } = await runCli(
        ["put", schemaHash.trim(), childFile],
        tmpStore,
      );
      const childHash = envValue(childOut) as string;

      // Create parent node
      const parentFile = join(tmpStore, "parent.json");
      writeFileSync(
        parentFile,
        JSON.stringify({ value: "parent", child: childHash }),
      );
      const { stdout: parentOut } = await runCli(
        ["put", schemaHash.trim(), parentFile],
        tmpStore,
      );
      const parentHash = envValue(parentOut) as string;

      // Create template showing resolution (JSON-encoded string)
      const templateFile = join(tmpStore, "template.json");
      writeFileSync(
        templateFile,
        JSON.stringify("{{ payload.value }}(res={{ resolution }})"),
      );
      const { stdout: tmplOut } = await runCli(
        ["put", "@string", templateFile],
        tmpStore,
      );
      const tmplHash = envValue(tmplOut) as string;

      // Register template
      await runCli(
        ["var", "set", `@ucas/template/text/${schemaHash.trim()}`, tmplHash],
        tmpStore,
      );

      // Render with custom decay
      const { stdout: output, exitCode } = await runCli(
        ["render", parentHash, "--decay", "0.7"],
        tmpStore,
      );

      expect(exitCode).toBe(0);
      expect(output).toContain("parent(res=1)");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("6.3 CLI with Template + All Parameters", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      const schemaFile = join(tmpStore, "schema.json");
      writeFileSync(
        schemaFile,
        JSON.stringify({
          type: "object",
          properties: { name: { type: "string" } },
        }),
      );
      const schemaHash = await putSchemaFile(tmpStore, schemaFile);

      const nodeFile = join(tmpStore, "node.json");
      writeFileSync(nodeFile, JSON.stringify({ name: "Bob" }));
      const { stdout: nodeOut } = await runCli(
        ["put", schemaHash.trim(), nodeFile],
        tmpStore,
      );
      const nodeHash = envValue(nodeOut) as string;

      // Create template (JSON-encoded string)
      const templateFile = join(tmpStore, "template.json");
      writeFileSync(
        templateFile,
        JSON.stringify("Greetings {{ payload.name }}!"),
      );
      const { stdout: tmplOut } = await runCli(
        ["put", "@string", templateFile],
        tmpStore,
      );
      const tmplHash = envValue(tmplOut) as string;

      await runCli(
        ["var", "set", `@ucas/template/text/${schemaHash.trim()}`, tmplHash],
        tmpStore,
      );

      const { stdout: output, exitCode } = await runCli(
        [
          "render",
          nodeHash,
          "--resolution",
          "0.8",
          "--decay",
          "0.6",
          "--epsilon",
          "0.005",
        ],
        tmpStore,
      );

      expect(exitCode).toBe(0);
      expect(output).toBe("Greetings Bob!");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("6.4 CLI with Non-templated Node (YAML Fallback)", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      const schemaFile = join(tmpStore, "schema.json");
      writeFileSync(
        schemaFile,
        JSON.stringify({
          type: "object",
          properties: { name: { type: "string" } },
        }),
      );
      const schemaHash = await putSchemaFile(tmpStore, schemaFile);

      const nodeFile = join(tmpStore, "node.json");
      writeFileSync(nodeFile, JSON.stringify({ name: "Charlie" }));
      const { stdout: nodeOut } = await runCli(
        ["put", schemaHash.trim(), nodeFile],
        tmpStore,
      );
      const nodeHash = envValue(nodeOut) as string;

      // No template registered - should fall back to YAML
      const { stdout: output, exitCode } = await runCli(
        ["render", nodeHash],
        tmpStore,
      );

      expect(exitCode).toBe(0);
      expect(output).toContain("name:");
      expect(output).toContain("Charlie");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("6.5 CLI Error: Invalid Decay Value", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      const schemaFile = join(tmpStore, "schema.json");
      writeFileSync(
        schemaFile,
        JSON.stringify({
          type: "object",
          properties: { name: { type: "string" } },
        }),
      );
      const schemaHash = await putSchemaFile(tmpStore, schemaFile);

      const nodeFile = join(tmpStore, "node.json");
      writeFileSync(nodeFile, JSON.stringify({ name: "Test" }));
      const { stdout: nodeOut } = await runCli(
        ["put", schemaHash.trim(), nodeFile],
        tmpStore,
      );
      const nodeHash = envValue(nodeOut) as string;

      const { exitCode, stderr } = await runCli(
        ["render", nodeHash, "--decay", "1.5"],
        tmpStore,
      );

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("decay");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("R8: render with non-existent hash exits with error", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);
      const { exitCode, stderr, stdout } = await runCli(
        ["render", "AAAAAAAAAAAAA"],
        tmpStore,
      );
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Node not found");
      expect(stderr).toContain("AAAAAAAAAAAAA");
      expect(stdout).toBe("");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("R9: render with valid hash exits successfully", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      // Get @string type hash via bootstrap
      const store = createFsStore(tmpStore);
      const types = await bootstrap(store);
      const stringType = types["@string"];

      // Create and store a simple string node
      const nodeFile = join(tmpStore, "test.json");
      writeFileSync(nodeFile, JSON.stringify("hello world"));
      const { stdout: nodeOut } = await runCli(
        ["put", stringType, nodeFile],
        tmpStore,
      );
      const nodeHash = envValue(nodeOut) as string;

      // Render the valid hash
      const { exitCode, stdout, stderr } = await runCli(
        ["render", nodeHash],
        tmpStore,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain("hello world");
      expect(stderr).toBe("");
      expect(stdout).not.toContain("Error");
      expect(stdout).not.toContain("Node not found");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("R10: render --pipe with valid envelope succeeds", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      // Get @string type hash via bootstrap
      const store = createFsStore(tmpStore);
      const types = await bootstrap(store);
      const stringType = types["@string"];

      // Create envelope and pipe to render
      const envelope = JSON.stringify({ type: stringType, value: "test" });
      const { exitCode, stdout, stderr } = await runCliWithStdin(
        ["render", "--pipe"],
        tmpStore,
        envelope,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain("test");
      expect(stderr).toBe("");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("R11: render --pipe with invalid type hash still renders", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      // Use invalid type hash in envelope
      const envelope = JSON.stringify({
        type: "ZZZZZZZZZZZZZ",
        value: "test",
      });
      const { exitCode, stdout, stderr } = await runCliWithStdin(
        ["render", "--pipe"],
        tmpStore,
        envelope,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain("test");
      expect(stderr).toBe("");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });
});

// Store validation tests removed - with auto-bootstrap in Phase 1a,
// stores are automatically created and bootstrapped when opened.
// Issue #55 validation is no longer applicable.
