import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "./store.js";

const T1 = "AAAAAAAAAAAAA";
const T2 = "BBBBBBBBBBBBB";

describe("In-memory TagStore", () => {
  test("D1. tag set with key/value round-trip", () => {
    const { tag } = createMemoryStore();
    const result = tag.tag(T1, [{ op: "set", key: "env", value: "prod" }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe("env");
    expect(result[0]?.value).toBe("prod");
    expect(result[0]?.target).toBe(T1);
    expect(typeof result[0]?.created).toBe("number");
    expect(tag.tags(T1)).toEqual(result);
  });

  test("D2. label tag (value omitted) records value: null", () => {
    const { tag } = createMemoryStore();
    tag.tag(T1, [{ op: "set", key: "pinned" }]);
    const tags = tag.tags(T1);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.key).toBe("pinned");
    expect(tags[0]?.value).toBeNull();
  });

  test("D3. multiple ops in one call, sorted by key", () => {
    const { tag } = createMemoryStore();
    const result = tag.tag(T1, [
      { op: "set", key: "b", value: "2" },
      { op: "set", key: "a", value: "1" },
    ]);
    expect(result.map((t) => t.key)).toEqual(["a", "b"]);
    expect(tag.tags(T1).map((t) => t.key)).toEqual(["a", "b"]);
  });

  test("D4. update existing key overwrites value", () => {
    const { tag } = createMemoryStore();
    tag.tag(T1, [{ op: "set", key: "env", value: "prod" }]);
    tag.tag(T1, [{ op: "set", key: "env", value: "dev" }]);
    const tags = tag.tags(T1);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.value).toBe("dev");
  });

  test("D5. delete via tag op removes the entry", () => {
    const { tag } = createMemoryStore();
    tag.tag(T1, [{ op: "set", key: "env", value: "prod" }]);
    tag.tag(T1, [{ op: "delete", key: "env" }]);
    expect(tag.tags(T1)).toEqual([]);
  });

  test("D6. untag removes listed keys; missing keys silently skipped", () => {
    const { tag } = createMemoryStore();
    tag.tag(T1, [
      { op: "set", key: "a", value: "1" },
      { op: "set", key: "b", value: "2" },
    ]);
    tag.untag(T1, ["a", "missing"]);
    expect(tag.tags(T1).map((t) => t.key)).toEqual(["b"]);
  });

  test("D7. listByTag returns all targets with the bare key", () => {
    const { tag } = createMemoryStore();
    tag.tag(T1, [{ op: "set", key: "env", value: "prod" }]);
    tag.tag(T2, [{ op: "set", key: "env", value: "dev" }]);
    const listed = tag.listByTag("env").sort();
    expect(listed).toEqual([T1, T2].sort());
  });

  test("D8. listByTag with key=value form filters by exact value", () => {
    const { tag } = createMemoryStore();
    tag.tag(T1, [{ op: "set", key: "env", value: "prod" }]);
    tag.tag(T2, [{ op: "set", key: "env", value: "dev" }]);
    expect(tag.listByTag("env=prod")).toEqual([T1]);
  });

  test("D9. ListOptions on listByTag (limit, offset, desc)", () => {
    const { tag } = createMemoryStore();
    const targets: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = `${"C".repeat(12)}${i}`;
      targets.push(t);
      tag.tag(t, [{ op: "set", key: "k", value: String(i) }]);
    }
    expect(tag.listByTag("k", { limit: 2 })).toHaveLength(2);
    expect(tag.listByTag("k", { offset: 3 })).toHaveLength(2);
    const desc = tag.listByTag("k", { desc: true });
    expect(desc[0]).toBe(targets[targets.length - 1] as string);
  });

  test("D10. different targets are independent", () => {
    const { tag } = createMemoryStore();
    tag.tag(T1, [{ op: "set", key: "k", value: "1" }]);
    expect(tag.tags(T2)).toEqual([]);
  });

  test("D11. each Tag returned has a created timestamp", () => {
    const { tag } = createMemoryStore();
    const before = Date.now();
    const result = tag.tag(T1, [{ op: "set", key: "k", value: "v" }]);
    const after = Date.now();
    expect(result[0]?.created).toBeGreaterThanOrEqual(before);
    expect(result[0]?.created).toBeLessThanOrEqual(after);
  });
});
