import { describe, expect, test } from "bun:test";
import { bootstrap } from "./bootstrap.js";
import { createMemoryStore } from "./store.js";
import { wrapEnvelope } from "./wrap-envelope.js";

describe("wrapEnvelope", () => {
  test("resolves @ocas/output/put alias and returns envelope", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);

    const envelope = await wrapEnvelope(
      store,
      "@ocas/output/put",
      "AAAAAAAAAAAAA",
    );

    expect(envelope.type).toBe(aliases["@ocas/output/put"]);
    expect(envelope.value).toBe("AAAAAAAAAAAAA");
  });

  test("resolves @ocas/output/has alias with boolean value", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);

    const envelope = await wrapEnvelope(store, "@ocas/output/has", true);

    expect(envelope.type).toBe(aliases["@ocas/output/has"]);
    expect(envelope.value).toBe(true);
  });

  test("resolves @ocas/output/gc alias with object value", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);

    const gcStats = { total: 100, reachable: 80, collected: 20, scanned: 5 };
    const envelope = await wrapEnvelope(store, "@ocas/output/gc", gcStats);

    expect(envelope.type).toBe(aliases["@ocas/output/gc"]);
    expect(envelope.value).toEqual(gcStats);
  });

  test("resolves primitive alias @string", async () => {
    const store = createMemoryStore();
    const aliases = await bootstrap(store);

    const envelope = await wrapEnvelope(store, "@ocas/string", "hello");

    expect(envelope.type).toBe(aliases["@ocas/string"]);
    expect(envelope.value).toBe("hello");
  });

  test("throws for unknown alias", async () => {
    const store = createMemoryStore();
    await bootstrap(store);

    await expect(
      wrapEnvelope(store, "@ocas/output/nonexistent", "value"),
    ).rejects.toThrow("Unknown schema alias: @ocas/output/nonexistent");
  });

  test("is idempotent — same alias returns same type hash", async () => {
    const store = createMemoryStore();

    const first = await wrapEnvelope(store, "@ocas/output/verify", "ok");
    const second = await wrapEnvelope(
      store,
      "@ocas/output/verify",
      "corrupted",
    );

    expect(first.type).toBe(second.type);
    expect(first.value).toBe("ok");
    expect(second.value).toBe("corrupted");
  });

  test("preserves complex object values without mutation", async () => {
    const store = createMemoryStore();
    await bootstrap(store);

    const original = {
      name: "test",
      schema: "AAAAAAAAAAAAA",
      value: "BBBBBBBBBBBBB",
      created: 1000,
      updated: 2000,
      tags: { env: "prod" },
      labels: ["stable"],
    };
    const envelope = await wrapEnvelope(
      store,
      "@ocas/output/var-set",
      original,
    );

    expect(envelope.value).toEqual(original);
  });
});
