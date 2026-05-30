import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "./store.js";
import type { Store } from "./types.js";
import {
  CasNodeNotFoundError,
  InvalidScopeError,
  SchemaMismatchError,
  VariableNotFoundError,
  VariableStore,
} from "./variable-store.js";

describe("VariableStore", () => {
  let store: Store;
  let varStore: VariableStore;
  let dbPath: string;
  let schemaA: string;
  let schemaB: string;
  let hashA: string;
  let hashB: string;
  let hashC: string;

  beforeEach(async () => {
    // Create a temporary database
    dbPath = join(tmpdir(), `test-variables-${Date.now()}.db`);

    // Create a CAS store with test data
    store = createMemoryStore();

    // Create two different schemas
    schemaA = await store.put("BOOTSTRAPHASH", {
      type: "object",
      properties: { name: { type: "string" } },
    });
    schemaB = await store.put("BOOTSTRAPHASH", {
      type: "object",
      properties: { count: { type: "number" } },
    });

    // Create CAS nodes with different schemas
    hashA = await store.put(schemaA, { name: "hello" });
    hashB = await store.put(schemaA, { name: "world" });
    hashC = await store.put(schemaB, { count: 42 });

    // Create variable store
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

  describe("Test Group 1: Variable Creation", () => {
    test("1.1: Create variable with valid scope", () => {
      const variable = varStore.create("uwf/thread/", hashA);

      expect(variable.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(variable.scope).toBe("uwf/thread/");
      expect(variable.value).toBe(hashA);
      expect(variable.schema).toBe(schemaA);
      expect(variable.created).toBeGreaterThan(Date.now() - 5000);
      expect(variable.created).toBeLessThanOrEqual(Date.now());
      expect(variable.updated).toBe(variable.created);

      // Verify persistence
      const retrieved = varStore.get(variable.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(variable.id);
      expect(retrieved?.scope).toBe(variable.scope);
      expect(retrieved?.value).toBe(variable.value);
    });

    test("1.2: Create variable fails with scope not ending in /", () => {
      expect(() => varStore.create("uwf/thread", hashA)).toThrow(
        InvalidScopeError,
      );
      expect(() => varStore.create("uwf/thread", hashA)).toThrow(
        "scope must end with /",
      );
    });

    test("1.3: Create variable fails with non-existent CAS node", () => {
      const fakeHash = "FAKEHASH00000";
      expect(() => varStore.create("uwf/", fakeHash)).toThrow(
        CasNodeNotFoundError,
      );
      expect(() => varStore.create("uwf/", fakeHash)).toThrow(
        `CAS node not found: ${fakeHash}`,
      );
    });
  });

  describe("Test Group 2: Variable Retrieval", () => {
    test("2.1: Get existing variable", () => {
      const created = varStore.create("uwf/thread/", hashA);
      const retrieved = varStore.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.scope).toBe("uwf/thread/");
      expect(retrieved?.value).toBe(hashA);
      expect(retrieved?.schema).toBe(schemaA);
      expect(retrieved?.created).toBe(created.created);
      expect(retrieved?.updated).toBe(created.updated);
    });

    test("2.2: Get non-existent variable", () => {
      const fakeId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
      const result = varStore.get(fakeId);

      expect(result).toBeNull();
    });
  });

  describe("Test Group 3: Variable Update (Schema Consistent)", () => {
    test("3.1: Update variable with matching schema", async () => {
      const created = varStore.create("uwf/thread/", hashA);
      const t1 = created.created;

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = varStore.update(created.id, hashB);

      expect(updated.id).toBe(created.id);
      expect(updated.scope).toBe("uwf/thread/");
      expect(updated.value).toBe(hashB);
      expect(updated.schema).toBe(schemaA);
      expect(updated.created).toBe(t1);
      expect(updated.updated).toBeGreaterThan(t1);
      expect(updated.updated).toBeGreaterThan(Date.now() - 5000);
      expect(updated.updated).toBeLessThanOrEqual(Date.now());

      // Verify persistence
      const retrieved = varStore.get(created.id);
      expect(retrieved?.value).toBe(hashB);
      expect(retrieved?.updated).toBe(updated.updated);
    });

    test("3.2: Update variable to same value is idempotent", () => {
      const created = varStore.create("uwf/thread/", hashA);
      const updated = varStore.update(created.id, hashA);

      expect(updated.value).toBe(hashA);
      expect(updated.schema).toBe(schemaA);
      // Updated timestamp may change, this is implementation-defined
    });
  });

  describe("Test Group 4: Variable Update (Schema Mismatch)", () => {
    test("4.1: Update variable fails with schema mismatch", () => {
      const created = varStore.create("uwf/thread/", hashA);

      expect(() => varStore.update(created.id, hashC)).toThrow(
        SchemaMismatchError,
      );

      const error = (() => {
        try {
          varStore.update(created.id, hashC);
          return null;
        } catch (e) {
          return e as SchemaMismatchError;
        }
      })();

      expect(error).not.toBeNull();
      expect(error?.expected).toBe(schemaA);
      expect(error?.actual).toBe(schemaB);
      expect(error?.message.toLowerCase()).toContain("schema mismatch");

      // Verify variable is unchanged
      const retrieved = varStore.get(created.id);
      expect(retrieved?.value).toBe(hashA);
    });

    test("4.2: Update variable fails with non-existent CAS node", () => {
      const created = varStore.create("uwf/thread/", hashA);
      const fakeHash = "FAKEHASH00000";

      expect(() => varStore.update(created.id, fakeHash)).toThrow(
        CasNodeNotFoundError,
      );
    });

    test("4.3: Update non-existent variable", () => {
      const fakeId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

      expect(() => varStore.update(fakeId, hashA)).toThrow(
        VariableNotFoundError,
      );
      expect(() => varStore.update(fakeId, hashA)).toThrow(
        `Variable not found: ${fakeId}`,
      );
    });
  });

  describe("Test Group 5: Variable Deletion", () => {
    test("5.1: Delete existing variable", () => {
      const created = varStore.create("uwf/thread/", hashA);
      const deleted = varStore.delete(created.id);

      expect(deleted.id).toBe(created.id);
      expect(deleted.scope).toBe(created.scope);
      expect(deleted.value).toBe(created.value);
      expect(deleted.schema).toBe(created.schema);

      // Verify it's removed from database
      const retrieved = varStore.get(created.id);
      expect(retrieved).toBeNull();
    });

    test("5.2: Get deleted variable", () => {
      const created = varStore.create("uwf/thread/", hashA);
      varStore.delete(created.id);

      const retrieved = varStore.get(created.id);
      expect(retrieved).toBeNull();
    });

    test("5.3: Delete non-existent variable", () => {
      const fakeId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

      expect(() => varStore.delete(fakeId)).toThrow(VariableNotFoundError);
      expect(() => varStore.delete(fakeId)).toThrow(
        `Variable not found: ${fakeId}`,
      );
    });
  });

  describe("Test Group 7: Integration Tests", () => {
    test("7.1: Full lifecycle workflow", async () => {
      // Create variable
      const var1 = varStore.create("uwf/thread/", hashA);
      expect(var1.value).toBe(hashA);

      // Get variable
      const retrieved1 = varStore.get(var1.id);
      expect(retrieved1?.value).toBe(hashA);

      // Wait to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update variable
      const updated = varStore.update(var1.id, hashB);
      expect(updated.value).toBe(hashB);
      expect(updated.updated).toBeGreaterThan(var1.created);

      // Get updated variable
      const retrieved2 = varStore.get(var1.id);
      expect(retrieved2?.value).toBe(hashB);

      // Delete variable
      const deleted = varStore.delete(var1.id);
      expect(deleted.value).toBe(hashB);

      // Verify deletion
      const retrieved3 = varStore.get(var1.id);
      expect(retrieved3).toBeNull();
    });

    test("7.2: Multiple variables with same scope", () => {
      const var1 = varStore.create("uwf/thread/", hashA);
      const var2 = varStore.create("uwf/thread/", hashB);

      // Verify independence
      expect(var1.id).not.toBe(var2.id);

      const retrieved1 = varStore.get(var1.id);
      const retrieved2 = varStore.get(var2.id);

      expect(retrieved1?.value).toBe(hashA);
      expect(retrieved2?.value).toBe(hashB);

      // Update var1, verify var2 is unaffected
      varStore.update(var1.id, hashB);
      const retrieved2After = varStore.get(var2.id);
      expect(retrieved2After?.value).toBe(hashB);
      expect(retrieved2After?.updated).toBe(var2.updated);

      // Delete var1, verify var2 still exists
      varStore.delete(var1.id);
      const retrieved2Final = varStore.get(var2.id);
      expect(retrieved2Final).not.toBeNull();
      expect(retrieved2Final?.value).toBe(hashB);
    });

    test("7.3: Variables with hierarchical scopes", () => {
      const var1 = varStore.create("uwf/", hashA);
      const var2 = varStore.create("uwf/thread/", hashA);
      const var3 = varStore.create("uwf/workflow/", hashA);

      expect(var1.scope).toBe("uwf/");
      expect(var2.scope).toBe("uwf/thread/");
      expect(var3.scope).toBe("uwf/workflow/");

      // All should exist independently
      expect(varStore.get(var1.id)).not.toBeNull();
      expect(varStore.get(var2.id)).not.toBeNull();
      expect(varStore.get(var3.id)).not.toBeNull();
    });
  });
});
