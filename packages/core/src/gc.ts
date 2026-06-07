import { walk } from "./schema.js";
import type { Hash, Store } from "./types.js";

export interface GcStats {
  total: number; // Total CAS nodes before GC
  reachable: number; // Nodes marked as reachable
  collected: number; // Nodes deleted (swept)
  scanned: number; // Variables scanned as roots
}

const TEMPLATE_VAR_PREFIX = "@ocas/template/text/";

/**
 * Garbage collection: mark-and-sweep algorithm
 * - Roots: all variable values (global, not scoped), excluding
 *   `@ocas/template/text/*` variables — those are added in a follow-up
 *   phase only when their referenced schema is itself reachable.
 * - Mark: recursively walk refs from roots
 * - Template phase: for every reachable schema, walk the contents of its
 *   `@ocas/template/text/<schema>` template variable (mirrors
 *   `computeClosure` Phase 3).
 * - Sweep: delete unmarked nodes
 * - Schema preservation: schemas of reachable nodes are also marked
 */
export function gc(store: Store): GcStats {
  // Get all variables (no filters → global). Omit `limit` so the full
  // variable set is returned for use as gc roots.
  const variables = store.var.list();
  const scanned = variables.length;

  // Collect unique root hashes from all variables, except template
  // variables (`@ocas/template/text/*`). Template variables are processed
  // in a follow-up phase so their content is preserved only when the
  // referenced schema is itself reachable from non-template roots.
  const roots = new Set<Hash>();
  for (const variable of variables) {
    if (variable.name.startsWith(TEMPLATE_VAR_PREFIX)) continue;
    roots.add(variable.value);
  }

  // Mark phase: walk from all roots
  const reachable = new Set<Hash>();

  for (const rootHash of roots) {
    walk(store, rootHash, (hash, node) => {
      // Mark the node itself
      reachable.add(hash);
      // Mark the schema (type) of the node
      reachable.add(node.type);
    });
  }

  // Walk the schema chain to ensure bootstrap meta-schema is preserved
  // For each reachable schema, walk its schema chain (not its references)
  const schemasToWalk = new Set<Hash>();
  for (const hash of reachable) {
    const node = store.cas.get(hash);
    if (node) {
      schemasToWalk.add(node.type);
    }
  }

  for (const schemaHash of schemasToWalk) {
    // Walk the schema's type chain (meta-schema, etc.)
    let current: Hash | null = schemaHash;
    while (current !== null && !reachable.has(current)) {
      reachable.add(current);
      const node = store.cas.get(current);
      if (!node || node.type === current) {
        // Self-referencing or missing node, stop
        break;
      }
      current = node.type;
    }
  }

  // Template phase: include `@ocas/template/text/<schema>` content nodes
  // when their schema is in the reachable set (mirrors closure.ts Phase 3).
  // Snapshot the current reachable set before walking template content so
  // that template-only nodes do not transitively pull in further templates.
  const reachableSnapshot = [...reachable];
  for (const hash of reachableSnapshot) {
    const templateName = `${TEMPLATE_VAR_PREFIX}${hash}`;
    const variants = store.var.list({ exactName: templateName });
    for (const variant of variants) {
      walk(store, variant.value, (h, n) => {
        reachable.add(h);
        reachable.add(n.type);
      });
      // Walk the template content's schema chain too
      const tNode = store.cas.get(variant.value);
      if (tNode) {
        let current: Hash | null = tNode.type;
        while (current !== null && !reachable.has(current)) {
          reachable.add(current);
          const node = store.cas.get(current);
          if (!node || node.type === current) break;
          current = node.type;
        }
      }
    }
  }

  // Preserve all self-referencing nodes (bootstrap meta-schema)
  // These are nodes where type === hash
  const allHashes = store.cas.listAll();
  for (const hash of allHashes) {
    const node = store.cas.get(hash);
    if (node && node.type === hash) {
      reachable.add(hash);
    }
  }

  // Count total nodes
  const total = allHashes.length;

  // Sweep phase: delete unmarked nodes
  let collected = 0;
  for (const hash of allHashes) {
    if (!reachable.has(hash)) {
      store.cas.delete(hash);
      collected++;
    }
  }

  return {
    total,
    reachable: reachable.size,
    collected,
    scanned,
  };
}
