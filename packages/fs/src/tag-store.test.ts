import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openStore } from "./store.js";

const T1 = "AAAAAAAAAAAAA";
const T2 = "BBBBBBBBBBBBB";

describe("FsTagStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ocas-fs-tag-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("B1. set tag with key/value round-trip + SQLite persisted", async () => {
    const store = await openStore(dir);
    const result = store.tag.tag(T1, [
      { op: "set", key: "env", value: "prod" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe("env");
    expect(result[0]?.value).toBe("prod");
    expect(store.tag.tags(T1)).toEqual(result);

    const dbFile = join(dir, "_store.db");
    expect(existsSync(dbFile)).toBe(true);
  });

  test("B2. label tag (no value) records value: null", async () => {
    const store = await openStore(dir);
    store.tag.tag(T1, [{ op: "set", key: "pinned" }]);
    const tags = store.tag.tags(T1);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.value).toBeNull();
  });

  test("B3. multiple ops in one call sorted by key", async () => {
    const store = await openStore(dir);
    const result = store.tag.tag(T1, [
      { op: "set", key: "b", value: "2" },
      { op: "set", key: "a", value: "1" },
    ]);
    expect(result.map((t) => t.key)).toEqual(["a", "b"]);
  });

  test("B4. update existing key overwrites value", async () => {
    const store = await openStore(dir);
    store.tag.tag(T1, [{ op: "set", key: "env", value: "prod" }]);
    store.tag.tag(T1, [{ op: "set", key: "env", value: "dev" }]);
    const tags = store.tag.tags(T1);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.value).toBe("dev");
  });

  test("B5. delete via tag op removes the entry", async () => {
    const store = await openStore(dir);
    store.tag.tag(T1, [{ op: "set", key: "env", value: "prod" }]);
    store.tag.tag(T1, [{ op: "delete", key: "env" }]);
    expect(store.tag.tags(T1)).toEqual([]);
  });

  test("B6. untag removes listed keys; missing keys silently skipped", async () => {
    const store = await openStore(dir);
    store.tag.tag(T1, [
      { op: "set", key: "a", value: "1" },
      { op: "set", key: "b", value: "2" },
    ]);
    store.tag.untag(T1, ["a", "missing"]);
    expect(store.tag.tags(T1).map((t) => t.key)).toEqual(["b"]);
  });

  test("B7. listByTag bare key returns all tagged targets", async () => {
    const store = await openStore(dir);
    store.tag.tag(T1, [{ op: "set", key: "env", value: "prod" }]);
    store.tag.tag(T2, [{ op: "set", key: "env", value: "dev" }]);
    const listed = store.tag.listByTag("env").sort();
    expect(listed).toEqual([T1, T2].sort());
  });

  test("B8. listByTag key=value filters by exact value", async () => {
    const store = await openStore(dir);
    store.tag.tag(T1, [{ op: "set", key: "env", value: "prod" }]);
    store.tag.tag(T2, [{ op: "set", key: "env", value: "dev" }]);
    expect(store.tag.listByTag("env=prod")).toEqual([T1]);
  });

  test("B9. ListOptions on listByTag (limit, offset)", async () => {
    const store = await openStore(dir);
    const targets: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = `${"C".repeat(12)}${i}`;
      targets.push(t);
      store.tag.tag(t, [{ op: "set", key: "k", value: String(i) }]);
    }
    expect(store.tag.listByTag("k", { limit: 2 })).toHaveLength(2);
  });

  test("B10. persistence across reopen", async () => {
    const store = await openStore(dir);
    store.tag.tag(T1, [
      { op: "set", key: "env", value: "prod" },
      { op: "set", key: "team", value: "platform" },
    ]);
    const reopened = await openStore(dir);
    const tags = reopened.tag.tags(T1);
    expect(tags.map((t) => t.key)).toEqual(["env", "team"]);
    expect(tags.map((t) => t.value)).toEqual(["prod", "platform"]);
  });

  test("B11. SQLite replay fidelity (set/delete/untag mix)", async () => {
    const store = await openStore(dir);
    store.tag.tag(T1, [{ op: "set", key: "a", value: "1" }]);
    store.tag.tag(T1, [{ op: "set", key: "b", value: "2" }]);
    store.tag.tag(T1, [{ op: "set", key: "c", value: "3" }]);
    store.tag.tag(T1, [{ op: "delete", key: "b" }]);
    store.tag.untag(T1, ["a"]);

    const reopened = await openStore(dir);
    const tags = reopened.tag.tags(T1);
    expect(tags.map((t) => t.key)).toEqual(["c"]);
    expect(tags[0]?.value).toBe("3");
  });
});
