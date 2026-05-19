import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  BootstrapCapableStore,
  CasNode,
  Hash,
} from "@uncaged/json-cas";

import {
  BOOTSTRAP_STORE,
  cborEncode,
  computeHash,
  computeSelfHash,
} from "@uncaged/json-cas";
import { decode } from "cborg";

const INDEX_DIR = "_index";

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

export function createFsStore(dir: string): BootstrapCapableStore {
  const data = new Map<Hash, CasNode>();
  loadDir(dir, data);
  const indexDir = join(dir, INDEX_DIR);
  const typeIndex = loadOrMigrateTypeIndex(dir, data);

  async function putSelfReferencing(payload: unknown): Promise<Hash> {
    const hash = await computeSelfHash(payload);
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
    return hash;
  }

  const store: BootstrapCapableStore = {
    async put(typeHash: Hash, payload: unknown): Promise<Hash> {
      const hash = await computeHash(typeHash, payload);

      if (!data.has(hash)) {
        const node: CasNode = { type: typeHash, payload, timestamp: Date.now() };
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

    list(): Hash[] {
      return [...data.keys()];
    },

    listByType(typeHash: Hash): Hash[] {
      return typeIndex.get(typeHash) ?? [];
    },

    [BOOTSTRAP_STORE]: putSelfReferencing,
  };

  return store;
}
