import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CasNode,
  CasStore,
  Hash,
  HistoryEntry,
  ListEntry,
  ListOptions,
  OcasStore,
  Tag,
  TagOp,
  TagStore,
  Variable,
  VarListOptions,
  VarSetOptions,
  VarStore,
} from "./index.js";

describe("CasStore type", () => {
  test("has all required methods with correct signatures", () => {
    const stub: CasStore = {
      get: (_h: Hash): CasNode | null => null,
      put: (_t: Hash, _p: unknown): Hash => "0000000000000",
      has: (_h: Hash): boolean => false,
      delete: (_h: Hash): boolean => false,
      listByType: (_t: Hash, _o?: ListOptions): ListEntry[] => [],
      listMeta: (_o?: ListOptions): ListEntry[] => [],
      listSchemas: (_o?: ListOptions): ListEntry[] => [],
    };
    expect(typeof stub.get).toBe("function");
    expect(typeof stub.put).toBe("function");
    expect(typeof stub.has).toBe("function");
    expect(typeof stub.delete).toBe("function");
    expect(typeof stub.listByType).toBe("function");
    expect(typeof stub.listMeta).toBe("function");
    expect(typeof stub.listSchemas).toBe("function");
  });
});

describe("VarStore type", () => {
  test("VarStore shape", () => {
    const sample: Variable = {
      name: "@x/y",
      schema: "0",
      value: "0",
      created: 0,
      updated: 0,
      tags: {},
      labels: [],
    };
    const stub: VarStore = {
      set: (_n: string, _h: Hash, _o?: VarSetOptions): Variable => sample,
      get: (_n: string, _s?: Hash): Variable | null => null,
      remove: (_n: string, _s?: Hash): Variable[] => [],
      update: (_n: string, _h: Hash, _o?: VarSetOptions): Variable => sample,
      list: (_o?: VarListOptions): Variable[] => [],
      history: (_n: string, _s?: Hash): HistoryEntry[] => [],
      close: (): void => {},
    };
    expect(typeof stub.set).toBe("function");
    expect(typeof stub.get).toBe("function");
    expect(typeof stub.remove).toBe("function");
    expect(typeof stub.update).toBe("function");
    expect(typeof stub.list).toBe("function");
    expect(typeof stub.history).toBe("function");
    expect(typeof stub.close).toBe("function");
  });

  test("VarSetOptions shape", () => {
    const opts: VarSetOptions = { tags: { k: "v" }, labels: ["l"] };
    expect(opts.tags?.k).toBe("v");
  });

  test("VarListOptions extends ListOptions", () => {
    const opts: VarListOptions = {
      namePrefix: "@x/",
      exactName: "@x/y",
      schema: "0",
      tags: { k: "v" },
      labels: ["l"],
      sort: "created",
      desc: true,
      limit: 10,
      offset: 0,
    };
    expect(opts.namePrefix).toBe("@x/");
  });

  test("HistoryEntry shape", () => {
    const e: HistoryEntry = { value: "0", position: 0, setAt: 0 };
    expect(e.position).toBe(0);
  });
});

describe("TagStore type", () => {
  test("TagStore shape", () => {
    const stub: TagStore = {
      tag: (_t: Hash, _ops: TagOp[]): Tag[] => [],
      untag: (_t: Hash, _k: string[]): void => {},
      tags: (_t: Hash): Tag[] => [],
      listByTag: (_t: string, _o?: ListOptions): Hash[] => [],
    };
    expect(typeof stub.tag).toBe("function");
    expect(typeof stub.untag).toBe("function");
    expect(typeof stub.tags).toBe("function");
    expect(typeof stub.listByTag).toBe("function");
  });

  test("Tag and TagOp shapes", () => {
    const t: Tag = { key: "k", value: "v", target: "0", created: 0 };
    const tNull: Tag = { key: "label", value: null, target: "0", created: 0 };
    const op1: TagOp = { op: "set", key: "k", value: "v" };
    const op2: TagOp = { op: "delete", key: "k" };
    expect(t.value).toBe("v");
    expect(tNull.value).toBeNull();
    expect(op1.op).toBe("set");
    expect(op2.op).toBe("delete");
  });
});

describe("Aggregate OcasStore type", () => {
  test("has cas, var, tag fields", () => {
    type _AssertCas = OcasStore["cas"] extends CasStore ? true : false;
    type _AssertVar = OcasStore["var"] extends VarStore ? true : false;
    type _AssertTag = OcasStore["tag"] extends TagStore ? true : false;
    const a: _AssertCas = true;
    const b: _AssertVar = true;
    const c: _AssertTag = true;
    expect(a && b && c).toBe(true);
  });
});

describe("source convention", () => {
  test("types.ts uses 'type' not 'interface' for new types", () => {
    const src = readFileSync(join(import.meta.dir, "types.ts"), "utf8");
    for (const name of ["CasStore", "VarStore", "TagStore"]) {
      expect(src).toMatch(new RegExp(`export\\s+type\\s+${name}\\b`));
      expect(src).not.toMatch(new RegExp(`interface\\s+${name}\\b`));
    }
  });
});

describe("Exports surface", () => {
  test("@ocas/core exports the new type names (compile-time only)", () => {
    type _C = CasStore extends object ? true : never;
    type _V = VarStore extends object ? true : never;
    type _T = TagStore extends object ? true : never;
    type _O = OcasStore extends object ? true : never;
    const _checks: [_C, _V, _T, _O] = [true, true, true, true];
    expect(_checks.length).toBe(4);
  });
});
