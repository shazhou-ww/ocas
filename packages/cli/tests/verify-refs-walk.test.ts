import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { envValue, stripVolatile } from "./helpers";

const entrypoint = resolve(import.meta.dirname, "../src/index.ts");

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
  test("1.9 verify returns ok for valid node", async () => {
    const { stdout, exitCode } = await runCli(["verify", nodeHash]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("1.10 refs lists direct references (snapshot)", async () => {
    const { stdout, exitCode } = await runCli(["refs", nodeHash]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  test("1.11 walk shows traversal tree (snapshot)", async () => {
    const { stdout, exitCode } = await runCli(["walk", nodeHash]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot();
  });
});

describe("Phase 2: Schema Validation", () => {
  test("2.2 verify on valid node returns ok (hash + schema)", async () => {
    const { stdout, exitCode } = await runCli(["verify", nodeHash]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toBe("ok");
  });
});
