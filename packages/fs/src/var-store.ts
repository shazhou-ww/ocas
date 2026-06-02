import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  CasStore,
  Hash,
  HistoryEntry,
  ListEntry,
  Tag,
  TagStore,
  Variable,
  VarListOptions,
  VarStore,
} from "@ocas/core";
import {
  applyListOptions,
  CasNodeNotFoundError,
  casListEntry,
  MAX_HISTORY,
  SchemaMismatchError,
  TagLabelConflictError,
  VariableNotFoundError,
  validateName,
} from "@ocas/core";

const VARS_FILE = "_vars.jsonl";
const TAGS_FILE = "_tags.jsonl";

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

export function createFsVarStoreFor(dir: string, cas: CasStore): VarStore {
  const records = new Map<string, VarRecord>();
  const byName = new Map<string, Set<string>>();
  const path = join(dir, VARS_FILE);

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

  // Load existing records (last record per key wins)
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split("\n")) {
      if (line.length === 0) continue;
      try {
        const rec = JSON.parse(line) as VarRecord & { __op?: string };
        if (rec.__op === "remove") {
          const k = key(rec.name, rec.schema);
          records.delete(k);
          removeIndex(rec.name, k);
        } else {
          const k = key(rec.name, rec.schema);
          records.set(k, rec);
          addIndex(rec.name, k);
        }
      } catch {
        // skip malformed
      }
    }
  } catch {
    // file may not exist
  }

  function persistFull(): void {
    mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    for (const rec of records.values()) {
      lines.push(JSON.stringify(rec));
    }
    writeFileSync(path, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
  }

  function appendRecord(rec: VarRecord): void {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path, `${JSON.stringify(rec)}\n`, "utf8");
  }

  function appendRemoval(name: string, schema: Hash): void {
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      path,
      `${JSON.stringify({ __op: "remove", name, schema })}\n`,
      "utf8",
    );
  }

  function extractSchema(hash: Hash): Hash {
    const node = cas.get(hash);
    if (node === null) throw new CasNodeNotFoundError(hash);
    return node.type;
  }

  function checkConflict(tags: Record<string, string>, labels: string[]): void {
    for (const tk of Object.keys(tags)) {
      if (labels.includes(tk))
        throw new TagLabelConflictError(tk, "label", "tag");
    }
  }

  function pushHistory(rec: VarRecord, value: Hash, now: number): boolean {
    if (rec.history.length > 0 && rec.history[0]?.value === value) return false;
    const existingIdx = rec.history.findIndex((e) => e.value === value);
    if (existingIdx > 0) rec.history.splice(existingIdx, 1);
    rec.history.unshift({ value, position: 0, setAt: now });
    if (rec.history.length > MAX_HISTORY) rec.history.length = MAX_HISTORY;
    for (let i = 0; i < rec.history.length; i++) {
      const entry = rec.history[i];
      if (entry !== undefined) entry.position = i;
    }
    return true;
  }

  return {
    set(name, hash, options) {
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
        persistFull();
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
      appendRecord(rec);
      return cloneVar(rec);
    },

    get(name, schema) {
      if (schema !== undefined) {
        const rec = records.get(key(name, schema));
        return rec ? cloneVar(rec) : null;
      }
      const set = byName.get(name);
      if (!set || set.size !== 1) return null;
      const onlyKey = set.values().next().value;
      if (onlyKey === undefined) return null;
      const rec = records.get(onlyKey);
      return rec ? cloneVar(rec) : null;
    },

    remove(name, schema) {
      if (schema !== undefined) {
        const k = key(name, schema);
        const rec = records.get(k);
        if (!rec) return [];
        records.delete(k);
        removeIndex(name, k);
        appendRemoval(name, schema);
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
          appendRemoval(rec.name, rec.schema);
        }
      }
      byName.delete(name);
      return removed;
    },

    update(name, hash, options) {
      validateName(name);
      const newSchema = extractSchema(hash);
      const set = byName.get(name);
      if (!set || set.size === 0)
        throw new VariableNotFoundError(name, newSchema);
      const k = key(name, newSchema);
      const existing = records.get(k);
      if (!existing) {
        for (const ek of set) {
          const erec = records.get(ek);
          if (erec) throw new SchemaMismatchError(erec.schema, newSchema);
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
      persistFull();
      return cloneVar(existing);
    },

    list(options?: VarListOptions) {
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

    history(name, schema) {
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

    close() {
      // no-op (synchronous file ops)
    },
  };
}

type StoredTag = {
  key: string;
  value: string | null;
  target: Hash;
  created: number;
};

export function createFsTagStore(dir: string): TagStore {
  const byTarget = new Map<Hash, Map<string, Tag>>();
  const byKey = new Map<string, Set<Hash>>();
  const path = join(dir, TAGS_FILE);

  function addKeyIndex(k: string, target: Hash): void {
    let set = byKey.get(k);
    if (!set) {
      set = new Set();
      byKey.set(k, set);
    }
    set.add(target);
  }
  function removeKeyIndex(k: string, target: Hash): void {
    const set = byKey.get(k);
    if (!set) return;
    const tmap = byTarget.get(target);
    if (tmap?.has(k)) return;
    set.delete(target);
    if (set.size === 0) byKey.delete(k);
  }

  // Load
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split("\n")) {
      if (line.length === 0) continue;
      try {
        const ent = JSON.parse(line) as
          | (StoredTag & { __op?: "set" | "untag" })
          | { __op: "untag"; target: Hash; key: string };
        if ((ent as { __op?: string }).__op === "untag") {
          const e = ent as { target: Hash; key: string };
          const tm = byTarget.get(e.target);
          if (tm) {
            tm.delete(e.key);
            removeKeyIndex(e.key, e.target);
            if (tm.size === 0) byTarget.delete(e.target);
          }
        } else {
          const t = ent as StoredTag;
          let tm = byTarget.get(t.target);
          if (!tm) {
            tm = new Map();
            byTarget.set(t.target, tm);
          }
          tm.set(t.key, {
            key: t.key,
            value: t.value,
            target: t.target,
            created: t.created,
          });
          addKeyIndex(t.key, t.target);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // none
  }

  function append(line: object): void {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
  }

  return {
    tag(target, ops) {
      let tm = byTarget.get(target);
      if (!tm) {
        tm = new Map();
        byTarget.set(target, tm);
      }
      const now = Date.now();
      for (const op of ops) {
        if (op.op === "set") {
          const existing = tm.get(op.key);
          const tag: Tag = {
            key: op.key,
            value: op.value ?? null,
            target,
            created: existing?.created ?? now,
          };
          tm.set(op.key, tag);
          addKeyIndex(op.key, target);
          append(tag);
        } else {
          tm.delete(op.key);
          removeKeyIndex(op.key, target);
          append({ __op: "untag", target, key: op.key });
        }
      }
      return [...tm.values()].sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
      );
    },
    untag(target, keys) {
      const tm = byTarget.get(target);
      if (!tm) return;
      for (const k of keys) {
        tm.delete(k);
        removeKeyIndex(k, target);
        append({ __op: "untag", target, key: k });
      }
      if (tm.size === 0) byTarget.delete(target);
    },
    tags(target) {
      const tm = byTarget.get(target);
      if (!tm) return [];
      return [...tm.values()].sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
      );
    },
    listByTag(tag, options) {
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
        const tm = byTarget.get(t);
        if (!tm) continue;
        const tagEntry = tm.get(key);
        if (!tagEntry) continue;
        if (value !== undefined && tagEntry.value !== value) continue;
        entries.push(casListEntry(t, tagEntry.created));
      }
      entries = applyListOptions(entries, options);
      return entries.map((e) => e.hash);
    },
  };
}
