import { execFileSync } from "node:child_process";
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

export const entrypoint = resolve(import.meta.dirname, "../dist/index.js");
export const pkgPath = resolve(import.meta.dirname, "../package.json");

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
  const hash = putSchema(store, schema);
  return hash;
}

/**
 * Run CLI command. Accepts either a string[] or ...string[] (rest args).
 * If first arg is an array, uses that as args. Otherwise treats all args as the command.
 */
export function runCli(
  args: string[],
  storePath?: string,
): { stdout: string; stderr: string; exitCode: number } {
  const finalArgs = storePath
    ? [entrypoint, "--home", storePath, ...args]
    : [entrypoint, ...args];
  try {
    const stdout = execFileSync("node", ["--no-warnings", ...finalArgs], {
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

export function runCliWithStdin(
  args: string[],
  storePath: string,
  stdin: string,
): { stdout: string; stderr: string; exitCode: number } {
  const finalArgs = [entrypoint, "--home", storePath, ...args];
  try {
    const stdout = execFileSync("node", ["--no-warnings", ...finalArgs], {
      input: stdin,
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
