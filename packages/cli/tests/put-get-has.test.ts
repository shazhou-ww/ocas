import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { envValue, stripVolatile } from "./helpers";

const entrypoint = resolve(import.meta.dirname, "../dist/index.js");

let tmpStore: string;
let typeHash: string;
let nodeHash: string;

beforeAll(async () => {
  tmpStore = mkdtempSync(join(tmpdir(), "ocas-e2e-"));

  const schemaFile = join(tmpStore, "test-schema.json");
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
  const { openStore: openFsStore } = await import("@ocas/fs");
  const { putSchema } = await import("@ocas/core");
  const store = await openFsStore(tmpStore);
  typeHash = putSchema(store, JSON.parse(readFileSync(schemaFile, "utf-8")));

  const nodeFile = join(tmpStore, "test-node.json");
  writeFileSync(nodeFile, JSON.stringify({ name: "Alice", age: 30 }));
  const { stdout } = await runCli(["put", typeHash, nodeFile]);
  nodeHash = envValue(stdout) as string;
});

afterAll(() => {
  rmSync(tmpStore, { recursive: true, force: true });
});

function runCli(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execFileSync(
      "node",
      [entrypoint, "--home", tmpStore, ...args],
      {
        encoding: "utf-8",
        timeout: 10000,
      },
    );
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? "").trim(),
      exitCode: err.status ?? 1,
    };
  }
}

describe("Phase 1: CAS Core", () => {
  test("1.1 init + put with @ocas/object bootstraps store", async () => {
    expect(typeHash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("1.5 put returns node hash", async () => {
    expect(nodeHash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("1.6 get returns node JSON (snapshot)", async () => {
    const { stdout, exitCode } = await runCli(["get", nodeHash]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("1.7 has returns true for existing node", async () => {
    const { stdout, exitCode } = await runCli(["has", nodeHash]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toBe(true);
  });

  test("1.8 has returns false for non-existing hash", async () => {
    const { stdout, exitCode } = await runCli(["has", "AAAAAAAAAAAAA"]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toBe(false);
  });

  test("1.12 hash dry-run returns same hash as put", async () => {
    const nodeFile = join(tmpStore, "test-node.json");
    const { stdout, exitCode } = await runCli(["hash", typeHash, nodeFile]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toBe(nodeHash);
  });

  test("1.13 list --type returns nodes of that type", async () => {
    const { stdout, exitCode } = await runCli(["list", "--type", typeHash]);
    expect(exitCode).toBe(0);
    const value = envValue(stdout) as Array<{ hash: string }>;
    expect(value.map((e) => e.hash)).toContain(nodeHash);
  });
});

describe("ocas has predicate contract (#117)", () => {
  test("has returns false for unresolvable bare name", async () => {
    const { stdout, stderr, exitCode } = await runCli(["has", "short"]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(envValue(stdout)).toBe(false);
  });

  test("has returns false for unresolvable @scope/name", async () => {
    const { stdout, exitCode } = await runCli(["has", "@nonexistent/var"]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toBe(false);
  });

  test("has returns true for a registered builtin variable name", async () => {
    const { stdout, exitCode } = await runCli(["has", "@ocas/schema"]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toBe(true);
  });

  test("has envelope type is @ocas/output/has regardless of outcome", async () => {
    const a = await runCli(["has", "short"]);
    const b = await runCli(["has", "@ocas/schema"]);
    const aType = (JSON.parse(a.stdout.trim()) as { type: string }).type;
    const bType = (JSON.parse(b.stdout.trim()) as { type: string }).type;
    expect(aType).toBe(bType);
    expect(envValue(a.stdout)).toBe(false);
    expect(envValue(b.stdout)).toBe(true);
  });

  test("get on unresolvable name dies with 'Unknown hash or variable'", async () => {
    const { stderr, exitCode } = await runCli(["get", "@nonexistent/name"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Unknown hash or variable:");
    expect(stderr).not.toContain("Name not found");
    expect(stderr).not.toContain("Schema not found");
  });
});

// --- Issue #136: tightened resolveHash + has-no-die expansion ---

describe("resolveHash unified error wording (#136)", () => {
  test.each([
    "not-a-hash",
    "foo bar",
    "@/x",
    "@1bad/x",
    "@app/",
    "@app//x",
    "@app/foo!bar",
    "aaaaaaaaaaaaa",
    "AAAAAAAAAAAAAA",
    "@nonexistent/var",
  ])("ocas get %s dies with 'Unknown hash or variable: <input>'", (input) => {
    const { stdout, stderr, exitCode } = runCli(["get", input]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(`Error: Unknown hash or variable: ${input}`);
    expect(stderr).not.toContain("Name not found");
    expect(stderr).not.toContain("Schema not found");
    expect(stdout).toBe("");
  });

  test.each([
    "verify",
    "refs",
    "walk",
    "render",
  ])("ocas %s not-a-hash emits the same unified error", (cmd) => {
    const { stderr, exitCode } = runCli([cmd, "not-a-hash"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Unknown hash or variable: not-a-hash");
  });

  test("ocas put not-a-hash <file> fails on the type-hash arg with the unified error", () => {
    const payloadFile = join(tmpStore, "payload-136.json");
    writeFileSync(payloadFile, JSON.stringify({ name: "x" }));
    const { stderr, exitCode } = runCli(["put", "not-a-hash", payloadFile]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Unknown hash or variable: not-a-hash");
  });

  test("ocas hash not-a-hash <file> fails on the type-hash arg with the unified error", () => {
    const payloadFile = join(tmpStore, "payload-136.json");
    writeFileSync(payloadFile, JSON.stringify({ name: "x" }));
    const { stderr, exitCode } = runCli(["hash", "not-a-hash", payloadFile]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Unknown hash or variable: not-a-hash");
  });

  test("Schema not found wording is preserved when a valid hash resolves but no schema lives at it", () => {
    const payloadFile = join(tmpStore, "payload-136.json");
    writeFileSync(payloadFile, JSON.stringify({ name: "x" }));
    const { stderr, exitCode } = runCli(["put", "AAAAAAAAAAAAA", payloadFile]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Schema not found: AAAAAAAAAAAAA");
  });
});

describe("ocas has never dies (#136 full enumeration)", () => {
  test.each([
    ["not-a-hash", "malformed: not a hash, fails @scope/name format"],
    ["foo bar", "malformed: contains a space"],
    ["@/x", "malformed: empty scope"],
    ["@1bad/x", "malformed: scope starts with a digit"],
    ["@app/", "malformed: trailing slash"],
    ["@app//x", "malformed: empty segment"],
    ["@app/foo!bar", "malformed: illegal character"],
    ["aaaaaaaaaaaaa", "malformed: lowercase fails uppercase Crockford regex"],
    ["AAAAAAAAAAAAAA", "malformed: 14 chars, wrong length"],
    ["@nonexistent/var", "valid format but unregistered"],
    ["AAAAAAAAAAAAA", "valid hash format but absent from CAS"],
  ])("has %s returns {value:false}, exit 0 (%s)", (input) => {
    const { stdout, stderr, exitCode } = runCli(["has", input]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(envValue(stdout)).toBe(false);
  });
});
