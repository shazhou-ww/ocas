import type { Hash, Store } from "@uncaged/json-cas";
import { type JSONSchema, putSchema } from "@uncaged/json-cas";

// ── Definition layer ──────────────────────────────────────────────────────────

const AGENT: JSONSchema = {
  type: "object",
  required: ["package", "version", "config"],
  properties: {
    package: { type: "string" },
    version: { type: "string" },
    config: { type: "object" },
  },
  additionalProperties: false,
};

/** role-schema nodes hold raw JSON Schema documents, so any object is valid. */
const ROLE_SCHEMA: JSONSchema = {
  type: "object",
};

const ROLE: JSONSchema = {
  type: "object",
  required: ["name", "description", "systemPrompt", "extractPrompt", "schema"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    systemPrompt: { type: "string" },
    extractPrompt: { type: "string" },
    schema: { type: "string", format: "cas_ref" },
  },
  additionalProperties: false,
};

const WORKFLOW: JSONSchema = {
  type: "object",
  required: ["name", "description", "roles", "moderator"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    roles: {
      type: "object",
      additionalProperties: { type: "string", format: "cas_ref" },
    },
    moderator: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "to", "when"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          when: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

// ── Execution layer ───────────────────────────────────────────────────────────

const THREAD_START: JSONSchema = {
  type: "object",
  required: ["workflow", "input", "depth", "parentThread", "agents"],
  properties: {
    workflow: { type: "string", format: "cas_ref" },
    input: { type: "string" },
    depth: { type: "number" },
    parentThread: {
      anyOf: [{ type: "string", format: "cas_ref" }, { type: "null" }],
    },
    agents: {
      type: "object",
      additionalProperties: { type: "string", format: "cas_ref" },
    },
  },
  additionalProperties: false,
};

const THREAD_STEP: JSONSchema = {
  type: "object",
  required: ["role", "meta", "content", "react", "start", "previous"],
  properties: {
    role: { type: "string" },
    meta: { type: "object" },
    content: { type: "string", format: "cas_ref" },
    react: { type: "string", format: "cas_ref" },
    start: { type: "string", format: "cas_ref" },
    previous: {
      anyOf: [{ type: "string", format: "cas_ref" }, { type: "null" }],
    },
  },
  additionalProperties: false,
};

const THREAD_END: JSONSchema = {
  type: "object",
  required: ["returnCode", "summary", "start", "lastStep"],
  properties: {
    returnCode: { type: "number" },
    summary: { type: "string" },
    start: { type: "string", format: "cas_ref" },
    lastStep: { type: "string", format: "cas_ref" },
  },
  additionalProperties: false,
};

const CONTENT: JSONSchema = {
  type: "object",
  required: ["text"],
  properties: {
    text: { type: "string" },
  },
  additionalProperties: false,
};

// ── React layer ───────────────────────────────────────────────────────────────

const REACT_SESSION: JSONSchema = {
  type: "object",
  required: ["agent", "role", "turns", "totalTokens", "durationMs"],
  properties: {
    agent: { type: "string", format: "cas_ref" },
    role: { type: "string" },
    turns: {
      type: "array",
      items: { type: "string", format: "cas_ref" },
    },
    totalTokens: { type: "number" },
    durationMs: { type: "number" },
  },
  additionalProperties: false,
};

const REACT_TURN: JSONSchema = {
  type: "object",
  required: ["input", "output", "toolCalls", "tokens", "latencyMs"],
  properties: {
    input: { type: "string", format: "cas_ref" },
    output: { type: "string", format: "cas_ref" },
    toolCalls: {
      type: "array",
      items: { type: "string", format: "cas_ref" },
    },
    tokens: {
      type: "object",
      required: ["input", "output"],
      properties: {
        input: { type: "number" },
        output: { type: "number" },
      },
      additionalProperties: false,
    },
    latencyMs: { type: "number" },
  },
  additionalProperties: false,
};

const REACT_TOOL_CALL: JSONSchema = {
  type: "object",
  required: ["name", "arguments", "result", "durationMs"],
  properties: {
    name: { type: "string" },
    arguments: { type: "string", format: "cas_ref" },
    result: { type: "string", format: "cas_ref" },
    durationMs: { type: "number" },
  },
  additionalProperties: false,
};

// ── Registry ──────────────────────────────────────────────────────────────────

export type WorkflowSchemaHashes = {
  agent: Hash;
  roleSchema: Hash;
  role: Hash;
  workflow: Hash;
  threadStart: Hash;
  threadStep: Hash;
  threadEnd: Hash;
  content: Hash;
  reactSession: Hash;
  reactTurn: Hash;
  reactToolCall: Hash;
};

/**
 * Register all 11 workflow schemas into the given store.
 * Returns a map from camelCase schema name to its CAS type hash.
 * Idempotent: safe to call multiple times on the same store.
 */
export async function registerWorkflowSchemas(
  store: Store,
): Promise<WorkflowSchemaHashes> {
  const [
    agent,
    roleSchema,
    role,
    workflow,
    threadStart,
    threadStep,
    threadEnd,
    content,
    reactSession,
    reactTurn,
    reactToolCall,
  ] = await Promise.all([
    putSchema(store, AGENT),
    putSchema(store, ROLE_SCHEMA),
    putSchema(store, ROLE),
    putSchema(store, WORKFLOW),
    putSchema(store, THREAD_START),
    putSchema(store, THREAD_STEP),
    putSchema(store, THREAD_END),
    putSchema(store, CONTENT),
    putSchema(store, REACT_SESSION),
    putSchema(store, REACT_TURN),
    putSchema(store, REACT_TOOL_CALL),
  ]);

  return {
    agent,
    roleSchema,
    role,
    workflow,
    threadStart,
    threadStep,
    threadEnd,
    content,
    reactSession,
    reactTurn,
    reactToolCall,
  };
}
