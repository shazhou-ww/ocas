import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const pkgPath = resolve(import.meta.dir, "../package.json");

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
    const entrypoint = resolve(import.meta.dir, "index.ts");
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
