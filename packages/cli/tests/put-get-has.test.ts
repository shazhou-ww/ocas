import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

function runCli(
  args: string[],
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [entrypoint, "--home", tmpStore, ...args], {
      encoding: "utf-8",
      timeout: 10000,
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (err.stdout ?? "").trim(), stderr: (err.stderr ?? "").trim(), exitCode: err.status ?? 1 };
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
