import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOOTSTRAP_STORE } from "@ocas/core";
import { openStore as openFsStore } from "@ocas/fs";
import { envValue, runCli } from "./helpers.js";

let storePath: string;

beforeEach(() => {
  storePath = mkdtempSync(join(tmpdir(), "ocas-list-meta-schema-"));
  mkdirSync(storePath, { recursive: true });
});

afterEach(() => {
  rmSync(storePath, { recursive: true, force: true });
});

describe("list-meta CLI command", () => {
  test("E1. list-meta on bootstrapped store contains exactly the meta-schema hash", async () => {
    // First, get @ocas/schema hash by calling has on it (also triggers bootstrap)
    const { stdout: hashOut, exitCode: hashCode } = await runCli(
      ["hash", "@ocas/schema", "--pipe"],
      storePath,
    );
    // ensure bootstrap by running a no-op command:
    void hashOut;
    void hashCode;

    // Bootstrap fully via 'list --type @ocas/schema'
    const { stdout: schemaListOut } = await runCli(
      ["list", "--type", "@ocas/schema"],
      storePath,
    );
    const schemaList = envValue(schemaListOut) as Array<{ hash: string }>;
    expect(Array.isArray(schemaList)).toBe(true);

    const { stdout, stderr, exitCode } = await runCli(["list-meta"], storePath);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const parsed = JSON.parse(stdout) as {
      type: string;
      value: Array<{ hash: string; created: number; updated: number }>;
    };
    expect(parsed.type).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    expect(Array.isArray(parsed.value)).toBe(true);
    expect(parsed.value).toHaveLength(1);
    const first = parsed.value[0] as { hash: string };
    expect(first.hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
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
  test("@ocas/output/list-meta and @ocas/output/list-schema schemas exist", async () => {
    const { stdout, exitCode } = await runCli(["list-meta"], storePath);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { type: string };
    // type hash references the @ocas/output/list-meta schema, must be retrievable
    const { stdout: getOut, exitCode: getCode } = await runCli(
      ["get", parsed.type],
      storePath,
    );
    expect(getCode).toBe(0);
    const node = envValue(getOut) as {
      payload: { title?: string };
    };
    expect(node.payload.title).toBe("ocas list-meta result");

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
    expect(schNode.payload.title).toBe("ocas list-schema result");
  });
});

describe("E4. list-schema vs list --type with multiple meta-schema versions", () => {
  test("list-schema includes schemas typed by older meta-schemas; list --type @ocas/schema does not", async () => {
    // Set up two distinct meta-schemas via the library
    const store = await openFsStore(storePath);
    const m1 = await store.cas[BOOTSTRAP_STORE]({
      type: "object",
      title: "meta-v1",
    });
    const m2 = await store.cas[BOOTSTRAP_STORE]({
      type: "object",
      title: "meta-v2",
    });
    // schema typed by older meta M1
    const sM1 = store.cas.put(m1, { type: "string" });
    expect(m1).not.toBe(m2);

    // CLI: list-schema must include sM1
    const { stdout: lsOut, exitCode: lsCode } = await runCli(
      ["list-schema"],
      storePath,
    );
    expect(lsCode).toBe(0);
    const lsHashes = (envValue(lsOut) as Array<{ hash: string }>).map(
      (e) => e.hash,
    );
    expect(lsHashes).toContain(sM1);
    expect(lsHashes).toContain(m1);
    expect(lsHashes).toContain(m2);

    // CLI: list --type <M2 hash> must NOT include sM1
    const { stdout: ltOut, exitCode: ltCode } = await runCli(
      ["list", "--type", m2],
      storePath,
    );
    expect(ltCode).toBe(0);
    const ltHashes = (envValue(ltOut) as Array<{ hash: string }>).map(
      (e) => e.hash,
    );
    expect(ltHashes).not.toContain(sM1);

    // list-schema.value.length > list --type <newest>.value.length
    expect(lsHashes.length).toBeGreaterThan(ltHashes.length);
  });
});
