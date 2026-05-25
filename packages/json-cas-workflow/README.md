# @uncaged/json-cas-workflow

Workflow integration layer (schemas + types).

## Overview

`@uncaged/json-cas-workflow` registers eleven JSON Schemas for agent/workflow execution graphs (definitions, thread lifecycle, content, and React-style tool/session nodes) and exports matching TypeScript payload types. Call `registerWorkflowSchemas(store)` once per store to obtain type hashes for each schema.

Sits above `@uncaged/json-cas`; typically used with `json-cas-fs` or `createMemoryStore` when building workflow-aware applications.

**Dependencies:** `@uncaged/json-cas`

## Installation

```bash
bun add @uncaged/json-cas-workflow
```

## API

Exported from `src/index.ts`.

### Schema registry

```typescript
type WorkflowSchemaHashes = {
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

async function registerWorkflowSchemas(store: Store): Promise<WorkflowSchemaHashes>;
```

Idempotent: safe to call multiple times on the same store (duplicate puts return the same hashes).

### Payload types

Definition layer:

```typescript
type AgentPayload = {
  package: string;
  version: string;
  config: Record<string, unknown>;
};

type RoleSchemaPayload = Record<string, unknown>;

type RolePayload = {
  name: string;
  description: string;
  systemPrompt: string;
  extractPrompt: string;
  schema: Hash; // cas_ref → role-schema
};

type WorkflowTransition = {
  from: string;
  to: string;
  when: string | null;
};

type WorkflowPayload = {
  name: string;
  description: string;
  roles: Record<string, Hash>; // cas_ref → role
  moderator: WorkflowTransition[];
};
```

Execution layer:

```typescript
type ThreadStartPayload = {
  workflow: Hash;
  input: string;
  depth: number;
  parentThread: Hash | null;
  agents: Record<string, Hash>;
};

type ThreadStepPayload = {
  role: string;
  meta: Record<string, unknown>;
  content: Hash;
  react: Hash;
  start: Hash;
  previous: Hash | null;
};

type ThreadEndPayload = {
  returnCode: number;
  summary: string;
  start: Hash;
  lastStep: Hash;
};

type ContentPayload = {
  text: string;
};
```

React layer:

```typescript
type ReactTurnTokens = {
  input: number;
  output: number;
};

type ReactSessionPayload = {
  agent: Hash;
  role: string;
  turns: Hash[];
  totalTokens: number;
  durationMs: number;
};

type ReactTurnPayload = {
  input: Hash;
  output: Hash;
  toolCalls: Hash[];
  tokens: ReactTurnTokens;
  latencyMs: number;
};

type ReactToolCallPayload = {
  name: string;
  arguments: Hash;
  result: Hash;
  durationMs: number;
};
```

(`Hash` is imported from `@uncaged/json-cas` in source; consumers should import `Hash` from `@uncaged/json-cas` when typing their own code.)

### Example

```typescript
import { bootstrap, createMemoryStore } from "@uncaged/json-cas";
import {
  registerWorkflowSchemas,
  type WorkflowPayload,
} from "@uncaged/json-cas-workflow";

const store = createMemoryStore();
await bootstrap(store);

const schemas = await registerWorkflowSchemas(store);

const workflowHash = await store.put(schemas.workflow, {
  name: "demo",
  description: "Example workflow",
  roles: {},
  moderator: [],
} satisfies WorkflowPayload);

console.log(workflowHash);
```

## Internal Structure

| File | Purpose |
|------|---------|
| `schemas.ts` | JSON Schema definitions and `registerWorkflowSchemas` |
| `types.ts` | Payload TypeScript types |
| `index.ts` | Public exports |
| `index.test.ts` | Registry and schema tests |
