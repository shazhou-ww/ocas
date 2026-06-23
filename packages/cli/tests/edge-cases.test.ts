import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { envValue, stripVolatile } from "./helpers";

const entrypoint = resolve(import.meta.dirname, "../dist/index.js");
const pkgPath = resolve(import.meta.dirname, "../package.json");

// --- ocas command alias tests (from cli.test.ts) ---

describe("ocas binary", () => {
  test("T1: ocas bin entry exists in package.json", async () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.bin.ocas).toBe("dist/index.js");
  });

  test("T2: no legacy bin entries (json-cas, ucas)", async () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.bin["json-cas"]).toBeUndefined();
    expect(pkg.bin.ucas).toBeUndefined();
    expect(Object.keys(pkg.bin)).toEqual(["ocas"]);
  });

  test("T3: ocas command is executable and shows help", () => {
    const stdout = execFileSync("node", [entrypoint, "--help"], {
      encoding: "utf-8",
      timeout: 10000,
    });
    expect(stdout.length).toBeGreaterThan(0);
  });
});

// --- e2e Phase 7: Edge Cases ---

describe("Phase 7: Edge Cases", () => {
  let tmpStore: string;
  let typeHash: string;
  let nodeHash: string;

  function runCli(...rawArgs: (string | string[])[]): {
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    const args = rawArgs.flat();
  const finalArgs = args.includes("--json") ? args : [...args, "--json"];
    try {
      const stdout = execFileSync(
        "node",
        [entrypoint, "--home", tmpStore, ...finalArgs],
        {
          encoding: "utf-8",
          timeout: 10000,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
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

  test("7.6 --home path is a file errors", () => {
    const fileAsStore = join(tmpStore, "not-a-directory");
    writeFileSync(fileAsStore, "test");
    try {
      execFileSync(
        "node",
        [entrypoint, "--home", fileAsStore, "get", "AAAAAAAAAAAAA"],
        {
          encoding: "utf-8",
          timeout: 10000,
        },
      );
      expect.unreachable("should have thrown");
    } catch (e: unknown) {
      const err = e as { stderr?: string; status?: number };
      expect(err.status).not.toBe(0);
      expect((err.stderr ?? "").trim()).toContain("not a directory");
    }
  });
});

// --- e2e Phase 3: Variable System (edge cases from e2e.test.ts) ---

describe("Phase 3: Variable System", () => {
  let tmpStore: string;
  let typeHash: string;
  let nodeHash: string;

  function runCli(...rawArgs: (string | string[])[]): {
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    const args = rawArgs.flat();
  const finalArgs = args.includes("--json") ? args : [...args, "--json"];
    try {
      const stdout = execFileSync(
        "node",
        [entrypoint, "--home", tmpStore, ...finalArgs],
        {
          encoding: "utf-8",
          timeout: 10000,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
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

  test("3.1 var set creates variable", async () => {
    const { exitCode, stdout } = await runCli([
      "var",
      "set",
      "@myapp/config",
      nodeHash,
    ]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("3.2 var get returns variable", async () => {
    const { stdout, exitCode } = await runCli([
      "var",
      "get",
      "@myapp/config",
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
    const stripped = stripVolatile(stdout) as { value: { name: string }[] };
    stripped.value.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    expect(stripped).toMatchSnapshot();
    expect(stdout).toContain("@myapp/config");
  });

  test("3.4 var list prefix filters by prefix", async () => {
    const { stdout, exitCode } = await runCli(["var", "list", "@myapp/"]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
    expect(stdout).toContain("@myapp/config");
  });

  test("3.5 var set upsert updates existing variable", async () => {
    const node2File = join(tmpStore, "node2.json");
    writeFileSync(node2File, JSON.stringify({ name: "Bob", age: 25 }));
    const { stdout: node2Out } = await runCli(["put", typeHash, node2File]);
    const node2Hash = envValue(node2Out) as string;
    const { exitCode, stdout } = await runCli([
      "var",
      "set",
      "@myapp/config",
      node2Hash,
    ]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
    // Restore original value
    await runCli(["var", "set", "@myapp/config", nodeHash]);
  });

  test("3.6 var set with tag and label adds them", async () => {
    const { exitCode, stdout } = await runCli([
      "var",
      "set",
      "@myapp/config",
      nodeHash,
      "--tag",
      "env:prod",
      "--tag",
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
    expect(stdout).toContain("@myapp/config");
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
    expect(stdout).toContain("@myapp/config");
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("3.9 var set without label removes it", async () => {
    const { exitCode, stdout } = await runCli([
      "var",
      "set",
      "@myapp/config",
      nodeHash,
      "--tag",
      "env:prod",
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
    expect(listOut).not.toContain("@myapp/config");
  });

  test("3.10 var delete removes variable", async () => {
    const { exitCode, stdout } = await runCli([
      "var",
      "delete",
      "@myapp/config",
    ]);
    expect(exitCode).toBe(0);
    expect(stripVolatile(stdout)).toMatchSnapshot();
  });

  test("3.11 var get deleted variable returns not found", async () => {
    const { stderr, exitCode } = await runCli([
      "var",
      "get",
      "@myapp/config",
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
  let typeHash: string;

  function runCli(...rawArgs: (string | string[])[]): {
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    const args = rawArgs.flat();
  const finalArgs = args.includes("--json") ? args : [...args, "--json"];
    try {
      const stdout = execFileSync(
        "node",
        [entrypoint, "--home", tmpStore, ...finalArgs],
        {
          encoding: "utf-8",
          timeout: 10000,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
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
