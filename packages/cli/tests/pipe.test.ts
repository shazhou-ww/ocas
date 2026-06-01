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
  const { stdout } = await runCli(["put", typeHash, nodeFile]);
  nodeHash = envValue(stdout) as string;

  // Set up template for render tests
  const tmplFile = join(tmpStore, "render-template.liquid");
  writeFileSync(tmplFile, "Hello {{ payload.name }}!");
  await runCli(["template", "set", typeHash, tmplFile]);
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

async function runCliWithStdin(
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

// ---- Phase 8: Pipe Composition ----

describe("Phase 8: Pipe Composition", () => {
  test("8.1 put | render -p expands the stored hash to its content", async () => {
    const nodeFile = join(tmpStore, "pipe-node.json");
    writeFileSync(nodeFile, JSON.stringify({ name: "Bob", age: 42 }));

    const { stdout: putOut, exitCode: putExit } = await runCli([
      "put",
      typeHash,
      nodeFile,
    ]);
    expect(putExit).toBe(0);

    // The put envelope value is a cas_ref hash; render -p dereferences it and
    // renders the stored node's payload.
    const { stdout, exitCode } = await runCliWithStdin(
      ["render", "--pipe"],
      putOut,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Bob");
  });

  test("8.3 list --type @schema emits a parseable envelope of hashes", async () => {
    const { stdout, exitCode } = await runCli(["list", "--type", "@schema"]);
    expect(exitCode).toBe(0);

    // Downstream consumers (jq, etc.) read the `value` array of hashes.
    const value = envValue(stdout) as string[];
    expect(Array.isArray(value)).toBe(true);
    for (const hash of value) {
      expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    }
  });

  test("8.4 list --type @schema | render -p expands the schema list", async () => {
    const { stdout: listOut } = await runCli(["list", "--type", "@schema"]);
    // list result items are cas_ref hashes; render -p dereferences each one
    // and renders the schema contents.
    const { stdout, exitCode } = await runCliWithStdin(
      ["render", "--pipe"],
      listOut,
    );
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  test("8.5 render <hash> uses a registered template", async () => {
    // Register a template for the schema, then render a fresh node by hash.
    const tmplFile = join(tmpStore, "pipe-render.liquid");
    writeFileSync(tmplFile, "Person: {{ payload.name }} ({{ payload.age }})");
    const { exitCode: setExit } = await runCli([
      "template",
      "set",
      typeHash,
      tmplFile,
    ]);
    expect(setExit).toBe(0);

    const nodeFile = join(tmpStore, "pipe-render-node.json");
    writeFileSync(nodeFile, JSON.stringify({ name: "Carol", age: 25 }));
    const { stdout: putOut } = await runCli(["put", typeHash, nodeFile]);
    const freshHash = envValue(putOut) as string;

    const { stdout, exitCode } = await runCli(["render", freshHash]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("Person: Carol (25)");
  });
});

// ---- Phase 9: Put/Hash Pipe Input ----

describe("Phase 9: Put/Hash Pipe Input", () => {
  test("9.1 put -p reads JSON from stdin and stores node", async () => {
    const payload = JSON.stringify({ name: "PipeAlice", age: 99 });
    const { stdout, exitCode } = await runCliWithStdin(
      ["put", typeHash, "-p"],
      payload,
    );
    expect(exitCode).toBe(0);
    const hash = envValue(stdout);
    expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);

    // Verify stored correctly
    const { stdout: getOut } = await runCli(["get", hash as string]);
    expect(getOut).toContain("PipeAlice");
  });

  test("9.2 hash -p reads JSON from stdin and computes hash without storing", async () => {
    const payload = JSON.stringify({ name: "PipeBob", age: 55 });
    const { stdout, exitCode } = await runCliWithStdin(
      ["hash", typeHash, "-p"],
      payload,
    );
    expect(exitCode).toBe(0);
    const hash = envValue(stdout);
    expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);

    // Should NOT be stored
    const { exitCode: hasExit, stdout: hasOut } = await runCli([
      "has",
      hash as string,
    ]);
    expect(hasExit).toBe(0);
    expect(envValue(hasOut)).toBe(false);
  });

  test("9.3 put -p with file arg errors", async () => {
    const { stderr, exitCode } = await runCliWithStdin(
      ["put", typeHash, "some-file.json", "-p"],
      "{}",
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Cannot use --pipe/-p with a file argument");
  });

  test("9.4 put -p with empty stdin errors", async () => {
    const { stderr, exitCode } = await runCliWithStdin(
      ["put", typeHash, "-p"],
      "",
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("No input on stdin");
  });

  test("9.5 put -p with invalid JSON errors", async () => {
    const { stderr, exitCode } = await runCliWithStdin(
      ["put", typeHash, "-p"],
      "not json",
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Invalid JSON on stdin");
  });
});
