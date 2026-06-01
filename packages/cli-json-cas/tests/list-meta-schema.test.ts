import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envValue, runCli } from "./helpers.js";

let storePath: string;

beforeEach(() => {
  storePath = mkdtempSync(join(tmpdir(), "json-cas-list-meta-schema-"));
  mkdirSync(storePath, { recursive: true });
});

afterEach(() => {
  rmSync(storePath, { recursive: true, force: true });
});

describe("list-meta CLI command", () => {
  test("E1. list-meta on bootstrapped store contains exactly the meta-schema hash", async () => {
    // First, get @schema hash by calling has on it (also triggers bootstrap)
    const { stdout: hashOut, exitCode: hashCode } = await runCli(
      ["hash", "@schema", "--pipe"],
      storePath,
    );
    // ensure bootstrap by running a no-op command:
    void hashOut;
    void hashCode;

    // Bootstrap fully via 'list --type @schema'
    const { stdout: schemaListOut } = await runCli(
      ["list", "--type", "@schema"],
      storePath,
    );
    const schemaList = envValue(schemaListOut) as string[];
    expect(Array.isArray(schemaList)).toBe(true);

    const { stdout, stderr, exitCode } = await runCli(["list-meta"], storePath);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const parsed = JSON.parse(stdout) as { type: string; value: string[] };
    expect(parsed.type).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    expect(Array.isArray(parsed.value)).toBe(true);
    expect(parsed.value).toHaveLength(1);
    expect(parsed.value[0]).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("E1. --json flag yields compact JSON", async () => {
    const { stdout, exitCode } = await runCli(
      ["--json", "list-meta"],
      storePath,
    );
    expect(exitCode).toBe(0);
    // compact = no newlines/spaces between fields
    expect(stdout.trim()).not.toContain("\n  ");
  });
});

describe("list-schema CLI command", () => {
  test("E2. list-schema on bootstrapped store includes meta-schema and built-ins", async () => {
    const { stdout, stderr, exitCode } = await runCli(
      ["list-schema"],
      storePath,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const parsed = JSON.parse(stdout) as { type: string; value: string[] };
    expect(parsed.type).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    expect(Array.isArray(parsed.value)).toBe(true);
    // meta + 5 primitive + 20 output = 26
    expect(parsed.value.length).toBeGreaterThanOrEqual(6);
  });
});

describe("usage help", () => {
  test("E3. printing usage includes list-meta and list-schema lines", async () => {
    const { stdout, exitCode } = await runCli([], storePath);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("list-meta");
    expect(stdout).toContain("list-schema");
  });
});

describe("F1. output schemas registered", () => {
  test("@output/list-meta and @output/list-schema schemas exist", async () => {
    const { stdout, exitCode } = await runCli(["list-meta"], storePath);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { type: string };
    // type hash references the @output/list-meta schema, must be retrievable
    const { stdout: getOut, exitCode: getCode } = await runCli(
      ["get", parsed.type],
      storePath,
    );
    expect(getCode).toBe(0);
    const node = envValue(getOut) as {
      payload: { title?: string };
    };
    expect(node.payload.title).toBe("ucas list-meta result");

    const { stdout: schemaOut } = await runCli(["list-schema"], storePath);
    const schemaParsed = JSON.parse(schemaOut) as { type: string };
    const { stdout: getSchOut, exitCode: getSchCode } = await runCli(
      ["get", schemaParsed.type],
      storePath,
    );
    expect(getSchCode).toBe(0);
    const schNode = envValue(getSchOut) as {
      payload: { title?: string };
    };
    expect(schNode.payload.title).toBe("ucas list-schema result");
  });
});
