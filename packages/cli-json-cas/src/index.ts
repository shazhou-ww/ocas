#!/usr/bin/env bun

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Hash, JSONSchema, Store, VariableStore } from "@uncaged/json-cas";
import {
  bootstrap,
  CasNodeNotFoundError,
  computeHash,
  createVariableStore,
  getSchema,
  InvalidScopeError,
  putSchema,
  refs,
  SchemaMismatchError,
  VariableNotFoundError,
  validate,
  verify,
  walk,
} from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";

// ---- Argument parsing ----

type Flags = Record<string, string | boolean>;

/** Flags that consume the next token as their value. All others are boolean. */
const VALUE_FLAGS = new Set(["store", "format", "scope", "value", "var-db"]);

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
          flags[key] = next;
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

const defaultVarDbPath = join(defaultStorePath, "variables.db");
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

// ---- Commands ----

async function cmdInit(): Promise<void> {
  const dir = resolve(storePath);
  mkdirSync(dir, { recursive: true });
  const store = createFsStore(dir);
  const hash = await bootstrap(store);
  console.log(hash);
}

async function cmdBootstrap(): Promise<void> {
  const store = openStore();
  const hash = await bootstrap(store);
  console.log(hash);
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
  const hash = args[0];
  if (!hash) die("Usage: json-cas schema get <type-hash>");
  const store = openStore();
  const schema = getSchema(store, hash);
  if (schema === null) die(`Schema not found: ${hash}`);
  out(schema);
}

async function cmdSchemaList(): Promise<void> {
  const store = openStore();
  const metaHash = await bootstrap(store);
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
  const typeHash = args[0];
  const file = args[1];
  if (!typeHash || !file) die("Usage: json-cas put <type-hash> <file.json>");
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
  const typeHash = args[0];
  const file = args[1];
  if (!typeHash || !file) die("Usage: json-cas hash <type-hash> <file.json>");
  const payload = readJsonFile(file);
  const hash = await computeHash(typeHash, payload);
  console.log(hash);
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

async function cmdVarCreate(_args: string[]): Promise<void> {
  const scope = flags.scope as string | undefined;
  const value = flags.value as string | undefined;

  if (!scope) die("Usage: json-cas var create --scope <scope> --value <hash>");
  if (!value) die("Usage: json-cas var create --scope <scope> --value <hash>");

  const varStore = openVarStore();

  try {
    const variable = varStore.create(scope, value);
    out(variable);
  } catch (e) {
    if (e instanceof InvalidScopeError || e instanceof CasNodeNotFoundError) {
      die(`Error: ${e.message}`);
    }
    throw e;
  } finally {
    varStore.close();
  }
}

async function cmdVarGet(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) die("Usage: json-cas var get <id>");

  const varStore = openVarStore();

  try {
    const variable = varStore.get(id);
    if (variable === null) {
      die(`Error: Variable not found: ${id}`);
    }
    out(variable);
  } finally {
    varStore.close();
  }
}

async function cmdVarUpdate(args: string[]): Promise<void> {
  const id = args[0];
  const value = args[1];

  if (!id || !value) {
    die("Usage: json-cas var update <id> <hash>");
  }

  const varStore = openVarStore();

  try {
    const variable = varStore.update(id, value);
    out(variable);
  } catch (e) {
    if (
      e instanceof VariableNotFoundError ||
      e instanceof SchemaMismatchError ||
      e instanceof CasNodeNotFoundError
    ) {
      die(`Error: ${e.message}`);
    }
    throw e;
  } finally {
    varStore.close();
  }
}

async function cmdVarDelete(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) die("Usage: json-cas var delete <id>");

  const varStore = openVarStore();

  try {
    const variable = varStore.delete(id);
    out(variable);
  } catch (e) {
    if (e instanceof VariableNotFoundError) {
      die(`Error: ${e.message}`);
    }
    throw e;
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
  cat <hash> [--payload]            Output node (--payload for payload only)
  var create --scope <s> --value <h> Create a variable
  var get <id>                      Get a variable by ID
  var update <id> <hash>            Update variable value
  var delete <id>                   Delete a variable

Flags:
  --store <path>   Store directory (default: ~/.uncaged/json-cas)
  --var-db <path>  Variable database path (default: <store>/variables.db)
  --json           Compact JSON output`);
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

  case "cat":
    await cmdCat(rest);
    break;

  case "var": {
    const [sub, ...subRest] = rest;
    switch (sub) {
      case "create":
        await cmdVarCreate(subRest);
        break;
      case "get":
        await cmdVarGet(subRest);
        break;
      case "update":
        await cmdVarUpdate(subRest);
        break;
      case "delete":
        await cmdVarDelete(subRest);
        break;
      default:
        die(`Unknown var subcommand: ${sub ?? "(none)"}`);
    }
    break;
  }

  default:
    die(`Unknown command: ${cmd}`);
}
