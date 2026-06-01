import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { JSONSchema } from "@ocas/core";
import { putSchema } from "@ocas/core";
import { openStore as openFsStore } from "@ocas/fs";

export {
  join,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  resolve,
  rmSync,
  tmpdir,
  writeFileSync,
};

export const entrypoint = resolve(import.meta.dir, "../src/index.ts");
export const pkgPath = resolve(import.meta.dir, "../package.json");

/** Extract the `value` field from a { type, value } envelope JSON string. */
export function envValue(json: string): unknown {
  return (JSON.parse(json.trim()) as { value: unknown }).value;
}

/**
 * Register a schema directly via the library (CLI schema put was removed).
 * Returns the type hash.
 */
export async function putSchemaFile(
  storePath: string,
  schemaFilePath: string,
): Promise<string> {
  const store = await openFsStore(storePath);
  const schema = JSON.parse(
    readFileSync(schemaFilePath, "utf-8"),
  ) as JSONSchema;
  const hash = await putSchema(store, schema);
  return hash;
}

/**
 * Run CLI command. Accepts either a string[] or ...string[] (rest args).
 * If first arg is an array, uses that as args. Otherwise treats all args as the command.
 */
export async function runCli(
  args: string[],
  storePath?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const finalArgs = storePath
    ? ["bun", entrypoint, "--home", storePath, ...args]
    : ["bun", entrypoint, ...args];
  const proc = Bun.spawn(finalArgs, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode };
}

export async function runCliWithStdin(
  args: string[],
  storePath: string,
  stdin: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const finalArgs = ["bun", entrypoint, "--home", storePath, ...args];
  const proc = Bun.spawn(finalArgs, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin.write(stdin);
  proc.stdin.end();
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode };
}

/**
 * Parse JSON and strip volatile fields (timestamp, created, updated)
 * so snapshots are stable across runs.
 */
export function stripVolatile(json: string): unknown {
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
