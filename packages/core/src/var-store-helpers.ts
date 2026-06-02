import {
  CasNodeNotFoundError,
  MAX_HISTORY,
  TagLabelConflictError,
} from "./errors.js";
import type { CasStore, Hash, HistoryEntry } from "./types.js";
import type { Variable } from "./variable.js";

/**
 * Internal record shape used by both Memory and Fs VarStore implementations.
 * Persistence-specific code lives in each factory; pure operations on this
 * shape live here so they aren't duplicated.
 */
export type VarRecord = {
  name: string;
  schema: Hash;
  value: Hash;
  created: number;
  updated: number;
  tags: Record<string, string>;
  labels: string[];
  history: HistoryEntry[];
};

/** Build the composite map key from `(name, schema)`. */
export function varKey(name: string, schema: Hash): string {
  return `${name}\u0000${schema}`;
}

/** Add `k` to the `byName[name]` index, creating the set if needed. */
export function addNameIndex(
  byName: Map<string, Set<string>>,
  name: string,
  k: string,
): void {
  let set = byName.get(name);
  if (!set) {
    set = new Set();
    byName.set(name, set);
  }
  set.add(k);
}

/** Remove `k` from the `byName[name]` index, dropping empty sets. */
export function removeNameIndex(
  byName: Map<string, Set<string>>,
  name: string,
  k: string,
): void {
  const set = byName.get(name);
  if (!set) return;
  set.delete(k);
  if (set.size === 0) byName.delete(name);
}

/** Resolve `hash → schema` (the type field of the stored CAS node). */
export function extractSchema(cas: CasStore, hash: Hash): Hash {
  const node = cas.get(hash);
  if (node === null) throw new CasNodeNotFoundError(hash);
  return node.type;
}

/** Reject `(tags, labels)` combinations where the same key appears in both. */
export function checkTagLabelConflict(
  tags: Record<string, string>,
  labels: string[],
): void {
  for (const tk of Object.keys(tags)) {
    if (labels.includes(tk)) {
      throw new TagLabelConflictError(tk, "label", "tag");
    }
  }
}

/**
 * Push a new value onto the variable's history. Returns true if the head
 * changed (i.e. a new value was set), false when the head was already `value`.
 */
export function pushHistory(rec: VarRecord, value: Hash, now: number): boolean {
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

/** Convert a stored `VarRecord` to the public `Variable` shape (deep copy). */
export function cloneVarRecord(rec: VarRecord): Variable {
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
