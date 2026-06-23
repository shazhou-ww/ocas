#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCLI, ocasRenderPlugin } from "@ocas/cli-kit";
import { z } from "zod";

import { cmdPromptBootstrap } from "./prompt-bootstrap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

import type { Hash, ListEntry, ListOptions, Store, TagOp } from "@ocas/core";
import {
  applyListOptions,
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
  wrapEnvelope,
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
      normalized.push("--format", "json", "--compact");
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
let commandOutput: unknown = undefined;
const parsedInput = parseArgs(process.argv.slice(2));
const normalizedArgv = normalizeArgv(parsedInput.positional, parsedInput.flags);

// ---- Helpers ----

async function out(data: unknown, store?: Store): Promise<void> {
  void store;
  commandOutput = data;
}

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

async function cmdPut(args: string[]): Promise<void> {
  const isPipe = flags.pipe === true || flags.p === true;
  const typeHashOrName = args[0];
  const file = isPipe ? undefined : args[1];
  if (!typeHashOrName || (!isPipe && !file))
    die(
      "Usage: ocas put <type-hash> <file.json>\n       ocas put <type-hash> --pipe/-p",
    );
  if (isPipe && args[1])
    die("Cannot use --pipe/-p with a file argument. Use one or the other.");
  const store = await openStore();
  const typeHash = resolveHash(typeHashOrName, store);
  const payload = isPipe ? await readStdinJson() : readJsonFile(file as string);

  // Schema nodes: use putSchema() which validates via isValidSchema() (recursive)
  // instead of ajv against meta-schema (which can't express recursive constraints)
  const metaHash = resolveHash("@ocas/schema", store);
  if (typeHash === metaHash) {
    try {
      const hash = putSchema(store, payload as Record<string, unknown>);
      await out(await wrapEnvelope(store, "@ocas/output/put", hash), store);
    } catch (_e) {
      die(
        `Validation failed: payload in ${file ?? "<stdin>"} does not match schema ${typeHash}`,
      );
    }
    return;
  }

  // Check if schema exists
  const schema = getSchema(store, typeHash);
  if (schema === null) {
    die(`Schema not found: ${typeHash}`);
  }

  // Validate payload against schema before storing
  const tempNode = { type: typeHash, payload, timestamp: Date.now() };
  if (!validate(store, tempNode)) {
    die(
      `Validation failed: payload in ${file ?? "<stdin>"} does not match schema ${typeHash}`,
    );
  }

  const hash = store.cas.put(typeHash, payload);
  await out(await wrapEnvelope(store, "@ocas/output/put", hash), store);
}

async function cmdGet(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) die("Usage: ocas get <hash-or-name>");
  const store = await openStore();
  const hash = resolveHash(input, store);
  const node = store.cas.get(hash);
  if (node === null) die(`Node not found: ${hash}`);
  const tags = store.tag.tags(hash);
  const value = tags.length === 0 ? node : { ...node, tags };
  await out(await wrapEnvelope(store, "@ocas/output/get", value), store);
}

async function cmdHas(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) die("Usage: ocas has <hash-or-name>");
  const store = await openStore();
  const hash = tryResolveHash(input, store);
  const present = hash !== null && store.cas.has(hash);
  await out(await wrapEnvelope(store, "@ocas/output/has", present), store);
}

async function cmdVerify(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) die("Usage: ocas verify <hash-or-name>");
  const store = await openStore();
  const hash = resolveHash(input, store);
  const node = store.cas.get(hash);
  if (node === null) die(`Node not found: ${hash}`);
  const ok = await verify(hash, node);
  let status: string;
  if (!ok) {
    status = "corrupted";
  } else {
    status = validate(store, node) ? "ok" : "invalid";
  }
  await out(await wrapEnvelope(store, "@ocas/output/verify", status), store);
}

async function cmdRefs(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) die("Usage: ocas refs <hash-or-name>");
  const store = await openStore();
  const hash = resolveHash(input, store);
  const node = store.cas.get(hash);
  if (node === null) die(`Node not found: ${hash}`);
  const refHashes = refs(store, node);
  await out(await wrapEnvelope(store, "@ocas/output/refs", refHashes), store);
}

async function cmdWalk(args: string[]): Promise<void> {
  const input = args[0];
  if (!input)
    die("Usage: ocas walk <hash-or-name> [--format tree] [--follow-type]");
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
    await out(
      await wrapEnvelope(store, "@ocas/output/walk", lines.join("\n")),
      store,
    );
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
    await out(await wrapEnvelope(store, "@ocas/output/walk", hashes), store);
  }
}

async function cmdHash(args: string[]): Promise<void> {
  const isPipe = flags.pipe === true || flags.p === true;
  const typeHashOrName = args[0];
  const file = isPipe ? undefined : args[1];
  if (!typeHashOrName || (!isPipe && !file))
    die(
      "Usage: ocas hash <type-hash> <file.json>\n       ocas hash <type-hash> --pipe/-p",
    );
  if (isPipe && args[1])
    die("Cannot use --pipe/-p with a file argument. Use one or the other.");
  const store = await openStore();
  const typeHash = resolveHash(typeHashOrName, store);
  const payload = isPipe ? await readStdinJson() : readJsonFile(file as string);
  const hash = await computeHash(typeHash, payload);
  await out(await wrapEnvelope(store, "@ocas/output/hash", hash), store);
}

async function cmdRender(args: string[]): Promise<void> {
  const isPipe = flags.pipe === true || flags.p === true;
  const input = args[0];

  if (isPipe && input) {
    die("Cannot use --pipe/-p with a hash argument. Use one or the other.");
  }

  if (!isPipe && !input) {
    die(
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
  const format = typeof flags.format === "string" ? flags.format : undefined;

  // Validate numeric values
  if (resolution !== undefined && Number.isNaN(resolution)) {
    die("--resolution must be a valid number");
  }
  if (decay !== undefined && Number.isNaN(decay)) {
    die("--decay must be a valid number");
  }
  if (epsilon !== undefined && Number.isNaN(epsilon)) {
    die("--epsilon must be a valid number");
  }

  try {
    if (isPipe) {
      // Read { type, value } JSON from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      const input = Buffer.concat(chunks).toString("utf-8").trim();
      if (!input) {
        die("No input on stdin. Pipe a { type, value } JSON envelope.");
      }

      let envelope: { type: string; value: unknown };
      try {
        envelope = JSON.parse(input) as { type: string; value: unknown };
      } catch {
        die("Invalid JSON on stdin. Expected { type, value } envelope.");
        return; // unreachable, for TS
      }

      if (
        typeof envelope !== "object" ||
        envelope === null ||
        typeof envelope.type !== "string" ||
        !("value" in envelope)
      ) {
        die("Invalid envelope. Expected { type: string, value: unknown }.");
      }

      // Validate type hash format: 13-char uppercase Crockford Base32
      if (!isHash(envelope.type)) {
        die(
          `Invalid type hash: "${envelope.type}". Expected 13-character uppercase Crockford Base32 string.`,
        );
      }

      // If the envelope value is a hash string (e.g. from `put` output),
      // resolve it through renderAsync to apply templates and expand refs.
      // Otherwise, use renderDirectAsync to run the full template + compose
      // pipeline on the in-memory value.
      if (typeof envelope.value === "string" && isHash(envelope.value)) {
        const output = await renderAsync(store, envelope.value as Hash, {
          ...(resolution !== undefined && { resolution }),
          ...(decay !== undefined && { decay }),
          ...(epsilon !== undefined && { epsilon }),
          ...(format !== undefined && { format }),
        });
        await out(output);
      } else {
        const output = await renderDirectAsync(
          envelope.type as Hash,
          envelope.value,
          store,
          {
            ...(resolution !== undefined && { resolution }),
            ...(decay !== undefined && { decay }),
            ...(epsilon !== undefined && { epsilon }),
            ...(format !== undefined && { format }),
          },
        );
        await out(output);
      }
    } else {
      const hash = resolveHash(input as string, store);
      const output = await renderAsync(store, hash, {
        ...(resolution !== undefined && { resolution }),
        ...(decay !== undefined && { decay }),
        ...(epsilon !== undefined && { epsilon }),
        ...(format !== undefined && { format }),
      });
      await out(output);
    }
  } catch (error) {
    if (error instanceof CasNodeNotFoundError) {
      die(`Error: Node not found: ${error.hash}`);
    }
    if (error instanceof Error) {
      die(error.message);
    }
    die(String(error));
  }
}

async function cmdVarSet(args: string[]): Promise<void> {
  const name = args[0];
  const value = args[1];
  const tagFlags = flags.tag;

  if (!name || !value) {
    die("Usage: ocas var set <name> <hash> [--tag <tag>...]");
  }

  if (name.startsWith("@ocas/")) {
    die(
      "The @ocas/ namespace is reserved and cannot be modified directly. Use a different scope, e.g. @myapp/name (variable names must follow @scope/name format).",
    );
  }

  const store = await openStore();

  try {
    // Parse tags/labels from --tag flags
    const tagArgs = Array.isArray(tagFlags)
      ? tagFlags
      : typeof tagFlags === "string"
        ? [tagFlags]
        : [];
    const { tags, labels, deleteNames } = parseTagsLabels(tagArgs);

    // Check for conflicts in initial tags/labels
    if (deleteNames.length > 0) {
      die("Error: Cannot use deletion syntax (:name) in var set");
    }

    // If --tag flags are provided at all, always pass options to replace tags/labels
    // If no --tag flags, pass undefined to preserve existing tags/labels
    const options =
      tagArgs.length > 0
        ? {
            tags: Object.keys(tags).length > 0 ? tags : {},
            labels: labels.length > 0 ? labels : [],
          }
        : undefined;

    const variable = store.var.set(name, value as Hash, options);
    await out(
      await wrapEnvelope(store, "@ocas/output/var-set", variable),
      store,
    );
  } catch (e) {
    if (
      e instanceof InvalidVariableNameError ||
      e instanceof CasNodeNotFoundError ||
      e instanceof TagLabelConflictError
    ) {
      die(`Error: ${e.message}`);
    }
    throw e;
  }
}

async function cmdVarGet(args: string[]): Promise<void> {
  const name = args[0];
  const schemaInput = flags.schema as string | undefined;

  if (!name || !schemaInput) {
    die("Usage: ocas var get <name> --schema <hash-or-name>");
  }

  const store = await openStore();
  const schema = resolveHash(schemaInput, store);
  const variable = store.var.get(name, schema);
  if (variable === null) {
    die(`Error: Variable not found: name=${name}, schema=${schema}`);
  }
  const valueTags = store.tag.tags(variable.value);
  const out_value =
    valueTags.length === 0 ? variable : { ...variable, valueTags };
  await out(
    await wrapEnvelope(store, "@ocas/output/var-get", out_value),
    store,
  );
}

async function cmdVarDelete(args: string[]): Promise<void> {
  const name = args[0];
  const schemaInput = flags.schema as string | undefined;

  if (!name) {
    die("Usage: ocas var delete <name> [--schema <hash-or-name>]");
  }

  if (name.startsWith("@ocas/")) {
    die(
      "The @ocas/ namespace is reserved and cannot be modified directly. Use a different scope, e.g. @myapp/name (variable names must follow @scope/name format).",
    );
  }

  const store = await openStore();

  try {
    if (schemaInput !== undefined) {
      const schema = resolveHash(schemaInput, store);
      // Precise deletion: remove specific (name, schema) variant
      const variables = store.var.remove(name, schema);
      if (variables.length === 0) {
        throw new VariableNotFoundError(name, schema);
      }
      await out(
        await wrapEnvelope(
          store,
          "@ocas/output/var-delete",
          variables[0] as unknown,
        ),
        store,
      );
    } else {
      // Batch deletion: remove all variants for this name
      const variables = store.var.remove(name);
      await out(
        await wrapEnvelope(store, "@ocas/output/var-delete", variables),
        store,
      );
    }
  } catch (e) {
    if (e instanceof VariableNotFoundError) {
      die(`Error: ${e.message}`);
    }
    throw e;
  }
}

async function cmdTag(args: string[]): Promise<void> {
  const targetInput = args[0];
  const tagArgs = args.slice(1);
  if (!targetInput || tagArgs.length === 0) {
    die("Usage: ocas tag <target> <tag>...");
  }
  const store = await openStore();
  const target = resolveHash(targetInput, store);
  const { tags, labels, deleteNames } = parseTagsLabels(tagArgs);
  if (deleteNames.length > 0) {
    die("Error: Cannot use deletion syntax (:name) in tag (use untag)");
  }
  const ops: TagOp[] = [
    ...Object.entries(tags).map(
      ([key, value]) => ({ op: "set", key, value }) as TagOp,
    ),
    ...labels.map((key) => ({ op: "set", key }) as TagOp),
  ];
  store.tag.tag(target, ops);
  await out(
    await wrapEnvelope(store, "@ocas/output/tag", store.tag.tags(target)),
    store,
  );
}

async function cmdUntag(args: string[]): Promise<void> {
  const targetInput = args[0];
  const tagArgs = args.slice(1);
  if (!targetInput || tagArgs.length === 0) {
    die("Usage: ocas untag <target> <tag>...");
  }
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
  await out(
    await wrapEnvelope(store, "@ocas/output/untag", store.tag.tags(target)),
    store,
  );
}

async function cmdVarHistory(args: string[]): Promise<void> {
  const name = args[0];
  const schemaInput = flags.schema as string | undefined;

  if (!name) {
    die("Usage: ocas var history <name> [--schema <hash-or-name>]");
  }

  const store = await openStore();
  let schema: Hash;
  if (schemaInput !== undefined) {
    schema = resolveHash(schemaInput, store);
  } else {
    const variants = store.var.list({ exactName: name });
    if (variants.length === 0) {
      die(`Error: Variable not found: ${name}`);
    }
    if (variants.length > 1) {
      die(
        `Error: Multiple schema variants for "${name}"; use --schema to disambiguate`,
      );
    }
    schema = (variants[0] as { schema: string }).schema as Hash;
  }

  const entries = store.var.history(name, schema);
  if (entries.length === 0) {
    die(`Error: Variable not found: name=${name}, schema=${schema}`);
  }

  const values = entries.map((e) => e.value);
  await out(
    await wrapEnvelope(store, "@ocas/output/var-history", {
      name,
      schema,
      values,
    }),
    store,
  );
}

async function cmdVarList(args: string[]): Promise<void> {
  const namePrefix = args[0] ?? "";
  const schemaInput = flags.schema as string | undefined;
  const tagFlags = flags.tag;
  const listOpts = parseListOptions();

  const store = await openStore();

  try {
    const schema =
      schemaInput !== undefined ? resolveHash(schemaInput, store) : undefined;
    // Parse tags/labels from --tag flags
    const tagArgs = Array.isArray(tagFlags)
      ? tagFlags
      : typeof tagFlags === "string"
        ? [tagFlags]
        : [];
    const { tags, labels, deleteNames } = parseTagsLabels(tagArgs);

    // Check for invalid deletion syntax in filters
    if (deleteNames.length > 0) {
      die("Error: Cannot use deletion syntax (:name) in var list filters");
    }

    const variables = store.var.list({
      namePrefix,
      ...(schema !== undefined ? { schema } : {}),
      ...(Object.keys(tags).length > 0 ? { tags } : {}),
      ...(labels.length > 0 ? { labels } : {}),
      ...listOpts,
    });
    await out(
      await wrapEnvelope(store, "@ocas/output/var-list", variables),
      store,
    );
  } catch (e) {
    if (e instanceof InvalidVariableNameError) {
      die(`Error: ${e.message}`);
    }
    throw e;
  }
}

async function cmdTemplateSet(args: string[]): Promise<void> {
  const schemaInput = args[0];
  const inlineFlag = flags.inline;
  const formatFlag = typeof flags.format === "string" ? flags.format : "text";
  const isStatic = flags.static === true;

  if (!schemaInput) {
    die(
      "Usage: ocas template set <schema-hash-or-name> <file> | --inline <text> [--format html] [--static]",
    );
  }

  // --static requires --format html
  if (isStatic && formatFlag !== "html") {
    die("Error: --static is only valid with --format html");
  }

  const store = await openStore();

  try {
    const schemaHash = resolveHash(schemaInput, store);
    // Validate schema hash exists in CAS
    if (!store.cas.has(schemaHash)) {
      die(`Error: Schema hash not found in CAS: ${schemaHash}`);
    }

    // Determine content source
    let content: string;

    if (typeof inlineFlag === "string") {
      // --inline mode
      const fileArg = args[1];
      if (fileArg !== undefined && !fileArg.startsWith("--")) {
        die("Error: Cannot specify both file and --inline");
      }
      content = inlineFlag;
    } else if (inlineFlag === true) {
      // --inline flag present but no value
      const contentArg = args[1];
      if (!contentArg) {
        die(
          "Usage: ocas template set <schema-hash> <file> | --inline <text> [--format html] [--static]",
        );
      }
      content = contentArg;
    } else {
      // File mode
      const file = args[1];
      if (!file) {
        die(
          "Usage: ocas template set <schema-hash> <file> | --inline <text> [--format html] [--static]",
        );
      }
      if (!existsSync(file)) {
        die(`Error: File not found: ${file}`);
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

    await out(
      await wrapEnvelope(store, "@ocas/output/template-set", {
        schemaHash,
        contentHash,
      }),
      store,
    );
  } catch (e) {
    if (e instanceof CasNodeNotFoundError) {
      die(`Error: ${e.message}`);
    }
    throw e;
  }
}

async function cmdTemplateGet(args: string[]): Promise<void> {
  const schemaInput = args[0];
  const formatFlag = typeof flags.format === "string" ? flags.format : "text";

  if (!schemaInput) {
    die("Usage: ocas template get <schema-hash-or-name> [--format html]");
  }

  const store = await openStore();
  const schemaHash = resolveHash(schemaInput, store);
  const varName = `@ocas/template/${formatFlag}/${schemaHash}`;
  const stringHash = resolveHash("@ocas/string", store);
  const variable = store.var.get(varName, stringHash);

  if (variable === null) {
    die(`Error: Template not found for schema: ${schemaHash}`);
  }

  // Get the content from CAS
  const node = store.cas.get(variable.value);
  if (node === null) {
    die(`Error: Content not found in CAS: ${variable.value}`);
  }

  await out(
    await wrapEnvelope(
      store,
      "@ocas/output/template-get",
      node.payload as string,
    ),
    store,
  );
}

async function cmdTemplateList(_args: string[]): Promise<void> {
  const formatFlag = typeof flags.format === "string" ? flags.format : "text";
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

  await out(
    await wrapEnvelope(store, "@ocas/output/template-list", templates),
    store,
  );
}

async function cmdTemplateDelete(args: string[]): Promise<void> {
  const schemaInput = args[0];
  const formatFlag = typeof flags.format === "string" ? flags.format : "text";

  if (!schemaInput) {
    die("Usage: ocas template delete <schema-hash-or-name> [--format html]");
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

    await out(
      await wrapEnvelope(store, "@ocas/output/template-delete", {
        deleted: true,
      }),
      store,
    );
  } catch (e) {
    if (e instanceof VariableNotFoundError) {
      die(`Error: Template not found for schema: ${schemaInput}`);
    }
    throw e;
  }
}

async function cmdGc(_args: string[]): Promise<void> {
  const store = await openStore();
  const stats = gc(store);
  await out(await wrapEnvelope(store, "@ocas/output/gc", stats), store);
}

async function cmdReindex(_args: string[]): Promise<void> {
  const storePath =
    typeof flags.home === "string"
      ? flags.home
      : (process.env.OCAS_HOME ?? defaultStorePath);
  const fullPath = resolve(storePath);
  const cas = (await prepareStore(fullPath)) as FsCasStore;
  const result = cas.reindex();
  await out(
    `Reindexed: ${result.nodes} nodes, ${result.types} type indexes, ${result.removed} stale entries removed.`,
  );
}

async function cmdExport(args: string[]): Promise<void> {
  if (args.length === 0) {
    die(
      "Usage: ocas export <root>... -o <bundle.tar>\n       ocas export <hash>... -o <bundle.tar>",
    );
  }
  const output = flags.o;
  if (typeof output !== "string") {
    die(
      "Error: -o <output-path> is required.\nUsage: ocas export <root>... -o <bundle.tar>",
    );
  }

  const store = await openStore();
  try {
    const stats = await exportBundle(store, args, output);
    await out(await wrapEnvelope(store, "@ocas/output/export", stats), store);
  } catch (e) {
    if (e instanceof Error) {
      die(`Error: ${e.message}`);
    }
    throw e;
  }
}

async function cmdImport(args: string[]): Promise<void> {
  const bundlePath = args[0];
  if (!bundlePath) {
    die("Usage: ocas import <bundle.tar> [--scope @newscope]");
  }
  const scope = typeof flags.scope === "string" ? flags.scope : undefined;

  const store = await openStore();
  try {
    const opts = scope !== undefined ? { scope } : undefined;
    const stats = await importBundle(bundlePath, store, opts);
    await out(await wrapEnvelope(store, "@ocas/output/import", stats), store);
  } catch (e) {
    if (e instanceof Error) {
      die(`Error: ${e.message}`);
    }
    throw e;
  }
}

async function cmdList(_args: string[]): Promise<void> {
  const typeFlag = flags.type;
  if (typeof typeFlag !== "string")
    die("Usage: ocas list --type <hash-or-name> [--tag <tag>...]");
  const opts = parseListOptions();
  const tagFlags = flags.tag;
  const tagArgs = Array.isArray(tagFlags)
    ? tagFlags
    : typeof tagFlags === "string"
      ? [tagFlags]
      : [];
  const store = await openStore();
  const typeHash = resolveHash(typeFlag, store);

  if (tagArgs.length === 0) {
    const entries = store.cas.listByType(typeHash, opts);
    await out(await wrapEnvelope(store, "@ocas/output/list", entries), store);
    return;
  }

  const { tags, labels, deleteNames } = parseTagsLabels(tagArgs);
  if (deleteNames.length > 0) {
    die("Error: Cannot use deletion syntax (:name) in list filters");
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
  const paged = applyListOptions(filtered, opts);
  await out(await wrapEnvelope(store, "@ocas/output/list", paged), store);
}

async function cmdListMeta(_args: string[]): Promise<void> {
  const opts = parseListOptions();
  const store = await openStore();
  const entries = store.cas.listMeta(opts);
  await out(
    await wrapEnvelope(store, "@ocas/output/list-meta", entries),
    store,
  );
}

async function cmdListSchema(_args: string[]): Promise<void> {
  const opts = parseListOptions();
  const store = await openStore();
  const entries = store.cas.listSchemas(opts);
  await out(
    await wrapEnvelope(store, "@ocas/output/list-schema", entries),
    store,
  );
}

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

// ---- Dispatch ----
interface Envelope {
  type: string;
  value: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "value" in value
  );
}

function setRuntimeFlags(runtimeFlags: Record<string, unknown>): void {
  flags = { ...(parsedInput.flags as Flags) };
  if (runtimeFlags.render === true || flags.r === true) {
    flags.render = true;
  }
  if (flags.json === true) {
    flags.compact = true;
  }
}

function getPositionals(runtimeFlags: Record<string, unknown>): string[] {
  const positionals = runtimeFlags._positionals;
  return Array.isArray(positionals)
    ? positionals.filter((v): v is string => typeof v === "string")
    : [];
}

async function invokeLegacy(
  commandKey: string,
  fn: (args: string[]) => Promise<void>,
  args: string[],
  _expectedType: string,
): Promise<unknown> {
  ensureWritable(commandKey);
  commandOutput = undefined;
  await fn(args);
  const output = commandOutput;
  if (!isEnvelope(output)) {
    return output;
  }
  return output.value;
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
  command.flag("json", { type: "boolean", default: false });
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
const cli = createCLI({
  name: "ocas",
  version: pkg.version,
  plugins: [ocasRenderPlugin(() => openStore())],
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
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "put",
      cmdPut,
      getPositionals(runtimeFlags),
      "@ocas/output/put",
    );
  });
addCommonFlags(put);

const get = cli
  .command("get")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/get" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "get",
      cmdGet,
      getPositionals(runtimeFlags),
      "@ocas/output/get",
    );
  });
addCommonFlags(get);

const has = cli
  .command("has")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/has" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "has",
      cmdHas,
      getPositionals(runtimeFlags),
      "@ocas/output/has",
    );
  });
addCommonFlags(has);

const verifyCommand = cli
  .command("verify")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/verify" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "verify",
      cmdVerify,
      getPositionals(runtimeFlags),
      "@ocas/output/verify",
    );
  });
addCommonFlags(verifyCommand);

const refsCommand = cli
  .command("refs")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/refs" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "refs",
      cmdRefs,
      getPositionals(runtimeFlags),
      "@ocas/output/refs",
    );
  });
addCommonFlags(refsCommand);

const walkCommand = cli
  .command("walk")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/walk" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "walk",
      cmdWalk,
      getPositionals(runtimeFlags),
      "@ocas/output/walk",
    );
  });
addCommonFlags(walkCommand);

const hash = cli
  .command("hash")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/hash" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "hash",
      cmdHash,
      getPositionals(runtimeFlags),
      "@ocas/output/hash",
    );
  });
addCommonFlags(hash);

const render = cli
  .command("render")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/render" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("render");
    commandOutput = undefined;
    await cmdRender(getPositionals(runtimeFlags));
    return commandOutput;
  });
addCommonFlags(render);

const list = cli
  .command("list")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/list" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "list",
      cmdList,
      getPositionals(runtimeFlags),
      "@ocas/output/list",
    );
  });
addCommonFlags(list);

const listMeta = cli
  .command("list-meta")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/list-meta" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "list-meta",
      cmdListMeta,
      getPositionals(runtimeFlags),
      "@ocas/output/list-meta",
    );
  });
addCommonFlags(listMeta);

const listSchema = cli
  .command("list-schema")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/list-schema" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "list-schema",
      cmdListSchema,
      getPositionals(runtimeFlags),
      "@ocas/output/list-schema",
    );
  });
addCommonFlags(listSchema);

const tag = cli
  .command("tag")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/tag" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "tag",
      cmdTag,
      getPositionals(runtimeFlags),
      "@ocas/output/tag",
    );
  });
addCommonFlags(tag);

const untag = cli
  .command("untag")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/untag" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "untag",
      cmdUntag,
      getPositionals(runtimeFlags),
      "@ocas/output/untag",
    );
  });
addCommonFlags(untag);

const varSet = cli
  .command("var")
  .command("set")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/var-set" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "var:set",
      cmdVarSet,
      getPositionals(runtimeFlags),
      "@ocas/output/var-set",
    );
  });
addCommonFlags(varSet);

const varGet = cli
  .command("var")
  .command("get")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/var-get" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "var:get",
      cmdVarGet,
      getPositionals(runtimeFlags),
      "@ocas/output/var-get",
    );
  });
addCommonFlags(varGet);

const varDelete = cli
  .command("var")
  .command("delete")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/var-delete" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "var:delete",
      cmdVarDelete,
      getPositionals(runtimeFlags),
      "@ocas/output/var-delete",
    );
  });
addCommonFlags(varDelete);

const varList = cli
  .command("var")
  .command("list")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/var-list" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "var:list",
      cmdVarList,
      getPositionals(runtimeFlags),
      "@ocas/output/var-list",
    );
  });
addCommonFlags(varList);

const varHistory = cli
  .command("var")
  .command("history")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/var-history" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "var:history",
      cmdVarHistory,
      getPositionals(runtimeFlags),
      "@ocas/output/var-history",
    );
  });
addCommonFlags(varHistory);

const templateSet = cli
  .command("template")
  .command("set")
  .returns(returnSchema, genericTemplate, {
    name: "@ocas/output/template-set",
  })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "template:set",
      cmdTemplateSet,
      getPositionals(runtimeFlags),
      "@ocas/output/template-set",
    );
  });
addCommonFlags(templateSet);

const templateGet = cli
  .command("template")
  .command("get")
  .returns(returnSchema, genericTemplate, {
    name: "@ocas/output/template-get",
  })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "template:get",
      cmdTemplateGet,
      getPositionals(runtimeFlags),
      "@ocas/output/template-get",
    );
  });
addCommonFlags(templateGet);

const templateList = cli
  .command("template")
  .command("list")
  .returns(returnSchema, genericTemplate, {
    name: "@ocas/output/template-list",
  })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "template:list",
      cmdTemplateList,
      getPositionals(runtimeFlags),
      "@ocas/output/template-list",
    );
  });
addCommonFlags(templateList);

const templateDelete = cli
  .command("template")
  .command("delete")
  .returns(returnSchema, genericTemplate, {
    name: "@ocas/output/template-delete",
  })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "template:delete",
      cmdTemplateDelete,
      getPositionals(runtimeFlags),
      "@ocas/output/template-delete",
    );
  });
addCommonFlags(templateDelete);

const gcCommand = cli
  .command("gc")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/gc" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "gc",
      cmdGc,
      getPositionals(runtimeFlags),
      "@ocas/output/gc",
    );
  });
addCommonFlags(gcCommand);

const reindex = cli
  .command("reindex")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/reindex" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    ensureWritable("reindex");
    commandOutput = undefined;
    await cmdReindex(getPositionals(runtimeFlags));
    return commandOutput;
  });
addCommonFlags(reindex);

const exportCommand = cli
  .command("export")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/export" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "export",
      cmdExport,
      getPositionals(runtimeFlags),
      "@ocas/output/export",
    );
  });
addCommonFlags(exportCommand);

const importCommand = cli
  .command("import")
  .returns(returnSchema, genericTemplate, { name: "@ocas/output/import" })
  .action(async (_args, runtimeFlags) => {
    setRuntimeFlags(runtimeFlags);
    return await invokeLegacy(
      "import",
      cmdImport,
      getPositionals(runtimeFlags),
      "@ocas/output/import",
    );
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
