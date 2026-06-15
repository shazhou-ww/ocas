import { describe, expect, test } from "vitest";
import { bootstrap } from "./bootstrap.js";
import { registerOutputTemplates } from "./output-templates.js";
import { renderAsync, renderDirectAsync } from "./render.js";
import { putSchema } from "./schema.js";
import { createMemoryStore } from "./store.js";
import type { Hash } from "./types.js";

describe("renderDirectAsync — object-valued envelope rendering with templates", () => {
  test("uses text template when one exists for the type", async () => {
    // Spec: render-pipe-object-uses-template
    const store = createMemoryStore();
    bootstrap(store);
    await registerOutputTemplates(store);

    // Get the gc output schema hash
    const aliases = bootstrap(store);
    const gcTypeHash = aliases["@ocas/output/gc"];
    if (!gcTypeHash) throw new Error("@ocas/output/gc not found");

    const gcValue = { total: 10, reachable: 8, collected: 2, scanned: 10 };

    const output = await renderDirectAsync(gcTypeHash, gcValue, store, {});

    // Should use the text template, not YAML
    expect(output).toContain("total: 10");
    expect(output).toContain("reachable: 8");
    expect(output).toContain("collected: 2");
    expect(output).toContain("scanned: 10");
    // Should NOT be raw YAML with nested object format
    expect(output).not.toContain("{");
  });

  test("respects --format html with object-valued envelopes", async () => {
    // Spec: render-pipe-object-respects-format
    const store = createMemoryStore();
    bootstrap(store);
    await registerOutputTemplates(store);

    const aliases = bootstrap(store);
    const gcTypeHash = aliases["@ocas/output/gc"];
    if (!gcTypeHash) throw new Error("@ocas/output/gc not found");

    const gcValue = { total: 5, reachable: 3, collected: 2, scanned: 5 };

    const output = await renderDirectAsync(gcTypeHash, gcValue, store, {
      format: "html",
    });

    // Should use HTML template (new card layout)
    expect(output).toContain('<div class="ocas-card">');
    expect(output).toContain("Garbage Collection");
    expect(output).toContain('class="ocas-stats-grid"');
    // Compose phase should apply builtin HTML shell
    expect(output).toContain("<!DOCTYPE html>");
    expect(output).toContain("<head>");
    expect(output).toContain("<body>");
    // Static CSS should be included
    expect(output).toContain("<style>");
    expect(output).toContain(".ocas-card");
  });

  test("falls back to YAML when no template exists (text format)", async () => {
    // Spec: render-pipe-object-fallback-no-template
    const store = createMemoryStore();
    bootstrap(store);
    // Do NOT register output templates — no template for this type

    // Create a custom schema with no template
    const customSchema = putSchema(store, {
      type: "object",
      properties: {
        foo: { type: "string" },
        count: { type: "number" },
      },
    });

    const value = { foo: "bar", count: 42 };

    const output = await renderDirectAsync(customSchema, value, store, {});

    // Should fall back to YAML
    expect(output).toContain("foo: bar");
    expect(output).toContain("count: 42");
  });

  test("falls back to structured HTML with HTML shell when no html template", async () => {
    // Spec: render-pipe-object-html-fallback-no-template
    const store = createMemoryStore();
    bootstrap(store);
    // Do NOT register output templates

    const customSchema = putSchema(store, {
      type: "object",
      properties: {
        key: { type: "string" },
      },
    });

    const value = { key: "value" };

    const output = await renderDirectAsync(customSchema, value, store, {
      format: "html",
    });

    // Should be a complete HTML document
    expect(output).toContain("<!DOCTYPE html>");
    expect(output).toContain("<head>");
    expect(output).toContain("<body>");
    // Should use structured HTML, not <pre><code> YAML
    expect(output).toContain("<ul");
    expect(output).toContain("key");
    expect(output).toContain("value");
    expect(output).not.toContain("<pre><code>");
  });

  test("hash-valued envelope still uses renderAsync (backward compat)", async () => {
    // Spec: render-pipe-hash-value-unchanged
    const store = createMemoryStore();
    bootstrap(store);
    await registerOutputTemplates(store);

    // Create a real CAS node
    const schema = putSchema(store, {
      type: "object",
      properties: { name: { type: "string" } },
    });
    const hash = store.cas.put(schema, { name: "test-node" });

    // renderAsync should still work for stored hashes
    const output = await renderAsync(store, hash, { format: "text" });

    expect(output).toContain("name");
    expect(output).toContain("test-node");
  });

  test("resolution/decay/epsilon options are respected", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    await registerOutputTemplates(store);

    const aliases = bootstrap(store);
    const gcTypeHash = aliases["@ocas/output/gc"];
    if (!gcTypeHash) throw new Error("@ocas/output/gc not found");

    const gcValue = { total: 10, reachable: 8, collected: 2, scanned: 10 };

    // Should not throw with custom resolution/decay/epsilon
    const output = await renderDirectAsync(gcTypeHash, gcValue, store, {
      resolution: 0.8,
      decay: 0.7,
      epsilon: 0.05,
    });

    expect(output).toContain("total: 10");
  });

  test("null store returns YAML fallback", async () => {
    const store = createMemoryStore();
    bootstrap(store);

    const fakeHash = "ZZZZZZZZZZZZZ" as Hash;
    const value = { test: "data" };

    const output = await renderDirectAsync(fakeHash, value, store, {});

    // Should fall back to YAML
    expect(output).toContain("test: data");
  });

  test("renders array values via template", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    await registerOutputTemplates(store);

    const aliases = bootstrap(store);
    const refsTypeHash = aliases["@ocas/output/refs"];
    if (!refsTypeHash) throw new Error("@ocas/output/refs not found");

    const refsValue = ["ABCDEFGH12345", "BCDEFGH123456"];

    const output = await renderDirectAsync(refsTypeHash, refsValue, store, {});

    expect(output).toContain("ABCDEFGH12345");
    expect(output).toContain("BCDEFGH123456");
  });

  test("renders string value via template", async () => {
    const store = createMemoryStore();
    bootstrap(store);
    await registerOutputTemplates(store);

    const aliases = bootstrap(store);
    const putTypeHash = aliases["@ocas/output/put"];
    if (!putTypeHash) throw new Error("@ocas/output/put not found");

    const output = await renderDirectAsync(
      putTypeHash,
      "ABCDEFGH12345",
      store,
      {},
    );

    expect(output).toContain("ABCDEFGH12345");
  });
});
