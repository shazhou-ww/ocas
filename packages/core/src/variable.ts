import type { Hash } from "./types.js";

/**
 * Variable: mutable binding to an immutable CAS node
 * Identified by composite key (name, schema)
 */
export type Variable = {
  name: string; // variable name (unique per schema)
  schema: Hash; // schema hash (part of composite key)
  value: Hash; // CAS node hash
  created: number; // epoch ms
  updated: number; // epoch ms
  tags: Record<string, string>; // key-value pairs
  labels: string[]; // bare identifiers
};
