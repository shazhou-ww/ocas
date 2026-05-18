import type { Hash } from "@uncaged/json-cas";

// ── Definition layer ──────────────────────────────────────────────────────────

export type AgentPayload = {
  package: string;
  version: string;
  config: Record<string, unknown>;
};

/** A JSON Schema document stored as-is. */
export type RoleSchemaPayload = Record<string, unknown>;

export type RolePayload = {
  name: string;
  description: string;
  systemPrompt: string;
  extractPrompt: string;
  /** cas_ref → role-schema */
  schema: Hash;
};

export type WorkflowTransition = {
  from: string;
  to: string;
  when: string | null;
};

export type WorkflowPayload = {
  name: string;
  description: string;
  /** cas_ref → role */
  roles: Record<string, Hash>;
  moderator: WorkflowTransition[];
};

// ── Execution layer ───────────────────────────────────────────────────────────

export type ThreadStartPayload = {
  /** cas_ref → workflow */
  workflow: Hash;
  input: string;
  depth: number;
  /** cas_ref → thread-start | null */
  parentThread: Hash | null;
  /** cas_ref → agent */
  agents: Record<string, Hash>;
};

export type ThreadStepPayload = {
  role: string;
  meta: Record<string, unknown>;
  /** cas_ref → content */
  content: Hash;
  /** cas_ref → react-session */
  react: Hash;
  /** cas_ref → thread-start */
  start: Hash;
  /** cas_ref → thread-step | null */
  previous: Hash | null;
};

export type ThreadEndPayload = {
  returnCode: number;
  summary: string;
  /** cas_ref → thread-start */
  start: Hash;
  /** cas_ref → thread-step */
  lastStep: Hash;
};

export type ContentPayload = {
  text: string;
};

// ── React layer ───────────────────────────────────────────────────────────────

export type ReactSessionPayload = {
  /** cas_ref → agent */
  agent: Hash;
  role: string;
  /** cas_ref → react-turn */
  turns: Hash[];
  totalTokens: number;
  durationMs: number;
};

export type ReactTurnTokens = {
  input: number;
  output: number;
};

export type ReactTurnPayload = {
  /** cas_ref → content */
  input: Hash;
  /** cas_ref → content */
  output: Hash;
  /** cas_ref → react-tool-call */
  toolCalls: Hash[];
  tokens: ReactTurnTokens;
  latencyMs: number;
};

export type ReactToolCallPayload = {
  name: string;
  /** cas_ref → content (arguments) */
  arguments: Hash;
  /** cas_ref → content (result) */
  result: Hash;
  durationMs: number;
};
