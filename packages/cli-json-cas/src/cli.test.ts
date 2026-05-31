import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const pkgPath = resolve(import.meta.dir, "../package.json");
const entrypoint = resolve(import.meta.dir, "index.ts");

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

describe("@ Alias Resolution - schema get", () => {
  test("ucas schema get @string should work", async () => {
    await runCliAlias("init"); // Initialize store

    const { stdout, stderr, exitCode } = await runCliAlias(
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
    await runCliAlias("init");

    const { stdout, exitCode } = await runCliAlias("schema", "get", "@number");

    expect(exitCode).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema).toEqual({ type: "number" });
  });

  test("ucas schema get @object should work", async () => {
    await runCliAlias("init");

    const { stdout, exitCode } = await runCliAlias("schema", "get", "@object");

    expect(exitCode).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema).toEqual({ type: "object" });
  });

  test("ucas schema get @array should work", async () => {
    await runCliAlias("init");

    const { stdout, exitCode } = await runCliAlias("schema", "get", "@array");

    expect(exitCode).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema).toEqual({ type: "array" });
  });

  test("ucas schema get @bool should work", async () => {
    await runCliAlias("init");

    const { stdout, exitCode } = await runCliAlias("schema", "get", "@bool");

    expect(exitCode).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema).toEqual({ type: "boolean" });
  });

  test("ucas schema get @schema should work", async () => {
    await runCliAlias("init");

    const { stdout, exitCode } = await runCliAlias("schema", "get", "@schema");

    expect(exitCode).toBe(0);
    const schema = JSON.parse(stdout);
    expect(schema).toHaveProperty("type", "object");
    expect(schema).toHaveProperty(
      "description",
      "json-cas JSON Schema meta-schema",
    );
  });

  test("ucas schema get @invalid should fail gracefully", async () => {
    await runCliAlias("init");

    const { stderr, exitCode } = await runCliAlias("schema", "get", "@invalid");

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Schema not found");
  });
});

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
    // Should output a valid hash (13 chars)
    expect(stdout).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
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
    expect(stdout).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
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
    expect(stdout).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
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
    expect(stdout).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
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
      const { exitCode, stdout } = await runCli(
        ["render", "ZZZZZZZZZZZZZ"],
        tmpStore,
      );
      // Missing hash renders as cas: reference
      expect(exitCode).toBe(0);
      expect(stdout).toContain("cas:ZZZZZZZZZZZZZ");
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
      const { stdout: schemaHash } = await runCli(
        ["schema", "put", schemaFile],
        tmpStore,
      );

      // Create node
      const nodeFile = join(tmpStore, "node.json");
      writeFileSync(nodeFile, JSON.stringify({ name: "Alice" }));
      const { stdout: nodeHash } = await runCli(
        ["put", schemaHash.trim(), nodeFile],
        tmpStore,
      );

      // Create template file (JSON-encoded string)
      const templateFile = join(tmpStore, "template.json");
      writeFileSync(templateFile, JSON.stringify("Hello {{ payload.name }}!"));
      const { stdout: tmplHash } = await runCli(
        ["put", "@string", templateFile],
        tmpStore,
      );

      // Register template
      await runCli(
        [
          "var",
          "set",
          `@ucas/template/text/${schemaHash.trim()}`,
          tmplHash.trim(),
        ],
        tmpStore,
      );

      // Render with template
      const { stdout: output, exitCode } = await runCli(
        ["render", nodeHash.trim()],
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
      const { stdout: schemaHash } = await runCli(
        ["schema", "put", schemaFile],
        tmpStore,
      );

      // Create child node
      const childFile = join(tmpStore, "child.json");
      writeFileSync(childFile, JSON.stringify({ value: "child", child: null }));
      const { stdout: childHash } = await runCli(
        ["put", schemaHash.trim(), childFile],
        tmpStore,
      );

      // Create parent node
      const parentFile = join(tmpStore, "parent.json");
      writeFileSync(
        parentFile,
        JSON.stringify({ value: "parent", child: childHash.trim() }),
      );
      const { stdout: parentHash } = await runCli(
        ["put", schemaHash.trim(), parentFile],
        tmpStore,
      );

      // Create template showing resolution (JSON-encoded string)
      const templateFile = join(tmpStore, "template.json");
      writeFileSync(
        templateFile,
        JSON.stringify("{{ payload.value }}(res={{ resolution }})"),
      );
      const { stdout: tmplHash } = await runCli(
        ["put", "@string", templateFile],
        tmpStore,
      );

      // Register template
      await runCli(
        [
          "var",
          "set",
          `@ucas/template/text/${schemaHash.trim()}`,
          tmplHash.trim(),
        ],
        tmpStore,
      );

      // Render with custom decay
      const { stdout: output, exitCode } = await runCli(
        ["render", parentHash.trim(), "--decay", "0.7"],
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
      const { stdout: schemaHash } = await runCli(
        ["schema", "put", schemaFile],
        tmpStore,
      );

      const nodeFile = join(tmpStore, "node.json");
      writeFileSync(nodeFile, JSON.stringify({ name: "Bob" }));
      const { stdout: nodeHash } = await runCli(
        ["put", schemaHash.trim(), nodeFile],
        tmpStore,
      );

      // Create template (JSON-encoded string)
      const templateFile = join(tmpStore, "template.json");
      writeFileSync(
        templateFile,
        JSON.stringify("Greetings {{ payload.name }}!"),
      );
      const { stdout: tmplHash } = await runCli(
        ["put", "@string", templateFile],
        tmpStore,
      );

      await runCli(
        [
          "var",
          "set",
          `@ucas/template/text/${schemaHash.trim()}`,
          tmplHash.trim(),
        ],
        tmpStore,
      );

      const { stdout: output, exitCode } = await runCli(
        [
          "render",
          nodeHash.trim(),
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
      const { stdout: schemaHash } = await runCli(
        ["schema", "put", schemaFile],
        tmpStore,
      );

      const nodeFile = join(tmpStore, "node.json");
      writeFileSync(nodeFile, JSON.stringify({ name: "Charlie" }));
      const { stdout: nodeHash } = await runCli(
        ["put", schemaHash.trim(), nodeFile],
        tmpStore,
      );

      // No template registered - should fall back to YAML
      const { stdout: output, exitCode } = await runCli(
        ["render", nodeHash.trim()],
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
      const { stdout: schemaHash } = await runCli(
        ["schema", "put", schemaFile],
        tmpStore,
      );

      const nodeFile = join(tmpStore, "node.json");
      writeFileSync(nodeFile, JSON.stringify({ name: "Test" }));
      const { stdout: nodeHash } = await runCli(
        ["put", schemaHash.trim(), nodeFile],
        tmpStore,
      );

      const { exitCode, stderr } = await runCli(
        ["render", nodeHash.trim(), "--decay", "1.5"],
        tmpStore,
      );

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("decay");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });
});

// ---- schema put - invalid schema error handling ----

describe("schema put - invalid schema error handling", () => {
  test("invalid schema - unknown type value shows clean error", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      const schemaFile = join(tmpStore, "invalid-schema.json");
      writeFileSync(schemaFile, JSON.stringify({ type: "invalid" }));

      const { exitCode, stderr, stdout } = await runCli(
        ["schema", "put", schemaFile],
        tmpStore,
      );

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Invalid schema");
      expect(stderr).not.toContain("at ");
      expect(stdout).toBe("");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("invalid schema - unknown key shows clean error", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      const schemaFile = join(tmpStore, "invalid-schema.json");
      writeFileSync(
        schemaFile,
        JSON.stringify({ type: "string", unknownKey: true }),
      );

      const { exitCode, stderr, stdout } = await runCli(
        ["schema", "put", schemaFile],
        tmpStore,
      );

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Invalid schema");
      expect(stderr).not.toContain("at ");
      expect(stdout).toBe("");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("invalid schema - invalid nested schema shows clean error", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      const schemaFile = join(tmpStore, "invalid-schema.json");
      writeFileSync(
        schemaFile,
        JSON.stringify({
          type: "object",
          properties: {
            name: { type: "invalid" },
          },
        }),
      );

      const { exitCode, stderr, stdout } = await runCli(
        ["schema", "put", schemaFile],
        tmpStore,
      );

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Invalid schema");
      expect(stderr).not.toContain("at ");
      expect(stdout).toBe("");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("invalid schema - non-object root shows clean error", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      const schemaFile = join(tmpStore, "invalid-schema.json");
      writeFileSync(schemaFile, JSON.stringify(["type", "string"]));

      const { exitCode, stderr, stdout } = await runCli(
        ["schema", "put", schemaFile],
        tmpStore,
      );

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Invalid schema");
      expect(stderr).not.toContain("at ");
      expect(stdout).toBe("");
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });

  test("valid schema still works (regression)", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "json-cas-test-"));
    try {
      await runCli(["init"], tmpStore);

      const schemaFile = join(tmpStore, "valid-schema.json");
      writeFileSync(
        schemaFile,
        JSON.stringify({
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name"],
        }),
      );

      const { exitCode, stderr, stdout } = await runCli(
        ["schema", "put", schemaFile],
        tmpStore,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.trim()).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    } finally {
      rmSync(tmpStore, { recursive: true, force: true });
    }
  });
});
