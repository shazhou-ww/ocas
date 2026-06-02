import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const usagePath = join(import.meta.dir, "usage.md");

describe("usage.md doc cleanup (D)", () => {
  test("D3. usage.md does not reference legacy openStoreAndVarStore / createVariableStore", () => {
    const content = readFileSync(usagePath, "utf8");
    expect(content).not.toContain("openStoreAndVarStore");
    expect(content).not.toContain("createVariableStore");
  });

  test("D1. usage.md references openStore returning OcasStore", () => {
    const content = readFileSync(usagePath, "utf8");
    expect(content).toContain("openStore");
    expect(content).toMatch(/store\.cas|store\.var|store\.tag/);
  });
});
