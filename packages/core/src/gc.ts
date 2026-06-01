import { walk } from "./schema.js";
import type { Hash, Store } from "./types.js";
import type { VariableStore } from "./variable-store.js";

export interface GcStats {
  total: number; // Total CAS nodes before GC
  reachable: number; // Nodes marked as reachable
  collected: number; // Nodes deleted (swept)
  scanned: number; // Variables scanned as roots
}

/**
 * Garbage collection: mark-and-sweep algorithm
 * - Roots: all variable values (global, not scoped)
 * - Mark: recursively walk refs from roots
 * - Sweep: delete unmarked nodes
 * - Schema preservation: schemas of reachable nodes are also marked
 */
export function gc(store: Store, varStore: VariableStore): GcStats {
  // Get all variables (no filters → global)
  const variables = varStore.list();
  const scanned = variables.length;

  // Collect unique root hashes from all variables
  const roots = new Set<Hash>();
  for (const variable of variables) {
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
    const node = store.get(hash);
    if (node) {
      schemasToWalk.add(node.type);
    }
  }

  for (const schemaHash of schemasToWalk) {
    // Walk the schema's type chain (meta-schema, etc.)
    let current: Hash | null = schemaHash;
    while (current !== null && !reachable.has(current)) {
      reachable.add(current);
      const node = store.get(current);
      if (!node || node.type === current) {
        // Self-referencing or missing node, stop
        break;
      }
      current = node.type;
    }
  }

  // Preserve all self-referencing nodes (bootstrap meta-schema)
  // These are nodes where type === hash
  const allHashes = store.listAll();
  for (const hash of allHashes) {
    const node = store.get(hash);
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
      store.delete(hash);
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
