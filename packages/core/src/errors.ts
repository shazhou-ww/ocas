import type { Hash } from "./types.js";

/**
 * Maximum number of historical values retained per (variable_name, variable_schema).
 * Position 0 is current; positions 1..MAX_HISTORY-1 are previous values (LRU).
 */
export const MAX_HISTORY = 10;

/**
 * Custom error types for variable operations
 */
export class VariableNotFoundError extends Error {
  constructor(
    public variableName: string,
    public variableSchema: Hash,
  ) {
    super(`Variable not found: name=${variableName}, schema=${variableSchema}`);
    this.name = "VariableNotFoundError";
  }
}

export class InvalidVariableNameError extends Error {
  constructor(
    public variableName: string,
    public reason: string,
  ) {
    super(`Invalid variable name "${variableName}": ${reason}`);
    this.name = "InvalidVariableNameError";
  }
}

export class SchemaMismatchError extends Error {
  constructor(
    public expected: string,
    public actual: string,
  ) {
    super(`Schema mismatch: expected ${expected}, got ${actual}`);
    this.name = "SchemaMismatchError";
  }
}

export class CasNodeNotFoundError extends Error {
  constructor(
    public readonly hash: string,
    message?: string,
  ) {
    super(message ?? `CAS node not found: ${hash}`);
    this.name = "CasNodeNotFoundError";
  }
}

export class TagLabelConflictError extends Error {
  constructor(
    public conflictName: string,
    public existingType: "tag" | "label",
    public attemptedType: "tag" | "label",
  ) {
    super(`Conflict: '${conflictName}' already exists as a ${existingType}`);
    this.name = "TagLabelConflictError";
  }
}

export class InvalidTagFormatError extends Error {
  constructor(tag: string) {
    super(`Invalid tag format: ${tag}`);
    this.name = "InvalidTagFormatError";
  }
}
