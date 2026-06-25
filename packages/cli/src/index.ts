#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliMiddleware, RenderFn } from "@ocas/cli-kit";
import { createCLI, renderMiddleware } from "@ocas/cli-kit";
import { z } from "zod";

import { cmdPromptBootstrap } from "./prompt-bootstrap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

import type { Hash, ListEntry, ListOptions, Store, TagOp } from "@ocas/core";
import {
  applyListOptions,
  bootstrap,
  CasNodeNotFoundError,
  computeHash,
  exportBundle,
  gc,
  getSchema,
  InvalidVariableNameError,
  importBundle,
  isValidName,
  loadBundleStore,
  putSchema,
  refs,
  renderAsync,
  renderDirectAsync,
  TagLabelConflictError,
  VariableNotFoundError,
  validate,
  verify,
  walk,
} from "@ocas/core";
import {
  type FsCasStore,
  openStore as openFsStore,
  prepareStore,
} from "@ocas/fs";

type Flags = Record<string, string | boolean | number | string[]>;

/** Flags that consume the next token as their value. All others are boolean. */
const VALUE_FLAGS = new Set([
  "home",
  "format",
  "tag",
  "schema",
  "resolution",
  "decay",
  "epsilon",
  "inline",
  "type",
  "sort",
  "limit",
  "offset",
  "store",
  "scope",
  "o",
]);

function parseArgs(argv: string[]): { flags: Flags; positional: string[] } {
  const parsed: Flags = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (VALUE_FLAGS.has(key)) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          if (key === "tag") {
            const existing = parsed[key];
            if (Array.isArray(existing)) {
              existing.push(next);
            } else if (typeof existing === "string") {
              parsed[key] = [existing, next];
            } else {
              parsed[key] = [next];
            }
          } else {
            parsed[key] = next;
          }
          i++;
        } else {
          parsed[key] = true;
        }
      } else {
        parsed[key] = true;
      }
      continue;
    }
    if (arg === "-p") {
      parsed.p = true;
      continue;
    }
    if (arg === "-r") {
      parsed.r = true;
      continue;
    }
    if (arg === "-o") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        parsed.o = next;
        i++;
      } else {
        parsed.o = true;
      }
      continue;
    }
    positional.push(arg);
  }

  return { flags: parsed, positional };
}

function normalizeArgv(positionals: string[], parsedFlags: Flags): string[] {
  const normalized = [...positionals];
  const commandName = positionals[0];
  if (
    commandName === "render" &&
    parsedFlags.format === undefined &&
    parsedFlags.json !== true
  ) {
    normalized.push("--format", "text");
  }
  for (const [key, value] of Object.entries(parsedFlags)) {
    if (key === "version") continue;
    if (key === "json" && value === true) {
      // Pass --json directly so cli-kit handles the output format natively.
      // This preserves any explicit --format flag (e.g. --format html) instead
      // of overriding it with "json".
      normalized.push("--json", "--compact");
      continue;
    }
    const cliKey = key === "r" ? "render" : key;
    if (Array.isArray(value)) {
      for (const item of value) {
        normalized.push(`--${cliKey}`, item);
      }
      continue;
    }
    if (value === true) {
      normalized.push(`--${cliKey}`);
      continue;
    }
    if (value === false) {
      continue;
    }
    normalized.push(`--${cliKey}`, String(value));
  }
  return normalized;
}

// --- Handle --version early ---
if (process.argv.includes("--version")) {
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

const defaultStorePath = join(homedir(), ".ocas");
let flags: Flags = {};
const parsedInput = parseArgs(process.argv.slice(2));
const normalizedArgv = normalizeArgv(parsedInput.positional, parsedInput.flags);

// ---- Helpers ----

function die(msg: string): never {
  throw new Error(msg);
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    return die(`Cannot read JSON from "${file}": ${e}`);
  }
}

async function readStdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const input = Buffer.concat(chunks).toString("utf-8").trim();
  if (!input) {
    die("No input on stdin. Pipe JSON content.");
  }
  try {
    return JSON.parse(input);
  } catch {
    return die("Invalid JSON on stdin.");
  }
}

/**
 * Set of write-mutating commands that cannot run against a bundle (read-only).
 * Subcommands are also recorded as `cmd:sub`.
 */
const WRITE_COMMANDS = new Set([
  "put",
  "tag",
  "untag",
  "gc",
  "reindex",
  "import",
  "var:set",
  "var:delete",
  "template:set",
  "template:delete",
]);

/**
 * Open the filesystem-backed Store. Automatically creates directory and
 * bootstraps if needed. If `--store <bundle>` is passed, returns a read-only
 * bundle-backed Store instead.
 */
async function openStore(): Promise<Store> {
  if (typeof flags.store === "string") {
    return await loadBundleStore(flags.store);
  }
  const storePath =
    typeof flags.home === "string"
      ? flags.home
      : (process.env.OCAS_HOME ?? defaultStorePath);
  const fullPath = resolve(storePath);
  return await openFsStore(fullPath);
}

/**
 * Reject write commands when --store points at a bundle. Should be called
 * from the dispatch layer before any write command runs.
 */
function ensureWritable(commandKey: string): void {
  if (typeof flags.store !== "string") return;
  if (WRITE_COMMANDS.has(commandKey)) {
    die(
      `Error: --store is read-only — '${commandKey}' is not allowed against a bundle. Use --home for a writable store.`,
    );
  }
}

/**
 * Hash format check: 13-char uppercase Crockford Base32.
 */
function isHash(input: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{13}$/.test(input);
}

/**
 * Resolve a hash-or-name. If `input` already looks like a hash, return it as-is.
 * If it is a syntactically valid `@scope/name`, query the store's var sub-store
 * for an exact-name match. Otherwise — and on any lookup miss — die with the
 * unified `Unknown hash or variable` error.
 */
function resolveHash(input: string, store: Store): Hash {
  const resolved = tryResolveHash(input, store);
  if (resolved === null) {
    die(`Error: Unknown hash or variable: ${input}`);
  }
  return resolved;
}

/**
 * Non-dying variant of `resolveHash`. Returns `null` when the input is neither
 * a valid hash nor a registered variable name. Malformed inputs (that are
 * neither a 13-char hash nor a syntactically valid `@scope/name`) short-circuit
 * to `null` WITHOUT querying `store.var`. Used by predicate commands like
 * `ocas has` that must report "not present" instead of crashing.
 */
function tryResolveHash(input: string, store: Store): Hash | null {
  if (isHash(input)) {
    return input as Hash;
  }
  // Reject malformed input before touching store.var — anything that fails
  // validateName() cannot possibly be a registered variable name, so the
  // lookup would be pure waste (and produce a misleading error path).
  if (!isValidName(input)) {
    return null;
  }
  const variants = store.var.list({ exactName: input });
  const first = variants[0];
  if (!first) {
    return null;
  }
  return first.value as Hash;
}

/**
 * Parse tag/label arguments
 * Returns: { tags: Record<string, string>, labels: string[], deleteNames: string[] }
 */
function parseTagsLabels(args: string[]): {
  tags: Record<string, string>;
  labels: string[];
  deleteNames: string[];
} {
  const tags: Record<string, string> = {};
  const labels: string[] = [];
  const deleteNames: string[] = [];

  for (const arg of args) {
    if (arg.startsWith(":")) {
      // Deletion syntax: :name
      deleteNames.push(arg.slice(1));
    } else if (arg.includes(":")) {
      // Tag: key:value (split on first colon)
      const colonIdx = arg.indexOf(":");
      const key = arg.slice(0, colonIdx);
      const value = arg.slice(colonIdx + 1);
      tags[key] = value;
    } else {
      // Label: bare identifier
      labels.push(arg);
    }
  }

  return { tags, labels, deleteNames };
}

/**
 * Parse --sort/--limit/--offset/--desc into a ListOptions object.
 * Validates each flag and dies with a clear error on invalid values.
 */
function parseListOptions(): ListOptions {
  // Default limit applied at the CLI layer only; core treats undefined as
  // "no limit" so internal callers (e.g. gc) can fetch full result sets.
  const opts: ListOptions = { limit: 100 };
  const sortFlag = flags.sort;
  if (sortFlag !== undefined) {
    if (typeof sortFlag !== "string") {
      die("Error: --sort requires a value (created or updated)");
    }
    if (sortFlag !== "created" && sortFlag !== "updated") {
      die(`Error: --sort must be 'created' or 'updated' (got '${sortFlag}')`);
    }
    opts.sort = sortFlag;
  }
  const limitFlag = flags.limit;
  if (limitFlag !== undefined) {
    if (typeof limitFlag !== "string") {
      die("Error: --limit requires a numeric value");
    }
    const parsed = Number.parseInt(limitFlag, 10);
    if (
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      String(parsed) !== limitFlag
    ) {
      die(`Error: --limit must be a non-negative integer (got '${limitFlag}')`);
    }
    opts.limit = parsed;
  }
  const offsetFlag = flags.offset;
  if (offsetFlag !== undefined) {
    if (typeof offsetFlag !== "string") {
      die("Error: --offset requires a numeric value");
    }
    const parsed = Number.parseInt(offsetFlag, 10);
    if (
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      String(parsed) !== offsetFlag
    ) {
      die(
        `Error: --offset must be a non-negative integer (got '${offsetFlag}')`,
      );
    }
    opts.offset = parsed;
  }
  if (flags.desc === true) {
    opts.desc = true;
  }
  return opts;
}

// ---- Commands ----

function printUsage(): string {
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return `\
Usage: ocas [--home <path>] [--json] <command> [args]

All JSON commands emit a { type, value } envelope. The type is the hash of the
command's @ocas/output/* schema (shown in parentheses); pipe any envelope into
\`render -p\` to render its value (ocas_ref hashes are expanded).

Commands:
  put <type-hash> <file.json|--pipe> Store node, print envelope (value=hash)            (@ocas/output/put)
  get <hash>                        Print node as envelope                             (@ocas/output/get)
  has <hash>                        Print envelope (value=boolean)                     (@ocas/output/has)
  verify <hash>                     Verify integrity + schema (value=ok/corrupted/invalid) (@ocas/output/verify)
  refs <hash>                       List direct ocas_ref edges                          (@ocas/output/refs)
  walk <hash> [--format tree]       Recursive traversal (--follow-type to include schemas) (@ocas/output/walk)
  hash <type-hash> <file.json|--pipe> Compute hash without storing                     (@ocas/output/hash)
  render <hash> [options]           Render node as text/html with resolution decay (raw output)
  render --pipe/-p [options]        Render { type, value } from stdin (raw output)
  list --type <hash-or-name> [--tag <tag>...]  List hashes for a type, optionally filtered by tags    (@ocas/output/list)
  list-meta                         List meta-schema hashes (value=string[])           (@ocas/output/list-meta)
  list-schema                       List all schema hashes (value=string[])           (@ocas/output/list-schema)
  tag <target> <tag>...             Apply tags/labels to a target                      (@ocas/output/tag)
  untag <target> <tag>...           Remove tags/labels from a target                   (@ocas/output/untag)
  var set <name> <hash> [--tag <tag>...] Create/update a variable                      (@ocas/output/var-set)
  var get <name> --schema <hash>    Get a variable by name + schema                    (@ocas/output/var-get)
  var delete <name> [--schema <hash>] Delete variable(s)                               (@ocas/output/var-delete)
  var list [prefix] [--schema <hash>] [--tag <tag>...] List variables                  (@ocas/output/var-list)
  var history <name> [--schema <hash>] Show value history (LRU)                        (@ocas/output/var-history)
  template set <schema-hash> <file> | --inline <text> Set template for schema          (@ocas/output/template-set)
                                    [--format html] [--static]
  template get <schema-hash>        Get template content (value=string)                (@ocas/output/template-get)
                                    [--format html]
  template list                     List all templates                                 (@ocas/output/template-list)
                                    [--format html]
  template delete <schema-hash>     Delete template for schema                         (@ocas/output/template-delete)
                                    [--format html]
  gc                                Run garbage collection                             (@ocas/output/gc)
  export <root>... -o <file>        Export CAS closure of roots to a tar bundle
  import <bundle> [--scope @s]      Import nodes/vars/tags from a bundle into the store

Flags:
  --home <path>       Store directory (default: $OCAS_HOME or ~/.ocas)
  --store <bundle>    Use a tar bundle as a read-only store (instead of --home)
  --json              Compact JSON output
  --render, -r        Render output inline (equivalent to | ocas render -p)
  --schema <hash>     Schema hash filter for var get/delete/tag/list
  --tag <tag>         Tag/label (can be repeated): key:value (tag), name (label), :name (delete)
  --inline <text>     Inline text content for template set
  --static            Store as static template (CSS/JS); requires --format html
  --format <fmt>      Output format for render/template (text or html, default: text)
  --resolution <n>    Initial resolution for render (default: 1.0)
  --decay <n>         Decay factor for render (default: 0.5)
  --epsilon <n>       Cutoff threshold for render (default: 0.01)
  --pipe, -p          Read from stdin (put/hash: raw JSON payload; render: { type, value } envelope)
  --scope <name>      Variable name remap target for import (e.g. --scope @imported)
  -o <file>           Output path for export

Agent: If you have not installed the ocas skill for this version (${pkg.version}), run \`ocas prompt bootstrap\` and follow the instructions.`;
}

function setRuntimeFlags(runtimeFlags: Record<string, unknown>): void {
  flags = { ...(parsedInput.flags as Flags) };
  // Merge cli-kit parsed flags into the legacy flags object
  for (const [key, value] of Object.entries(runtimeFlags)) {
    if (key === "_positionals") continue;
    if (value !== undefined && value !== false) {
      flags[key] = value as string | boolean | number | string[];
    }
  }
  if (runtimeFlags.render === true || flags.r === true) {
    flags.render = true;
  }
  // Map --json to compact JSON output for backward compat.
  // But only set format to "json" if the user didn't explicitly request a
  // different format like "html" or "text" (used by template namespace selection).
  if (flags.json === true) {
    const explicitFormat = runtimeFlags.format;
    if (explicitFormat !== "html" && explicitFormat !== "text") {
      flags.format = "json";
    }
    flags.compact = true;
  }
}

function getPositionals(runtimeFlags: Record<string, unknown>): string[] {
  const positionals = runtimeFlags._positionals;
  return Array.isArray(positionals)
    ? positionals.filter((v): v is string => typeof v === "string")
    : [];
}

const genericTemplate = "{{value}}";
const returnSchema = z.unknown();
const commonStringFlags = [
  "home",
  "store",
  "schema",
  "type",
  "sort",
  "limit",
  "offset",
  "resolution",
  "decay",
  "epsilon",
  "inline",
  "scope",
  "o",
  "tag",
] as const;

function addCommonFlags(command: {
  flag: (
    name: string,
    definition: {
      type: "string" | "number" | "boolean";
      default?: string | number | boolean;
    },
  ) => unknown;
}): void {
  command.flag("p", { type: "boolean", default: false });
  command.flag("pipe", { type: "boolean", default: false });
  command.flag("desc", { type: "boolean", default: false });
  command.flag("static", { type: "boolean", default: false });
  command.flag("follow-type", { type: "boolean", default: false });
  for (const name of commonStringFlags) {
    command.flag(name, { type: "string" });
  }
}

const pkgPath = join(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

// --- Middleware (function decorator pattern, see issue #234) ---
// The render flag is now enabled implicitly by the presence of global
// middleware, and every `if (flags.render)` block has been replaced by a small
// middleware below.

// Global: render a *returned hash* via renderAsync. Commands whose return
// value is not a hash (e.g. `has` → boolean, `get` → node object, `list` →
// array) are passed through untouched here and either render via their own
// per-command `.use()` middleware or simply produce their normal envelope.
const renderHashFn: RenderFn = async (store, value) => {
  if (typeof value === "string" && isHash(value)) {
    return await renderAsync(store as Store, value as Hash, {});
  }
  return undefined;
};

// Per-command factory: render the return value via renderDirectAsync using the
// `@ocas/output/<name>` type resolved from the store. Used by list / tag / var
// / template-list style commands whose result is an in-memory value, not a hash.
function directRenderMiddleware(outputTypeName: string): CliMiddleware {
  return (inner) => async (ctx, flags) => {
    const result = await inner(ctx, flags);
    if (flags.render === true && result !== undefined) {
      const store = await openStore();
      const typeHash = store.var.get(outputTypeName)?.value;
      if (typeHash !== undefined) {
        const rendered = await renderDirectAsync(typeHash, result, store, {});
        ctx.stdout(`${rendered}\n`);
        return undefined;
      }
    }
    return result;
  };
}

// `get` renders the node's own type+payload (not the tagged envelope value the
// action returns), so it has a bespoke middleware instead of the factory above.
const getRenderMiddleware: CliMiddleware = (inner) => async (ctx, flags) => {
  const result = await inner(ctx, flags);
  if (flags.render === true && result !== null && typeof result === "object") {
    const node = result as { type: Hash; payload: unknown };
    const store = await openStore();
    const rendered = await renderDirectAsync(
      node.type,
      node.payload,
      store,
      {},
    );
    ctx.stdout(`${rendered}\n`);
    return undefined;
  }
  return result;
};

// `refs`/`walk` render the *input* hash (the node being inspected), not their
// own return value (an array / tree string), so they re-resolve the first
// positional.
function inputHashRenderMiddleware(): CliMiddleware {
  return (inner) => async (ctx, flags) => {
    const result = await inner(ctx, flags);
    if (flags.render === true) {
      const input = getPositionals(flags)[0];
      if (input !== undefined) {
        const store = await openStore();
        const hash = resolveHash(input, store);
        const rendered = await renderAsync(store, hash, {});
        ctx.stdout(`${rendered}\n`);
        return undefined;
      }
    }
    return result;
  };
}

const cli = createCLI({
  name: "ocas",
  version: pkg.version,
  middleware: [renderMiddleware(() => openStore(), renderHashFn)],
  homeDir: defaultStorePath,
});

const init = cli
  .command("init")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/init" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    await openStore();
    return { ok: true };
  });
addCommonFlags(init);

const put = cli
  .command("put")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/put" })
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("put");
    const positionals = getPositionals(runtimeFlags);
    const isPipe = runtimeFlags.pipe === true || runtimeFlags.p === true;
    const typeHashOrName = positionals[0];
    const file = isPipe ? undefined : positionals[1];
    if (!typeHashOrName)
      return ctx.error(
        "Usage: ocas put <type-hash> <file.json>\n       ocas put <type-hash> --pipe/-p",
      );
    if (!isPipe && !file)
      return ctx.error(
        "Usage: ocas put <type-hash> <file.json>\n       ocas put <type-hash> --pipe/-p",
      );
    if (isPipe && positionals[1])
      return ctx.error(
        "Cannot use --pipe/-p with a file argument. Use one or the other.",
      );
    const store = await openStore();
    const typeHash = resolveHash(typeHashOrName, store);
    const payload = isPipe
      ? await readStdinJson()
      : readJsonFile(file as string);

    // Schema nodes: use putSchema() which validates via isValidSchema() (recursive)
    const metaHash = resolveHash("@ocas/schema", store);
    if (typeHash === metaHash) {
      let putHash: Hash;
      try {
        putHash = putSchema(store, payload as Record<string, unknown>);
      } catch (_e) {
        return ctx.error(
          `Validation failed: payload in ${file ?? "<stdin>"} does not match schema ${typeHash}`,
        );
      }
      return putHash;
    }

    // Check if schema exists
    const schema = getSchema(store, typeHash);
    if (schema === null) return ctx.error(`Schema not found: ${typeHash}`);

    // Validate payload against schema before storing
    const tempNode = { type: typeHash, payload, timestamp: Date.now() };
    if (!validate(store, tempNode))
      return ctx.error(
        `Validation failed: payload in ${file ?? "<stdin>"} does not match schema ${typeHash}`,
      );

    const hash = store.cas.put(typeHash, payload);
    return hash;
  });
addCommonFlags(put);

const get = cli
  .command("get")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/get" })
  .use(getRenderMiddleware)
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const input = positionals[0];
    if (!input) return ctx.error("Usage: ocas get <hash-or-name>");
    const store = await openStore();
    const hash = resolveHash(input, store);
    const node = store.cas.get(hash);
    if (node === null) return ctx.error(`Node not found: ${hash}`);
    const tags = store.tag.tags(hash);
    const value = tags.length === 0 ? node : { ...node, tags };

    return value;
  });
addCommonFlags(get);

const has = cli
  .command("has")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/has" })
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const input = positionals[0];
    if (!input) return ctx.error("Usage: ocas has <hash-or-name>");
    const store = await openStore();
    const hash = tryResolveHash(input, store);
    return hash !== null && store.cas.has(hash);
  });
addCommonFlags(has);

const verifyCommand = cli
  .command("verify")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/verify" })
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const input = positionals[0];
    if (!input) return ctx.error("Usage: ocas verify <hash-or-name>");
    const store = await openStore();
    const hash = resolveHash(input, store);
    const node = store.cas.get(hash);
    if (node === null) return ctx.error(`Node not found: ${hash}`);
    const ok = await verify(hash, node);
    if (!ok) return "corrupted";
    return validate(store, node) ? "ok" : "invalid";
  });
addCommonFlags(verifyCommand);

const refsCommand = cli
  .command("refs")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/refs" })
  .use(inputHashRenderMiddleware())
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const input = positionals[0];
    if (!input) return ctx.error("Usage: ocas refs <hash-or-name>");
    const store = await openStore();
    const hash = resolveHash(input, store);
    const node = store.cas.get(hash);
    if (node === null) return ctx.error(`Node not found: ${hash}`);
    const refHashes = refs(store, node);
    return refHashes;
  });
addCommonFlags(refsCommand);

const walkCommand = cli
  .command("walk")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/walk" })
  .use(inputHashRenderMiddleware())
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const input = positionals[0];
    if (!input)
      return ctx.error(
        "Usage: ocas walk <hash-or-name> [--format tree] [--follow-type]",
      );
    const store = await openStore();
    const hash = resolveHash(input, store);
    const format = flags.format;
    const followType = flags["follow-type"] === true;

    if (format === "tree") {
      const childMap = new Map<Hash, Hash[]>();
      walk(
        store,
        hash,
        (h, node) => {
          const children = refs(store, node);
          if (followType) {
            children.push(node.type);
          }
          childMap.set(h, children);
        },
        { followType },
      );

      const printed = new Set<Hash>();
      const lines: string[] = [];

      function printNode(h: Hash, prefix: string, isLast: boolean): void {
        const connector = prefix === "" ? "" : isLast ? "└── " : "├── ";
        if (printed.has(h)) {
          lines.push(`${prefix}${connector}${h} (seen)`);
          return;
        }
        printed.add(h);
        lines.push(`${prefix}${connector}${h}`);

        const kids = childMap.get(h) ?? [];
        const childPrefix =
          prefix === "" ? "" : prefix + (isLast ? "    " : "│   ");
        for (let i = 0; i < kids.length; i++) {
          printNode(kids[i] as Hash, childPrefix, i === kids.length - 1);
        }
      }

      printNode(hash, "", true);
      const treeString = lines.join("\n");

      return treeString;
    } else {
      const hashes: Hash[] = [];
      walk(
        store,
        hash,
        (h) => {
          hashes.push(h);
        },
        { followType },
      );

      return hashes;
    }
  });
addCommonFlags(walkCommand);

const hash = cli
  .command("hash")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/hash" })
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const isPipe = runtimeFlags.pipe === true || runtimeFlags.p === true;
    const typeHashOrName = positionals[0];
    const file = isPipe ? undefined : positionals[1];
    if (!typeHashOrName)
      return ctx.error(
        "Usage: ocas hash <type-hash> <file.json>\n       ocas hash <type-hash> --pipe/-p",
      );
    if (!isPipe && !file)
      return ctx.error(
        "Usage: ocas hash <type-hash> <file.json>\n       ocas hash <type-hash> --pipe/-p",
      );
    if (isPipe && positionals[1])
      return ctx.error(
        "Cannot use --pipe/-p with a file argument. Use one or the other.",
      );
    const store = await openStore();
    const typeHash = resolveHash(typeHashOrName, store);
    const payload = isPipe
      ? await readStdinJson()
      : readJsonFile(file as string);
    const computedHash = await computeHash(typeHash, payload);
    return computedHash;
  });
addCommonFlags(hash);

const render = cli
  .command("render")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/render" })
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const isPipe = flags.pipe === true || flags.p === true;
    const input = positionals[0];

    if (isPipe && input) {
      return ctx.error(
        "Cannot use --pipe/-p with a hash argument. Use one or the other.",
      );
    }

    if (!isPipe && !input) {
      return ctx.error(
        "Usage: ocas render <hash-or-name> [--resolution <n>] [--decay <n>] [--epsilon <n>]\n       ocas render --pipe/-p [--resolution <n>] [--decay <n>] [--epsilon <n>]",
      );
    }

    const store = await openStore();

    // Parse numeric options
    const resolution =
      typeof flags.resolution === "string"
        ? Number.parseFloat(flags.resolution)
        : undefined;
    const decay =
      typeof flags.decay === "string"
        ? Number.parseFloat(flags.decay)
        : undefined;
    const epsilon =
      typeof flags.epsilon === "string"
        ? Number.parseFloat(flags.epsilon)
        : undefined;
    // Only pass format to renderAsync if it's a render format (text/html),
    // not a cli-kit envelope format (yaml/json) that happens to be the default.
    const rawFormat =
      typeof flags.format === "string" ? flags.format : undefined;
    const format =
      rawFormat === "text" || rawFormat === "html" ? rawFormat : undefined;

    // Validate numeric values
    if (resolution !== undefined && Number.isNaN(resolution)) {
      return ctx.error("--resolution must be a valid number");
    }
    if (decay !== undefined && Number.isNaN(decay)) {
      return ctx.error("--decay must be a valid number");
    }
    if (epsilon !== undefined && Number.isNaN(epsilon)) {
      return ctx.error("--epsilon must be a valid number");
    }

    const renderOpts = {
      ...(resolution !== undefined && { resolution }),
      ...(decay !== undefined && { decay }),
      ...(epsilon !== undefined && { epsilon }),
      ...(format !== undefined && { format }),
    };

    try {
      let rendered: string;

      if (isPipe) {
        // Read { type, value } JSON from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        const stdinText = Buffer.concat(chunks).toString("utf-8").trim();
        if (!stdinText) {
          return ctx.error(
            "No input on stdin. Pipe a { type, value } JSON envelope.",
          );
        }

        let envelope: { type: string; value: unknown };
        try {
          envelope = JSON.parse(stdinText) as { type: string; value: unknown };
        } catch {
          return ctx.error(
            "Invalid JSON on stdin. Expected { type, value } envelope.",
          );
        }

        if (
          typeof envelope !== "object" ||
          envelope === null ||
          typeof envelope.type !== "string" ||
          !("value" in envelope)
        ) {
          return ctx.error(
            "Invalid envelope. Expected { type: string, value: unknown }.",
          );
        }

        // Resolve type: accept both hash and readable alias (e.g. @ocas/output/put)
        const typeHash = isHash(envelope.type)
          ? (envelope.type as Hash)
          : (bootstrap(store)[envelope.type] ?? null);
        if (typeHash === null) {
          return ctx.error(
            `Unknown type: "${envelope.type}". Expected a hash or a known schema alias.`,
          );
        }

        // If the envelope value is a hash string (e.g. from `put` output),
        // resolve it through renderAsync to apply templates and expand refs.
        // Otherwise, use renderDirectAsync to run the full template + compose
        // pipeline on the in-memory value.
        if (typeof envelope.value === "string" && isHash(envelope.value)) {
          rendered = await renderAsync(
            store,
            envelope.value as Hash,
            renderOpts,
          );
        } else {
          rendered = await renderDirectAsync(
            typeHash,
            envelope.value,
            store,
            renderOpts,
          );
        }
      } else {
        const resolvedHash = resolveHash(input as string, store);
        rendered = await renderAsync(store, resolvedHash, renderOpts);
      }

      // Render outputs raw content — write directly to stdout and return
      // undefined so cli-kit skips its envelope wrapping.
      process.stdout.write(`${rendered}\n`);
      return undefined;
    } catch (error) {
      if (error instanceof CasNodeNotFoundError) {
        return ctx.error(`Error: Node not found: ${error.hash}`);
      }
      if (error instanceof Error) {
        return ctx.error(error.message);
      }
      return ctx.error(String(error));
    }
  });
addCommonFlags(render);

const list = cli
  .command("list")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/list" })
  .use(directRenderMiddleware("@ocas/output/list"))
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const typeFlag = flags.type;
    if (typeof typeFlag !== "string")
      return ctx.error(
        "Usage: ocas list --type <hash-or-name> [--tag <tag>...]",
      );
    const opts = parseListOptions();
    const tagFlags = flags.tag;
    const tagArgs = Array.isArray(tagFlags)
      ? tagFlags
      : typeof tagFlags === "string"
        ? [tagFlags]
        : [];
    const store = await openStore();
    const typeHash = resolveHash(typeFlag, store);

    let entries: ListEntry[];

    if (tagArgs.length === 0) {
      entries = store.cas.listByType(typeHash, opts);
    } else {
      const { tags, labels, deleteNames } = parseTagsLabels(tagArgs);
      if (deleteNames.length > 0) {
        return ctx.error(
          "Error: Cannot use deletion syntax (:name) in list filters",
        );
      }

      // Build per-tag-spec hash sets, then intersect.
      const tagSpecs: string[] = [
        ...Object.entries(tags).map(([k, v]) => `${k}=${v}`),
        ...labels,
      ];
      let intersection: Set<Hash> | null = null;
      for (const spec of tagSpecs) {
        const hashes = store.tag.listByTag(spec);
        const set = new Set<Hash>(hashes);
        if (intersection === null) {
          intersection = set;
        } else {
          const next = new Set<Hash>();
          for (const h of intersection) {
            if (set.has(h)) next.add(h);
          }
          intersection = next;
        }
        if (intersection.size === 0) break;
      }

      // Get all entries of the requested type (no limit/offset yet) and filter.
      const allOfType = store.cas.listByType(typeHash, {
        ...(opts.sort !== undefined ? { sort: opts.sort } : {}),
        ...(opts.desc !== undefined ? { desc: opts.desc } : {}),
      });
      const filtered: ListEntry[] = allOfType.filter((e) =>
        intersection?.has(e.hash),
      );
      entries = applyListOptions(filtered, opts);
    }

    return entries;
  });
addCommonFlags(list);

const listMeta = cli
  .command("list-meta")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/list-meta" })
  .use(directRenderMiddleware("@ocas/output/list-meta"))
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    const opts = parseListOptions();
    const store = await openStore();
    const entries = store.cas.listMeta(opts);
    return entries;
  });
addCommonFlags(listMeta);

const listSchema = cli
  .command("list-schema")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/list-schema" })
  .use(directRenderMiddleware("@ocas/output/list-schema"))
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    const opts = parseListOptions();
    const store = await openStore();
    const entries = store.cas.listSchemas(opts);
    return entries;
  });
addCommonFlags(listSchema);

const tag = cli
  .command("tag")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/tag" })
  .use(directRenderMiddleware("@ocas/output/tag"))
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("tag");
    const positionals = getPositionals(runtimeFlags);
    const targetInput = positionals[0];
    const tagArgs = positionals.slice(1);
    if (!targetInput || tagArgs.length === 0)
      return ctx.error("Usage: ocas tag <target> <tag>...");
    const store = await openStore();
    const target = resolveHash(targetInput, store);
    const { tags, labels, deleteNames } = parseTagsLabels(tagArgs);
    if (deleteNames.length > 0)
      return ctx.error(
        "Error: Cannot use deletion syntax (:name) in tag (use untag)",
      );
    const ops: TagOp[] = [
      ...Object.entries(tags).map(
        ([key, value]) => ({ op: "set", key, value }) as TagOp,
      ),
      ...labels.map((key) => ({ op: "set", key }) as TagOp),
    ];
    store.tag.tag(target, ops);
    const result = store.tag.tags(target);
    return result;
  });
addCommonFlags(tag);

const untag = cli
  .command("untag")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/untag" })
  .use(directRenderMiddleware("@ocas/output/untag"))
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("untag");
    const positionals = getPositionals(runtimeFlags);
    const targetInput = positionals[0];
    const tagArgs = positionals.slice(1);
    if (!targetInput || tagArgs.length === 0)
      return ctx.error("Usage: ocas untag <target> <tag>...");
    const store = await openStore();
    const target = resolveHash(targetInput, store);
    const keys = tagArgs.map((a) =>
      a.startsWith(":")
        ? a.slice(1)
        : a.includes(":")
          ? a.slice(0, a.indexOf(":"))
          : a,
    );
    store.tag.untag(target, keys);
    const result = store.tag.tags(target);
    return result;
  });
addCommonFlags(untag);

const varSet = cli
  .command("var")
  .command("set")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/var-set" })
  .use(directRenderMiddleware("@ocas/output/var-set"))
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("var:set");
    const positionals = getPositionals(runtimeFlags);
    const name = positionals[0];
    const value = positionals[1];
    const tagFlags = flags.tag;
    if (!name || !value)
      return ctx.error("Usage: ocas var set <name> <hash> [--tag <tag>...]");
    if (name.startsWith("@ocas/"))
      return ctx.error(
        "The @ocas/ namespace is reserved and cannot be modified directly. Use a different scope, e.g. @myapp/name (variable names must follow @scope/name format).",
      );
    const store = await openStore();
    try {
      const tagArgs = Array.isArray(tagFlags)
        ? tagFlags
        : typeof tagFlags === "string"
          ? [tagFlags]
          : [];
      const { tags, labels, deleteNames } = parseTagsLabels(tagArgs);
      if (deleteNames.length > 0)
        return ctx.error(
          "Error: Cannot use deletion syntax (:name) in var set",
        );
      const options =
        tagArgs.length > 0
          ? {
              tags: Object.keys(tags).length > 0 ? tags : {},
              labels: labels.length > 0 ? labels : [],
            }
          : undefined;
      const variable = store.var.set(name, value as Hash, options);
      return variable;
    } catch (e) {
      if (
        e instanceof InvalidVariableNameError ||
        e instanceof CasNodeNotFoundError ||
        e instanceof TagLabelConflictError
      ) {
        return ctx.error(`Error: ${(e as Error).message}`);
      }
      throw e;
    }
  });
addCommonFlags(varSet);

const varGet = cli
  .command("var")
  .command("get")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/var-get" })
  .use(directRenderMiddleware("@ocas/output/var-get"))
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const name = positionals[0];
    const schemaInput = flags.schema as string | undefined;
    if (!name || !schemaInput)
      return ctx.error("Usage: ocas var get <name> --schema <hash-or-name>");
    const store = await openStore();
    const schema = resolveHash(schemaInput, store);
    const variable = store.var.get(name, schema);
    if (variable === null)
      return ctx.error(
        `Error: Variable not found: name=${name}, schema=${schema}`,
      );
    const valueTags = store.tag.tags(variable.value);
    const outValue =
      valueTags.length === 0 ? variable : { ...variable, valueTags };
    return outValue;
  });
addCommonFlags(varGet);

const varDelete = cli
  .command("var")
  .command("delete")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/var-delete" })
  .use(directRenderMiddleware("@ocas/output/var-delete"))
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("var:delete");
    const positionals = getPositionals(runtimeFlags);
    const name = positionals[0];
    const schemaInput = flags.schema as string | undefined;
    if (!name)
      return ctx.error(
        "Usage: ocas var delete <name> [--schema <hash-or-name>]",
      );
    if (name.startsWith("@ocas/"))
      return ctx.error(
        "The @ocas/ namespace is reserved and cannot be modified directly. Use a different scope, e.g. @myapp/name (variable names must follow @scope/name format).",
      );
    const store = await openStore();
    try {
      let result: unknown;
      if (schemaInput !== undefined) {
        const schema = resolveHash(schemaInput, store);
        const variables = store.var.remove(name, schema);
        if (variables.length === 0)
          throw new VariableNotFoundError(name, schema);
        result = variables[0] as unknown;
      } else {
        result = store.var.remove(name);
      }
      return result;
    } catch (e) {
      if (e instanceof VariableNotFoundError) {
        return ctx.error(`Error: ${(e as Error).message}`);
      }
      throw e;
    }
  });
addCommonFlags(varDelete);

const varList = cli
  .command("var")
  .command("list")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/var-list" })
  .use(directRenderMiddleware("@ocas/output/var-list"))
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const namePrefix = positionals[0] ?? "";
    const schemaInput = flags.schema as string | undefined;
    const tagFlags = flags.tag;
    const listOpts = parseListOptions();
    const store = await openStore();
    try {
      const schema =
        schemaInput !== undefined ? resolveHash(schemaInput, store) : undefined;
      const tagArgs = Array.isArray(tagFlags)
        ? tagFlags
        : typeof tagFlags === "string"
          ? [tagFlags]
          : [];
      const { tags, labels, deleteNames } = parseTagsLabels(tagArgs);
      if (deleteNames.length > 0)
        return ctx.error(
          "Error: Cannot use deletion syntax (:name) in var list filters",
        );
      const variables = store.var.list({
        namePrefix,
        ...(schema !== undefined ? { schema } : {}),
        ...(Object.keys(tags).length > 0 ? { tags } : {}),
        ...(labels.length > 0 ? { labels } : {}),
        ...listOpts,
      });
      return variables;
    } catch (e) {
      if (e instanceof InvalidVariableNameError) {
        return ctx.error(`Error: ${(e as Error).message}`);
      }
      throw e;
    }
  });
addCommonFlags(varList);

const varHistory = cli
  .command("var")
  .command("history")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/var-history" })
  .use(directRenderMiddleware("@ocas/output/var-history"))
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const name = positionals[0];
    const schemaInput = flags.schema as string | undefined;
    if (!name)
      return ctx.error(
        "Usage: ocas var history <name> [--schema <hash-or-name>]",
      );
    const store = await openStore();
    let schema: Hash;
    if (schemaInput !== undefined) {
      schema = resolveHash(schemaInput, store);
    } else {
      const variants = store.var.list({ exactName: name });
      if (variants.length === 0)
        return ctx.error(`Error: Variable not found: ${name}`);
      if (variants.length > 1)
        return ctx.error(
          `Error: Multiple schema variants for "${name}"; use --schema to disambiguate`,
        );
      schema = (variants[0] as { schema: string }).schema as Hash;
    }
    const entries = store.var.history(name, schema);
    if (entries.length === 0)
      return ctx.error(
        `Error: Variable not found: name=${name}, schema=${schema}`,
      );
    const values = entries.map((e) => e.value);
    const result = { name, schema, values };
    return result;
  });
addCommonFlags(varHistory);

const templateSet = cli
  .command("template")
  .command("set")
  .returns(returnSchema, genericTemplate, {
    name: "@ocas/output/template-set",
  })
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("template:set");
    const positionals = getPositionals(runtimeFlags);
    const schemaInput = positionals[0];
    const inlineFlag = flags.inline;
    const formatFlag =
      typeof flags.format === "string" &&
      (flags.format === "text" || flags.format === "html")
        ? flags.format
        : "text";
    const isStatic = flags.static === true;

    if (!schemaInput) {
      return ctx.error(
        "Usage: ocas template set <schema-hash-or-name> <file> | --inline <text> [--format html] [--static]",
      );
    }

    // --static requires --format html
    if (isStatic && formatFlag !== "html") {
      return ctx.error("Error: --static is only valid with --format html");
    }

    const store = await openStore();

    try {
      const schemaHash = resolveHash(schemaInput, store);
      // Validate schema hash exists in CAS
      if (!store.cas.has(schemaHash)) {
        return ctx.error(`Error: Schema hash not found in CAS: ${schemaHash}`);
      }

      // Determine content source
      let content: string;

      if (typeof inlineFlag === "string") {
        // --inline mode
        const fileArg = positionals[1];
        if (fileArg !== undefined && !fileArg.startsWith("--")) {
          return ctx.error("Error: Cannot specify both file and --inline");
        }
        content = inlineFlag;
      } else if (inlineFlag === true) {
        // --inline flag present but no value
        const contentArg = positionals[1];
        if (!contentArg) {
          return ctx.error(
            "Usage: ocas template set <schema-hash> <file> | --inline <text> [--format html] [--static]",
          );
        }
        content = contentArg;
      } else {
        // File mode
        const file = positionals[1];
        if (!file) {
          return ctx.error(
            "Usage: ocas template set <schema-hash> <file> | --inline <text> [--format html] [--static]",
          );
        }
        if (!existsSync(file)) {
          return ctx.error(`Error: File not found: ${file}`);
        }
        content = readFileSync(file, "utf-8");
      }

      // Store content in CAS under @string schema
      const stringHash = resolveHash("@ocas/string", store);
      const contentHash = store.cas.put(stringHash, content);

      // Create variable binding based on format and static flag
      const varName = isStatic
        ? `@ocas/template-static/html/${schemaHash}`
        : `@ocas/template/${formatFlag}/${schemaHash}`;
      store.var.set(varName, contentHash);

      return { schemaHash, contentHash };
    } catch (e) {
      if (e instanceof CasNodeNotFoundError) {
        return ctx.error(`Error: ${(e as Error).message}`);
      }
      throw e;
    }
  });
addCommonFlags(templateSet);

const templateGet = cli
  .command("template")
  .command("get")
  .returns(returnSchema, genericTemplate, {
    name: "@ocas/output/template-get",
  })
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    const schemaInput = positionals[0];
    const formatFlag =
      typeof flags.format === "string" &&
      (flags.format === "text" || flags.format === "html")
        ? flags.format
        : "text";

    if (!schemaInput) {
      return ctx.error(
        "Usage: ocas template get <schema-hash-or-name> [--format html]",
      );
    }

    const store = await openStore();
    const schemaHash = resolveHash(schemaInput, store);
    const varName = `@ocas/template/${formatFlag}/${schemaHash}`;
    const stringHash = resolveHash("@ocas/string", store);
    const variable = store.var.get(varName, stringHash);

    if (variable === null) {
      return ctx.error(`Error: Template not found for schema: ${schemaHash}`);
    }

    // Get the content from CAS
    const node = store.cas.get(variable.value);
    if (node === null) {
      return ctx.error(`Error: Content not found in CAS: ${variable.value}`);
    }

    return node.payload as string;
  });
addCommonFlags(templateGet);

const templateList = cli
  .command("template")
  .command("list")
  .returns(returnSchema, genericTemplate, {
    name: "@ocas/output/template-list",
  })
  .use(directRenderMiddleware("@ocas/output/template-list"))
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    const formatFlag =
      typeof flags.format === "string" &&
      (flags.format === "text" || flags.format === "html")
        ? flags.format
        : "text";
    const store = await openStore();
    const stringHash = resolveHash("@ocas/string", store);
    const instancePrefix = `@ocas/template/${formatFlag}/`;
    const staticPrefix = `@ocas/template-static/${formatFlag}/`;
    const instanceVars = store.var.list({
      namePrefix: instancePrefix,
      schema: stringHash,
    });
    const staticVars = store.var.list({
      namePrefix: staticPrefix,
      schema: stringHash,
    });

    const templates = [
      ...instanceVars.map((v) => ({
        schemaHash: v.name.replace(instancePrefix, ""),
        contentHash: v.value,
      })),
      ...staticVars.map((v) => ({
        schemaHash: `${v.name.replace(staticPrefix, "")}/static`,
        contentHash: v.value,
      })),
    ];

    return templates;
  });
addCommonFlags(templateList);

const templateDelete = cli
  .command("template")
  .command("delete")
  .returns(returnSchema, genericTemplate, {
    name: "@ocas/output/template-delete",
  })
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("template:delete");
    const positionals = getPositionals(runtimeFlags);
    const schemaInput = positionals[0];
    const formatFlag =
      typeof flags.format === "string" &&
      (flags.format === "text" || flags.format === "html")
        ? flags.format
        : "text";

    if (!schemaInput) {
      return ctx.error(
        "Usage: ocas template delete <schema-hash-or-name> [--format html]",
      );
    }

    const store = await openStore();

    try {
      const schemaHash = resolveHash(schemaInput, store);
      const varName = `@ocas/template/${formatFlag}/${schemaHash}`;
      const stringHash = resolveHash("@ocas/string", store);
      const removed = store.var.remove(varName, stringHash);
      if (removed.length === 0) {
        throw new VariableNotFoundError(varName, stringHash);
      }

      return { deleted: true };
    } catch (e) {
      if (e instanceof VariableNotFoundError) {
        return ctx.error(
          `Error: Template not found for schema: ${schemaInput}`,
        );
      }
      throw e;
    }
  });
addCommonFlags(templateDelete);

const gcCommand = cli
  .command("gc")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/gc" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("gc");
    const store = await openStore();
    return gc(store);
  });
addCommonFlags(gcCommand);

const reindex = cli
  .command("reindex")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/reindex" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("reindex");
    const storePath =
      typeof flags.home === "string"
        ? flags.home
        : (process.env.OCAS_HOME ?? defaultStorePath);
    const fullPath = resolve(storePath);
    const cas = (await prepareStore(fullPath)) as FsCasStore;
    const result = cas.reindex();
    return `Reindexed: ${result.nodes} nodes, ${result.types} type indexes, ${result.removed} stale entries removed.`;
  });
addCommonFlags(reindex);

const exportCommand = cli
  .command("export")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/export" })
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    const positionals = getPositionals(runtimeFlags);
    if (positionals.length === 0) {
      return ctx.error(
        "Usage: ocas export <root>... -o <bundle.tar>\n       ocas export <hash>... -o <bundle.tar>",
      );
    }
    const output = flags.o;
    if (typeof output !== "string") {
      return ctx.error(
        "Error: -o <output-path> is required.\nUsage: ocas export <root>... -o <bundle.tar>",
      );
    }

    const store = await openStore();
    try {
      return await exportBundle(store, positionals, output);
    } catch (e) {
      if (e instanceof Error) {
        return ctx.error(`Error: ${e.message}`);
      }
      throw e;
    }
  });
addCommonFlags(exportCommand);

const importCommand = cli
  .command("import")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/import" })
  .action(async (_args, runtimeFlags, ctx) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("import");
    const positionals = getPositionals(runtimeFlags);
    const bundlePath = positionals[0];
    if (!bundlePath) {
      return ctx.error("Usage: ocas import <bundle.tar> [--scope @newscope]");
    }
    const scope = typeof flags.scope === "string" ? flags.scope : undefined;

    const store = await openStore();
    try {
      const opts = scope !== undefined ? { scope } : undefined;
      return await importBundle(bundlePath, store, opts);
    } catch (e) {
      if (e instanceof Error) {
        return ctx.error(`Error: ${e.message}`);
      }
      throw e;
    }
  });
addCommonFlags(importCommand);

const promptList = cli
  .command("prompt")
  .command("list")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/prompt-list" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return "usage\nbootstrap";
  });
addCommonFlags(promptList);

const promptUsage = cli
  .command("prompt")
  .command("usage")
  .returns(returnSchema, genericTemplate, {
    name: "@ocas/output/prompt-usage",
  })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return readFileSync(join(__dirname, "..", "prompts", "usage.md"), "utf-8");
  });
addCommonFlags(promptUsage);

const promptBootstrap = cli
  .command("prompt")
  .command("bootstrap")
  .returns(returnSchema, genericTemplate, {
    name: "@ocas/output/prompt-bootstrap",
  })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return cmdPromptBootstrap();
  });
addCommonFlags(promptBootstrap);

if (parsedInput.flags.help === true || parsedInput.positional.length === 0) {
  process.stdout.write(`${printUsage()}\n`);
  process.exit(0);
}

const exitCode = await cli.run({ argv: normalizedArgv });
process.exit(exitCode);
