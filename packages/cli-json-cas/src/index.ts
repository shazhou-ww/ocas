#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Hash, JSONSchema, Store, VariableStore } from "@uncaged/json-cas";
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
} from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";

// ---- Argument parsing ----

type Flags = Record<string, string | boolean | string[]>;

/** Flags that consume the next token as their value. All others are boolean. */
const VALUE_FLAGS = new Set([
  "store",
  "format",
  "var-db",
  "tag",
  "schema",
  "resolution",
  "decay",
  "epsilon",
  "inline",
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
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

const { flags, positional } = parseArgs(process.argv.slice(2));

const defaultStorePath = join(homedir(), ".uncaged", "json-cas");
const storePath =
  typeof flags.store === "string" ? flags.store : defaultStorePath;
const compact = flags.json === true;

const defaultVarDbPath = join(storePath, "variables.db");
const varDbPath =
  typeof flags["var-db"] === "string" ? flags["var-db"] : defaultVarDbPath;

// ---- Helpers ----

function out(data: unknown): void {
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

function openStore(): Store {
  return createFsStore(resolve(storePath));
}

function openVarStore(): VariableStore {
  const store = openStore();
  mkdirSync(resolve(storePath), { recursive: true });
  return createVariableStore(resolve(varDbPath), store);
}

/**
 * Resolve a type-hash, handling @ aliases
 * If the input starts with @, resolve it via bootstrap
 * Otherwise, return the hash as-is
 */
async function resolveTypeHash(typeHashOrAlias: string): Promise<Hash> {
  if (typeHashOrAlias.startsWith("@")) {
    const store = openStore();
    const builtinSchemas = await bootstrap(store);
    const resolvedHash = builtinSchemas[typeHashOrAlias];
    if (!resolvedHash) {
      die(`Schema not found: ${typeHashOrAlias}`);
    }
    return resolvedHash;
  }
  return typeHashOrAlias;
}

/**
 * Get the Variable schema's CAS hash
 * This is the type hash used in JSON envelopes
 */
async function getVariableSchemaHash(): Promise<Hash> {
  const store = openStore();

  // Define the Variable JSON Schema (updated for new model with composite key)
  const variableSchema: JSONSchema = {
    title: "Variable",
    type: "object",
    properties: {
      name: { type: "string" },
      schema: { type: "string" },
      value: { type: "string" },
      created: { type: "number" },
      updated: { type: "number" },
      tags: { type: "object" },
      labels: { type: "array", items: { type: "string" } },
    },
    required: [
      "name",
      "schema",
      "value",
      "created",
      "updated",
      "tags",
      "labels",
    ],
  };

  // Compute hash or retrieve from store
  const hash = await putSchema(store, variableSchema);
  return hash;
}

/**
 * Wrap Variable output in JSON envelope
 */
async function wrapVariableEnvelope(
  variable: unknown,
): Promise<{ type: Hash; value: unknown }> {
  const typeHash = await getVariableSchemaHash();
  return {
    type: typeHash,
    value: variable,
  };
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

// ---- Commands ----

async function cmdInit(): Promise<void> {
  const dir = resolve(storePath);
  mkdirSync(dir, { recursive: true });
  const store = createFsStore(dir);
  const builtinSchemas = await bootstrap(store);
  const metaHash = builtinSchemas["@schema"];
  console.log(metaHash);
}

async function cmdBootstrap(): Promise<void> {
  const store = openStore();
  const builtinSchemas = await bootstrap(store);
  const metaHash = builtinSchemas["@schema"];
  console.log(metaHash);
}

async function cmdSchemaPut(args: string[]): Promise<void> {
  const file = args[0];
  if (!file) die("Usage: json-cas schema put <file.json>");
  const schema = readJsonFile(file) as JSONSchema;
  const store = openStore();
  const hash = await putSchema(store, schema);
  console.log(hash);
}

async function cmdSchemaGet(args: string[]): Promise<void> {
  const hashOrAlias = args[0];
  if (!hashOrAlias) die("Usage: json-cas schema get <type-hash>");
  const hash = await resolveTypeHash(hashOrAlias);
  const store = openStore();
  const schema = getSchema(store, hash);
  if (schema === null) die(`Schema not found: ${hashOrAlias}`);
  out(schema);
}

async function cmdSchemaList(): Promise<void> {
  const store = openStore();
  const builtinSchemas = await bootstrap(store);
  const metaHash = builtinSchemas["@schema"];
  if (!metaHash) throw new Error("Meta-schema not found");
  for (const hash of store.listByType(metaHash)) {
    if (hash === metaHash) continue;
    const node = store.get(hash);
    if (node !== null) {
      const schema = node.payload as JSONSchema;
      const name =
        (schema.title as string | undefined) ??
        (schema.description as string | undefined) ??
        "(unnamed)";
      console.log(`${hash}  ${name}`);
    }
  }
}

async function cmdSchemaValidate(args: string[]): Promise<void> {
  const hash = args[0];
  if (!hash) die("Usage: json-cas schema validate <hash>");
  const store = openStore();
  const node = store.get(hash);
  if (node === null) die(`Node not found: ${hash}`);
  const valid = validate(store, node);
  console.log(valid ? "valid" : "invalid");
}

async function cmdPut(args: string[]): Promise<void> {
  const typeHashOrAlias = args[0];
  const file = args[1];
  if (!typeHashOrAlias || !file)
    die("Usage: json-cas put <type-hash> <file.json>");
  const typeHash = await resolveTypeHash(typeHashOrAlias);
  const payload = readJsonFile(file);
  const store = openStore();
  const hash = await store.put(typeHash, payload);
  console.log(hash);
}

async function cmdGet(args: string[]): Promise<void> {
  const hash = args[0];
  if (!hash) die("Usage: json-cas get <hash>");
  const store = openStore();
  const node = store.get(hash);
  if (node === null) die(`Node not found: ${hash}`);
  out(node);
}

async function cmdHas(args: string[]): Promise<void> {
  const hash = args[0];
  if (!hash) die("Usage: json-cas has <hash>");
  const store = openStore();
  console.log(String(store.has(hash)));
}

async function cmdVerify(args: string[]): Promise<void> {
  const hash = args[0];
  if (!hash) die("Usage: json-cas verify <hash>");
  const store = openStore();
  const node = store.get(hash);
  if (node === null) die(`Node not found: ${hash}`);
  const ok = await verify(hash, node);
  console.log(ok ? "ok" : "corrupted");
}

async function cmdRefs(args: string[]): Promise<void> {
  const hash = args[0];
  if (!hash) die("Usage: json-cas refs <hash>");
  const store = openStore();
  const node = store.get(hash);
  if (node === null) die(`Node not found: ${hash}`);
  const refHashes = refs(store, node);
  for (const r of refHashes) {
    console.log(r);
  }
}

async function cmdWalk(args: string[]): Promise<void> {
  const hash = args[0];
  if (!hash) die("Usage: json-cas walk <hash> [--format tree]");
  const store = openStore();
  const format = flags.format;

  if (format === "tree") {
    const childMap = new Map<Hash, Hash[]>();
    walk(store, hash, (h, node) => {
      childMap.set(h, refs(store, node));
    });

    const printed = new Set<Hash>();

    function printNode(h: Hash, prefix: string, isLast: boolean): void {
      const connector = prefix === "" ? "" : isLast ? "└── " : "├── ";
      if (printed.has(h)) {
        console.log(`${prefix}${connector}${h} (seen)`);
        return;
      }
      printed.add(h);
      console.log(`${prefix}${connector}${h}`);

      const kids = childMap.get(h) ?? [];
      const childPrefix =
        prefix === "" ? "" : prefix + (isLast ? "    " : "│   ");
      for (let i = 0; i < kids.length; i++) {
        printNode(kids[i] as Hash, childPrefix, i === kids.length - 1);
      }
    }

    printNode(hash, "", true);
  } else {
    walk(store, hash, (h) => {
      console.log(h);
    });
  }
}

async function cmdHash(args: string[]): Promise<void> {
  const typeHashOrAlias = args[0];
  const file = args[1];
  if (!typeHashOrAlias || !file)
    die("Usage: json-cas hash <type-hash> <file.json>");
  const typeHash = await resolveTypeHash(typeHashOrAlias);
  const payload = readJsonFile(file);
  const hash = await computeHash(typeHash, payload);
  console.log(hash);
}

async function cmdRender(args: string[]): Promise<void> {
  const isPipe = flags.pipe === true || flags.p === true;
  const hash = args[0];

  if (isPipe && hash) {
    die("Cannot use --pipe/-p with a hash argument. Use one or the other.");
  }

  if (!isPipe && !hash) {
    die(
      "Usage: ucas render <hash> [--resolution <n>] [--decay <n>] [--epsilon <n>]\n       ucas render --pipe/-p [--resolution <n>] [--decay <n>] [--epsilon <n>]",
    );
  }

  const store = openStore();

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
      if (!/^[0-9A-Z]{13}$/.test(envelope.type)) {
        die(
          `Invalid type hash: "${envelope.type}". Expected 13-character uppercase Crockford Base32 string.`,
        );
      }

      const output = renderDirect(
        envelope.type as Hash,
        envelope.value,
        store,
        {
          resolution,
          decay,
          epsilon,
        },
      );
      process.stdout.write(output);
    } else {
      const varStore = openVarStore();
      const output = await renderAsync(store, hash, {
        resolution,
        decay,
        epsilon,
        varStore,
      });
      // Output to stdout without JSON wrapping (raw output)
      process.stdout.write(output);
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

async function cmdCat(args: string[]): Promise<void> {
  const hash = args[0];
  if (!hash) die("Usage: json-cas cat <hash>");
  const store = openStore();
  const node = store.get(hash);
  if (node === null) die(`Node not found: ${hash}`);
  if (flags.payload === true) {
    out(node.payload);
  } else {
    out(node);
  }
}

async function cmdVarSet(args: string[]): Promise<void> {
  const name = args[0];
  const value = args[1];
  const tagFlags = flags.tag;

  if (!name || !value) {
    die("Usage: json-cas var set <name> <hash> [--tag <tag>...]");
  }

  const varStore = openVarStore();

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
    const envelope = await wrapVariableEnvelope(variable);
    out(envelope);
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
  const schema = flags.schema as string | undefined;

  if (!name || !schema) {
    die("Usage: json-cas var get <name> --schema <hash>");
  }

  const varStore = openVarStore();

  try {
    const variable = varStore.get(name, schema);
    if (variable === null) {
      die(`Error: Variable not found: name=${name}, schema=${schema}`);
    }
    const envelope = await wrapVariableEnvelope(variable);
    out(envelope);
  } finally {
    varStore.close();
  }
}

async function cmdVarDelete(args: string[]): Promise<void> {
  const name = args[0];
  const schema = flags.schema as string | undefined;

  if (!name) {
    die("Usage: json-cas var delete <name> [--schema <hash>]");
  }

  const varStore = openVarStore();

  try {
    if (schema !== undefined) {
      // Precise deletion: remove specific (name, schema) variant
      const variable = varStore.remove(name, schema);
      const envelope = await wrapVariableEnvelope(variable);
      out(envelope);
    } else {
      // Batch deletion: remove all variants for this name
      const variables = varStore.remove(name);
      const envelope = await wrapVariableEnvelope(variables);
      out(envelope);
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
  const schema = flags.schema as string | undefined;

  if (!name || !schema) {
    die("Usage: json-cas var tag <name> --schema <hash> <operations...>");
  }

  const tagArgs = args.slice(1);
  if (tagArgs.length === 0) {
    die("Usage: json-cas var tag <name> --schema <hash> <operations...>");
  }

  const varStore = openVarStore();

  try {
    const { tags, labels, deleteNames } = parseTagsLabels(tagArgs);

    const variable = varStore.tag(name, schema, {
      add: Object.keys(tags).length > 0 ? tags : undefined,
      addLabels: labels.length > 0 ? labels : undefined,
      delete: deleteNames.length > 0 ? deleteNames : undefined,
    });

    const envelope = await wrapVariableEnvelope(variable);
    out(envelope);
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

async function cmdVarList(args: string[]): Promise<void> {
  const namePrefix = args[0] ?? "";
  const schema = flags.schema as string | undefined;
  const tagFlags = flags.tag;

  const varStore = openVarStore();

  try {
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
      schema,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
      labels: labels.length > 0 ? labels : undefined,
    });
    const envelope = await wrapVariableEnvelope(variables);
    out(envelope);
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
  const schemaHash = args[0];
  const inlineFlag = flags.inline;

  if (!schemaHash) {
    die("Usage: json-cas template set <schema-hash> <file> | --inline <text>");
  }

  const store = openStore();
  mkdirSync(resolve(storePath), { recursive: true });
  const varStore = createVariableStore(resolve(varDbPath), store);

  try {
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
        die(
          "Usage: json-cas template set <schema-hash> <file> | --inline <text>",
        );
      }
      content = contentArg;
    } else {
      // File mode
      const file = args[1];
      if (!file) {
        die(
          "Usage: json-cas template set <schema-hash> <file> | --inline <text>",
        );
      }
      if (!existsSync(file)) {
        die(`Error: File not found: ${file}`);
      }
      content = readFileSync(file, "utf-8");
    }

    // Store content in CAS under @string schema
    const stringHash = await resolveTypeHash("@string");
    const contentHash = await store.put(stringHash, content);

    // Create variable binding: @ucas/template/text/<schema-hash>
    const varName = `@ucas/template/text/${schemaHash}`;
    varStore.set(varName, contentHash);

    out({
      schemaHash,
      contentHash,
    });
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
  const schemaHash = args[0];

  if (!schemaHash) {
    die("Usage: json-cas template get <schema-hash>");
  }

  const store = openStore();
  mkdirSync(resolve(storePath), { recursive: true });
  const varStore = createVariableStore(resolve(varDbPath), store);

  try {
    const varName = `@ucas/template/text/${schemaHash}`;
    const stringHash = await resolveTypeHash("@string");
    const variable = varStore.get(varName, stringHash);

    if (variable === null) {
      die(`Error: Template not found for schema: ${schemaHash}`);
    }

    // Get the content from CAS
    const node = store.get(variable.value);
    if (node === null) {
      die(`Error: Content not found in CAS: ${variable.value}`);
    }

    // Output raw text (not JSON)
    process.stdout.write(node.payload as string);
  } finally {
    varStore.close();
  }
}

async function cmdTemplateList(_args: string[]): Promise<void> {
  const store = openStore();
  mkdirSync(resolve(storePath), { recursive: true });
  const varStore = createVariableStore(resolve(varDbPath), store);

  try {
    const stringHash = await resolveTypeHash("@string");
    const variables = varStore.list({
      namePrefix: "@ucas/template/text/",
      schema: stringHash,
    });

    const templates = variables.map((v) => {
      const schemaHash = v.name.replace("@ucas/template/text/", "");

      // Get content for preview
      const node = store.get(v.value);
      const content = (node?.payload as string | undefined) ?? "";

      // Truncate preview to 80 chars
      const preview =
        content.length > 80 ? `${content.slice(0, 77)}...` : content;

      return {
        schemaHash,
        preview,
      };
    });

    out(templates);
  } finally {
    varStore.close();
  }
}

async function cmdTemplateDelete(args: string[]): Promise<void> {
  const schemaHash = args[0];

  if (!schemaHash) {
    die("Usage: json-cas template delete <schema-hash>");
  }

  const store = openStore();
  mkdirSync(resolve(storePath), { recursive: true });
  const varStore = createVariableStore(resolve(varDbPath), store);

  try {
    const varName = `@ucas/template/text/${schemaHash}`;
    const stringHash = await resolveTypeHash("@string");
    varStore.remove(varName, stringHash);

    out({ deleted: true });
  } catch (e) {
    if (e instanceof VariableNotFoundError) {
      die(`Error: Template not found for schema: ${schemaHash}`);
    }
    throw e;
  } finally {
    varStore.close();
  }
}

async function cmdGc(_args: string[]): Promise<void> {
  const store = createFsStore(storePath);
  const varStore = createVariableStore(varDbPath, store);

  try {
    const stats = gc(store, varStore);
    out(stats);
  } finally {
    varStore.close();
  }
}

function printUsage(): void {
  console.log(`\
Usage: json-cas [--store <path>] [--json] <command> [args]

Commands:
  init                              Create store dir and write bootstrap seed
  bootstrap                         Write meta-schema seed, print hash
  schema put <file.json>            Register schema, print type hash
  schema get <type-hash>            Print schema JSON
  schema list                       List all schemas (name + hash)
  schema validate <hash>            Validate node against its schema
  put <type-hash> <file.json>       Store node, print hash
  get <hash>                        Print node as JSON
  has <hash>                        Print true/false
  verify <hash>                     Verify integrity, print ok/corrupted
  refs <hash>                       List direct cas_ref edges
  walk <hash> [--format tree]       Recursive traversal
  hash <type-hash> <file.json>      Compute hash without storing (dry run)
  render <hash> [options]           Render node as YAML with resolution decay
  render --pipe/-p [options]        Render { type, value } from stdin
  cat <hash> [--payload]            Output node (--payload for payload only)
  var set <name> <hash> [--tag <tag>...] Create/update a variable
  var get <name> --schema <hash>    Get a variable by name + schema
  var delete <name> [--schema <hash>] Delete variable(s)
  var list [prefix] [--schema <hash>] [--tag <tag>...] List variables
  var tag <name> --schema <hash> <operations...> Modify tags/labels
  template set <schema-hash> <file> | --inline <text> Set template for schema
  template get <schema-hash>        Get template content as raw text
  template list                     List all templates
  template delete <schema-hash>     Delete template for schema
  gc                                Run garbage collection

Flags:
  --store <path>      Store directory (default: ~/.uncaged/json-cas)
  --var-db <path>     Variable database path (default: <store>/variables.db)
  --json              Compact JSON output
  --schema <hash>     Schema hash filter for var get/delete/tag/list
  --tag <tag>         Tag/label (can be repeated): key:value (tag), name (label), :name (delete)
  --inline <text>     Inline text content for template set
  --resolution <n>    Initial resolution for render (default: 1.0)
  --decay <n>         Decay factor for render (default: 0.5)
  --epsilon <n>       Cutoff threshold for render (default: 0.01)
  --pipe, -p          Read { type, value } JSON from stdin for render`);
}

// ---- Dispatch ----

const [cmd, ...rest] = positional;

if (!cmd) {
  printUsage();
  process.exit(0);
}

switch (cmd) {
  case "init":
    await cmdInit();
    break;

  case "bootstrap":
    await cmdBootstrap();
    break;

  case "schema": {
    const [sub, ...subRest] = rest;
    switch (sub) {
      case "put":
        await cmdSchemaPut(subRest);
        break;
      case "get":
        await cmdSchemaGet(subRest);
        break;
      case "list":
        await cmdSchemaList();
        break;
      case "validate":
        await cmdSchemaValidate(subRest);
        break;
      default:
        die(`Unknown schema subcommand: ${sub ?? "(none)"}`);
    }
    break;
  }

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

  case "cat":
    await cmdCat(rest);
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

  default:
    die(`Unknown command: ${cmd}`);
}
