import {
  DEFAULT_LIST_LIMIT,
  type Hash,
  type ListEntry,
  type ListOptions,
} from "./types.js";

/**
 * Apply sort/desc/offset/limit to an array of `ListEntry` records.
 * Default sort is by `created` ascending; default limit is `DEFAULT_LIST_LIMIT`.
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
  const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
  const offset = options?.offset ?? 0;

  const sorted = [...entries].sort((a, b) => {
    const av = sort === "updated" ? a.updated : a.created;
    const bv = sort === "updated" ? b.updated : b.created;
    if (av !== bv) return desc ? bv - av : av - bv;
    // Hash tiebreaker — stable across calls
    if (a.hash === b.hash) return 0;
    return desc ? (a.hash < b.hash ? 1 : -1) : a.hash < b.hash ? -1 : 1;
  });

  if (limit <= 0) return [];
  return sorted.slice(offset, offset + limit);
}

/**
 * Build a `ListEntry` for a CAS node from its hash and timestamp.
 * For immutable CAS nodes `created === updated === timestamp`.
 */
export function casListEntry(hash: Hash, timestamp: number): ListEntry {
  return { hash, created: timestamp, updated: timestamp };
}
