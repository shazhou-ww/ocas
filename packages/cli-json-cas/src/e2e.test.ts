import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entrypoint = resolve(import.meta.dir, "index.ts");

let tmpStore: string;
let varDbPath: string;

// Shared hashes across phases
let typeHash: string;
let nodeHash: string;

beforeAll(() => {
  tmpStore = mkdtempSync(join(tmpdir(), "json-cas-e2e-"));
  varDbPath = join(tmpStore, "variables.db");
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

/**
 * Parse JSON and strip volatile fields (timestamp, created, updated)
 * so snapshots are stable across runs.
 */
function stripVolatile(json: string): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === "timestamp" || k === "created" || k === "updated") continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  return strip(JSON.parse(json));
}

/** Extract the `value` field from a { type, value } envelope JSON string. */
function envValue(json: string): unknown {
  return (JSON.parse(json) as { value: unknown }).value;
}

// ---- Phase 1: CAS Core ----

describe("Phase 1: CAS Core", () => {
  test("1.1 init + put with @object bootstraps store", async () => {
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
    // Use putSchema via the library to register schema, since CLI schema put is removed
    const { openStore: openFsStore } = await import("@uncaged/json-cas-fs");
    const { putSchema } = await import("@uncaged/json-cas");
    const store = await openFsStore(tmpStore);
    const hash = await putSchema(
      store,
      JSON.parse(readFileSync(schemaFile, "utf-8")),
    );
    typeHash = hash;
    expect(typeHash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("1.5 put returns node hash", async () => {
    const nodeFile = join(tmpStore, "test-node.json");
    writeFileSync(nodeFile, JSON.stringify({ name: "Alice", age: 30 }));
    const { stdout, exitCode } = await runCli(["put", typeHash, nodeFile]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    nodeHash = envValue(stdout) as string;
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

  test("1.12 hash dry-run returns same hash as put", async () => {
    const nodeFile = join(tmpStore, "test-node.json");
    const { stdout, exitCode } = await runCli(["hash", typeHash, nodeFile]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toBe(nodeHash);
  });

  test("1.13 list --type returns nodes of that type", async () => {
    const { stdout, exitCode } = await runCli(["list", "--type", typeHash]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toContain(nodeHash);
  });
});

// ---- Phase 2: Schema Validation ----

describe("Phase 2: Schema Validation", () => {
  test("2.1 put {name:123} against string-schema fails with non-zero exit", async () => {
    const badFile = join(tmpStore, "bad-node.json");
    writeFileSync(badFile, JSON.stringify({ name: 123 }));
    const { stdout, stderr, exitCode } = await runCli([
      "put",
      typeHash,
      badFile,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Validation failed");
    expect(stderr).toContain(typeHash);
    // Do NOT snapshot stderr — it embeds a machine-specific tmp path
  });

  test("2.2 verify on valid node returns ok (hash + schema)", async () => {
    const { stdout, exitCode } = await runCli(["verify", nodeHash]);
    expect(exitCode).toBe(0);
    expect(envValue(stdout)).toBe("ok");
  });

  test("2.3 put against non-existent schema hash fails", async () => {
    const nodeFile = join(tmpStore, "test-node.json");
    const { stderr, exitCode } = await runCli([
      "put",
      "AAAAAAAAAAAAA",
      nodeFile,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatchSnapshot();
  });
});

// ---- Phase 3: Variable System ----

describe("Phase 3: Variable System", () => {
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

// ---- Phase 4: Template System ----

describe("Phase 4: Template System", () => {
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
    expect(stdout).toMatchSnapshot();
  });

  test("4.2 template get returns template text", async () => {
    const { stdout, exitCode } = await runCli(["template", "get", typeHash]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("Name: {{ payload.name }}, Age: {{ payload.age }}");
    expect(stdout).toMatchSnapshot();
  });

  test("4.3 template list shows registered templates", async () => {
    const { stdout, exitCode } = await runCli(["template", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(typeHash);
    expect(stdout).toMatchSnapshot();
  });

  test("4.4 template delete removes template", async () => {
    const { exitCode, stdout } = await runCli(["template", "delete", typeHash]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  test("4.5 template get deleted template returns not found", async () => {
    const { stderr, exitCode } = await runCli(["template", "get", typeHash]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatchSnapshot();
  });
});

// ---- Phase 5: Render ----

describe("Phase 5: Render", () => {
  beforeAll(async () => {
    const tmplFile = join(tmpStore, "render-template.liquid");
    writeFileSync(tmplFile, "Hello {{ payload.name }}!");
    await runCli(["template", "set", typeHash, tmplFile]);
  });

  test("5.1 render fills payload variables", async () => {
    const { stdout, exitCode } = await runCli(["render", nodeHash]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("Hello Alice!");
    expect(stdout).toMatchSnapshot();
  });

  test("5.2 render --resolution with different value", async () => {
    const { stdout, exitCode } = await runCli([
      "render",
      nodeHash,
      "--resolution",
      "0.5",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  test("5.3 render non-existent hash fails with error", async () => {
    const { stderr, exitCode } = await runCli(["render", "ZZZZZZZZZZZZZ"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Node not found");
    expect(stderr).toContain("ZZZZZZZZZZZZZ");
  });
});

// ---- Phase 6: GC ----

describe("Phase 6: GC", () => {
  let gcNodeHash: string;

  beforeAll(async () => {
    // Create a fresh node for GC tests (independent of shared nodeHash)
    const gcNodeFile = join(tmpStore, "gc-node.json");
    writeFileSync(gcNodeFile, JSON.stringify({ name: "GcAlice", age: 30 }));
    const { stdout } = await runCli(["put", typeHash, gcNodeFile]);
    gcNodeHash = envValue(stdout) as string;
    // Set a var referencing this node so it survives GC during Phase 6
    await runCli(["var", "set", "gc-test/ref", gcNodeHash]);
  });

  test("6.1 gc runs without error", async () => {
    const { exitCode, stdout } = await runCli(["gc"]);
    expect(exitCode).toBe(0);
    // Assert structural shape only — exact counts depend on phase history
    const result = envValue(stdout) as Record<string, unknown>;
    expect(typeof result.total).toBe("number");
    expect(typeof result.reachable).toBe("number");
    expect(typeof result.collected).toBe("number");
    expect(typeof result.scanned).toBe("number");
    expect(result.total as number).toBeGreaterThanOrEqual(
      result.reachable as number,
    );
  });

  test("6.2 gc preserves node referenced by a var", async () => {
    const { exitCode } = await runCli(["gc"]);
    expect(exitCode).toBe(0);
    const { stdout } = await runCli(["has", gcNodeHash]);
    expect(envValue(stdout)).toBe(true);
  });

  test("6.3 gc reclaims orphan node", async () => {
    const orphanFile = join(tmpStore, "orphan.json");
    writeFileSync(orphanFile, JSON.stringify({ name: "Orphan", age: 99 }));
    const { stdout: orphanOut } = await runCli(["put", typeHash, orphanFile]);
    const orphanHash = envValue(orphanOut) as string;

    const { stdout: beforeGc } = await runCli(["has", orphanHash]);
    expect(envValue(beforeGc)).toBe(true);

    await runCli(["gc"]);
    const { stdout: afterGc } = await runCli(["has", orphanHash]);
    expect(envValue(afterGc)).toBe(false);
  });
});

// ---- Phase 7: Edge Cases ----

describe("Phase 7: Edge Cases", () => {
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
