import { describe, expect, test } from "bun:test";
import { bootstrap } from "./bootstrap.js";
import { getSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";

// ──────────────────────────────────────────────────────────────────────────────
// Built-in Schema Registration Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("bootstrap - Built-in Schemas", () => {
  test("should return map of built-in schema aliases to hashes", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    // Should return object with 6 aliases
    expect(builtinSchemas).toHaveProperty("@schema");
    expect(builtinSchemas).toHaveProperty("@string");
    expect(builtinSchemas).toHaveProperty("@number");
    expect(builtinSchemas).toHaveProperty("@object");
    expect(builtinSchemas).toHaveProperty("@array");
    expect(builtinSchemas).toHaveProperty("@bool");

    // All values should be valid hashes
    for (const [_alias, hash] of Object.entries(builtinSchemas)) {
      expect(typeof hash).toBe("string");
      expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    }
  });

  test("should register @schema as meta-schema alias", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const metaHash = builtinSchemas["@schema"];
    if (!metaHash) throw new Error("@schema not found");

    const metaSchema = getSchema(store, metaHash);
    expect(metaSchema).not.toBeNull();
    expect(metaSchema?.type).toBe("object");
    expect(metaSchema?.description).toBe("json-cas JSON Schema meta-schema");
  });

  test("should register @string schema correctly", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const stringHash = builtinSchemas["@string"];
    if (!stringHash) throw new Error("@string not found");

    const stringSchema = getSchema(store, stringHash);
    expect(stringSchema).toEqual({ type: "string" });
  });

  test("should register @number schema correctly", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const numberHash = builtinSchemas["@number"];
    if (!numberHash) throw new Error("@number not found");

    const numberSchema = getSchema(store, numberHash);
    expect(numberSchema).toEqual({ type: "number" });
  });

  test("should register @object schema correctly", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const objectHash = builtinSchemas["@object"];
    if (!objectHash) throw new Error("@object not found");

    const objectSchema = getSchema(store, objectHash);
    expect(objectSchema).toEqual({ type: "object" });
  });

  test("should register @array schema correctly", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const arrayHash = builtinSchemas["@array"];
    if (!arrayHash) throw new Error("@array not found");

    const arraySchema = getSchema(store, arrayHash);
    expect(arraySchema).toEqual({ type: "array" });
  });

  test("should register @bool schema correctly", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const boolHash = builtinSchemas["@bool"];
    if (!boolHash) throw new Error("@bool not found");

    const boolSchema = getSchema(store, boolHash);
    expect(boolSchema).toEqual({ type: "boolean" });
  });

  test("should return same hashes on repeated bootstrap calls", async () => {
    const store = createMemoryStore();
    const first = await bootstrap(store);
    const second = await bootstrap(store);

    expect(first).toEqual(second);

    // Verify each alias points to same hash
    expect(first["@string"]).toBe(second["@string"]);
    expect(first["@number"]).toBe(second["@number"]);
    expect(first["@object"]).toBe(second["@object"]);
    expect(first["@array"]).toBe(second["@array"]);
    expect(first["@bool"]).toBe(second["@bool"]);
    expect(first["@schema"]).toBe(second["@schema"]);
  });

  test("all built-in schemas should be typed by meta-schema", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const metaHash = builtinSchemas["@schema"];
    if (!metaHash) throw new Error("@schema not found");

    for (const [alias, hash] of Object.entries(builtinSchemas)) {
      if (alias === "@schema") continue; // meta-schema is self-typed

      const node = store.get(hash);
      expect(node).not.toBeNull();
      expect(node?.type).toBe(metaHash);
    }
  });
});
