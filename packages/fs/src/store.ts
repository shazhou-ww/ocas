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
const NODES_DIR = "nodes";

// Initialise the xxhash WASM instance once at module load so the FS CAS
// store can use the synchronous hashing functions.
await initHasher();

/**
 * Migrate any pre-#84 flat-layout `.bin` files at the store root into the
 * `nodes/` subdirectory. Idempotent — does nothing if no `.bin` files are
 * present at the root.
 */
function migrateFlatLayoutToNodes(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const binFiles = entries.filter((name) => name.endsWith(".bin"));
  if (binFiles.length === 0) return;

  const nodesDir = join(dir, NODES_DIR);
  mkdirSync(nodesDir, { recursive: true });
  for (const name of binFiles) {
    renameSync(join(dir, name), join(nodesDir, name));
  }
}

/**
 * Scan `nodes/` directory for `.bin` filenames and return the set of hashes
 * present on disk. Does NOT read or decode any node content — this is the
 * cheap O(n) startup operation that replaces the legacy full-load.
 */
function loadHashSet(dir: string): Set<Hash> {
  const hashes = new Set<Hash>();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return hashes;
  }
  for (const name of entries) {
    if (!name.endsWith(".bin")) continue;
    hashes.add(name.slice(0, -4) as Hash);
  }
  return hashes;
}

/**
 * Read and CBOR-decode a single node from disk. Returns `null` if the file
 * is missing or its content is corrupted.
 */
function readNodeFromDisk(nodesDir: string, hash: Hash): CasNode | null {
  try {
    const buf = readFileSync(join(nodesDir, `${hash}.bin`));
    return decode(new Uint8Array(buf)) as CasNode;
  } catch {
    return null;
  }
}

function parseIndexFile(content: string): Hash[] {
  if (content.length === 0) return [];
  // Defensive dedup: preserve first occurrence to maintain insertion order
  // even when a stale on-disk index file contains duplicates from a previous
  // session that pre-dates the dedup fix (issue #116).
  const seen = new Set<Hash>();
  const out: Hash[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    const h = line as Hash;
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
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

/**
 * Migration helper: scan all `.bin` files on disk, decoding each one to read
 * its `type` field, and rebuild the type index. Used only when `_index/` is
 * missing — a one-time cost.
 */
function buildTypeIndexFromDisk(
  nodesDir: string,
  hashSet: Set<Hash>,
): Map<Hash, Hash[]> {
  const typeIndex = new Map<Hash, Hash[]>();
  for (const hash of hashSet) {
    const node = readNodeFromDisk(nodesDir, hash);
    if (!node) continue;
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
  nodesDir: string,
  hashSet: Set<Hash>,
): Map<Hash, Hash[]> {
  const indexDir = join(dir, INDEX_DIR);
  if (!existsSync(indexDir)) {
    const typeIndex = buildTypeIndexFromDisk(nodesDir, hashSet);
    if (typeIndex.size > 0) {
      writeTypeIndex(indexDir, typeIndex);
    }
    return typeIndex;
  }
  return loadTypeIndex(indexDir);
}

function loadOrMigrateMetaSet(
  dir: string,
  nodesDir: string,
  hashSet: Set<Hash>,
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
  // Migration: scan nodes on disk for self-referencing nodes (type === hash)
  const metaSet = new Set<Hash>();
  for (const hash of hashSet) {
    const node = readNodeFromDisk(nodesDir, hash);
    if (node && node.type === hash) {
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
  // Skip if already indexed (issue #116): prevents stale on-disk lines from
  // accumulating across put → delete → reopen cycles. The in-memory list is
  // the source of truth here because parseIndexFile dedupes on read.
  const list = typeIndex.get(type) ?? [];
  if (list.includes(hash)) return;
  mkdirSync(indexDir, { recursive: true });
  appendFileSync(join(indexDir, type), `${hash}\n`, "utf8");
  list.push(hash);
  typeIndex.set(type, list);
}

/**
 * The CAS sub-store of an FS-backed `Store` — also satisfies the legacy
 * `BootstrapCapableStore` interface so `bootstrap()` can run against it.
 */
export type ReindexResult = {
  types: number;
  nodes: number;
  removed: number;
  rebuilt: boolean;
};

export type FsCasStore = BootstrapCapableStore & {
  put(typeHash: Hash, payload: unknown): Hash;
  delete(hash: Hash): boolean;
  reindex(): ReindexResult;
};

export function createFsStore(dir: string): FsCasStore {
  // Migrate any pre-#84 flat-layout .bin files at the root into nodes/.
  migrateFlatLayoutToNodes(dir);

  const nodesDir = join(dir, NODES_DIR);
  // Lazy loading (#85): only scan filenames at startup — do NOT decode.
  const hashSet = loadHashSet(nodesDir);
  // In-memory cache of decoded nodes. Populated on first get() of each hash.
  const cache = new Map<Hash, CasNode>();
  const indexDir = join(dir, INDEX_DIR);
  const typeIndex = loadOrMigrateTypeIndex(dir, nodesDir, hashSet);
  const metaSet = loadOrMigrateMetaSet(dir, nodesDir, hashSet);

  /**
   * Look up a node by hash, loading from disk on cache miss. Returns `null`
   * if the hash is unknown or the file is corrupted.
   */
  function loadNode(hash: Hash): CasNode | null {
    const cached = cache.get(hash);
    if (cached) return cached;
    if (!hashSet.has(hash)) return null;
    const node = readNodeFromDisk(nodesDir, hash);
    if (node) cache.set(hash, node);
    return node;
  }

  function hashesToEntries(hashes: Iterable<Hash>): ListEntry[] {
    const result: ListEntry[] = [];
    for (const h of hashes) {
      const node = loadNode(h);
      if (node) result.push(casListEntry(h, node.timestamp));
    }
    return result;
  }

  function putSelfReferencing(payload: unknown): Hash {
    const hash = computeSelfHashSync(payload);
    if (!hashSet.has(hash)) {
      const node: CasNode = { type: hash, payload, timestamp: Date.now() };
      hashSet.add(hash);
      cache.set(hash, node);

      mkdirSync(nodesDir, { recursive: true });
      const tmp = join(nodesDir, `${hash}.tmp`);
      const dest = join(nodesDir, `${hash}.bin`);
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

      if (!hashSet.has(hash)) {
        const node: CasNode = {
          type: typeHash,
          payload,
          timestamp: Date.now(),
        };
        hashSet.add(hash);
        cache.set(hash, node);

        mkdirSync(nodesDir, { recursive: true });
        const tmp = join(nodesDir, `${hash}.tmp`);
        const dest = join(nodesDir, `${hash}.bin`);
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
      return loadNode(hash);
    },

    has(hash: Hash): boolean {
      return hashSet.has(hash);
    },

    listByType(typeHash: Hash, options?: ListOptions): ListEntry[] {
      const list = typeIndex.get(typeHash);
      if (!list) return [];
      return applyListOptions(hashesToEntries(list), options);
    },

    listAll(): Hash[] {
      return Array.from(hashSet);
    },

    listMeta(options?: ListOptions): ListEntry[] {
      return applyListOptions(hashesToEntries(metaSet), options);
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
      return applyListOptions(hashesToEntries(result), options);
    },

    delete(hash: Hash): boolean {
      // Detect stale index entries (issue #116): a hash may be present only
      // in the on-disk type index (e.g. its .bin was already removed by a
      // previous failed delete). We still want delete() to succeed so the
      // caller can reach a consistent state.
      const inHashSet = hashSet.has(hash);
      let inTypeIndex = false;
      if (!inHashSet) {
        for (const list of typeIndex.values()) {
          if (list.includes(hash)) {
            inTypeIndex = true;
            break;
          }
        }
      }
      if (!inHashSet && !inTypeIndex && !metaSet.has(hash)) return false;

      // Need the node's type to clean up the type index. Lazy-load if needed.
      const node = inHashSet ? loadNode(hash) : null;
      hashSet.delete(hash);
      cache.delete(hash);
      // Delete file
      try {
        unlinkSync(join(nodesDir, `${hash}.bin`));
      } catch {
        // ignore if file doesn't exist
      }
      // Remove from type index. If the node could be decoded, we know its
      // type directly; otherwise (issue #116: missing or corrupted .bin file)
      // we scan every type list for the hash and clean it up there. This
      // prevents stale on-disk index entries from accumulating across
      // delete → reopen cycles.
      const typesToCleanup: Hash[] = [];
      if (node) {
        if (typeIndex.has(node.type)) typesToCleanup.push(node.type);
      } else {
        for (const [type, list] of typeIndex) {
          if (list.includes(hash)) typesToCleanup.push(type);
        }
      }
      for (const type of typesToCleanup) {
        const list = typeIndex.get(type);
        if (!list) continue;
        const idx = list.indexOf(hash);
        if (idx !== -1) list.splice(idx, 1);
        if (list.length === 0) {
          typeIndex.delete(type);
          try {
            unlinkSync(join(indexDir, type));
          } catch {
            // ignore
          }
        } else {
          const body = `${list.join("\n")}\n`;
          writeFileSync(join(indexDir, type), body, "utf8");
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

    reindex(): ReindexResult {
      // Count duplicates and stale entries from on-disk index files
      let removed = 0;
      const idxDir = join(dir, INDEX_DIR);
      try {
        const indexFiles = readdirSync(idxDir);
        for (const f of indexFiles) {
          if (f === META_FILE) continue;
          try {
            const raw = readFileSync(join(idxDir, f), "utf8");
            const lines = raw.split("\n").filter((l) => l.length > 0);
            const unique = new Set(lines);
            // Duplicates within the file
            removed += lines.length - unique.size;
            // Stale entries pointing to nodes not on disk
            for (const h of unique) {
              if (!hashSet.has(h as Hash)) removed++;
            }
          } catch {
            // skip unreadable
          }
        }
      } catch {
        // no index dir
      }

      // Rebuild from disk: scan all nodes, decode type field
      const freshIndex = buildTypeIndexFromDisk(nodesDir, hashSet);
      const freshMeta = new Set<Hash>();
      for (const hash of hashSet) {
        const node = readNodeFromDisk(nodesDir, hash);
        if (node && node.type === hash) {
          freshMeta.add(hash);
        }
      }

      // Replace in-memory state
      typeIndex.clear();
      for (const [type, list] of freshIndex) {
        typeIndex.set(type, list);
      }
      metaSet.clear();
      for (const h of freshMeta) {
        metaSet.add(h);
      }

      // Rewrite on disk
      try {
        const oldFiles = readdirSync(idxDir);
        for (const f of oldFiles) {
          unlinkSync(join(idxDir, f));
        }
      } catch {
        // index dir may not exist
      }
      writeTypeIndex(idxDir, typeIndex);
      rewriteMetaSet(idxDir, metaSet);

      return {
        types: typeIndex.size,
        nodes: hashSet.size,
        removed,
        rebuilt: true,
      };
    },
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
