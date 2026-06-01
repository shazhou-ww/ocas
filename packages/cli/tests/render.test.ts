import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bootstrap } from "@ocas/core";
import { createFsStore } from "@ocas/fs";
import { envValue, putSchemaFile, runCli, runCliWithStdin } from "./helpers";

const entrypoint = resolve(import.meta.dir, "../src/index.ts");

// --- Standalone render tests from cli.test.ts ---

describe("ocas render command", () => {
  test("R1: render requires hash argument", async () => {
    const { exitCode, stderr } = await runCli(["render"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage");
  });

  test("R2: render with missing hash shows error", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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

// --- e2e Phase 5: Render ---

describe("Phase 5: Render", () => {
  let tmpStore: string;
  let varDbPath: string;
  let typeHash: string;
  let nodeHash: string;

  async function runCliE2e(
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(
      ["bun", entrypoint, "--store", tmpStore, "--var-db", varDbPath, ...args],
      { stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stdout = (await new Response(proc.stdout).text()).trim();
    const stderr = (await new Response(proc.stderr).text()).trim();
    return { stdout, stderr, exitCode };
  }

  async function runCliE2eWithStdin(
    args: string[],
    stdin: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(
      ["bun", entrypoint, "--store", tmpStore, "--var-db", varDbPath, ...args],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    proc.stdin.write(stdin);
    proc.stdin.end();
    const exitCode = await proc.exited;
    const stdout = (await new Response(proc.stdout).text()).trim();
    const stderr = (await new Response(proc.stderr).text()).trim();
    return { stdout, stderr, exitCode };
  }

  beforeAll(async () => {
    tmpStore = mkdtempSync(join(tmpdir(), "ocas-e2e-"));
    varDbPath = join(tmpStore, "variables.db");

    const schemaFile = join(tmpStore, "test-schema.json");
    writeFileSync(
      schemaFile,
      JSON.stringify({
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name"],
        additionalProperties: false,
      }),
    );
    const { openStore: openFsStore } = await import("@ocas/fs");
    const { putSchema } = await import("@ocas/core");
    const store = await openFsStore(tmpStore);
    typeHash = await putSchema(
      store,
      JSON.parse(readFileSync(schemaFile, "utf-8")),
    );

    const nodeFile = join(tmpStore, "test-node.json");
    writeFileSync(nodeFile, JSON.stringify({ name: "Alice", age: 30 }));
    const { stdout } = await runCliE2e(["put", typeHash, nodeFile]);
    nodeHash = envValue(stdout) as string;

    // Register template for render tests
    const tmplFile = join(tmpStore, "render-template.liquid");
    writeFileSync(tmplFile, "Hello {{ payload.name }}!");
    await runCliE2e(["template", "set", typeHash, tmplFile]);
  });

  afterAll(() => {
    rmSync(tmpStore, { recursive: true, force: true });
  });

  test("5.1 render fills payload variables", async () => {
    const { stdout, exitCode } = await runCliE2e(["render", nodeHash]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("Hello Alice!");
    expect(stdout).toMatchSnapshot();
  });

  test("5.2 render --resolution with different value", async () => {
    const { stdout, exitCode } = await runCliE2e([
      "render",
      nodeHash,
      "--resolution",
      "0.5",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  test("5.3 render non-existent hash fails with error", async () => {
    const { stderr, exitCode } = await runCliE2e(["render", "ZZZZZZZZZZZZZ"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Node not found");
    expect(stderr).toContain("ZZZZZZZZZZZZZ");
  });
});

// --- Suite 6: CLI Integration with Templates (from cli.test.ts) ---

describe("Suite 6: CLI Integration with Templates", () => {
  test("6.1 CLI with Template (Default Parameters)", async () => {
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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

      // Register template via template set --inline
      await runCli(
        [
          "template",
          "set",
          schemaHash.trim(),
          "--inline",
          "Hello {{ payload.name }}!",
        ],
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
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
              anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
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

      // Register template via template set --inline
      await runCli(
        [
          "template",
          "set",
          schemaHash.trim(),
          "--inline",
          "{{ payload.value }}(res={{ resolution }})",
        ],
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
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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

      // Register template via template set --inline
      await runCli(
        [
          "template",
          "set",
          schemaHash.trim(),
          "--inline",
          "Greetings {{ payload.name }}!",
        ],
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
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
    try {
      await runCli(["init"], tmpStore);

      // Get @string type hash via bootstrap
      const store = createFsStore(tmpStore);
      const types = await bootstrap(store);
      const stringType = types["@ocas/string"];

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
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
    try {
      await runCli(["init"], tmpStore);

      // Get @string type hash via bootstrap
      const store = createFsStore(tmpStore);
      const types = await bootstrap(store);
      const stringType = types["@ocas/string"];

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
    const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
