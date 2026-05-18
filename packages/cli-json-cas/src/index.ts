#!/usr/bin/env bun

import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { Hash, JSONSchema, Store } from "@uncaged/json-cas";
import {
  bootstrap,
  computeHash,
  getSchema,
  putSchema,
  refs,
  validate,
  verify,
  walk,
} from "@uncaged/json-cas";
import { createFsStore } from "@uncaged/json-cas-fs";

// ---- Argument parsing ----

type Flags = Record<string, string | boolean>;

/** Flags that consume the next token as their value. All others are boolean. */
const VALUE_FLAGS = new Set(["store", "format"]);

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
const storePath = typeof flags.store === "string" ? flags.store : defaultStorePath;
const compact = flags.json === true;

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
  for (const hash of store.list()) {
    if (hash === metaHash) continue;
    const node = store.get(hash);
    if (node !== null && node.type === metaHash) {
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

async function cmdList(): Promise<void> {
  const store = openStore();
  for (const hash of store.list()) {
    console.log(hash);
  }
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
  list                              List all hashes
  refs <hash>                       List direct cas_ref edges
  walk <hash> [--format tree]       Recursive traversal
  hash <type-hash> <file.json>      Compute hash without storing (dry run)
  cat <hash> [--payload]            Output node (--payload for payload only)

Flags:
  --store <path>   Store directory (default: ~/.uncaged/json-cas)
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

  case "list":
    await cmdList();
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

  default:
    die(`Unknown command: ${cmd}`);
}
