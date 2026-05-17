import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { CasNode, Hash, Store } from "@uncaged/json-cas";

import { cborEncode, computeHash, computeSelfHash } from "@uncaged/json-cas";
import { decode } from "cborg";

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

export function createFsStore(dir: string): Store {
  const data = new Map<Hash, CasNode>();
  loadDir(dir, data);

  return {
    async put(typeHash: Hash | null, payload: unknown): Promise<Hash> {
      const hash =
        typeHash === null
          ? await computeSelfHash(payload)
          : await computeHash(typeHash, payload);

      if (!data.has(hash)) {
        const type = typeHash === null ? hash : typeHash;
        const node: CasNode = { type, payload, timestamp: Date.now() };
        data.set(hash, node);

        mkdirSync(dir, { recursive: true });
        const tmp = join(dir, `${hash}.tmp`);
        const dest = join(dir, `${hash}.bin`);
        writeFileSync(
          tmp,
          cborEncode({ type, payload, timestamp: node.timestamp }),
        );
        renameSync(tmp, dest);
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
  };
}
