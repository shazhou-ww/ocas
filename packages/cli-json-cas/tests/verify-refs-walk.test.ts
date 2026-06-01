import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { envValue, stripVolatile } from "./helpers";

const entrypoint = resolve(import.meta.dir, "../src/index.ts");

let tmpStore: string;
let varDbPath: string;
let typeHash: string;
let nodeHash: string;

beforeAll(async () => {
  tmpStore = mkdtempSync(join(tmpdir(), "json-cas-e2e-"));
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
  const { openStore: openFsStore } = await import("@uncaged/json-cas-fs");
  const { putSchema } = await import("@uncaged/json-cas");
  const store = await openFsStore(tmpStore);
  typeHash = await putSchema(
    store,
    JSON.parse(readFileSync(schemaFile, "utf-8")),
  );

  const nodeFile = join(tmpStore, "test-node.json");
  writeFileSync(nodeFile, JSON.stringify({ name: "Alice", age: 30 }));
  const { stdout } = await runCli(["put", typeHash, nodeFile]);
  nodeHash = envValue(stdout) as string;
});

afterAll(() => {
  rmSync(tmpStore, { recursive: true, force: true });
});

async function runCli(
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
