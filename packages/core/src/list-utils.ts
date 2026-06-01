import type { Hash, ListEntry, ListOptions } from "./types.js";

/**
 * Apply sort/desc/offset/limit to an array of `ListEntry` records.
 * Default sort is by `created` ascending. If `limit` is omitted, all entries
 * (after offset) are returned.
 *
 * Tiebreaker is the entry hash (lexicographic ascending) so ordering remains
 * deterministic for entries sharing the same timestamp.
 */
export function applyListOptions(
  entries: ListEntry[],
  options?: ListOptions,
): ListEntry[] {
  const sort = options?.sort ?? "created";
  const desc = options?.desc ?? false;
  const limit = options?.limit;
  const offset = options?.offset ?? 0;

  const sorted = [...entries].sort((a, b) => {
    const av = sort === "updated" ? a.updated : a.created;
    const bv = sort === "updated" ? b.updated : b.created;
    if (av !== bv) return desc ? bv - av : av - bv;
    // Hash tiebreaker — stable across calls
    if (a.hash === b.hash) return 0;
    return desc ? (a.hash < b.hash ? 1 : -1) : a.hash < b.hash ? -1 : 1;
  });

  if (limit !== undefined) {
    if (limit <= 0) return [];
    return sorted.slice(offset, offset + limit);
  }
  return sorted.slice(offset);
}

/**
 * Build a `ListEntry` for a CAS node from its hash and timestamp.
 * For immutable CAS nodes `created === updated === timestamp`.
 */
export function casListEntry(hash: Hash, timestamp: number): ListEntry {
  return { hash, created: timestamp, updated: timestamp };
}
