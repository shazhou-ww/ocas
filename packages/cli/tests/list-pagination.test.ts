import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envValue, runCli } from "./helpers.js";

const HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/;

let storePath: string;

beforeEach(() => {
  storePath = mkdtempSync(join(tmpdir(), "ocas-list-pagination-"));
  mkdirSync(storePath, { recursive: true });
});

afterEach(() => {
  rmSync(storePath, { recursive: true, force: true });
});

async function putString(text: string): Promise<string> {
  const entrypoint = join(import.meta.dirname, "../src/index.ts");
  const out = execFileSync("tsx", [entrypoint, "--home", storePath, "put", "@ocas/string", "--pipe"], {
    input: JSON.stringify(text),
    encoding: "utf-8",
    timeout: 10000,
  });
  return (JSON.parse(out) as { value: string }).value;
}

async function makeN(n: number, gap = 2): Promise<string[]> {
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) {
    hashes.push(await putString(`val-${i}-${Math.random()}`));
    if (gap > 0 && i < n - 1) {
      await new Promise((r) => setTimeout(r, gap));
    }
  }
  return hashes;
}

describe("CLI list --type pagination", () => {
  test("E1. entries are {hash, created, updated} objects", async () => {
    await makeN(3);
    const { stdout, exitCode } = await runCli(
      ["list", "--type", "@ocas/string"],
      storePath,
    );
    expect(exitCode).toBe(0);
    const value = envValue(stdout) as Array<{
      hash: string;
      created: number;
      updated: number;
    }>;
    expect(value.length).toBeGreaterThan(0);
    for (const e of value) {
      expect(e.hash).toMatch(HASH_RE);
      expect(typeof e.created).toBe("number");
      expect(typeof e.updated).toBe("number");
    }
  });

  test("E2. --limit 2", async () => {
    await makeN(5, 0);
    const { stdout, exitCode } = await runCli(
      ["list", "--type", "@ocas/string", "--limit", "2"],
      storePath,
    );
    expect(exitCode).toBe(0);
    const value = envValue(stdout) as unknown[];
    expect(value).toHaveLength(2);
  });

  test("E3. --offset 1 skips first", async () => {
    await makeN(3);
    const { stdout: a } = await runCli(
      ["list", "--type", "@ocas/string"],
      storePath,
    );
    const { stdout: b } = await runCli(
      ["list", "--type", "@ocas/string", "--offset", "1", "--limit", "100"],
      storePath,
    );
    const all = envValue(a) as Array<{ hash: string }>;
    const skip = envValue(b) as Array<{ hash: string }>;
    expect(skip).toHaveLength(all.length - 1);
    expect((skip[0] as { hash: string }).hash).toBe(
      (all[1] as { hash: string }).hash,
    );
  });

  test("E4. --desc reverses default order", async () => {
    await makeN(3);
    const { stdout, exitCode } = await runCli(
      ["list", "--type", "@ocas/string", "--desc"],
      storePath,
    );
    expect(exitCode).toBe(0);
    const value = envValue(stdout) as Array<{ created: number }>;
    for (let i = 1; i < value.length; i++) {
      expect((value[i] as { created: number }).created).toBeLessThanOrEqual(
        (value[i - 1] as { created: number }).created,
      );
    }
  });

  test("E5. --sort updated accepted; equals created for CAS", async () => {
    await makeN(3);
    const { stdout: a } = await runCli(
      ["list", "--type", "@ocas/string", "--sort", "created"],
      storePath,
    );
    const { stdout: b } = await runCli(
      ["list", "--type", "@ocas/string", "--sort", "updated"],
      storePath,
    );
    expect(envValue(a)).toEqual(envValue(b));
  });

  test("E7. invalid --sort exits non-zero", async () => {
    const { exitCode, stderr } = await runCli(
      ["list", "--type", "@ocas/string", "--sort", "foo"],
      storePath,
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--sort");
  });

  test("E8. invalid --limit exits non-zero", async () => {
    const r1 = await runCli(
      ["list", "--type", "@ocas/string", "--limit", "-1"],
      storePath,
    );
    expect(r1.exitCode).not.toBe(0);
    expect(r1.stderr).toContain("--limit");

    const r2 = await runCli(
      ["list", "--type", "@ocas/string", "--limit", "abc"],
      storePath,
    );
    expect(r2.exitCode).not.toBe(0);
    expect(r2.stderr).toContain("--limit");
  });
});

describe("CLI list-meta / list-schema pagination", () => {
  test("F1. list-meta entries are objects", async () => {
    // Bootstrap implicitly happens when running any cli command that opens store
    await runCli(["list-meta"], storePath);
    const { stdout } = await runCli(["list-meta"], storePath);
    const value = envValue(stdout) as Array<{
      hash: string;
      created: number;
      updated: number;
    }>;
    expect(value.length).toBeGreaterThanOrEqual(1);
    for (const e of value) {
      expect(e.hash).toMatch(HASH_RE);
      expect(typeof e.created).toBe("number");
    }
  });

  test("F2. list-schema --limit honored", async () => {
    const { stdout } = await runCli(["list-schema", "--limit", "3"], storePath);
    const value = envValue(stdout) as unknown[];
    expect(value).toHaveLength(3);
  });

  test("F3. list-schema --desc reverses order", async () => {
    const { stdout: asc } = await runCli(["list-schema"], storePath);
    const { stdout: desc } = await runCli(["list-schema", "--desc"], storePath);
    const a = envValue(asc) as Array<{ hash: string }>;
    const d = envValue(desc) as Array<{ hash: string }>;
    expect(d[0]?.hash).toBe(a[a.length - 1]?.hash);
  });
});

describe("CLI var list pagination", () => {
  test("G1./G2. --limit and --offset on var list", async () => {
    for (let i = 0; i < 4; i++) {
      const h = await putString(`tval-${i}`);
      await runCli(["var", "set", `@test/myvar-${i}`, h], storePath);
      await new Promise((r) => setTimeout(r, 2));
    }
    const { stdout: lim } = await runCli(
      ["var", "list", "@test/myvar-", "--limit", "2"],
      storePath,
    );
    expect((envValue(lim) as unknown[]).length).toBe(2);

    const { stdout: off } = await runCli(
      ["var", "list", "@test/myvar-", "--offset", "1", "--limit", "10"],
      storePath,
    );
    const offList = envValue(off) as Array<{ name: string }>;
    expect(offList.length).toBe(3);
    expect(offList[0]?.name).toBe("@test/myvar-1");
  });

  test("G3. --desc reverses var list order", async () => {
    for (let i = 0; i < 3; i++) {
      const h = await putString(`dval-${i}`);
      await runCli(["var", "set", `@test/dv-${i}`, h], storePath);
      await new Promise((r) => setTimeout(r, 2));
    }
    const { stdout } = await runCli(
      ["var", "list", "@test/dv-", "--desc"],
      storePath,
    );
    const list = envValue(stdout) as Array<{ name: string }>;
    expect(list[0]?.name).toBe("@test/dv-2");
  });

  test("G4. --sort updated", async () => {
    for (let i = 0; i < 3; i++) {
      const h = await putString(`sval-${i}`);
      await runCli(["var", "set", `@test/sv-${i}`, h], storePath);
      await new Promise((r) => setTimeout(r, 2));
    }
    // Re-set sv-0 with NEW value to bump updated
    await new Promise((r) => setTimeout(r, 2));
    const newH = await putString("sval-0-new");
    await runCli(["var", "set", "@test/sv-0", newH], storePath);

    const { stdout } = await runCli(
      ["var", "list", "@test/sv-", "--sort", "updated"],
      storePath,
    );
    const list = envValue(stdout) as Array<{ name: string }>;
    expect(list[list.length - 1]?.name).toBe("@test/sv-0");
  });

  test("G6. invalid --sort exits non-zero", async () => {
    const r = await runCli(["var", "list", "--sort", "bogus"], storePath);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("--sort");
  });
});
