import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      yield* walk(path);
    } else if (stats.isFile()) {
      yield path;
    }
  }
}

describe("no SQLite in @ocas/core", () => {
  test("source files do not import sqlite", () => {
    const srcDir = import.meta.dir;
    const needle = ["bun", "sqlite"].join(":");
    for (const file of walk(srcDir)) {
      if (!file.endsWith(".ts")) continue;
      if (file.endsWith("no-sqlite.test.ts")) continue;
      const content = readFileSync(file, "utf-8");
      expect(content).not.toContain(needle);
    }
  });
});
