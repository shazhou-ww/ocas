import { describe, expect, test } from "bun:test";
import type { CasNode } from "@uncaged/json-cas";
import {
  createMemoryStore,
  getSchema,
  refs,
  validate,
  walk,
} from "@uncaged/json-cas";
import type { WorkflowSchemaHashes } from "./schemas.js";
import { registerWorkflowSchemas } from "./schemas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: registerWorkflowSchemas() — registers all 11 schemas
// ─────────────────────────────────────────────────────────────────────────────
describe("registerWorkflowSchemas", () => {
  test("returns an object with all 11 schema hashes", async () => {
    const store = createMemoryStore();
    const hashes = await registerWorkflowSchemas(store);

    const keys: (keyof WorkflowSchemaHashes)[] = [
      "agent",
      "roleSchema",
      "role",
      "workflow",
      "threadStart",
      "threadStep",
      "threadEnd",
      "content",
      "reactSession",
      "reactTurn",
      "reactToolCall",
    ];
    expect(Object.keys(hashes)).toHaveLength(11);
    for (const key of keys) {
      expect(hashes[key]).toBeDefined();
    }
  });

  test("all hashes are valid 13-char Crockford Base32 strings", async () => {
    const store = createMemoryStore();
    const hashes = await registerWorkflowSchemas(store);

    for (const hash of Object.values(hashes)) {
      expect(hash).toHaveLength(13);
      expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    }
  });

  test("all 11 hashes are distinct", async () => {
    const store = createMemoryStore();
    const hashes = await registerWorkflowSchemas(store);

    const values = Object.values(hashes);
    const unique = new Set(values);
    expect(unique.size).toBe(11);
  });

  test("is idempotent: repeated calls return the same hashes", async () => {
    const store = createMemoryStore();
    const first = await registerWorkflowSchemas(store);
    const second = await registerWorkflowSchemas(store);

    for (const key of Object.keys(first) as (keyof WorkflowSchemaHashes)[]) {
      expect(first[key]).toBe(second[key]);
    }
  });

  test("schemas are stored in the store (getSchema returns non-null)", async () => {
    const store = createMemoryStore();
    const hashes = await registerWorkflowSchemas(store);

    for (const hash of Object.values(hashes)) {
      expect(getSchema(store, hash)).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: getSchema() — schema round-trip for each of the 11 types
// ─────────────────────────────────────────────────────────────────────────────
describe("getSchema round-trip", () => {
  test("agent schema has the expected properties", async () => {
    const store = createMemoryStore();
    const { agent } = await registerWorkflowSchemas(store);
    const schema = getSchema(store, agent);

    expect(schema).not.toBeNull();
    expect(schema?.type).toBe("object");
    const props = schema?.properties as Record<string, unknown>;
    expect(props).toHaveProperty("package");
    expect(props).toHaveProperty("version");
    expect(props).toHaveProperty("config");
  });

  test("role schema references cas_ref for the schema field", async () => {
    const store = createMemoryStore();
    const { role } = await registerWorkflowSchemas(store);
    const schema = getSchema(store, role);

    expect(schema).not.toBeNull();
    const props = schema?.properties as Record<string, { format?: string }>;
    expect(props.schema?.format).toBe("cas_ref");
  });

  test("thread-step schema has six required fields", async () => {
    const store = createMemoryStore();
    const { threadStep } = await registerWorkflowSchemas(store);
    const schema = getSchema(store, threadStep);

    expect(schema?.required).toHaveLength(6);
  });

  test("react-turn schema has nested tokens object", async () => {
    const store = createMemoryStore();
    const { reactTurn } = await registerWorkflowSchemas(store);
    const schema = getSchema(store, reactTurn);

    const props = schema?.properties as Record<
      string,
      { type: string; properties?: unknown }
    >;
    expect(props.tokens?.type).toBe("object");
    expect(props.tokens?.properties).toBeDefined();
  });

  test("workflow schema has roles with additionalProperties cas_ref", async () => {
    const store = createMemoryStore();
    const { workflow } = await registerWorkflowSchemas(store);
    const schema = getSchema(store, workflow);

    const props = schema?.properties as Record<
      string,
      { additionalProperties?: { format?: string } }
    >;
    expect(props.roles?.additionalProperties?.format).toBe("cas_ref");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: validate() — correct payloads pass for all 11 schema types
// ─────────────────────────────────────────────────────────────────────────────
describe("validate – valid payloads", () => {
  const HASH = "AAAAAAAAAAAAA";

  test("agent payload is valid", async () => {
    const store = createMemoryStore();
    const { agent } = await registerWorkflowSchemas(store);
    const h = await store.put(agent, {
      package: "gpt-4o",
      version: "2024-11",
      config: { temperature: 0.7 },
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("role-schema payload is valid (any object)", async () => {
    const store = createMemoryStore();
    const { roleSchema } = await registerWorkflowSchemas(store);
    const h = await store.put(roleSchema, {
      type: "object",
      properties: { answer: { type: "string" } },
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("role payload is valid", async () => {
    const store = createMemoryStore();
    const { role } = await registerWorkflowSchemas(store);
    const h = await store.put(role, {
      name: "analyst",
      description: "Analyses data",
      systemPrompt: "You are an analyst.",
      extractPrompt: "Extract the findings.",
      schema: HASH,
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("workflow payload is valid", async () => {
    const store = createMemoryStore();
    const { workflow } = await registerWorkflowSchemas(store);
    const h = await store.put(workflow, {
      name: "research",
      description: "Research workflow",
      roles: { analyst: HASH },
      moderator: [{ from: "analyst", to: "analyst", when: null }],
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("thread-start payload is valid (null parentThread)", async () => {
    const store = createMemoryStore();
    const { threadStart } = await registerWorkflowSchemas(store);
    const h = await store.put(threadStart, {
      workflow: HASH,
      input: "hello",
      depth: 0,
      parentThread: null,
      agents: { main: HASH },
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("thread-start payload is valid (non-null parentThread)", async () => {
    const store = createMemoryStore();
    const { threadStart } = await registerWorkflowSchemas(store);
    const h = await store.put(threadStart, {
      workflow: HASH,
      input: "nested",
      depth: 1,
      parentThread: HASH,
      agents: {},
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("thread-step payload is valid (null previous)", async () => {
    const store = createMemoryStore();
    const { threadStep } = await registerWorkflowSchemas(store);
    const h = await store.put(threadStep, {
      role: "analyst",
      meta: { attempt: 1 },
      content: HASH,
      react: HASH,
      start: HASH,
      previous: null,
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("thread-step payload is valid (non-null previous)", async () => {
    const store = createMemoryStore();
    const { threadStep } = await registerWorkflowSchemas(store);
    const h = await store.put(threadStep, {
      role: "analyst",
      meta: {},
      content: HASH,
      react: HASH,
      start: HASH,
      previous: HASH,
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("thread-end payload is valid", async () => {
    const store = createMemoryStore();
    const { threadEnd } = await registerWorkflowSchemas(store);
    const h = await store.put(threadEnd, {
      returnCode: 0,
      summary: "Done",
      start: HASH,
      lastStep: HASH,
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("content payload is valid", async () => {
    const store = createMemoryStore();
    const { content } = await registerWorkflowSchemas(store);
    const h = await store.put(content, { text: "Hello, world!" });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("react-session payload is valid (empty turns)", async () => {
    const store = createMemoryStore();
    const { reactSession } = await registerWorkflowSchemas(store);
    const h = await store.put(reactSession, {
      agent: HASH,
      role: "analyst",
      turns: [],
      totalTokens: 0,
      durationMs: 42,
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("react-session payload is valid (multiple turns)", async () => {
    const store = createMemoryStore();
    const { reactSession } = await registerWorkflowSchemas(store);
    const h = await store.put(reactSession, {
      agent: HASH,
      role: "analyst",
      turns: [HASH, HASH],
      totalTokens: 300,
      durationMs: 1500,
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("react-turn payload is valid", async () => {
    const store = createMemoryStore();
    const { reactTurn } = await registerWorkflowSchemas(store);
    const h = await store.put(reactTurn, {
      input: HASH,
      output: HASH,
      toolCalls: [HASH],
      tokens: { input: 100, output: 50 },
      latencyMs: 800,
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });

  test("react-tool-call payload is valid", async () => {
    const store = createMemoryStore();
    const { reactToolCall } = await registerWorkflowSchemas(store);
    const h = await store.put(reactToolCall, {
      name: "search",
      arguments: HASH,
      result: HASH,
      durationMs: 200,
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: validate() — invalid payloads fail for representative types
// ─────────────────────────────────────────────────────────────────────────────
describe("validate – invalid payloads", () => {
  test("agent: missing required field fails", async () => {
    const store = createMemoryStore();
    const { agent } = await registerWorkflowSchemas(store);
    const h = await store.put(agent, { package: "gpt-4o", version: "1" });
    expect(validate(store, store.get(h) as CasNode)).toBe(false);
  });

  test("agent: wrong type for config fails", async () => {
    const store = createMemoryStore();
    const { agent } = await registerWorkflowSchemas(store);
    const h = await store.put(agent, {
      package: "gpt-4o",
      version: "1",
      config: "not-an-object",
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(false);
  });

  test("role: missing systemPrompt fails", async () => {
    const store = createMemoryStore();
    const { role } = await registerWorkflowSchemas(store);
    const h = await store.put(role, {
      name: "analyst",
      description: "d",
      extractPrompt: "e",
      schema: "AAAAAAAAAAAAA",
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(false);
  });

  test("thread-start: missing depth fails", async () => {
    const store = createMemoryStore();
    const { threadStart } = await registerWorkflowSchemas(store);
    const h = await store.put(threadStart, {
      workflow: "AAAAAAAAAAAAA",
      input: "hi",
      parentThread: null,
      agents: {},
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(false);
  });

  test("thread-end: returnCode as string fails", async () => {
    const store = createMemoryStore();
    const { threadEnd } = await registerWorkflowSchemas(store);
    const h = await store.put(threadEnd, {
      returnCode: "ok",
      summary: "Done",
      start: "AAAAAAAAAAAAA",
      lastStep: "AAAAAAAAAAAAA",
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(false);
  });

  test("content: missing text fails", async () => {
    const store = createMemoryStore();
    const { content } = await registerWorkflowSchemas(store);
    const h = await store.put(content, {});
    expect(validate(store, store.get(h) as CasNode)).toBe(false);
  });

  test("react-turn: tokens.input as string fails", async () => {
    const store = createMemoryStore();
    const { reactTurn } = await registerWorkflowSchemas(store);
    const h = await store.put(reactTurn, {
      input: "AAAAAAAAAAAAA",
      output: "AAAAAAAAAAAAA",
      toolCalls: [],
      tokens: { input: "many", output: 50 },
      latencyMs: 100,
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(false);
  });

  test("react-tool-call: missing durationMs fails", async () => {
    const store = createMemoryStore();
    const { reactToolCall } = await registerWorkflowSchemas(store);
    const h = await store.put(reactToolCall, {
      name: "tool",
      arguments: "AAAAAAAAAAAAA",
      result: "AAAAAAAAAAAAA",
    });
    expect(validate(store, store.get(h) as CasNode)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: refs() — extracts direct cas_ref fields from node payloads
// ─────────────────────────────────────────────────────────────────────────────
describe("refs – cas_ref extraction", () => {
  const HASH_A = "AAAAAAAAAAAAA";
  const HASH_B = "BBBBBBBBBBBBB";

  test("content node has no cas_ref fields → empty array", async () => {
    const store = createMemoryStore();
    const { content } = await registerWorkflowSchemas(store);
    const h = await store.put(content, { text: "hello" });
    const node = store.get(h) as CasNode;
    expect(refs(store, node)).toEqual([]);
  });

  test("role node: refs() returns the schema cas_ref", async () => {
    const store = createMemoryStore();
    const { role } = await registerWorkflowSchemas(store);
    const h = await store.put(role, {
      name: "r",
      description: "d",
      systemPrompt: "s",
      extractPrompt: "e",
      schema: HASH_A,
    });
    const node = store.get(h) as CasNode;
    expect(refs(store, node)).toContain(HASH_A);
  });

  test("thread-end: refs() returns start and lastStep", async () => {
    const store = createMemoryStore();
    const { threadEnd } = await registerWorkflowSchemas(store);
    const h = await store.put(threadEnd, {
      returnCode: 0,
      summary: "done",
      start: HASH_A,
      lastStep: HASH_B,
    });
    const node = store.get(h) as CasNode;
    const result = refs(store, node);
    expect(result).toContain(HASH_A);
    expect(result).toContain(HASH_B);
    expect(result).toHaveLength(2);
  });

  test("react-tool-call: refs() returns arguments and result", async () => {
    const store = createMemoryStore();
    const { reactToolCall } = await registerWorkflowSchemas(store);
    const h = await store.put(reactToolCall, {
      name: "search",
      arguments: HASH_A,
      result: HASH_B,
      durationMs: 100,
    });
    const node = store.get(h) as CasNode;
    const result = refs(store, node);
    expect(result).toContain(HASH_A);
    expect(result).toContain(HASH_B);
    expect(result).toHaveLength(2);
  });

  test("thread-step: refs() returns content, react, and start (previous null is skipped)", async () => {
    const store = createMemoryStore();
    const { threadStep } = await registerWorkflowSchemas(store);
    const h = await store.put(threadStep, {
      role: "r",
      meta: {},
      content: HASH_A,
      react: HASH_B,
      start: HASH_A,
      previous: null,
    });
    const node = store.get(h) as CasNode;
    const result = refs(store, node);
    expect(result).toContain(HASH_A);
    expect(result).toContain(HASH_B);
  });

  test("thread-step: refs() includes previous when non-null", async () => {
    const store = createMemoryStore();
    const { threadStep } = await registerWorkflowSchemas(store);
    const HASH_C = "CCCCCCCCCCCCC";
    const h = await store.put(threadStep, {
      role: "r",
      meta: {},
      content: HASH_A,
      react: HASH_B,
      start: HASH_A,
      previous: HASH_C,
    });
    const node = store.get(h) as CasNode;
    const result = refs(store, node);
    expect(result).toContain(HASH_C);
  });

  test("react-session: refs() returns the agent cas_ref", async () => {
    const store = createMemoryStore();
    const { reactSession } = await registerWorkflowSchemas(store);
    const h = await store.put(reactSession, {
      agent: HASH_A,
      role: "r",
      turns: [],
      totalTokens: 0,
      durationMs: 0,
    });
    const node = store.get(h) as CasNode;
    expect(refs(store, node)).toContain(HASH_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 6: walk() — BFS traversal through linked workflow nodes
// ─────────────────────────────────────────────────────────────────────────────
describe("walk – cross-schema traversal", () => {
  test("walk visits content node linked from thread-end", async () => {
    const store = createMemoryStore();
    const { threadEnd, content } = await registerWorkflowSchemas(store);

    const contentHash = await store.put(content, { text: "summary text" });
    const endHash = await store.put(threadEnd, {
      returnCode: 0,
      summary: "done",
      start: contentHash,
      lastStep: contentHash,
    });

    const visited = new Set<string>();
    walk(store, endHash, (h) => visited.add(h));

    expect(visited.has(endHash)).toBe(true);
    expect(visited.has(contentHash)).toBe(true);
  });

  test("walk through role → (schema stored in store)", async () => {
    const store = createMemoryStore();
    const { role, roleSchema } = await registerWorkflowSchemas(store);

    const schemaDocHash = await store.put(roleSchema, {
      type: "object",
      properties: { answer: { type: "string" } },
    });
    const roleHash = await store.put(role, {
      name: "analyst",
      description: "d",
      systemPrompt: "s",
      extractPrompt: "e",
      schema: schemaDocHash,
    });

    const visited = new Set<string>();
    walk(store, roleHash, (h) => visited.add(h));

    expect(visited.has(roleHash)).toBe(true);
    expect(visited.has(schemaDocHash)).toBe(true);
  });

  test("walk handles diamond: two thread-end nodes sharing the same start", async () => {
    const store = createMemoryStore();
    const { threadEnd, content } = await registerWorkflowSchemas(store);

    const sharedStart = await store.put(content, { text: "start" });
    const step1 = await store.put(content, { text: "step1" });
    const step2 = await store.put(content, { text: "step2" });

    const end1 = await store.put(threadEnd, {
      returnCode: 0,
      summary: "path A",
      start: sharedStart,
      lastStep: step1,
    });
    const end2 = await store.put(threadEnd, {
      returnCode: 1,
      summary: "path B",
      start: sharedStart,
      lastStep: step2,
    });

    // Use react-turn as the root linking both ends via input/output
    const { reactTurn } = await registerWorkflowSchemas(store);
    const turnHash = await store.put(reactTurn, {
      input: end1,
      output: end2,
      toolCalls: [],
      tokens: { input: 10, output: 5 },
      latencyMs: 50,
    });

    const visited = new Set<string>();
    walk(store, turnHash, (h) => visited.add(h));

    expect(visited.has(turnHash)).toBe(true);
    expect(visited.has(end1)).toBe(true);
    expect(visited.has(end2)).toBe(true);
    // sharedStart is reached from both end1 and end2, but visited only once
    expect(visited.has(sharedStart)).toBe(true);
    expect(visited.has(step1)).toBe(true);
    expect(visited.has(step2)).toBe(true);
  });

  test("walk visits react-tool-call linked from react-turn", async () => {
    const store = createMemoryStore();
    const { reactTurn, reactToolCall, content } =
      await registerWorkflowSchemas(store);

    const argsHash = await store.put(content, { text: '{"q":"test"}' });
    const resultHash = await store.put(content, { text: '{"r":"ok"}' });
    const toolCallHash = await store.put(reactToolCall, {
      name: "search",
      arguments: argsHash,
      result: resultHash,
      durationMs: 120,
    });

    const inputHash = await store.put(content, { text: "input" });
    const outputHash = await store.put(content, { text: "output" });
    const turnHash = await store.put(reactTurn, {
      input: inputHash,
      output: outputHash,
      toolCalls: [],
      tokens: { input: 80, output: 40 },
      latencyMs: 600,
    });

    const visited = new Set<string>();
    walk(store, turnHash, (h) => visited.add(h));

    expect(visited.has(turnHash)).toBe(true);
    expect(visited.has(inputHash)).toBe(true);
    expect(visited.has(outputHash)).toBe(true);
    // toolCallHash is not in the turn's cas_ref fields (toolCalls array), only linked manually
    expect(visited.has(toolCallHash)).toBe(false);

    // walk from toolCallHash to verify it reaches args and result
    const tcVisited = new Set<string>();
    walk(store, toolCallHash, (h) => tcVisited.add(h));
    expect(tcVisited.has(toolCallHash)).toBe(true);
    expect(tcVisited.has(argsHash)).toBe(true);
    expect(tcVisited.has(resultHash)).toBe(true);
  });
});
