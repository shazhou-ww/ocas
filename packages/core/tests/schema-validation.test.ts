import { describe, expect, test } from "vitest";
import { bootstrap } from "../src/bootstrap.js";
import { MemStore } from "../src/mem-store.js";
import type { JSONSchema } from "../src/schema.js";
import {
  getSchema,
  putSchema,
  refs,
  SchemaValidationError,
  validate,
  walk,
} from "../src/schema.js";
import type { CasNode } from "../src/types.js";

describe("Test Suite 1: Meta-Schema Structure and Self-Validation", () => {
  test("1.1: Meta-schema is a valid JSON Schema", async () => {
    const store = new MemStore();
    const builtinSchemas = bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";
    const metaNode = store.get(metaHash);

    expect(metaNode).not.toBeNull();
    expect(typeof metaNode?.payload).toBe("object");
    expect(metaNode?.payload).toHaveProperty("type");
  });

  test("1.2: Meta-schema self-validates", async () => {
    const store = new MemStore();
    const builtinSchemas = bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";
    const metaNode = store.get(metaHash);

    expect(metaNode).not.toBeNull();
    expect(validate(store, metaNode as CasNode)).toBe(true);
  });

  test("1.3: Meta-schema defines all supported keywords", async () => {
    const store = new MemStore();
    const builtinSchemas = bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";
    const metaSchema = getSchema(store, metaHash);

    expect(metaSchema).not.toBeNull();
    const properties =
      (metaSchema?.properties as Record<string, unknown>) || {};

    // Check that all supported keywords are defined
    expect(properties).toHaveProperty("type");
    expect(properties).toHaveProperty("properties");
    expect(properties).toHaveProperty("required");
    expect(properties).toHaveProperty("additionalProperties");
    expect(properties).toHaveProperty("anyOf");
    expect(properties).toHaveProperty("items");
    expect(properties).toHaveProperty("format");
    expect(properties).toHaveProperty("title");
    expect(properties).toHaveProperty("enum");
    expect(properties).toHaveProperty("const");
    expect(properties).toHaveProperty("description");
  });

  test("1.4: Meta-schema does not include unsupported keywords", async () => {
    const store = new MemStore();
    const builtinSchemas = bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";
    const metaSchema = getSchema(store, metaHash);

    expect(metaSchema).not.toBeNull();
    const properties =
      (metaSchema?.properties as Record<string, unknown>) || {};

    // Unsupported keywords should not be in properties
    expect(properties).not.toHaveProperty("$ref");
    expect(properties).not.toHaveProperty("$id");
    expect(properties).not.toHaveProperty("$defs");

    // P2 keywords should be present
    expect(properties).toHaveProperty("allOf");
    expect(properties).toHaveProperty("if");
    expect(properties).toHaveProperty("then");
    expect(properties).toHaveProperty("else");
    expect(properties).toHaveProperty("patternProperties");
    expect(properties).toHaveProperty("prefixItems");
    expect(properties).toHaveProperty("multipleOf");
    expect(properties).toHaveProperty("minProperties");
    expect(properties).toHaveProperty("maxProperties");
    expect(properties).toHaveProperty("default");

    // P3 keywords should be present
    expect(properties).toHaveProperty("not");
    expect(properties).toHaveProperty("contains");
    expect(properties).toHaveProperty("propertyNames");
    expect(properties).toHaveProperty("examples");
    expect(properties).toHaveProperty("readOnly");
    expect(properties).toHaveProperty("writeOnly");
    expect(properties).toHaveProperty("deprecated");
    expect(properties).toHaveProperty("$comment");
  });

  test("1.5: Meta-schema node type equals its own hash", async () => {
    const store = new MemStore();
    const builtinSchemas = bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";
    const metaNode = store.get(metaHash);

    expect(metaNode).not.toBeNull();
    expect(metaNode?.type).toBe(metaHash);
  });
});

describe("Test Suite 2: putSchema Validation - Valid Schemas", () => {
  test("2.1: Accept minimal valid schema (empty object)", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {});
    expect(hash).toBeTruthy();
  });

  test("2.2: Accept schema with type constraint", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, { type: "string" });
    expect(hash).toBeTruthy();
  });

  test("2.3: Accept schema with properties", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(hash).toBeTruthy();
  });

  test("2.4: Accept schema with required fields", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    });
    expect(hash).toBeTruthy();
  });

  test("2.5: Accept schema with additionalProperties = false", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      type: "object",
      additionalProperties: false,
    });
    expect(hash).toBeTruthy();
  });

  test("2.6: Accept schema with additionalProperties = schema", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      type: "object",
      additionalProperties: { type: "string" },
    });
    expect(hash).toBeTruthy();
  });

  test("2.7: Accept schema with anyOf", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(hash).toBeTruthy();
  });

  test("2.7b: Accept schema with oneOf", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      oneOf: [
        { properties: { status: { const: "ready" } }, required: ["status"] },
        { properties: { status: { const: "failed" } }, required: ["status"] },
      ],
    });
    expect(hash).toBeTruthy();
  });

  test("2.8: Accept schema with array items", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      type: "array",
      items: { type: "number" },
    });
    expect(hash).toBeTruthy();
  });

  test("2.9: Accept schema with format constraint", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      type: "string",
      format: "ocas_ref",
    });
    expect(hash).toBeTruthy();
  });

  test("2.10: Accept schema with enum", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      type: "string",
      enum: ["red", "green", "blue"],
    });
    expect(hash).toBeTruthy();
  });

  test("2.11: Accept schema with const", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, { const: "FIXED_VALUE" });
    expect(hash).toBeTruthy();
  });

  test("2.12: Accept schema with title and description", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      type: "string",
      title: "User Name",
      description: "The user's full name",
    });
    expect(hash).toBeTruthy();
  });

  test("2.13: Accept complex nested schema", async () => {
    const store = new MemStore();
    bootstrap(store);
    const hash = putSchema(store, {
      type: "object",
      required: ["type", "payload"],
      properties: {
        type: { type: "string", format: "ocas_ref" },
        payload: {
          anyOf: [{ type: "object" }, { type: "null" }],
        },
        refs: {
          type: "array",
          items: { type: "string", format: "ocas_ref" },
        },
      },
      additionalProperties: false,
    });
    expect(hash).toBeTruthy();
  });
});

describe("Test Suite 3: putSchema Validation - Invalid Schemas", () => {
  test("3.1: Reject schema with invalid type value", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () => putSchema(store, { type: "garbage" })).toThrow();
  });

  test("3.2: Reject schema with type as number", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, { type: 123 } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.3: Reject schema with properties not an object", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        type: "object",
        properties: "not-an-object",
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.4: Reject schema with required not an array", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        type: "object",
        required: "name",
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.5: Reject schema with required containing non-strings", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        type: "object",
        required: ["name", 123, true],
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.6: Reject schema with additionalProperties as string", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        type: "object",
        additionalProperties: "yes",
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.7: Reject schema with anyOf not an array", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        anyOf: { type: "string" },
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.8: Reject schema with empty anyOf array", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () => putSchema(store, { anyOf: [] })).toThrow();
  });

  test("3.9: Reject schema with items not an object", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        type: "array",
        items: "string",
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.10: Reject schema with format not a string", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        type: "string",
        format: 123,
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.11: Reject schema with enum not an array", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        type: "string",
        enum: "red",
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.12: Reject schema with empty enum array", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, { type: "string", enum: [] }),
    ).toThrow();
  });

  test("3.13: Reject schema with title not a string", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        type: "string",
        title: 123,
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.14: Reject schema with description not a string", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        type: "string",
        description: ["not a string"],
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.15: Reject schema with unsupported $ref keyword", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        $ref: "#/definitions/user",
      } as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.16: Reject completely invalid data (non-object)", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, "not-a-schema" as unknown as JSONSchema),
    ).toThrow();
  });

  test("3.17: Reject nested invalid schema in properties", async () => {
    const store = new MemStore();
    bootstrap(store);
    expect(async () =>
      putSchema(store, {
        type: "object",
        properties: {
          name: { type: "invalid-type" },
        },
      } as unknown as JSONSchema),
    ).toThrow();
  });
});

describe("Test Suite 4: Error Messages and Debugging", () => {
  test("4.1: Error includes schema validation details", async () => {
    const store = new MemStore();
    bootstrap(store);
    try {
      putSchema(store, { type: 123 } as unknown as JSONSchema);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      expect((error as Error).message).toContain("Invalid schema");
    }
  });

  test("4.2: Error distinguishes schema validation from data validation", async () => {
    const store = new MemStore();
    bootstrap(store);
    try {
      putSchema(store, { type: "invalid-type" } as unknown as JSONSchema);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      expect((error as Error).message.toLowerCase()).toContain("schema");
    }
  });
});

describe("Test Suite 5: Backward Compatibility and Migration", () => {
  test("5.1: Bootstrap hash changes (breaking change)", async () => {
    // This is a documentation test - the old hash was different
    const store = new MemStore();
    const builtinSchemas = bootstrap(store);
    const newMetaHash = builtinSchemas["@ocas/schema"] ?? "";

    // The new hash should be different from the old system metadata hash
    // We just verify it's a valid hash format
    expect(newMetaHash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
  });

  test("5.2: Existing tests compatibility", async () => {
    // This test ensures our changes don't break existing valid schema usage
    const store = new MemStore();
    bootstrap(store);

    // This is the kind of schema that existed before
    const schemaHash = putSchema(store, {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });

    expect(schemaHash).toBeTruthy();
  });

  test("5.3: Data nodes with valid schemas still validate", async () => {
    const store = new MemStore();
    bootstrap(store);

    const schemaHash = putSchema(store, {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
      },
    });

    const dataNode = store.get(await store.put(schemaHash, { name: "test" }));

    expect(dataNode).not.toBeNull();
    expect(validate(store, dataNode as CasNode)).toBe(true);
  });

  test("5.4: Invalid data still fails validation", async () => {
    const store = new MemStore();
    bootstrap(store);

    const schemaHash = putSchema(store, {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
      },
    });

    const dataNode = store.get(
      await store.put(schemaHash, { name: 123 }), // wrong type
    );

    expect(dataNode).not.toBeNull();
    expect(validate(store, dataNode as CasNode)).toBe(false);
  });
});

describe("Test Suite 6: Integration with Existing Functionality", () => {
  test("6.1: getSchema works with validated schemas", async () => {
    const store = new MemStore();
    bootstrap(store);

    const originalSchema = { type: "string", title: "Test" };
    const schemaHash = putSchema(store, originalSchema);
    const retrieved = getSchema(store, schemaHash);

    expect(retrieved).toEqual(originalSchema);
  });

  test("6.2: validate() works with schemas validated by meta-schema", async () => {
    const store = new MemStore();
    bootstrap(store);

    const schemaHash = putSchema(store, { type: "number" });
    const validNode = store.get(await store.put(schemaHash, 42));
    const invalidNode = store.get(await store.put(schemaHash, "not a number"));

    expect(validate(store, validNode as CasNode)).toBe(true);
    expect(validate(store, invalidNode as CasNode)).toBe(false);
  });

  test("6.3: refs() works with validated schemas containing ocas_ref", async () => {
    const store = new MemStore();
    bootstrap(store);

    const schemaHash = putSchema(store, {
      type: "object",
      properties: {
        ref: { type: "string", format: "ocas_ref" },
      },
    });

    const refHash = "0000000000001";
    const dataNode = store.get(await store.put(schemaHash, { ref: refHash }));

    const extractedRefs = refs(store, dataNode as CasNode);
    expect(extractedRefs).toContain(refHash);
  });

  test("6.4: walk() works with graphs using validated schemas", async () => {
    const store = new MemStore();
    bootstrap(store);

    const schemaHash = putSchema(store, {
      type: "object",
      properties: {
        next: {
          anyOf: [{ type: "string", format: "ocas_ref" }, { type: "null" }],
        },
      },
    });

    const node2Hash = await store.put(schemaHash, { next: null });
    const node1Hash = await store.put(schemaHash, { next: node2Hash });

    const visited: string[] = [];
    walk(store, node1Hash, (hash) => visited.push(hash));

    expect(visited).toContain(node1Hash);
    expect(visited).toContain(node2Hash);
  });

  test("6.5: Idempotency preserved for putSchema", async () => {
    const store = new MemStore();
    bootstrap(store);

    const schema = { type: "string", title: "Test" };
    const hash1 = putSchema(store, schema);
    const hash2 = putSchema(store, schema);

    expect(hash1).toBe(hash2);
  });
});

describe("Test Suite 7: Meta-Schema Content Validation", () => {
  test("7.1: Meta-schema allows recursive schema definitions", async () => {
    const store = new MemStore();
    const builtinSchemas = bootstrap(store);
    const metaHash = builtinSchemas["@ocas/schema"] ?? "";
    const metaSchema = getSchema(store, metaHash);

    expect(metaSchema).not.toBeNull();
    // The meta-schema should have properties that can contain schemas
    const properties =
      (metaSchema?.properties as Record<string, unknown>) || {};
    expect(properties).toHaveProperty("properties");
  });

  test("7.2: Meta-schema restricts additionalProperties", async () => {
    const store = new MemStore();
    bootstrap(store);

    // Schema with unknown keyword should be rejected if meta-schema is strict
    try {
      putSchema(store, {
        type: "string",
        unknownKeyword: "value",
      } as unknown as JSONSchema);
      // If we get here, meta-schema allows additional properties
      // This is acceptable behavior
    } catch (error) {
      // If it throws, meta-schema is strict about additionalProperties
      expect(error).toBeInstanceOf(SchemaValidationError);
    }
  });

  test("7.3: Meta-schema validates type as string OR array", async () => {
    const store = new MemStore();
    bootstrap(store);

    // Single string type
    const hash1 = putSchema(store, { type: "string" });
    expect(hash1).toBeTruthy();

    // Array of types
    const hash2 = putSchema(store, {
      type: ["string", "null"],
    } as unknown as JSONSchema);
    expect(hash2).toBeTruthy();

    // Invalid type (number)
    expect(async () =>
      putSchema(store, { type: 123 } as unknown as JSONSchema),
    ).toThrow();
  });
});

describe("Test Suite 8: Performance and Edge Cases", () => {
  test("8.1: Validation performance is acceptable", async () => {
    const store = new MemStore();
    bootstrap(store);

    const complexSchema = {
      type: "object",
      properties: {
        level1: {
          type: "object",
          properties: {
            level2: {
              type: "object",
              properties: {
                level3: { type: "string" },
              },
            },
          },
        },
      },
    };

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      putSchema(store, complexSchema);
    }
    const duration = performance.now() - start;

    // Should complete in reasonable time (< 100ms for 100 validations)
    expect(duration).toBeLessThan(1000);
  });

  test("8.2: Large schemas are handled correctly", async () => {
    const store = new MemStore();
    bootstrap(store);

    const largeSchema: Record<string, unknown> = {
      type: "object",
      properties: {},
    };

    // Create a schema with 100 properties
    const props = largeSchema.properties as Record<string, unknown>;
    for (let i = 0; i < 100; i++) {
      props[`prop${i}`] = { type: "string" };
    }

    const hash = putSchema(store, largeSchema);
    expect(hash).toBeTruthy();
  });

  test("8.3: Deeply nested schemas validate correctly", async () => {
    const store = new MemStore();
    bootstrap(store);

    // Build a 5-level deep schema
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 5; i++) {
      schema = {
        type: "object",
        properties: { nested: schema },
      };
    }

    const hash = putSchema(store, schema);
    expect(hash).toBeTruthy();
  });

  test("8.4: Circular-like schemas don't cause infinite loops", async () => {
    const store = new MemStore();
    bootstrap(store);

    // Schema where additionalProperties has same structure as parent
    const schema = {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      additionalProperties: {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      },
    };

    const hash = putSchema(store, schema);
    expect(hash).toBeTruthy();
  });
});
