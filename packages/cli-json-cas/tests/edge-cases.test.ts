import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { envValue, stripVolatile } from "./helpers";

const entrypoint = resolve(import.meta.dir, "../src/index.ts");
const pkgPath = resolve(import.meta.dir, "../package.json");

// --- ucas command alias tests (from cli.test.ts) ---

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

// --- e2e Phase 7: Edge Cases ---

describe("Phase 7: Edge Cases", () => {
  let tmpStore: string;
  let varDbPath: string;
  let typeHash: string;
  let nodeHash: string;

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
    typeHash = await putSchema(store, JSON.parse(readFileSync(schemaFile, "utf-8")));

    const nodeFile = join(tmpStore, "test-node.json");
    writeFileSync(nodeFile, JSON.stringify({ name: "Alice", age: 30 }));
    const { stdout } = await runCli(["put", typeHash, nodeFile]);
    nodeHash = envValue(stdout) as string;
  });

  afterAll(() => {
    rmSync(tmpStore, { recursive: true, force: true });
  });

  test("7.1 get non-existent hash errors gracefully", async () => {
    const { stderr, exitCode } = await runCli(["get", "AAAAAAAAAAAAA"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatchSnapshot();
  });

  test("7.2 put with non-existent file errors with ENOENT", async () => {
    const { stderr, exitCode } = await runCli([
      "put",
      typeHash,
      "/nonexistent/file.json",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("ENOENT");
  });

  test("7.3 var set empty name errors", async () => {
    const { stderr, exitCode } = await runCli(["var", "set", "", nodeHash]);
    expect(exitCode).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).toMatchSnapshot();
  });

  test("7.4 var set name with invalid chars errors", async () => {
    const { stderr, exitCode } = await runCli([
      "var",
      "set",
      "invalid name!",
      nodeHash,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).toMatchSnapshot();
  });

  test("7.5 no subcommand shows help text", async () => {
    const { stdout, stderr, exitCode: _exitCode } = await runCli([]);
    const combined = stdout + stderr;
    expect(combined.length).toBeGreaterThan(0);
    expect(combined).toMatchSnapshot();
    expect(combined.toLowerCase()).toContain("usage");
  });

  test("7.6 --store path is a file errors", async () => {
    const fileAsStore = join(tmpStore, "not-a-directory");
    writeFileSync(fileAsStore, "test");
    const proc = Bun.spawn(
      [
        "bun",
        entrypoint,
        "--store",
        fileAsStore,
        "--var-db",
        varDbPath,
        "get",
        "AAAAAAAAAAAAA",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stderr = (await new Response(proc.stderr).text()).trim();
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("not a directory");
  });
});

// --- e2e Phase 3: Variable System (edge cases from e2e.test.ts) ---

describe("Phase 3: Variable System", () => {
  let tmpStore: string;
  let varDbPath: string;
  let typeHash: string;
  let nodeHash: string;

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
    typeHash = await putSchema(store, JSON.parse(readFileSync(schemaFile, "utf-8")));

    const nodeFile = join(tmpStore, "test-node.json");
    writeFileSync(nodeFile, JSON.stringify({ name: "Alice", age: 30 }));
    const { stdout } = await runCli(["put", typeHash, nodeFile]);
    nodeHash = envValue(stdout) as string;
  });

  afterAll(() => {
    rmSync(tmpStore, { recursive: true, force: true });
  });

  test("3.1 var set creates variable", async () => {
    const { exitCode, stdout } = await runCli([
      "var",
      "set",
      "myapp/config",
      nodeHash,
    ]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("3.2 var get returns variable", async () => {
    const { stdout, exitCode } = await runCli([
      "var",
      "get",
      "myapp/config",
      "--schema",
      typeHash,
    ]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
    expect(stdout).toContain(nodeHash);
  });

  test("3.3 var list shows all variables", async () => {
    const { stdout, exitCode } = await runCli(["var", "list"]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
    expect(stdout).toContain("myapp/config");
  });

  test("3.4 var list prefix filters by prefix", async () => {
    const { stdout, exitCode } = await runCli(["var", "list", "myapp/"]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
    expect(stdout).toContain("myapp/config");
  });

  test("3.5 var set upsert updates existing variable", async () => {
    const node2File = join(tmpStore, "node2.json");
    writeFileSync(node2File, JSON.stringify({ name: "Bob", age: 25 }));
    const { stdout: node2Out } = await runCli(["put", typeHash, node2File]);
    const node2Hash = envValue(node2Out) as string;
    const { exitCode, stdout } = await runCli([
      "var",
      "set",
      "myapp/config",
      node2Hash,
    ]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
    // Restore original value
    await runCli(["var", "set", "myapp/config", nodeHash]);
  });

  test("3.6 var tag adds kv tag and label", async () => {
    const { exitCode, stdout } = await runCli([
      "var",
      "tag",
      "myapp/config",
      "--schema",
      typeHash,
      "env:prod",
      "important",
    ]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("3.7 var list --tag env:prod filters by kv tag", async () => {
    const { stdout, exitCode } = await runCli([
      "var",
      "list",
      "--tag",
      "env:prod",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("myapp/config");
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("3.8 var list --tag important filters by label", async () => {
    const { stdout, exitCode } = await runCli([
      "var",
      "list",
      "--tag",
      "important",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("myapp/config");
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("3.9 var tag remove deletes label", async () => {
    const { exitCode, stdout } = await runCli([
      "var",
      "tag",
      "myapp/config",
      "--schema",
      typeHash,
      ":important",
    ]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
    // Verify label is gone
    const { stdout: listOut } = await runCli([
      "var",
      "list",
      "--tag",
      "important",
    ]);
    expect(listOut).not.toContain("myapp/config");
  });

  test("3.10 var delete removes variable", async () => {
    const { exitCode, stdout } = await runCli([
      "var",
      "delete",
      "myapp/config",
    ]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("3.11 var get deleted variable returns not found", async () => {
    const { stderr, exitCode } = await runCli([
      "var",
      "get",
      "myapp/config",
      "--schema",
      typeHash,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatchSnapshot();
  });
});

// --- e2e Phase 4: Template System ---

describe("Phase 4: Template System", () => {
  let tmpStore: string;
  let varDbPath: string;
  let typeHash: string;

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
    typeHash = await putSchema(store, JSON.parse(readFileSync(schemaFile, "utf-8")));
  });

  afterAll(() => {
    rmSync(tmpStore, { recursive: true, force: true });
  });

  test("4.1 template set registers template", async () => {
    const tmplFile = join(tmpStore, "test.liquid");
    writeFileSync(tmplFile, "Name: {{ payload.name }}, Age: {{ payload.age }}");
    const { exitCode, stdout } = await runCli([
      "template",
      "set",
      typeHash,
      tmplFile,
    ]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("4.2 template get returns template text", async () => {
    const { stdout, exitCode } = await runCli(["template", "get", typeHash]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toBe(
      "Name: {{ payload.name }}, Age: {{ payload.age }}",
    );
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("4.3 template list shows registered templates", async () => {
    const { stdout, exitCode } = await runCli(["template", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(typeHash);
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("4.4 template delete removes template", async () => {
    const { exitCode, stdout } = await runCli(["template", "delete", typeHash]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("4.5 template get deleted template returns not found", async () => {
    const { stderr, exitCode } = await runCli(["template", "get", typeHash]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatchSnapshot();
  });
});
