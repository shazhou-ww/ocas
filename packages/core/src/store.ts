import {
  BOOTSTRAP_STORE,
  type BootstrapCapableStore,
} from "./bootstrap-capable.js";
import { computeHashSync, computeSelfHashSync, initHasher } from "./hash.js";
import { applyListOptions, casListEntry } from "./list-utils.js";
import type {
  CasNode,
  Hash,
  HistoryEntry,
  ListEntry,
  ListOptions,
  OcasStore,
  Tag,
  TagOp,
  TagStore,
  VarListOptions,
  VarSetOptions,
  VarStore,
} from "./types.js";
import type { Variable } from "./variable.js";
import {
  CasNodeNotFoundError,
  InvalidVariableNameError,
  MAX_HISTORY,
  SchemaMismatchError,
  TagLabelConflictError,
  VariableNotFoundError,
} from "./variable-store.js";

// Initialise the xxhash WASM instance once at module load. This allows the
// CAS sub-store's `put` method to be synchronous (per the new CasStore type).
await initHasher();

/**
 * The cas sub-store of an in-memory `OcasStore` — also satisfies the legacy
 * `BootstrapCapableStore` interface so that helpers that have not yet been
 * refactored (e.g. bootstrap, gc, render) continue to work against
 * `store.cas`.
 */
export type MemoryCasStore = BootstrapCapableStore & {
  put(typeHash: Hash, payload: unknown): Hash;
  delete(hash: Hash): boolean;
};

function validateName(name: string): void {
  if (name === "") {
    throw new InvalidVariableNameError(name, "Name cannot be empty");
  }
  const match = name.match(/^@([a-zA-Z][a-zA-Z0-9]*)\/(.+)$/);
  if (!match) {
    throw new InvalidVariableNameError(
      name,
      "Name must follow @scope/name format (e.g. @myapp/config)",
    );
  }
  const rest = match[2] as string;
  if (rest.endsWith("/")) {
    throw new InvalidVariableNameError(
      name,
      "Name cannot end with trailing slash",
    );
  }
  const segments = rest.split("/");
  for (const segment of segments) {
    if (segment === "") {
      throw new InvalidVariableNameError(
        name,
        "Name contains empty segment (consecutive slashes //)",
      );
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(segment)) {
      throw new InvalidVariableNameError(
        name,
        `Segment "${segment}" contains invalid characters (only a-z, A-Z, 0-9, ., _, - allowed)`,
      );
    }
  }
}

function createCasStore(): MemoryCasStore {
  const data = new Map<Hash, CasNode>();
  const byType = new Map<Hash, Set<Hash>>();
  const metaSet = new Set<Hash>();

  function indexHash(type: Hash, hash: Hash): void {
    let set = byType.get(type);
    if (!set) {
      set = new Set();
      byType.set(type, set);
    }
    set.add(hash);
  }

  function putSelfReferencing(payload: unknown): Hash {
    const hash = computeSelfHashSync(payload);
    if (!data.has(hash)) {
      data.set(hash, { type: hash, payload, timestamp: Date.now() });
      indexHash(hash, hash);
    }
    metaSet.add(hash);
    return hash;
  }

  function entriesForHashes(hashes: Iterable<Hash>): ListEntry[] {
    const result: ListEntry[] = [];
    for (const h of hashes) {
      const node = data.get(h);
      if (node) result.push(casListEntry(h, node.timestamp));
    }
    return result;
  }

  const store: MemoryCasStore = {
    put(typeHash: Hash, payload: unknown): Hash {
      const hash = computeHashSync(typeHash, payload);
      if (!data.has(hash)) {
        data.set(hash, { type: typeHash, payload, timestamp: Date.now() });
        indexHash(typeHash, hash);
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
      const set = byType.get(typeHash);
      if (!set) return [];
      return applyListOptions(entriesForHashes(set), options);
    },

    listAll(): Hash[] {
      return Array.from(data.keys());
    },

    listMeta(options?: ListOptions): ListEntry[] {
      return applyListOptions(entriesForHashes(metaSet), options);
    },

    listSchemas(options?: ListOptions): ListEntry[] {
      const result = new Set<Hash>();
      for (const meta of metaSet) {
        result.add(meta);
        const set = byType.get(meta);
        if (set) {
          for (const h of set) result.add(h);
        }
      }
      return applyListOptions(entriesForHashes(result), options);
    },

    delete(hash: Hash): boolean {
      const node = data.get(hash);
      if (!node) return false;
      data.delete(hash);
      const set = byType.get(node.type);
      if (set) {
        set.delete(hash);
        if (set.size === 0) {
          byType.delete(node.type);
        }
      }
      metaSet.delete(hash);
      return true;
    },

    [BOOTSTRAP_STORE]: putSelfReferencing,
  };

  return store;
}

type VarRecord = {
  name: string;
  schema: Hash;
  value: Hash;
  created: number;
  updated: number;
  tags: Record<string, string>;
  labels: string[];
  history: HistoryEntry[];
};

function cloneVar(rec: VarRecord): Variable {
  return {
    name: rec.name,
    schema: rec.schema,
    value: rec.value,
    created: rec.created,
    updated: rec.updated,
    tags: { ...rec.tags },
    labels: [...rec.labels],
  };
}

function createMemoryVarStore(cas: MemoryCasStore): VarStore {
  // composite key: `${name}\u0000${schema}`
  const records = new Map<string, VarRecord>();
  const byName = new Map<string, Set<string>>(); // name -> set of composite keys

  function key(name: string, schema: Hash): string {
    return `${name}\u0000${schema}`;
  }

  function addIndex(name: string, k: string): void {
    let set = byName.get(name);
    if (!set) {
      set = new Set();
      byName.set(name, set);
    }
    set.add(k);
  }

  function removeIndex(name: string, k: string): void {
    const set = byName.get(name);
    if (!set) return;
    set.delete(k);
    if (set.size === 0) byName.delete(name);
  }

  function extractSchema(hash: Hash): Hash {
    const node = cas.get(hash);
    if (node === null) {
      throw new CasNodeNotFoundError(hash);
    }
    return node.type;
  }

  function checkConflict(tags: Record<string, string>, labels: string[]): void {
    for (const tk of Object.keys(tags)) {
      if (labels.includes(tk)) {
        throw new TagLabelConflictError(tk, "label", "tag");
      }
    }
  }

  function pushHistory(rec: VarRecord, value: Hash, now: number): boolean {
    if (rec.history.length > 0 && rec.history[0]?.value === value) {
      return false;
    }
    const existingIdx = rec.history.findIndex((e) => e.value === value);
    if (existingIdx > 0) {
      rec.history.splice(existingIdx, 1);
    }
    rec.history.unshift({ value, position: 0, setAt: now });
    if (rec.history.length > MAX_HISTORY) {
      rec.history.length = MAX_HISTORY;
    }
    for (let i = 0; i < rec.history.length; i++) {
      const entry = rec.history[i];
      if (entry !== undefined) entry.position = i;
    }
    return true;
  }

  const varStore: VarStore = {
    set(name: string, hash: Hash, options?: VarSetOptions): Variable {
      validateName(name);
      const schema = extractSchema(hash);
      const k = key(name, schema);
      const existing = records.get(k);
      const now = Date.now();

      if (existing) {
        const tags = options?.tags ?? existing.tags;
        const labels = options?.labels ?? existing.labels;
        if (options !== undefined) checkConflict(tags, labels);
        const changed = pushHistory(existing, hash, now);
        if (changed) {
          existing.value = hash;
          existing.updated = now;
        }
        if (options !== undefined) {
          existing.tags = { ...tags };
          existing.labels = [...labels];
        }
        return cloneVar(existing);
      }

      const tags = options?.tags ?? {};
      const labels = options?.labels ?? [];
      checkConflict(tags, labels);
      const rec: VarRecord = {
        name,
        schema,
        value: hash,
        created: now,
        updated: now,
        tags: { ...tags },
        labels: [...labels],
        history: [{ value: hash, position: 0, setAt: now }],
      };
      records.set(k, rec);
      addIndex(name, k);
      return cloneVar(rec);
    },

    get(name: string, schema?: Hash): Variable | null {
      if (schema !== undefined) {
        const rec = records.get(key(name, schema));
        return rec ? cloneVar(rec) : null;
      }
      // No schema: if exactly one variant, return it; otherwise null
      const set = byName.get(name);
      if (!set || set.size !== 1) return null;
      const onlyKey = set.values().next().value;
      if (onlyKey === undefined) return null;
      const rec = records.get(onlyKey);
      return rec ? cloneVar(rec) : null;
    },

    remove(name: string, schema?: Hash): Variable[] {
      if (schema !== undefined) {
        const k = key(name, schema);
        const rec = records.get(k);
        if (!rec) return [];
        records.delete(k);
        removeIndex(name, k);
        return [cloneVar(rec)];
      }
      const set = byName.get(name);
      if (!set) return [];
      const removed: Variable[] = [];
      for (const k of [...set]) {
        const rec = records.get(k);
        if (rec) {
          removed.push(cloneVar(rec));
          records.delete(k);
        }
      }
      byName.delete(name);
      return removed;
    },

    update(name: string, hash: Hash, options?: VarSetOptions): Variable {
      validateName(name);
      const newSchema = extractSchema(hash);
      // Find existing record by name; require existing schema match new schema
      const set = byName.get(name);
      if (!set || set.size === 0) {
        throw new VariableNotFoundError(name, newSchema);
      }
      // find a record matching newSchema
      const k = key(name, newSchema);
      const existing = records.get(k);
      if (!existing) {
        // Find any existing — schema mismatch
        for (const ek of set) {
          const erec = records.get(ek);
          if (erec) {
            throw new SchemaMismatchError(erec.schema, newSchema);
          }
        }
        throw new VariableNotFoundError(name, newSchema);
      }
      const now = Date.now();
      const tags = options?.tags ?? existing.tags;
      const labels = options?.labels ?? existing.labels;
      if (options !== undefined) checkConflict(tags, labels);
      const changed = pushHistory(existing, hash, now);
      if (changed) {
        existing.value = hash;
        existing.updated = now;
      }
      if (options !== undefined) {
        existing.tags = { ...tags };
        existing.labels = [...labels];
      }
      return cloneVar(existing);
    },

    list(options?: VarListOptions): Variable[] {
      if (
        options?.namePrefix !== undefined &&
        options?.exactName !== undefined
      ) {
        throw new Error(
          "namePrefix and exactName are mutually exclusive - cannot specify both",
        );
      }
      const namePrefix = options?.namePrefix;
      const exactName = options?.exactName;
      const schema = options?.schema;
      const filterTags = options?.tags ?? {};
      const filterLabels = options?.labels ?? [];
      const sort = options?.sort ?? "created";
      const desc = options?.desc ?? false;
      const limit = options?.limit;
      const offset = options?.offset ?? 0;

      if (limit !== undefined && limit <= 0) return [];

      let results: VarRecord[] = [];
      for (const rec of records.values()) {
        if (exactName !== undefined && rec.name !== exactName) continue;
        if (namePrefix !== undefined && !rec.name.startsWith(namePrefix))
          continue;
        if (schema !== undefined && rec.schema !== schema) continue;
        let ok = true;
        for (const [tk, tv] of Object.entries(filterTags)) {
          if (rec.tags[tk] !== tv) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        for (const lb of filterLabels) {
          if (!rec.labels.includes(lb)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        results.push(rec);
      }

      results.sort((a, b) => {
        const av = sort === "updated" ? a.updated : a.created;
        const bv = sort === "updated" ? b.updated : b.created;
        if (av !== bv) return desc ? bv - av : av - bv;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });

      if (offset > 0) results = results.slice(offset);
      if (limit !== undefined) results = results.slice(0, limit);
      return results.map(cloneVar);
    },

    history(name: string, schema?: Hash): HistoryEntry[] {
      if (schema !== undefined) {
        const rec = records.get(key(name, schema));
        return rec ? rec.history.map((e) => ({ ...e })) : [];
      }
      const set = byName.get(name);
      if (!set || set.size !== 1) return [];
      const onlyKey = set.values().next().value;
      if (onlyKey === undefined) return [];
      const rec = records.get(onlyKey);
      return rec ? rec.history.map((e) => ({ ...e })) : [];
    },

    close(): void {
      // no-op for in-memory store
    },
  };

  return varStore;
}

function createMemoryTagStore(): TagStore {
  // target -> key -> Tag
  const byTarget = new Map<Hash, Map<string, Tag>>();
  // key -> set of targets
  const byKey = new Map<string, Set<Hash>>();
  // per-target ordering (created)
  const targetOrder = new Map<Hash, number>();

  function addKeyIndex(key: string, target: Hash): void {
    let set = byKey.get(key);
    if (!set) {
      set = new Set();
      byKey.set(key, set);
    }
    set.add(target);
  }

  function removeKeyIndex(key: string, target: Hash): void {
    const set = byKey.get(key);
    if (!set) return;
    // only remove if this target no longer has that key in any tag
    const tmap = byTarget.get(target);
    if (tmap && tmap.has(key)) return;
    set.delete(target);
    if (set.size === 0) byKey.delete(key);
  }

  return {
    tag(target: Hash, operations: TagOp[]): Tag[] {
      let tmap = byTarget.get(target);
      if (!tmap) {
        tmap = new Map();
        byTarget.set(target, tmap);
      }
      const now = Date.now();
      for (const op of operations) {
        if (op.op === "set") {
          const tag: Tag = {
            key: op.key,
            value: op.value ?? null,
            target,
            created: tmap.get(op.key)?.created ?? now,
          };
          tmap.set(op.key, tag);
          addKeyIndex(op.key, target);
        } else {
          tmap.delete(op.key);
          removeKeyIndex(op.key, target);
        }
      }
      if (!targetOrder.has(target)) {
        targetOrder.set(target, now);
      }
      // return the current tags
      return [...tmap.values()].sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
      );
    },

    untag(target: Hash, keys: string[]): void {
      const tmap = byTarget.get(target);
      if (!tmap) return;
      for (const k of keys) {
        tmap.delete(k);
        removeKeyIndex(k, target);
      }
      if (tmap.size === 0) {
        byTarget.delete(target);
        targetOrder.delete(target);
      }
    },

    tags(target: Hash): Tag[] {
      const tmap = byTarget.get(target);
      if (!tmap) return [];
      return [...tmap.values()].sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
      );
    },

    listByTag(tag: string, options?: ListOptions): Hash[] {
      // accept "key" or "key=value" form
      let key = tag;
      let value: string | null | undefined;
      const eqIdx = tag.indexOf("=");
      if (eqIdx >= 0) {
        key = tag.slice(0, eqIdx);
        value = tag.slice(eqIdx + 1);
      }
      const targets = byKey.get(key);
      if (!targets) return [];
      let entries: ListEntry[] = [];
      for (const t of targets) {
        const tmap = byTarget.get(t);
        if (!tmap) continue;
        const tagEntry = tmap.get(key);
        if (!tagEntry) continue;
        if (value !== undefined && tagEntry.value !== value) continue;
        entries.push(casListEntry(t, tagEntry.created));
      }
      entries = applyListOptions(entries, options);
      return entries.map((e) => e.hash);
    },
  };
}

/**
 * Create an in-memory `OcasStore` with three sub-stores: `cas`, `var`, `tag`.
 *
 * The `cas` sub-store also satisfies the legacy `BootstrapCapableStore`
 * contract — it carries a `[BOOTSTRAP_STORE]` callable and a `listAll()`
 * helper — so existing helpers (`bootstrap`, `gc`, `render`, …) can be
 * called with `store.cas` until they are migrated to the unified surface.
 */
export function createMemoryStore(): OcasStore & {
  cas: MemoryCasStore;
} {
  const cas = createCasStore();
  const varStore = createMemoryVarStore(cas);
  const tagStore = createMemoryTagStore();
  return { cas, var: varStore, tag: tagStore };
}
