import type { Hash } from "./types.js";

/**
 * ULID identifier (26-character Crockford Base32)
 */
export type VariableId = string;

/**
 * Variable: mutable binding to an immutable CAS node
 */
export type Variable = {
  id: VariableId;
  scope: string; // hierarchical path, must end with /
  value: Hash; // CAS node hash
  schema: Hash; // extracted from value's CAS node.type
  created: number; // epoch ms
  updated: number; // epoch ms
  tags: Record<string, string>; // key-value pairs
  labels: string[]; // bare identifiers
};
