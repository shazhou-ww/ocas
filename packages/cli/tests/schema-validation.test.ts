import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { envValue, putSchemaFile, runCli } from "./helpers";

// ---- Issue #50: Schema Validation in put Command ----

describe("Issue #50: Schema Validation in put", () => {
  describe("Test Group 1: Valid Data (Regression Tests)", () => {
    test("T1.1: Valid data matching schema should be accepted", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
      try {
        await runCli(["init"], tmpStore);

        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify("hello world"));

        const { exitCode, stdout } = await runCli(
          ["put", "@ocas/string", payloadFile],
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
      try {
        await runCli(["init"], tmpStore);

        const payloadFile = join(tmpStore, "payload.json");
        writeFileSync(payloadFile, JSON.stringify({}));

        const { exitCode, stderr } = await runCli(
          ["put", "@nonexistent", payloadFile],
          tmpStore,
        );

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Unknown hash or variable");
      } finally {
        rmSync(tmpStore, { recursive: true, force: true });
      }
    });
  });

  describe("Test Group 4: Integration with Existing Features", () => {
    test("T4.1: Hash command should not validate (dry-run consistency)", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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

    test("T4.2: Validation respects ocas_ref format in schemas", async () => {
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
      try {
        await runCli(["init"], tmpStore);

        // Schema with ocas_ref format
        const schemaFile = join(tmpStore, "schema.json");
        writeFileSync(
          schemaFile,
          JSON.stringify({
            type: "object",
            properties: {
              ref: { type: "string", format: "ocas_ref" },
            },
          }),
        );
        const schemaHash = await putSchemaFile(tmpStore, schemaFile);

        // Valid ocas_ref
        const validFile = join(tmpStore, "valid.json");
        writeFileSync(validFile, JSON.stringify({ ref: "0000000000000" }));

        const { exitCode: validExitCode } = await runCli(
          ["put", schemaHash.trim(), validFile],
          tmpStore,
        );
        expect(validExitCode).toBe(0);

        // Invalid ocas_ref (wrong length)
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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
      const tmpStore = mkdtempSync(join(tmpdir(), "ocas-test-"));
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

// e2e Phase 2 tests
describe("Phase 2: Schema Validation", () => {
  let tmpStore: string;
  let typeHash: string;
  let _nodeHash: string;

  const entrypoint = resolve(import.meta.dirname, "../dist/index.js");

  beforeAll(async () => {
    tmpStore = mkdtempSync(join(tmpdir(), "ocas-e2e-"));

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
    typeHash = putSchema(store, JSON.parse(readFileSync(schemaFile, "utf-8")));

    const nodeFile = join(tmpStore, "test-node.json");
    writeFileSync(nodeFile, JSON.stringify({ name: "Alice", age: 30 }));
    const stdout = execFileSync(
      "node",
      [entrypoint, "--home", tmpStore, "put", typeHash, nodeFile, "--json"],
      {
        encoding: "utf-8",
        timeout: 10000,
      },
    ).trim();
    _nodeHash = envValue(stdout) as string;
  });

  afterAll(() => {
    rmSync(tmpStore, { recursive: true, force: true });
  });

  test("2.1 put {name:123} against string-schema fails with non-zero exit", async () => {
    const badFile = join(tmpStore, "bad-node.json");
    writeFileSync(badFile, JSON.stringify({ name: 123 }));
    let stdout = "",
      stderr = "",
      exitCode = 0;
    try {
      stdout = execFileSync(
        "node",
        [entrypoint, "--home", tmpStore, "put", typeHash, badFile],
        {
          encoding: "utf-8",
          timeout: 10000,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        },
      ).trim();
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      stdout = (err.stdout ?? "").trim();
      stderr = (err.stderr ?? "").trim();
      exitCode = err.status ?? 1;
    }
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Validation failed");
    expect(stderr).toContain(typeHash);
  });

  test("2.3 put against non-existent schema hash fails", async () => {
    const nodeFile = join(tmpStore, "test-node.json");
    let exitCode = 0,
      stderr = "";
    try {
      execFileSync(
        "node",
        [entrypoint, "--home", tmpStore, "put", "AAAAAAAAAAAAA", nodeFile],
        {
          encoding: "utf-8",
          timeout: 10000,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        },
      );
    } catch (e: unknown) {
      const err = e as { stderr?: string; status?: number };
      stderr = (err.stderr ?? "").trim();
      exitCode = err.status ?? 1;
    }
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatchSnapshot();
  });
});
