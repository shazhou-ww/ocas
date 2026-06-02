#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Hash, ListOptions, Store, VariableStore } from "@ocas/core";
import {
  bootstrap,
  CasNodeNotFoundError,
  computeHash,
  createVariableStore,
  gc,
  getSchema,
  InvalidTagFormatError,
  InvalidVariableNameError,
  putSchema,
  refs,
  renderAsync,
  renderDirect,
  TagLabelConflictError,
  VariableNotFoundError,
  validate,
  verify,
  walk,
  wrapEnvelope,
} from "@ocas/core";
import { openStore as openFsStore, prepareStore } from "@ocas/fs";

// ---- Argument parsing ----

type Flags = Record<string, string | boolean | string[]>;

/** Flags that consume the next token as their value. All others are boolean. */
const VALUE_FLAGS = new Set([
  "home",
  "format",
  "var-db",
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
]);

function parseArgs(argv: string[]): { flags: Flags; positional: string[] } {
  const flags: Flags = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (VALUE_FLAGS.has(key)) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          // Handle repeatable flags (like --tag)
          if (key === "tag") {
            const existing = flags[key];
            if (Array.isArray(existing)) {
              existing.push(next);
            } else if (typeof existing === "string") {
              flags[key] = [existing, next];
            } else {
              flags[key] = [next];
            }
          } else {
            flags[key] = next;
          }
          i++;
        } else {
          flags[key] = true;
        }
      } else {
        flags[key] = true;
      }
    } else if (arg === "-p") {
      flags.p = true;
    } else if (arg === "-r") {
      flags.r = true;
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

const { flags, positional } = parseArgs(process.argv.slice(2));

// --- Handle --version early ---
if (flags.version === true) {
  const pkgPath = join(import.meta.dir, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

const defaultStorePath = join(homedir(), ".ocas");
const storePath =
  typeof flags.home === "string"
    ? flags.home
    : (process.env.OCAS_HOME ?? defaultStorePath);
const compact = flags.json === true;

const defaultVarDbPath = join(storePath, "variables.db");
const varDbPath =
  typeof flags["var-db"] === "string" ? flags["var-db"] : defaultVarDbPath;

// ---- Helpers ----

const inlineRender = flags.render === true || flags.r === true;

async function out(data: unknown, store?: Store): Promise<void> {
  if (
    inlineRender &&
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    "value" in data
  ) {
    const envelope = data as { type: string; value: unknown };
    const s = store ?? (await openStore());
    // renderDirect is synchronous; passing null options uses defaults.
    // varStore is intentionally omitted — inline render uses YAML fallback
    // only, custom templates require the full `ocas render` command.
    const output = renderDirect(envelope.type as Hash, envelope.value, s, null);
    process.stdout.write(`${output}\n`);
    return;
  }
  console.log(compact ? JSON.stringify(data) : JSON.stringify(data, null, 2));
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
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
 * Open the filesystem-backed CAS store.
 * Automatically creates directory and bootstraps if needed.
 * If a varStore is provided, builtin schema variables are written to it during bootstrap.
 */
async function openStore(varStore?: VariableStore): Promise<Store> {
  const fullPath = resolve(storePath);
  return await openFsStore(fullPath, varStore);
}

async function openStoreAndVarStore(): Promise<{
  store: Store;
  varStore: VariableStore;
}> {
  const fullPath = resolve(storePath);
  const store = await prepareStore(fullPath);
  const varStore = createVariableStore(resolve(varDbPath), store);
  await bootstrap(store, varStore);
  return { store, varStore };
}

/**
 * Hash format check: 13-char uppercase Crockford Base32.
 */
function isHash(input: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{13}$/.test(input);
}

/**
 * Resolve a hash-or-name. If `input` already looks like a hash, return it as-is.
 * Otherwise, query the provided varStore for a variable with that exact name
 * and return the first match's value.
 */
function resolveHash(input: string, varStore: VariableStore): Hash {
  if (isHash(input)) {
    return input as Hash;
  }
  const variants = varStore.list({ exactName: input });
  const first = variants[0];
  if (!first) {
    die(`Error: Schema not found: ${input}`);
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
  const { store, varStore } = await openStoreAndVarStore();
  try {
    const typeHash = resolveHash(typeHashOrName, varStore);
    const payload = isPipe
      ? await readStdinJson()
      : readJsonFile(file as string);

    // Schema nodes: use putSchema() which validates via isValidSchema() (recursive)
    // instead of ajv against meta-schema (which can't express recursive constraints)
    const metaHash = resolveHash("@ocas/schema", varStore);
    if (typeHash === metaHash) {
      try {
        const hash = await putSchema(store, payload as Record<string, unknown>);
        await out(await wrapEnvelope(store, "@ocas/output/put", hash), store);
      } catch (_e) {
        console.error(
          `Validation failed: payload in ${file} does not match schema ${typeHash}`,
        );
        process.exit(1);
      }
      return;
    }

    // Check if schema exists
    const schema = getSchema(store, typeHash);
    if (schema === null) {
      console.error(`Schema not found: ${typeHash}`);
      process.exit(1);
    }

    // Validate payload against schema before storing
    const tempNode = { type: typeHash, payload, timestamp: Date.now() };
    if (!validate(store, tempNode)) {
      console.error(
        `Validation failed: payload in ${file} does not match schema ${typeHash}`,
      );
      process.exit(1);
    }

    const hash = await store.put(typeHash, payload);
    await out(await wrapEnvelope(store, "@ocas/output/put", hash), store);
  } finally {
    varStore.close();
  }
}

async function cmdGet(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) die("Usage: ocas get <hash-or-name>");
  const { store, varStore } = await openStoreAndVarStore();
  try {
    const hash = resolveHash(input, varStore);
    const node = store.get(hash);
    if (node === null) die(`Node not found: ${hash}`);
    await out(await wrapEnvelope(store, "@ocas/output/get", node), store);
  } finally {
    varStore.close();
  }
}

async function cmdHas(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) die("Usage: ocas has <hash-or-name>");
  const { store, varStore } = await openStoreAndVarStore();
  try {
    const hash = resolveHash(input, varStore);
    await out(
      await wrapEnvelope(store, "@ocas/output/has", store.has(hash)),
      store,
    );
  } finally {
    varStore.close();
  }
}

async function cmdVerify(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) die("Usage: ocas verify <hash-or-name>");
  const { store, varStore } = await openStoreAndVarStore();
  try {
    const hash = resolveHash(input, varStore);
    const node = store.get(hash);
    if (node === null) die(`Node not found: ${hash}`);
    const ok = await verify(hash, node);
    let status: string;
    if (!ok) {
      status = "corrupted";
    } else {
      status = validate(store, node) ? "ok" : "invalid";
    }
    await out(await wrapEnvelope(store, "@ocas/output/verify", status), store);
  } finally {
    varStore.close();
  }
}

async function cmdRefs(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) die("Usage: ocas refs <hash-or-name>");
  const { store, varStore } = await openStoreAndVarStore();
  try {
    const hash = resolveHash(input, varStore);
    const node = store.get(hash);
    if (node === null) die(`Node not found: ${hash}`);
    const refHashes = refs(store, node);
    await out(await wrapEnvelope(store, "@ocas/output/refs", refHashes), store);
  } finally {
    varStore.close();
  }
}

async function cmdWalk(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) die("Usage: ocas walk <hash-or-name> [--format tree]");
  const { store, varStore } = await openStoreAndVarStore();
  try {
    const hash = resolveHash(input, varStore);
    const format = flags.format;

    if (format === "tree") {
      const childMap = new Map<Hash, Hash[]>();
      walk(store, hash, (h, node) => {
        childMap.set(h, refs(store, node));
      });

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
      walk(store, hash, (h) => {
        hashes.push(h);
      });
      await out(await wrapEnvelope(store, "@ocas/output/walk", hashes), store);
    }
  } finally {
    varStore.close();
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
  const { store, varStore } = await openStoreAndVarStore();
  try {
    const typeHash = resolveHash(typeHashOrName, varStore);
    const payload = isPipe
      ? await readStdinJson()
      : readJsonFile(file as string);
    const hash = await computeHash(typeHash, payload);
    await out(await wrapEnvelope(store, "@ocas/output/hash", hash), store);
  } finally {
    varStore.close();
  }
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

  const { store, varStore } = await openStoreAndVarStore();

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
      // Otherwise, use renderDirect for inline rendering of the envelope value.
      if (typeof envelope.value === "string" && isHash(envelope.value)) {
        const output = await renderAsync(store, envelope.value as Hash, {
          ...(resolution !== undefined && { resolution }),
          ...(decay !== undefined && { decay }),
          ...(epsilon !== undefined && { epsilon }),
          varStore,
        });
        process.stdout.write(`${output}\n`);
      } else {
        const output = renderDirect(
          envelope.type as Hash,
          envelope.value,
          store,
          {
            ...(resolution !== undefined && { resolution }),
            ...(decay !== undefined && { decay }),
            ...(epsilon !== undefined && { epsilon }),
          },
        );
        process.stdout.write(`${output}\n`);
      }
    } else {
      const hash = resolveHash(input as string, varStore);
      const output = await renderAsync(store, hash, {
        ...(resolution !== undefined && { resolution }),
        ...(decay !== undefined && { decay }),
        ...(epsilon !== undefined && { epsilon }),
        varStore,
      });
      // Output to stdout without JSON wrapping (raw output)
      process.stdout.write(`${output}\n`);
    }
    varStore.close();
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
  const varStore = createVariableStore(resolve(varDbPath), store);

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

    const variable = varStore.set(name, value, options);
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
  } finally {
    varStore.close();
  }
}

async function cmdVarGet(args: string[]): Promise<void> {
  const name = args[0];
  const schemaInput = flags.schema as string | undefined;

  if (!name || !schemaInput) {
    die("Usage: ocas var get <name> --schema <hash-or-name>");
  }

  const { store, varStore } = await openStoreAndVarStore();

  try {
    const schema = resolveHash(schemaInput, varStore);
    const variable = varStore.get(name, schema);
    if (variable === null) {
      die(`Error: Variable not found: name=${name}, schema=${schema}`);
    }
    await out(
      await wrapEnvelope(store, "@ocas/output/var-get", variable),
      store,
    );
  } finally {
    varStore.close();
  }
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

  const { store, varStore } = await openStoreAndVarStore();

  try {
    if (schemaInput !== undefined) {
      const schema = resolveHash(schemaInput, varStore);
      // Precise deletion: remove specific (name, schema) variant
      const variable = varStore.remove(name, schema);
      await out(
        await wrapEnvelope(store, "@ocas/output/var-delete", variable),
        store,
      );
    } else {
      // Batch deletion: remove all variants for this name
      const variables = varStore.remove(name);
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
  } finally {
    varStore.close();
  }
}

async function cmdVarTag(args: string[]): Promise<void> {
  const name = args[0];
  const schemaInput = flags.schema as string | undefined;

  if (!name || !schemaInput) {
    die("Usage: ocas var tag <name> --schema <hash-or-name> <operations...>");
  }

  const tagArgs = args.slice(1);
  if (tagArgs.length === 0) {
    die("Usage: ocas var tag <name> --schema <hash-or-name> <operations...>");
  }

  const { store, varStore } = await openStoreAndVarStore();

  try {
    const schema = resolveHash(schemaInput, varStore);
    const { tags, labels, deleteNames } = parseTagsLabels(tagArgs);

    const variable = varStore.tag(name, schema, {
      ...(Object.keys(tags).length > 0 && { add: tags }),
      ...(labels.length > 0 && { addLabels: labels }),
      ...(deleteNames.length > 0 && { delete: deleteNames }),
    });

    await out(
      await wrapEnvelope(store, "@ocas/output/var-tag", variable),
      store,
    );
  } catch (e) {
    if (
      e instanceof VariableNotFoundError ||
      e instanceof TagLabelConflictError ||
      e instanceof InvalidTagFormatError
    ) {
      die(`Error: ${e.message}`);
    }
    throw e;
  } finally {
    varStore.close();
  }
}

async function cmdVarHistory(args: string[]): Promise<void> {
  const name = args[0];
  const schemaInput = flags.schema as string | undefined;

  if (!name) {
    die("Usage: ocas var history <name> [--schema <hash-or-name>]");
  }

  const { store, varStore } = await openStoreAndVarStore();

  try {
    let schema: Hash;
    if (schemaInput !== undefined) {
      schema = resolveHash(schemaInput, varStore);
    } else {
      const variants = varStore.list({ exactName: name });
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

    const values = varStore.history(name, schema);
    if (values.length === 0) {
      die(`Error: Variable not found: name=${name}, schema=${schema}`);
    }

    await out(
      await wrapEnvelope(store, "@ocas/output/var-history", {
        name,
        schema,
        values,
      }),
      store,
    );
  } finally {
    varStore.close();
  }
}

async function cmdVarList(args: string[]): Promise<void> {
  const namePrefix = args[0] ?? "";
  const schemaInput = flags.schema as string | undefined;
  const tagFlags = flags.tag;
  const listOpts = parseListOptions();

  const { store, varStore } = await openStoreAndVarStore();

  try {
    const schema =
      schemaInput !== undefined
        ? resolveHash(schemaInput, varStore)
        : undefined;
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

    const variables = varStore.list({
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
  } finally {
    varStore.close();
  }
}

async function cmdTemplateSet(args: string[]): Promise<void> {
  const schemaInput = args[0];
  const inlineFlag = flags.inline;

  if (!schemaInput) {
    die(
      "Usage: ocas template set <schema-hash-or-name> <file> | --inline <text>",
    );
  }

  const { store, varStore } = await openStoreAndVarStore();

  try {
    const schemaHash = resolveHash(schemaInput, varStore);
    // Validate schema hash exists in CAS
    if (!store.has(schemaHash)) {
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
        die("Usage: ocas template set <schema-hash> <file> | --inline <text>");
      }
      content = contentArg;
    } else {
      // File mode
      const file = args[1];
      if (!file) {
        die("Usage: ocas template set <schema-hash> <file> | --inline <text>");
      }
      if (!existsSync(file)) {
        die(`Error: File not found: ${file}`);
      }
      content = readFileSync(file, "utf-8");
    }

    // Store content in CAS under @string schema
    const stringHash = resolveHash("@ocas/string", varStore);
    const contentHash = await store.put(stringHash, content);

    // Create variable binding: @ocas/template/text/<schema-hash>
    const varName = `@ocas/template/text/${schemaHash}`;
    varStore.set(varName, contentHash);

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
  } finally {
    varStore.close();
  }
}

async function cmdTemplateGet(args: string[]): Promise<void> {
  const schemaInput = args[0];

  if (!schemaInput) {
    die("Usage: ocas template get <schema-hash-or-name>");
  }

  const { store, varStore } = await openStoreAndVarStore();

  try {
    const schemaHash = resolveHash(schemaInput, varStore);
    const varName = `@ocas/template/text/${schemaHash}`;
    const stringHash = resolveHash("@ocas/string", varStore);
    const variable = varStore.get(varName, stringHash);

    if (variable === null) {
      die(`Error: Template not found for schema: ${schemaHash}`);
    }

    // Get the content from CAS
    const node = store.get(variable.value);
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
  } finally {
    varStore.close();
  }
}

async function cmdTemplateList(_args: string[]): Promise<void> {
  const { store, varStore } = await openStoreAndVarStore();

  try {
    const stringHash = resolveHash("@ocas/string", varStore);
    const variables = varStore.list({
      namePrefix: "@ocas/template/text/",
      schema: stringHash,
    });

    const templates = variables.map((v) => ({
      schemaHash: v.name.replace("@ocas/template/text/", ""),
      contentHash: v.value,
    }));

    await out(
      await wrapEnvelope(store, "@ocas/output/template-list", templates),
      store,
    );
  } finally {
    varStore.close();
  }
}

async function cmdTemplateDelete(args: string[]): Promise<void> {
  const schemaInput = args[0];

  if (!schemaInput) {
    die("Usage: ocas template delete <schema-hash-or-name>");
  }

  const { store, varStore } = await openStoreAndVarStore();

  try {
    const schemaHash = resolveHash(schemaInput, varStore);
    const varName = `@ocas/template/text/${schemaHash}`;
    const stringHash = resolveHash("@ocas/string", varStore);
    varStore.remove(varName, stringHash);

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
  } finally {
    varStore.close();
  }
}

async function cmdGc(_args: string[]): Promise<void> {
  const store = await openStore();
  const varStore = createVariableStore(varDbPath, store);

  try {
    const stats = gc(store, varStore);
    await out(await wrapEnvelope(store, "@ocas/output/gc", stats), store);
  } finally {
    varStore.close();
  }
}

async function cmdList(_args: string[]): Promise<void> {
  const typeFlag = flags.type;
  if (typeof typeFlag !== "string")
    die("Usage: ocas list --type <hash-or-name>");
  const opts = parseListOptions();
  const { store, varStore } = await openStoreAndVarStore();
  try {
    const typeHash = resolveHash(typeFlag, varStore);
    const entries = store.listByType(typeHash, opts);
    await out(await wrapEnvelope(store, "@ocas/output/list", entries), store);
  } finally {
    varStore.close();
  }
}

async function cmdListMeta(_args: string[]): Promise<void> {
  const opts = parseListOptions();
  const store = await openStore();
  const entries = store.listMeta(opts);
  await out(
    await wrapEnvelope(store, "@ocas/output/list-meta", entries),
    store,
  );
}

async function cmdListSchema(_args: string[]): Promise<void> {
  const opts = parseListOptions();
  const store = await openStore();
  const entries = store.listSchemas(opts);
  await out(
    await wrapEnvelope(store, "@ocas/output/list-schema", entries),
    store,
  );
}

function printUsage(): void {
  console.log(`\
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
  walk <hash> [--format tree]       Recursive traversal                                (@ocas/output/walk)
  hash <type-hash> <file.json|--pipe> Compute hash without storing                     (@ocas/output/hash)
  render <hash> [options]           Render node as text with resolution decay (raw output)
  render --pipe/-p [options]        Render { type, value } from stdin (raw output)
  list --type <hash-or-name>        List hashes for a type (value=string[])            (@ocas/output/list)
  list-meta                         List meta-schema hashes (value=string[])           (@ocas/output/list-meta)
  list-schema                       List all schema hashes (value=string[])            (@ocas/output/list-schema)
  var set <name> <hash> [--tag <tag>...] Create/update a variable                      (@ocas/output/var-set)
  var get <name> --schema <hash>    Get a variable by name + schema                    (@ocas/output/var-get)
  var delete <name> [--schema <hash>] Delete variable(s)                               (@ocas/output/var-delete)
  var list [prefix] [--schema <hash>] [--tag <tag>...] List variables                  (@ocas/output/var-list)
  var tag <name> --schema <hash> <operations...> Modify tags/labels                    (@ocas/output/var-tag)
  var history <name> [--schema <hash>] Show value history (LRU)                        (@ocas/output/var-history)
  template set <schema-hash> <file> | --inline <text> Set template for schema          (@ocas/output/template-set)
  template get <schema-hash>        Get template content (value=string)                (@ocas/output/template-get)
  template list                     List all templates                                 (@ocas/output/template-list)
  template delete <schema-hash>     Delete template for schema                         (@ocas/output/template-delete)
  gc                                Run garbage collection                             (@ocas/output/gc)

Flags:
  --home <path>       Store directory (default: $OCAS_HOME or ~/.ocas)
  --var-db <path>     Variable database path (default: <store>/variables.db)
  --json              Compact JSON output
  --render, -r        Render output inline (equivalent to | ocas render -p)
  --schema <hash>     Schema hash filter for var get/delete/tag/list
  --tag <tag>         Tag/label (can be repeated): key:value (tag), name (label), :name (delete)
  --inline <text>     Inline text content for template set
  --resolution <n>    Initial resolution for render (default: 1.0)
  --decay <n>         Decay factor for render (default: 0.5)
  --epsilon <n>       Cutoff threshold for render (default: 0.01)
  --pipe, -p          Read from stdin (put/hash: raw JSON payload; render: { type, value } envelope)`);
}

// ---- Dispatch ----

const [cmd, ...rest] = positional;

if (!cmd) {
  printUsage();
  process.exit(0);
}

switch (cmd) {
  case "put":
    await cmdPut(rest);
    break;

  case "get":
    await cmdGet(rest);
    break;

  case "has":
    await cmdHas(rest);
    break;

  case "verify":
    await cmdVerify(rest);
    break;

  case "refs":
    await cmdRefs(rest);
    break;

  case "walk":
    await cmdWalk(rest);
    break;

  case "hash":
    await cmdHash(rest);
    break;

  case "render":
    await cmdRender(rest);
    break;

  case "list":
    await cmdList(rest);
    break;

  case "list-meta":
    await cmdListMeta(rest);
    break;

  case "list-schema":
    await cmdListSchema(rest);
    break;

  case "var": {
    const [sub, ...subRest] = rest;
    switch (sub) {
      case "set":
        await cmdVarSet(subRest);
        break;
      case "get":
        await cmdVarGet(subRest);
        break;
      case "delete":
        await cmdVarDelete(subRest);
        break;
      case "tag":
        await cmdVarTag(subRest);
        break;
      case "list":
        await cmdVarList(subRest);
        break;
      case "history":
        await cmdVarHistory(subRest);
        break;
      default:
        die(`Unknown var subcommand: ${sub ?? "(none)"}`);
    }
    break;
  }

  case "template": {
    const [sub, ...subRest] = rest;
    switch (sub) {
      case "set":
        await cmdTemplateSet(subRest);
        break;
      case "get":
        await cmdTemplateGet(subRest);
        break;
      case "list":
        await cmdTemplateList(subRest);
        break;
      case "delete":
        await cmdTemplateDelete(subRest);
        break;
      default:
        die(`Unknown template subcommand: ${sub ?? "(none)"}`);
    }
    break;
  }

  case "gc":
    await cmdGc(rest);
    break;

  case "prompt": {
    const [sub] = rest;
    switch (sub) {
      case "usage": {
        const content = readFileSync(
          join(import.meta.dir, "prompts", "usage.md"),
          "utf-8",
        );
        process.stdout.write(content);
        break;
      }
      case "setup": {
        const content = readFileSync(
          join(import.meta.dir, "prompts", "setup.md"),
          "utf-8",
        );
        process.stdout.write(content);
        break;
      }
      default:
        die(
          `Unknown prompt subcommand: ${sub ?? "(none)"}. Available: usage, setup`,
        );
    }
    break;
  }

  default:
    die(`Unknown command: ${cmd}`);
}
