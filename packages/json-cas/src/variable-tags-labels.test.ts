import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "./store.js";
import type { Store } from "./types.js";
import {
  TagLabelConflictError,
  VariableNotFoundError,
  VariableStore,
} from "./variable-store.js";

describe("VariableStore - Tags and Labels (RFC-20 Phase 2)", () => {
  let store: Store;
  let varStore: VariableStore;
  let dbPath: string;
  let schemaHash: string;
  let hashA: string;
  let hashB: string;
  let hashC: string;

  beforeEach(async () => {
    dbPath = join(tmpdir(), `test-variables-phase2-${Date.now()}.db`);
    store = createMemoryStore();

    // Create test schema
    schemaHash = await store.put("BOOTSTRAPHASH", {
      type: "object",
      properties: { name: { type: "string" } },
    });

    // Create test CAS nodes
    hashA = await store.put(schemaHash, { name: "a" });
    hashB = await store.put(schemaHash, { name: "b" });
    hashC = await store.put(schemaHash, { name: "c" });

    varStore = new VariableStore(dbPath, store);
  });

  afterEach(() => {
    varStore.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Test Group 0: Setup and Backward Compatibility", () => {
    test("0.1: Create variable without tags/labels", () => {
      const variable = varStore.create("uwf/thread/", hashA);

      expect(variable.tags).toEqual({});
      expect(variable.labels).toEqual([]);
      expect(variable.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(variable.scope).toBe("uwf/thread/");
      expect(variable.value).toBe(hashA);
    });

    test("0.2: Get variable returns empty tags and labels", () => {
      const created = varStore.create("uwf/thread/", hashA);
      const retrieved = varStore.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.tags).toEqual({});
      expect(retrieved?.labels).toEqual([]);
    });

    test("0.3: Create variable with initial tags", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active", workflow: "solve-issue" },
      });

      expect(variable.tags).toEqual({
        status: "active",
        workflow: "solve-issue",
      });
      expect(variable.labels).toEqual([]);
    });

    test("0.4: Create variable with initial labels", () => {
      const variable = varStore.create("uwf/workflow/", hashC, {
        labels: ["pinned"],
      });

      expect(variable.tags).toEqual({});
      expect(variable.labels).toEqual(["pinned"]);
    });

    test("0.5: Create variable with both tags and labels", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active" },
        labels: ["pinned"],
      });

      expect(variable.tags).toEqual({ status: "active" });
      expect(variable.labels).toEqual(["pinned"]);
    });

    test("0.6: Create variable with conflicting tag/label throws error", () => {
      expect(() =>
        varStore.create("uwf/thread/", hashA, {
          tags: { workflow: "solve-issue" },
          labels: ["workflow"],
        }),
      ).toThrow(TagLabelConflictError);
    });
  });

  describe("Test Group 1: Tag Operations", () => {
    test("1.1: Add tag to existing variable", async () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active" },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = varStore.tag(variable.id, {
        add: { priority: "high" },
      });

      expect(updated.tags).toEqual({
        status: "active",
        priority: "high",
      });
      expect(updated.updated).toBeGreaterThan(variable.updated);
    });

    test("1.2: Tag same-key override", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active" },
      });

      const updated = varStore.tag(variable.id, {
        add: { status: "completed" },
      });

      expect(updated.tags).toEqual({ status: "completed" });
      expect(Object.keys(updated.tags)).toHaveLength(1);
    });

    test("1.3: Delete tag using delete array", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active", workflow: "solve-issue" },
      });

      const updated = varStore.tag(variable.id, {
        delete: ["status"],
      });

      expect(updated.tags).toEqual({ workflow: "solve-issue" });
      expect(updated.tags.status).toBeUndefined();
    });

    test("1.4: Delete non-existent tag is idempotent", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active" },
      });

      const updated = varStore.tag(variable.id, {
        delete: ["nonexistent"],
      });

      expect(updated.tags).toEqual({ status: "active" });
    });

    test("1.5: Multiple tag operations in single call", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active", workflow: "solve-issue" },
      });

      const updated = varStore.tag(variable.id, {
        add: { env: "production", region: "us-west" },
        delete: ["workflow"],
      });

      expect(updated.tags).toEqual({
        status: "active",
        env: "production",
        region: "us-west",
      });
    });

    test("1.6: Delete then add same key in single operation", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active" },
      });

      const updated = varStore.tag(variable.id, {
        delete: ["status"],
        add: { status: "new" },
      });

      expect(updated.tags).toEqual({ status: "new" });
    });
  });

  describe("Test Group 2: Label Operations", () => {
    test("2.1: Add label to existing variable", () => {
      const variable = varStore.create("uwf/thread/", hashA);

      const updated = varStore.tag(variable.id, {
        addLabels: ["archived"],
      });

      expect(updated.labels).toContain("archived");
      expect(updated.labels).toHaveLength(1);
    });

    test("2.2: Delete label using delete array", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        labels: ["archived", "pinned"],
      });

      const updated = varStore.tag(variable.id, {
        delete: ["archived"],
      });

      expect(updated.labels).toEqual(["pinned"]);
    });

    test("2.3: Add duplicate label is idempotent", () => {
      const variable = varStore.create("uwf/workflow/", hashC, {
        labels: ["pinned"],
      });

      const updated = varStore.tag(variable.id, {
        addLabels: ["pinned"],
      });

      expect(updated.labels).toEqual(["pinned"]);
    });

    test("2.4: Multiple label operations in single call", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        labels: ["archived"],
      });

      const updated = varStore.tag(variable.id, {
        addLabels: ["experimental", "deprecated"],
        delete: ["archived"],
      });

      expect(updated.labels).toHaveLength(2);
      expect(updated.labels).toContain("experimental");
      expect(updated.labels).toContain("deprecated");
      expect(updated.labels).not.toContain("archived");
    });
  });

  describe("Test Group 3: Tag/Label Mutual Exclusion", () => {
    test("3.1: Label conflicts with existing tag key", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { workflow: "solve-issue" },
      });

      expect(() =>
        varStore.tag(variable.id, {
          addLabels: ["workflow"],
        }),
      ).toThrow(TagLabelConflictError);

      // Verify variable state unchanged
      const retrieved = varStore.get(variable.id);
      expect(retrieved?.tags).toEqual({ workflow: "solve-issue" });
      expect(retrieved?.labels).toEqual([]);
    });

    test("3.2: Tag conflicts with existing label", () => {
      const variable = varStore.create("uwf/workflow/", hashC, {
        labels: ["pinned"],
      });

      expect(() =>
        varStore.tag(variable.id, {
          add: { pinned: "true" },
        }),
      ).toThrow(TagLabelConflictError);

      // Verify variable state unchanged
      const retrieved = varStore.get(variable.id);
      expect(retrieved?.tags).toEqual({});
      expect(retrieved?.labels).toEqual(["pinned"]);
    });

    test("3.3: Delete then add resolves conflict", () => {
      const variable = varStore.create("uwf/workflow/", hashC, {
        labels: ["pinned"],
      });

      const updated = varStore.tag(variable.id, {
        delete: ["pinned"],
        add: { pinned: "true" },
      });

      expect(updated.tags).toEqual({ pinned: "true" });
      expect(updated.labels).toEqual([]);
    });

    test("3.4: Simultaneous conflicting operations in same call", () => {
      const variable = varStore.create("uwf/thread/", hashA);

      expect(() =>
        varStore.tag(variable.id, {
          add: { newkey: "value" },
          addLabels: ["newkey"],
        }),
      ).toThrow(TagLabelConflictError);
    });
  });

  describe("Test Group 4: Query - Scope Filtering", () => {
    test("4.1: List with exact scope match", () => {
      const var1 = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active" },
      });
      const var2 = varStore.create("uwf/thread/", hashB, {
        tags: { status: "completed" },
      });
      varStore.create("uwf/workflow/", hashC);

      const results = varStore.list({ scope: "uwf/thread/" });

      expect(results).toHaveLength(2);
      expect(results.map((v) => v.id)).toContain(var1.id);
      expect(results.map((v) => v.id)).toContain(var2.id);
    });

    test("4.2: List with scope prefix match", () => {
      const var1 = varStore.create("uwf/thread/", hashA);
      const var2 = varStore.create("uwf/thread/", hashB);
      const var3 = varStore.create("uwf/workflow/", hashC);

      const results = varStore.list({ scope: "uwf/" });

      expect(results).toHaveLength(3);
      expect(results.map((v) => v.id)).toContain(var1.id);
      expect(results.map((v) => v.id)).toContain(var2.id);
      expect(results.map((v) => v.id)).toContain(var3.id);
    });

    test("4.3: List all variables (no scope filter)", () => {
      const var1 = varStore.create("uwf/thread/", hashA);
      const var2 = varStore.create("app/config/", hashB);

      const results = varStore.list();

      expect(results).toHaveLength(2);
      expect(results.map((v) => v.id)).toContain(var1.id);
      expect(results.map((v) => v.id)).toContain(var2.id);
    });

    test("4.4: List with non-matching scope returns empty", () => {
      varStore.create("uwf/thread/", hashA);

      const results = varStore.list({ scope: "app/config/" });

      expect(results).toEqual([]);
    });
  });

  describe("Test Group 5: Query - Tag Filtering", () => {
    test("5.1: Filter by tag key-value pair", () => {
      const var1 = varStore.create("uwf/thread/", hashA, {
        tags: { status: "completed" },
      });
      const var2 = varStore.create("uwf/thread/", hashB, {
        tags: { status: "completed" },
      });
      varStore.create("uwf/thread/", hashC, {
        tags: { status: "active" },
      });

      const results = varStore.list({
        tags: { status: "completed" },
      });

      expect(results).toHaveLength(2);
      expect(results.map((v) => v.id)).toContain(var1.id);
      expect(results.map((v) => v.id)).toContain(var2.id);
    });

    test("5.2: Filter by non-existent tag returns empty", () => {
      varStore.create("uwf/thread/", hashA, {
        tags: { status: "active" },
      });

      const results = varStore.list({
        tags: { nonexistent: "value" },
      });

      expect(results).toEqual([]);
    });

    test("5.3: Multiple tag filters use AND logic", () => {
      const var1 = varStore.create("uwf/thread/", hashA, {
        tags: { status: "completed", priority: "high" },
      });
      varStore.create("uwf/thread/", hashB, {
        tags: { status: "completed", priority: "low" },
      });
      varStore.create("uwf/thread/", hashC, {
        tags: { status: "active", priority: "high" },
      });

      const results = varStore.list({
        tags: { status: "completed", priority: "high" },
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(var1.id);
    });
  });

  describe("Test Group 6: Query - Label Filtering", () => {
    test("6.1: Filter by label", () => {
      const var1 = varStore.create("uwf/workflow/", hashA, {
        labels: ["pinned"],
      });
      varStore.create("uwf/workflow/", hashB);

      const results = varStore.list({
        labels: ["pinned"],
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(var1.id);
    });

    test("6.2: Filter by non-existent label returns empty", () => {
      varStore.create("uwf/workflow/", hashA, {
        labels: ["pinned"],
      });

      const results = varStore.list({
        labels: ["nonexistent"],
      });

      expect(results).toEqual([]);
    });

    test("6.3: Multiple label filters use AND logic", () => {
      const var1 = varStore.create("uwf/thread/", hashA, {
        labels: ["experimental", "deprecated"],
      });
      varStore.create("uwf/thread/", hashB, {
        labels: ["experimental"],
      });

      const results = varStore.list({
        labels: ["experimental", "deprecated"],
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(var1.id);
    });
  });

  describe("Test Group 7: Query - Combined Filtering", () => {
    test("7.1: Scope + tag filter", () => {
      const var1 = varStore.create("uwf/thread/", hashA, {
        tags: { status: "completed" },
      });
      const var2 = varStore.create("uwf/thread/", hashB, {
        tags: { status: "completed" },
      });
      varStore.create("uwf/workflow/", hashC, {
        tags: { status: "completed" },
      });

      const results = varStore.list({
        scope: "uwf/thread/",
        tags: { status: "completed" },
      });

      expect(results).toHaveLength(2);
      expect(results.map((v) => v.id)).toContain(var1.id);
      expect(results.map((v) => v.id)).toContain(var2.id);
    });

    test("7.2: Scope + label filter", () => {
      const var1 = varStore.create("uwf/workflow/", hashA, {
        labels: ["pinned"],
      });
      varStore.create("uwf/thread/", hashB, {
        labels: ["pinned"],
      });

      const results = varStore.list({
        scope: "uwf/workflow/",
        labels: ["pinned"],
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(var1.id);
    });

    test("7.3: Scope + multiple filters", () => {
      const var1 = varStore.create("uwf/thread/", hashA, {
        tags: { status: "completed", priority: "high" },
      });
      varStore.create("uwf/thread/", hashB, {
        tags: { status: "completed" },
      });
      varStore.create("uwf/workflow/", hashC, {
        tags: { status: "completed", priority: "high" },
      });

      const results = varStore.list({
        scope: "uwf/",
        tags: { status: "completed", priority: "high" },
      });

      expect(results).toHaveLength(2);
      expect(results.map((v) => v.id)).toContain(var1.id);
    });

    test("7.4: Combined filters with no matches", () => {
      varStore.create("uwf/thread/", hashA, {
        tags: { status: "active" },
      });

      const results = varStore.list({
        scope: "app/",
        tags: { status: "completed" },
      });

      expect(results).toEqual([]);
    });
  });

  describe("Test Group 8: Edge Cases and Error Handling", () => {
    test("8.1: Tag operation on non-existent variable", () => {
      const fakeId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

      expect(() =>
        varStore.tag(fakeId, {
          add: { key: "value" },
        }),
      ).toThrow(VariableNotFoundError);
    });

    test("8.2: Special characters in tag keys/values", () => {
      const variable = varStore.create("uwf/thread/", hashA);

      const updated = varStore.tag(variable.id, {
        add: { "env:region": "prod-us_west.2" },
      });

      expect(updated.tags).toEqual({ "env:region": "prod-us_west.2" });
    });

    test("8.3: Unicode in tag/label names", () => {
      const variable = varStore.create("uwf/thread/", hashA);

      const updated = varStore.tag(variable.id, {
        add: { 语言: "中文" },
        addLabels: ["测试"],
      });

      expect(updated.tags).toEqual({ 语言: "中文" });
      expect(updated.labels).toContain("测试");

      // Verify persistence
      const retrieved = varStore.get(variable.id);
      expect(retrieved?.tags).toEqual({ 语言: "中文" });
      expect(retrieved?.labels).toContain("测试");
    });

    test("8.4: Empty tag key or value", () => {
      const variable = varStore.create("uwf/thread/", hashA);

      // Empty key
      const updated1 = varStore.tag(variable.id, {
        add: { "": "value" },
      });
      expect(updated1.tags).toEqual({ "": "value" });

      // Empty value
      const updated2 = varStore.tag(variable.id, {
        add: { key: "" },
      });
      expect(updated2.tags.key).toBe("");
    });

    test("8.5: Very long tag key/value", () => {
      const variable = varStore.create("uwf/thread/", hashA);
      const longKey = "k".repeat(1000);
      const longValue = "v".repeat(1000);

      const updated = varStore.tag(variable.id, {
        add: { [longKey]: longValue },
      });

      expect(updated.tags[longKey]).toBe(longValue);
    });
  });

  describe("Test Group 9: Database Integrity", () => {
    test("9.1: Cascade delete for tags", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active", workflow: "solve-issue" },
      });

      varStore.delete(variable.id);

      // Verify variable is deleted
      const retrieved = varStore.get(variable.id);
      expect(retrieved).toBeNull();
    });

    test("9.2: Cascade delete for labels", () => {
      const variable = varStore.create("uwf/workflow/", hashA, {
        labels: ["pinned", "archived"],
      });

      varStore.delete(variable.id);

      const retrieved = varStore.get(variable.id);
      expect(retrieved).toBeNull();
    });

    test("9.3: Tag update preserves other variable data", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active" },
      });

      varStore.tag(variable.id, {
        add: { priority: "high" },
      });

      const retrieved = varStore.get(variable.id);
      expect(retrieved?.id).toBe(variable.id);
      expect(retrieved?.scope).toBe(variable.scope);
      expect(retrieved?.value).toBe(variable.value);
      expect(retrieved?.schema).toBe(variable.schema);
      expect(retrieved?.created).toBe(variable.created);
    });
  });

  describe("Test Group 10: Batch Operations and Atomicity", () => {
    test("10.1: Atomic tag operations", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active", workflow: "solve-issue" },
      });

      const updated = varStore.tag(variable.id, {
        add: { priority: "low" },
        addLabels: ["archived"],
        delete: ["status"],
      });

      expect(updated.tags).toEqual({
        workflow: "solve-issue",
        priority: "low",
      });
      expect(updated.labels).toContain("archived");
    });

    test("10.2: Rollback on conflict error", () => {
      const variable = varStore.create("uwf/thread/", hashA, {
        tags: { workflow: "solve-issue" },
      });

      expect(() =>
        varStore.tag(variable.id, {
          add: { priority: "high" },
          addLabels: ["workflow"], // Conflict!
        }),
      ).toThrow(TagLabelConflictError);

      // Verify NO changes applied
      const retrieved = varStore.get(variable.id);
      expect(retrieved?.tags).toEqual({ workflow: "solve-issue" });
      expect(retrieved?.labels).toEqual([]);
    });
  });

  describe("Test Group 11: Integration Tests", () => {
    test("11.1: Full workflow with tags and labels", async () => {
      // Create with initial tags
      const var1 = varStore.create("uwf/thread/", hashA, {
        tags: { status: "active" },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Add more tags
      varStore.tag(var1.id, {
        add: { priority: "high", workflow: "solve-issue" },
      });

      // Add labels
      varStore.tag(var1.id, {
        addLabels: ["pinned"],
      });

      // Update variable value
      const updated = varStore.update(var1.id, hashB);

      // Verify tags/labels preserved
      expect(updated.tags).toEqual({
        status: "active",
        priority: "high",
        workflow: "solve-issue",
      });
      expect(updated.labels).toContain("pinned");

      // Delete variable
      varStore.delete(var1.id);

      // Verify deletion
      const retrieved = varStore.get(var1.id);
      expect(retrieved).toBeNull();
    });

    test("11.2: Query with complex filtering", () => {
      const var1 = varStore.create("uwf/thread/", hashA, {
        tags: { status: "completed", priority: "high" },
        labels: ["archived"],
      });
      varStore.create("uwf/thread/", hashB, {
        tags: { status: "completed", priority: "low" },
      });
      varStore.create("uwf/workflow/", hashC, {
        tags: { status: "completed", priority: "high" },
        labels: ["archived"],
      });

      const results = varStore.list({
        scope: "uwf/thread/",
        tags: { status: "completed", priority: "high" },
        labels: ["archived"],
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(var1.id);
    });
  });
});
