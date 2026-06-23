import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { entrypoint, runCli } from "./helpers";

function runCliRaw(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execFileSync("node", [entrypoint, ...args], {
      encoding: "utf-8",
      timeout: 10000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

describe("phase 2 cli-kit migration", () => {
  test("entrypoint uses cli-kit command builder instead of switch dispatch", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../src/index.ts"),
      "utf-8",
    );

    expect(source).toContain("createCLI(");
    expect(source).toContain(".command(");
    expect(source).toContain(".returns(");
    expect(source).toContain(".action(");
    expect(source).not.toContain("switch (cmd)");
  });

  test("default output is yaml envelope and formats still work", async () => {
    const base = runCliRaw(["has", "@ocas/schema"]);
    expect(base.exitCode).toBe(0);
    expect(base.stdout).toContain('type: "@ocas/output/has"');
    expect(base.stdout).toContain("value: true");

    const asJson = runCliRaw(["has", "@ocas/schema", "--format", "json"]);
    expect(asJson.exitCode).toBe(0);
    const parsed = JSON.parse(asJson.stdout) as { type: string; value: boolean };
    expect(parsed.type).toBe("@ocas/output/has");
    expect(parsed.value).toBe(true);

    const asText = runCliRaw(["has", "@ocas/schema", "--format", "text"]);
    expect(asText.exitCode).toBe(0);
    expect(asText.stdout.trim()).toBe("true");

    const asHtml = runCliRaw(["has", "@ocas/schema", "--format", "html"]);
    expect(asHtml.exitCode).toBe(0);
    expect(asHtml.stdout.trim().length).toBeGreaterThan(0);
    expect(asHtml.stdout).not.toContain("@ocas/output/has");
  });

  test("render flag uses cli-kit plugin path and keeps envelope compatibility", async () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../src/index.ts"),
      "utf-8",
    );
    expect(source).toContain("ocasRenderPlugin(");

    const normal = runCliRaw(["has", "@ocas/schema"]);
    expect(normal.exitCode).toBe(0);
    expect(normal.stdout).toContain("@ocas/output/has");

    const rendered = runCliRaw([
      "has",
      "@ocas/schema",
      "-r",
      "--format",
      "text",
    ]);
    expect(rendered.exitCode).toBe(0);
    expect(rendered.stdout.trim()).toBe("true");
  });

  test("failures are structured envelopes on stderr", async () => {
    const failure = await runCli(["unknown-cmd"]);
    expect(failure.exitCode).not.toBe(0);
    const parsed = JSON.parse(failure.stderr) as {
      type: string;
      value: { message: string; command: string };
    };
    expect(parsed.type).toBe("@ocas/error");
    expect(parsed.value.message).toContain("Unknown");
  });
});
