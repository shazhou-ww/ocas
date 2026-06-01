import { describe, expect, test } from "bun:test";
import { bootstrap } from "./bootstrap.js";
import type { JSONSchema } from "./schema.js";
import { getSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";

const OUTPUT_ALIASES = [
  "@ocas/output/put",
  "@ocas/output/get",
  "@ocas/output/has",
  "@ocas/output/hash",
  "@ocas/output/verify",
  "@ocas/output/refs",
  "@ocas/output/walk",
  "@ocas/output/list",
  "@ocas/output/list-meta",
  "@ocas/output/list-schema",
  "@ocas/output/var-set",
  "@ocas/output/var-get",
  "@ocas/output/var-delete",
  "@ocas/output/var-tag",
  "@ocas/output/var-list",
  "@ocas/output/template-set",
  "@ocas/output/template-get",
  "@ocas/output/template-list",
  "@ocas/output/template-delete",
  "@ocas/output/gc",
] as const;

// ──────────────────────────────────────────────────────────────────────────────
// Built-in Schema Registration Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("bootstrap - Built-in Schemas", () => {
  test("should return map of 29 built-in schema aliases to hashes", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    // Should return object with 9 primitive + 20 output aliases = 29
    expect(builtinSchemas).toHaveProperty("@ocas/schema");
    expect(builtinSchemas).toHaveProperty("@ocas/string");
    expect(builtinSchemas).toHaveProperty("@ocas/number");
    expect(builtinSchemas).toHaveProperty("@ocas/integer");
    expect(builtinSchemas).toHaveProperty("@ocas/boolean");
    expect(builtinSchemas).toHaveProperty("@ocas/bool");
    expect(builtinSchemas).toHaveProperty("@ocas/object");
    expect(builtinSchemas).toHaveProperty("@ocas/array");
    expect(builtinSchemas).toHaveProperty("@ocas/null");

    for (const alias of OUTPUT_ALIASES) {
      expect(builtinSchemas).toHaveProperty(alias);
    }

    expect(Object.keys(builtinSchemas)).toHaveLength(29);

    // All values should be valid hashes
    for (const [_alias, hash] of Object.entries(builtinSchemas)) {
      expect(typeof hash).toBe("string");
      expect(hash).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    }
  });

  test("should register @schema as meta-schema alias", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const metaHash = builtinSchemas["@ocas/schema"];
    if (!metaHash) throw new Error("@schema not found");

    const metaSchema = getSchema(store, metaHash);
    expect(metaSchema).not.toBeNull();
    expect(metaSchema?.type).toBe("object");
    expect(metaSchema?.description).toBe("ocas JSON Schema meta-schema");
  });

  test("should register @string schema correctly", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const stringHash = builtinSchemas["@ocas/string"];
    if (!stringHash) throw new Error("@string not found");

    const stringSchema = getSchema(store, stringHash);
    expect(stringSchema).toEqual({ type: "string" });
  });

  test("should register @number schema correctly", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const numberHash = builtinSchemas["@ocas/number"];
    if (!numberHash) throw new Error("@number not found");

    const numberSchema = getSchema(store, numberHash);
    expect(numberSchema).toEqual({ type: "number" });
  });

  test("should register @object schema correctly", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const objectHash = builtinSchemas["@ocas/object"];
    if (!objectHash) throw new Error("@object not found");

    const objectSchema = getSchema(store, objectHash);
    expect(objectSchema).toEqual({ type: "object" });
  });

  test("should register @array schema correctly", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const arrayHash = builtinSchemas["@ocas/array"];
    if (!arrayHash) throw new Error("@array not found");

    const arraySchema = getSchema(store, arrayHash);
    expect(arraySchema).toEqual({ type: "array" });
  });

  test("should register @ocas/bool schema correctly", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const boolHash = builtinSchemas["@ocas/bool"];
    if (!boolHash) throw new Error("@ocas/bool not found");

    const boolSchema = getSchema(store, boolHash);
    expect(boolSchema).toEqual({ type: "boolean" });
  });

  test("should return same hashes on repeated bootstrap calls", async () => {
    const store = createMemoryStore();
    const first = await bootstrap(store);
    const second = await bootstrap(store);

    expect(first).toEqual(second);

    // Verify each alias points to same hash
    expect(first["@ocas/string"]).toBe(second["@ocas/string"]);
    expect(first["@ocas/number"]).toBe(second["@ocas/number"]);
    expect(first["@ocas/object"]).toBe(second["@ocas/object"]);
    expect(first["@ocas/array"]).toBe(second["@ocas/array"]);
    expect(first["@ocas/bool"]).toBe(second["@ocas/bool"]);
    expect(first["@ocas/schema"]).toBe(second["@ocas/schema"]);
  });

  test("all built-in schemas should be typed by meta-schema", async () => {
    const store = createMemoryStore();
    const builtinSchemas = await bootstrap(store);

    const metaHash = builtinSchemas["@ocas/schema"];
    if (!metaHash) throw new Error("@schema not found");

    for (const [alias, hash] of Object.entries(builtinSchemas)) {
      if (alias === "@ocas/schema") continue; // meta-schema is self-typed

      const node = store.get(hash);
      expect(node).not.toBeNull();
      expect(node?.type).toBe(metaHash);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// @ocas/output/* Schema Registration Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("bootstrap - @ocas/output/* Schemas", () => {
  test("each @ocas/output/* schema has a title", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);

    for (const alias of OUTPUT_ALIASES) {
      const hash = aliases[alias];
      if (!hash) throw new Error(`${alias} not found`);

      const schema = getSchema(store, hash) as JSONSchema;
      expect(schema).not.toBeNull();
      expect(typeof schema.title).toBe("string");
      expect((schema.title as string).startsWith("ocas ")).toBe(true);
    }
  });

  test("@ocas/output/put schema describes a ocas_ref string", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const hash = aliases["@ocas/output/put"];
    if (!hash) throw new Error("@ocas/output/put not found");

    const schema = getSchema(store, hash);
    expect(schema).toEqual({
      type: "string",
      format: "ocas_ref",
      title: "ocas put result",
    });
  });

  test("@ocas/output/get schema describes object with type, payload, timestamp", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const hash = aliases["@ocas/output/get"];
    if (!hash) throw new Error("@ocas/output/get not found");

    const schema = getSchema(store, hash) as JSONSchema;
    expect(schema.type).toBe("object");
    expect(schema.title).toBe("ocas get result");

    const props = schema.properties as Record<string, JSONSchema>;
    expect(props.type).toEqual({ type: "string", format: "ocas_ref" });
    expect(props.payload).toEqual({});
    expect(props.timestamp).toEqual({ type: "number" });
  });

  test("@ocas/output/has schema describes a boolean", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const hash = aliases["@ocas/output/has"];
    if (!hash) throw new Error("@ocas/output/has not found");

    expect(getSchema(store, hash)).toEqual({
      type: "boolean",
      title: "ocas has result",
    });
  });

  test("@ocas/output/verify schema describes enum of ok|corrupted|invalid", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const hash = aliases["@ocas/output/verify"];
    if (!hash) throw new Error("@ocas/output/verify not found");

    const schema = getSchema(store, hash);
    expect(schema).toEqual({
      type: "string",
      enum: ["ok", "corrupted", "invalid"],
      title: "ocas verify result",
    });
  });

  test("@ocas/output/refs schema describes array of ocas_ref strings", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const hash = aliases["@ocas/output/refs"];
    if (!hash) throw new Error("@ocas/output/refs not found");

    expect(getSchema(store, hash)).toEqual({
      type: "array",
      items: { type: "string", format: "ocas_ref" },
      title: "ocas refs result",
    });
  });

  test("@ocas/output/gc schema describes object with gc stats fields", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const hash = aliases["@ocas/output/gc"];
    if (!hash) throw new Error("@ocas/output/gc not found");

    const schema = getSchema(store, hash) as JSONSchema;
    expect(schema.type).toBe("object");
    expect(schema.title).toBe("ocas gc result");

    const props = schema.properties as Record<string, JSONSchema>;
    expect(props.total).toEqual({ type: "number" });
    expect(props.reachable).toEqual({ type: "number" });
    expect(props.collected).toEqual({ type: "number" });
    expect(props.scanned).toEqual({ type: "number" });
  });

  test("@ocas/output/var-set schema describes a Variable object", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const hash = aliases["@ocas/output/var-set"];
    if (!hash) throw new Error("@ocas/output/var-set not found");

    const schema = getSchema(store, hash) as JSONSchema;
    expect(schema.type).toBe("object");
    expect(schema.title).toBe("ocas var set result");

    const props = schema.properties as Record<string, JSONSchema>;
    expect(props.name).toEqual({ type: "string" });
    expect(props.schema).toEqual({ type: "string", format: "ocas_ref" });
    expect(props.value).toEqual({ type: "string", format: "ocas_ref" });
  });

  test("@ocas/output/var-list schema describes array of Variable objects", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const hash = aliases["@ocas/output/var-list"];
    if (!hash) throw new Error("@ocas/output/var-list not found");

    const schema = getSchema(store, hash) as JSONSchema;
    expect(schema.type).toBe("array");
    expect(schema.title).toBe("ocas var list result");

    const items = schema.items as JSONSchema;
    expect(items.type).toBe("object");
    const props = items.properties as Record<string, JSONSchema>;
    expect(props.name).toEqual({ type: "string" });
  });

  test("@ocas/output/template-delete schema describes object with deleted boolean", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const hash = aliases["@ocas/output/template-delete"];
    if (!hash) throw new Error("@ocas/output/template-delete not found");

    expect(getSchema(store, hash)).toEqual({
      type: "object",
      properties: { deleted: { type: "boolean" } },
      title: "ocas template delete result",
    });
  });

  test("all @ocas/output/* schemas are distinct hashes", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);

    const outputHashes = OUTPUT_ALIASES.map((alias) => aliases[alias]);
    const uniqueHashes = new Set(outputHashes);
    expect(uniqueHashes.size).toBe(OUTPUT_ALIASES.length);
  });
});

describe("bootstrap - meta and schemas indexes (D1)", () => {
  test("listMeta contains the bootstrap meta-schema hash", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const metaHash = aliases["@ocas/schema"];
    expect(store.listMeta()).toContain(metaHash as string);
  });

  test("listSchemas contains meta-schema and all built-in schemas", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);
    const schemas = store.listSchemas();

    for (const [, hash] of Object.entries(aliases)) {
      expect(schemas).toContain(hash);
    }
    expect(schemas.length).toBeGreaterThanOrEqual(6);
  });
});
