import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  applyListOptions,
  BOOTSTRAP_STORE,
  type BootstrapCapableStore,
  bootstrap,
  type CasNode,
  casListEntry,
  cborEncode,
  computeHashSync,
  computeSelfHashSync,
  type Hash,
  initHasher,
  type ListEntry,
  type ListOptions,
  type Store,
} from "@ocas/core";
import { decode } from "cborg";
import { createSqliteVarStore } from "./sqlite-store.js";

const INDEX_DIR = "_index";
const META_FILE = "_meta";

// Initialise the xxhash WASM instance once at module load so the FS CAS
// store can use the synchronous hashing functions.
await initHasher();

function loadDir(dir: string, data: Map<Hash, CasNode>): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".bin")) continue;
    const hash = name.slice(0, -4) as Hash;
    try {
      const buf = readFileSync(join(dir, name));
      const node = decode(new Uint8Array(buf)) as CasNode;
      data.set(hash, node);
    } catch {
      // skip corrupted files
    }
  }
}

function parseIndexFile(content: string): Hash[] {
  if (content.length === 0) return [];
  return content.split("\n").filter((line) => line.length > 0) as Hash[];
}

function loadTypeIndex(indexDir: string): Map<Hash, Hash[]> {
  const typeIndex = new Map<Hash, Hash[]>();
  let entries: string[];
  try {
    entries = readdirSync(indexDir);
  } catch {
    return typeIndex;
  }
  for (const typeHash of entries) {
    try {
      const content = readFileSync(join(indexDir, typeHash), "utf8");
      typeIndex.set(typeHash as Hash, parseIndexFile(content));
    } catch {
      // skip unreadable index files
    }
  }
  return typeIndex;
}

function buildTypeIndexFromNodes(data: Map<Hash, CasNode>): Map<Hash, Hash[]> {
  const typeIndex = new Map<Hash, Hash[]>();
  for (const [hash, node] of data) {
    const list = typeIndex.get(node.type) ?? [];
    list.push(hash);
    typeIndex.set(node.type, list);
  }
  return typeIndex;
}

function writeTypeIndex(indexDir: string, typeIndex: Map<Hash, Hash[]>): void {
  mkdirSync(indexDir, { recursive: true });
  for (const [typeHash, hashes] of typeIndex) {
    const body = hashes.length > 0 ? `${hashes.join("\n")}\n` : "";
    writeFileSync(join(indexDir, typeHash), body, "utf8");
  }
}

function loadOrMigrateTypeIndex(
  dir: string,
  data: Map<Hash, CasNode>,
): Map<Hash, Hash[]> {
  const indexDir = join(dir, INDEX_DIR);
  if (!existsSync(indexDir)) {
    const typeIndex = buildTypeIndexFromNodes(data);
    if (typeIndex.size > 0) {
      writeTypeIndex(indexDir, typeIndex);
    }
    return typeIndex;
  }
  return loadTypeIndex(indexDir);
}

function loadOrMigrateMetaSet(
  dir: string,
  data: Map<Hash, CasNode>,
): Set<Hash> {
  const indexDir = join(dir, INDEX_DIR);
  const metaPath = join(indexDir, META_FILE);
  if (existsSync(metaPath)) {
    try {
      const content = readFileSync(metaPath, "utf8");
      return new Set(parseIndexFile(content));
    } catch {
      return new Set();
    }
  }
  // Migration: scan loaded nodes for self-referencing nodes (type === hash)
  const metaSet = new Set<Hash>();
  for (const [hash, node] of data) {
    if (node.type === hash) {
      metaSet.add(hash);
    }
  }
  if (metaSet.size > 0) {
    mkdirSync(indexDir, { recursive: true });
    const body = `${[...metaSet].join("\n")}\n`;
    writeFileSync(metaPath, body, "utf8");
  }
  return metaSet;
}

function appendToMetaSet(
  indexDir: string,
  metaSet: Set<Hash>,
  hash: Hash,
): void {
  if (metaSet.has(hash)) return;
  metaSet.add(hash);
  mkdirSync(indexDir, { recursive: true });
  appendFileSync(join(indexDir, META_FILE), `${hash}\n`, "utf8");
}

function rewriteMetaSet(indexDir: string, metaSet: Set<Hash>): void {
  const metaPath = join(indexDir, META_FILE);
  if (metaSet.size === 0) {
    try {
      unlinkSync(metaPath);
    } catch {
      // ignore
    }
    return;
  }
  mkdirSync(indexDir, { recursive: true });
  const body = `${[...metaSet].join("\n")}\n`;
  writeFileSync(metaPath, body, "utf8");
}

function appendToTypeIndex(
  indexDir: string,
  typeIndex: Map<Hash, Hash[]>,
  type: Hash,
  hash: Hash,
): void {
  mkdirSync(indexDir, { recursive: true });
  appendFileSync(join(indexDir, type), `${hash}\n`, "utf8");
  const list = typeIndex.get(type) ?? [];
  list.push(hash);
  typeIndex.set(type, list);
}

function hashesToEntries(
  data: Map<Hash, CasNode>,
  hashes: Iterable<Hash>,
): ListEntry[] {
  const result: ListEntry[] = [];
  for (const h of hashes) {
    const node = data.get(h);
    if (node) result.push(casListEntry(h, node.timestamp));
  }
  return result;
}

/**
 * The CAS sub-store of an FS-backed `Store` — also satisfies the legacy
 * `BootstrapCapableStore` interface so `bootstrap()` can run against it.
 */
export type FsCasStore = BootstrapCapableStore & {
  put(typeHash: Hash, payload: unknown): Hash;
  delete(hash: Hash): boolean;
};

export function createFsStore(dir: string): FsCasStore {
  const data = new Map<Hash, CasNode>();
  loadDir(dir, data);
  const indexDir = join(dir, INDEX_DIR);
  const typeIndex = loadOrMigrateTypeIndex(dir, data);
  const metaSet = loadOrMigrateMetaSet(dir, data);

  function putSelfReferencing(payload: unknown): Hash {
    const hash = computeSelfHashSync(payload);
    if (!data.has(hash)) {
      const node: CasNode = { type: hash, payload, timestamp: Date.now() };
      data.set(hash, node);

      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, `${hash}.tmp`);
      const dest = join(dir, `${hash}.bin`);
      writeFileSync(
        tmp,
        cborEncode({ type: hash, payload, timestamp: node.timestamp }),
      );
      renameSync(tmp, dest);

      appendToTypeIndex(indexDir, typeIndex, hash, hash);
    }
    appendToMetaSet(indexDir, metaSet, hash);
    return hash;
  }

  const store: FsCasStore = {
    put(typeHash: Hash, payload: unknown): Hash {
      const hash = computeHashSync(typeHash, payload);

      if (!data.has(hash)) {
        const node: CasNode = {
          type: typeHash,
          payload,
          timestamp: Date.now(),
        };
        data.set(hash, node);

        mkdirSync(dir, { recursive: true });
        const tmp = join(dir, `${hash}.tmp`);
        const dest = join(dir, `${hash}.bin`);
        writeFileSync(
          tmp,
          cborEncode({ type: typeHash, payload, timestamp: node.timestamp }),
        );
        renameSync(tmp, dest);

        appendToTypeIndex(indexDir, typeIndex, typeHash, hash);
      }

      return hash;
    },

    get(hash: Hash): CasNode | null {
      return data.get(hash) ?? null;
    },

    has(hash: Hash): boolean {
      return data.has(hash);
    },

    listByType(typeHash: Hash, options?: ListOptions): ListEntry[] {
      const list = typeIndex.get(typeHash);
      if (!list) return [];
      return applyListOptions(hashesToEntries(data, list), options);
    },

    listAll(): Hash[] {
      return Array.from(data.keys());
    },

    listMeta(options?: ListOptions): ListEntry[] {
      return applyListOptions(hashesToEntries(data, metaSet), options);
    },

    listSchemas(options?: ListOptions): ListEntry[] {
      const result = new Set<Hash>();
      for (const meta of metaSet) {
        result.add(meta);
        const list = typeIndex.get(meta);
        if (list) {
          for (const h of list) result.add(h);
        }
      }
      return applyListOptions(hashesToEntries(data, result), options);
    },

    delete(hash: Hash): boolean {
      const node = data.get(hash);
      if (!node) return false;
      data.delete(hash);
      // Delete file
      try {
        unlinkSync(join(dir, `${hash}.bin`));
      } catch {
        // ignore if file doesn't exist
      }
      // Remove from type index
      const list = typeIndex.get(node.type);
      if (list) {
        const idx = list.indexOf(hash);
        if (idx !== -1) {
          list.splice(idx, 1);
        }
        if (list.length === 0) {
          typeIndex.delete(node.type);
          // Delete empty index file
          try {
            unlinkSync(join(indexDir, node.type));
          } catch {
            // ignore
          }
        } else {
          // Rewrite index file
          const body = `${list.join("\n")}\n`;
          writeFileSync(join(indexDir, node.type), body, "utf8");
        }
      }
      // Remove from meta set if applicable
      if (metaSet.has(hash)) {
        metaSet.delete(hash);
        rewriteMetaSet(indexDir, metaSet);
      }
      return true;
    },

    [BOOTSTRAP_STORE]: putSelfReferencing,
  };

  return store;
}

/**
 * Prepare a filesystem-backed CAS sub-store: create the directory (if needed),
 * validate that the path is a directory, and instantiate the store. Does NOT
 * run bootstrap — callers that want bootstrap should either use {@link openStore}
 * or call `bootstrap` themselves.
 *
 * @param dir - The directory path for the store
 * @returns A Promise resolving to the FsCasStore
 * @throws Error if the path exists but is not a directory
 */
export async function prepareStore(dir: string): Promise<FsCasStore> {
  // Create directory if it doesn't exist
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "EACCES") {
        throw new Error(`Permission denied: cannot access store at ${dir}`);
      }
      if (nodeError.code === "ENOTDIR" || nodeError.code === "EEXIST") {
        throw new Error(`Path exists but is not a directory: ${dir}`);
      }
    }
    throw error;
  }

  // Validate that the path is a directory
  try {
    const stats = statSync(dir);
    if (!stats.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${dir}`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        throw new Error(`Store not found at ${dir}`);
      }
    }
    throw error;
  }

  return createFsStore(dir);
}

/**
 * Open a filesystem-backed `Store` with automatic directory creation and
 * bootstrap. The CAS sub-store is FS-backed; the variable and tag sub-stores
 * are in-memory (provided by `@ocas/core`).
 *
 * @param dir - The directory path for the CAS store
 * @returns A Promise resolving to the Store
 * @throws Error if the path exists but is not a directory
 */
export async function openStore(dir: string): Promise<Store> {
  const cas = await prepareStore(dir);
  const sqlite = createSqliteVarStore(dir, cas);
  const ocas: Store = {
    cas,
    var: sqlite.var,
    tag: sqlite.tag,
  };
  bootstrap(ocas);
  return ocas;
}
