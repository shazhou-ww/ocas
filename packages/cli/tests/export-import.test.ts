import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { envValue, runCli } from "./helpers";

let storePath: string;
let bundlePath: string;

beforeEach(() => {
  storePath = mkdtempSync(join(tmpdir(), "ocas-export-import-"));
  bundlePath = join(storePath, "bundle.tar");
});

afterEach(() => {
  rmSync(storePath, { recursive: true, force: true });
});

async function setupSampleStore(): Promise<{
  schemaHash: string;
  nodeHash: string;
}> {
  // Create a schema, a node, a variable, and a tag.
  const { openStore } = await import("@ocas/fs");
  const { putSchema } = await import("@ocas/core");
  const store = await openStore(storePath);
  const schemaHash = putSchema(store, {
    type: "object",
    properties: { name: { type: "string" }, age: { type: "number" } },
    required: ["name"],
  });
  const nodeHash = store.cas.put(schemaHash, { name: "Alice", age: 30 });
  store.var.set("@test/app", nodeHash);
  store.tag.tag(nodeHash, [{ op: "set", key: "env", value: "prod" }]);
  return { schemaHash, nodeHash };
}

describe("CLI export/import", () => {
  test("3.1 export: basic usage with -o flag", async () => {
    const { nodeHash } = await setupSampleStore();
    const { exitCode, stdout } = runCli(
      ["export", "@test/app", "-o", bundlePath],
      storePath,
    );
    expect(exitCode).toBe(0);
    expect(existsSync(bundlePath)).toBe(true);
    const value = envValue(stdout) as {
      nodes: number;
      vars: number;
      tags: number;
    };
    expect(value.nodes).toBeGreaterThan(0);
    expect(value.vars).toBeGreaterThanOrEqual(1);
    expect(value.tags).toBeGreaterThanOrEqual(1);
    void nodeHash;
  });

  test("3.2 export: multiple roots", async () => {
    const { openStore } = await import("@ocas/fs");
    const { putSchema } = await import("@ocas/core");
    const store = await openStore(storePath);
    const schemaHash = putSchema(store, { type: "string" });
    const aHash = store.cas.put(schemaHash, "a");
    const bHash = store.cas.put(schemaHash, "b");
    store.var.set("@test/a", aHash);
    store.var.set("@test/b", bHash);

    const { exitCode } = runCli(
      ["export", "@test/a", "@test/b", "-o", bundlePath],
      storePath,
    );
    expect(exitCode).toBe(0);
    expect(existsSync(bundlePath)).toBe(true);
  });

  test("3.3 export: hash as root", async () => {
    const { nodeHash } = await setupSampleStore();
    const { exitCode } = runCli(
      ["export", nodeHash, "-o", bundlePath],
      storePath,
    );
    expect(exitCode).toBe(0);
  });

  test("3.4 export: missing root → error", async () => {
    await setupSampleStore();
    const { exitCode, stderr } = runCli(
      ["export", "@test/nonexistent", "-o", bundlePath],
      storePath,
    );
    expect(exitCode).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });

  test("3.5 export: missing -o flag → error", async () => {
    await setupSampleStore();
    const { exitCode, stderr } = runCli(["export", "@test/app"], storePath);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/-o|output/i);
  });

  test("3.6 import: basic", async () => {
    await setupSampleStore();
    runCli(["export", "@test/app", "-o", bundlePath], storePath);

    const dstPath = mkdtempSync(join(tmpdir(), "ocas-import-dst-"));
    try {
      const { exitCode, stdout } = runCli(["import", bundlePath], dstPath);
      expect(exitCode).toBe(0);
      const stats = envValue(stdout) as {
        nodes: { imported: number; skipped: number };
        vars: { created: number; updated: number };
        tags: number;
      };
      expect(stats.nodes.imported).toBeGreaterThan(0);

      // Variable accessible in dst.
      const get = runCli(["get", "@test/app"], dstPath);
      expect(get.exitCode).toBe(0);
    } finally {
      rmSync(dstPath, { recursive: true, force: true });
    }
  });

  test("3.7 import --scope remaps variables", async () => {
    await setupSampleStore();
    runCli(["export", "@test/app", "-o", bundlePath], storePath);

    const dstPath = mkdtempSync(join(tmpdir(), "ocas-import-scope-"));
    try {
      const { exitCode } = runCli(
        ["import", bundlePath, "--scope", "@imported"],
        dstPath,
      );
      expect(exitCode).toBe(0);

      const list = runCli(["var", "list", "@imported"], dstPath);
      expect(list.exitCode).toBe(0);
      const variables = envValue(list.stdout) as Array<{ name: string }>;
      expect(variables.some((v) => v.name === "@imported/app")).toBe(true);
    } finally {
      rmSync(dstPath, { recursive: true, force: true });
    }
  });

  test("3.8 import is idempotent", async () => {
    await setupSampleStore();
    runCli(["export", "@test/app", "-o", bundlePath], storePath);

    const dstPath = mkdtempSync(join(tmpdir(), "ocas-import-idem-"));
    try {
      runCli(["import", bundlePath], dstPath);
      const second = runCli(["import", bundlePath], dstPath);
      expect(second.exitCode).toBe(0);
      const stats = envValue(second.stdout) as {
        nodes: { imported: number; skipped: number };
      };
      expect(stats.nodes.imported).toBe(0);
      expect(stats.nodes.skipped).toBeGreaterThan(0);
    } finally {
      rmSync(dstPath, { recursive: true, force: true });
    }
  });

  test("3.9 --store flag: ocas get reads from bundle", async () => {
    const { nodeHash } = await setupSampleStore();
    runCli(["export", "@test/app", "-o", bundlePath], storePath);

    const { exitCode, stdout } = runCli([
      "get",
      nodeHash,
      "--store",
      bundlePath,
    ]);
    expect(exitCode).toBe(0);
    const value = envValue(stdout) as { payload: { name: string } };
    expect(value.payload.name).toBe("Alice");
  });

  test("3.10 --store flag: ocas var list reads from bundle", async () => {
    await setupSampleStore();
    runCli(["export", "@test/app", "-o", bundlePath], storePath);

    const { exitCode, stdout } = runCli([
      "var",
      "list",
      "@test",
      "--store",
      bundlePath,
    ]);
    expect(exitCode).toBe(0);
    const variables = envValue(stdout) as Array<{ name: string }>;
    expect(variables.some((v) => v.name === "@test/app")).toBe(true);
  });

  test("3.11 --store flag: ocas walk reads from bundle", async () => {
    const { nodeHash } = await setupSampleStore();
    runCli(["export", "@test/app", "-o", bundlePath], storePath);

    const { exitCode, stdout } = runCli([
      "walk",
      nodeHash,
      "--store",
      bundlePath,
    ]);
    expect(exitCode).toBe(0);
    const hashes = envValue(stdout) as string[];
    expect(hashes).toContain(nodeHash);
  });

  test("3.12 --store flag: ocas refs reads from bundle", async () => {
    const { nodeHash } = await setupSampleStore();
    runCli(["export", "@test/app", "-o", bundlePath], storePath);

    const { exitCode } = runCli(["refs", nodeHash, "--store", bundlePath]);
    expect(exitCode).toBe(0);
  });

  test("3.13 --store flag: ocas has reads from bundle", async () => {
    const { nodeHash } = await setupSampleStore();
    runCli(["export", "@test/app", "-o", bundlePath], storePath);

    const present = runCli(["has", nodeHash, "--store", bundlePath]);
    expect(present.exitCode).toBe(0);
    expect(envValue(present.stdout)).toBe(true);

    const missing = runCli(["has", "AAAAAAAAAAAAA", "--store", bundlePath]);
    expect(missing.exitCode).toBe(0);
    expect(envValue(missing.stdout)).toBe(false);
  });

  test("3.14 --store flag: write commands fail with 'read-only' error", async () => {
    await setupSampleStore();
    runCli(["export", "@test/app", "-o", bundlePath], storePath);

    // Try `ocas put` against a bundle.
    const tmp = mkdtempSync(join(tmpdir(), "ocas-store-write-"));
    try {
      const payload = join(tmp, "p.json");
      writeFileSync(payload, JSON.stringify({ name: "X" }));
      const { exitCode, stderr } = runCli([
        "put",
        "@ocas/string",
        payload,
        "--store",
        bundlePath,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/read[- ]only/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// Suppress unused.
void mkdirSync;
