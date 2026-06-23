import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { envValue } from "./helpers";

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

  // Set a var referencing the node so it survives GC
  await runCli(["var", "set", "@test/gc-test/ref", nodeHash]);
});

afterAll(() => {
  rmSync(tmpStore, { recursive: true, force: true });
});

function runCli(...rawArgs: (string | string[])[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const args = rawArgs.flat();
  const isRender = args[0] === "render";
  const finalArgs =
    isRender || args.includes("--json") ? args : [...args, "--json"];
  try {
    const stdout = execFileSync(
      "node",
      [entrypoint, "--home", tmpStore, ...finalArgs],
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

// ---- Phase 6: GC ----

describe("Phase 6: GC", () => {
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

  test("6.2 gc | render -p renders the gc stats", () => {
    const { stdout: gcOut, exitCode: gcExit } = runCli(["gc"]);
    expect(gcExit).toBe(0);

    const stdout = execFileSync(
      "node",
      [entrypoint, "--home", tmpStore, "render", "--pipe"],
      {
        input: gcOut,
        encoding: "utf-8",
        timeout: 10000,
      },
    ).trim();
    // gc value is an object { total, reachable, collected, scanned }
    expect(stdout).toContain("total:");
  });

  test("6.3 gc preserves node referenced by a var", async () => {
    const { exitCode } = await runCli(["gc"]);
    expect(exitCode).toBe(0);
    const { stdout } = await runCli(["has", nodeHash]);
    expect(envValue(stdout)).toBe(true);
  });

  test("6.4 gc reclaims orphan node", async () => {
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

// ──────────────────────────────────────────────────────────────────────────────
// Issue #93: gc must not collect uwf-style step chains joined by oneOf prev
// ──────────────────────────────────────────────────────────────────────────────
describe("GC #93 - oneOf step chain CLI integration", () => {
  test("6.5 gc preserves step chain joined by oneOf prev", async () => {
    const subStore = mkdtempSync(join(tmpdir(), "ocas-e2e-93-"));
    try {
      const { openStore: openFsStore } = await import("@ocas/fs");
      const { putSchema } = await import("@ocas/core");
      const store = await openFsStore(subStore);

      const stepSchemaHash = putSchema(store, {
        type: "object",
        properties: {
          payload: { type: "string" },
          prev: {
            oneOf: [{ type: "null" }, { type: "string", format: "ocas_ref" }],
          },
        },
      });

      const step1File = join(subStore, "step1.json");
      writeFileSync(step1File, JSON.stringify({ payload: "a", prev: null }));
      const runCliSub = (
        args: string[],
      ): { stdout: string; stderr: string; exitCode: number } => {
        const isRender = args[0] === "render";
        const finalArgs =
          isRender || args.includes("--json") ? args : [...args, "--json"];
        try {
          const stdout = execFileSync(
            "node",
            [entrypoint, "--home", subStore, ...finalArgs],
            { encoding: "utf-8", timeout: 10000 },
          );
          return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
        } catch (e: unknown) {
          const err = e as {
            stdout?: string;
            stderr?: string;
            status?: number;
          };
          return {
            stdout: (err.stdout ?? "").trim(),
            stderr: (err.stderr ?? "").trim(),
            exitCode: err.status ?? 1,
          };
        }
      };

      const { stdout: s1Out } = runCliSub(["put", stepSchemaHash, step1File]);
      const step1Hash = envValue(s1Out) as string;

      const step2File = join(subStore, "step2.json");
      writeFileSync(
        step2File,
        JSON.stringify({ payload: "b", prev: step1Hash }),
      );
      const { stdout: s2Out } = runCliSub(["put", stepSchemaHash, step2File]);
      const step2Hash = envValue(s2Out) as string;

      const step3File = join(subStore, "step3.json");
      writeFileSync(
        step3File,
        JSON.stringify({ payload: "c", prev: step2Hash }),
      );
      const { stdout: s3Out } = runCliSub(["put", stepSchemaHash, step3File]);
      const step3Hash = envValue(s3Out) as string;

      const orphanFile = join(subStore, "orphan-step.json");
      writeFileSync(
        orphanFile,
        JSON.stringify({ payload: "orphan", prev: null }),
      );
      const { stdout: orphanOut } = runCliSub([
        "put",
        stepSchemaHash,
        orphanFile,
      ]);
      const orphanHash = envValue(orphanOut) as string;

      runCliSub(["var", "set", "@test/thread/head", step3Hash]);

      const { exitCode } = runCliSub(["gc"]);
      expect(exitCode).toBe(0);

      const { stdout: has1 } = runCliSub(["has", step1Hash]);
      expect(envValue(has1)).toBe(true);
      const { stdout: has2 } = runCliSub(["has", step2Hash]);
      expect(envValue(has2)).toBe(true);
      const { stdout: has3 } = runCliSub(["has", step3Hash]);
      expect(envValue(has3)).toBe(true);
      const { stdout: hasOrphan } = runCliSub(["has", orphanHash]);
      expect(envValue(hasOrphan)).toBe(false);
    } finally {
      rmSync(subStore, { recursive: true, force: true });
    }
  });
});
