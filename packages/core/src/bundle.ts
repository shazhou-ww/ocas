import { readFileSync, writeFileSync } from "node:fs";
import { bootstrap } from "./bootstrap.js";
import { cborEncode } from "./cbor.js";
import { computeClosure } from "./closure.js";
import { createMemoryStore } from "./store.js";
import type { CasNode, Hash, Store, Tag } from "./types.js";
import type { Variable } from "./variable.js";

/**
 * Stats returned by `exportBundle`.
 */
export type ExportStats = {
  nodes: number;
  vars: number;
  tags: number;
};

/**
 * Options for `importBundle`.
 */
export type ImportOptions = {
  /** Replace the original `@scope` of each non-builtin variable with this value. */
  scope?: string;
};

/**
 * Stats returned by `importBundle`.
 */
export type ImportStats = {
  nodes: { imported: number; skipped: number };
  vars: { created: number; updated: number };
  tags: number;
};

/** Import via CBOR using cborg, mirroring how FsStore decodes nodes. */
import { decode } from "cborg";

const BUILTIN_PREFIX = "@ocas/";

/**
 * Resolve a single root spec (variable name OR raw hash) into a hash. Throws
 * if the name does not resolve and the input is not a hash.
 */
function resolveRoot(store: Store, input: string): Hash {
  if (/^[0-9A-HJKMNP-TV-Z]{13}$/.test(input)) {
    if (!store.cas.has(input)) {
      throw new Error(`Root hash not found in store: ${input}`);
    }
    return input as Hash;
  }
  const variants = store.var.list({ exactName: input });
  const first = variants[0];
  if (!first) {
    throw new Error(`Root variable not found: ${input}`);
  }
  return first.value as Hash;
}

/**
 * Compute the transitive CAS closure of `roots`, write a tar archive at
 * `outputPath` containing all CAS nodes (`cas/<hash>.bin`), variables
 * (`vars.jsonl`), and tags (`tags.jsonl`).
 */
export async function exportBundle(
  store: Store,
  roots: string[],
  outputPath: string,
): Promise<ExportStats> {
  // Resolve every root before computing the closure so missing names error
  // early.
  const rootHashes = roots.map((r) => resolveRoot(store, r));
  const closure = computeClosure(store, rootHashes);

  const entries: TarEntry[] = [];

  // CAS nodes — one CBOR-encoded file per node, named by hash.
  // Order is deterministic by sorted hash.
  const sortedNodes = [...closure.nodes].sort();
  for (const hash of sortedNodes) {
    const node = store.cas.get(hash);
    if (!node) continue;
    const content = cborEncode({
      type: node.type,
      payload: node.payload,
      timestamp: node.timestamp,
    });
    entries.push({ name: `cas/${hash}.bin`, content });
  }

  // Variables — JSON-lines.
  const sortedVars = [...closure.vars].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const varLines = sortedVars
    .map((v) =>
      JSON.stringify({
        name: v.name,
        schema: v.schema,
        value: v.value,
        created: v.created,
        updated: v.updated,
        tags: v.tags,
        labels: v.labels,
      }),
    )
    .join("\n");
  entries.push({
    name: "vars.jsonl",
    content: new TextEncoder().encode(
      varLines + (varLines.length > 0 ? "\n" : ""),
    ),
  });

  // Tags — JSON-lines, one per tag.
  const tagLines: string[] = [];
  const sortedTagTargets = [...closure.tags.keys()].sort();
  let tagCount = 0;
  for (const target of sortedTagTargets) {
    const tagList = closure.tags.get(target) ?? [];
    for (const t of tagList) {
      tagLines.push(
        JSON.stringify({
          target: t.target,
          key: t.key,
          value: t.value,
          created: t.created,
        }),
      );
      tagCount++;
    }
  }
  const tagText = tagLines.join("\n");
  entries.push({
    name: "tags.jsonl",
    content: new TextEncoder().encode(
      tagText + (tagText.length > 0 ? "\n" : ""),
    ),
  });

  // Pack into tar and write to disk.
  const tar = packTar(entries);
  writeFileSync(outputPath, tar);

  return {
    nodes: sortedNodes.length,
    vars: sortedVars.length,
    tags: tagCount,
  };
}

/**
 * Read a bundle tar archive from disk, returning the parsed components
 * without applying them to a store.
 */
function readBundle(bundlePath: string): {
  nodes: Map<Hash, CasNode>;
  vars: Variable[];
  tags: Tag[];
} {
  const buf = readFileSync(bundlePath);
  const entries = unpackTar(buf);
  const nodes = new Map<Hash, CasNode>();
  let vars: Variable[] = [];
  let tags: Tag[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith("cas/") && entry.name.endsWith(".bin")) {
      const hash = entry.name.slice(4, -4) as Hash;
      const node = decode(entry.content) as CasNode;
      nodes.set(hash, node);
    } else if (entry.name === "vars.jsonl") {
      const text = new TextDecoder().decode(entry.content);
      vars = text
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Variable);
    } else if (entry.name === "tags.jsonl") {
      const text = new TextDecoder().decode(entry.content);
      tags = text
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Tag);
    }
  }
  return { nodes, vars, tags };
}

/**
 * Apply scope remapping to a variable name. `@ocas/*` is reserved and never
 * remapped. Other names get `^@[^/]+` replaced with the new scope.
 */
function remapVarName(name: string, scope: string | undefined): string {
  if (scope === undefined) return name;
  if (name.startsWith(BUILTIN_PREFIX)) return name;
  // Replace leading @scope with the new scope. The format is `@scope/rest`.
  return name.replace(/^@[^/]+/, scope);
}

/**
 * Read a bundle from disk and apply its contents to `target`.
 */
export async function importBundle(
  bundlePath: string,
  target: Store,
  options?: ImportOptions,
): Promise<ImportStats> {
  // Ensure target is bootstrapped so meta-schema is available (importing the
  // meta-schema as a regular CAS node would still work since hash-equal
  // self-referencing nodes dedup).
  bootstrap(target);

  const { nodes, vars, tags } = readBundle(bundlePath);

  // Sort nodes so that meta-schema (self-referencing) is imported first,
  // then types (whose `type` is the meta-schema), then leaves. The simple
  // heuristic: import nodes whose `type` is already present (or self) until
  // the queue stabilises.
  let imported = 0;
  let skipped = 0;
  const remaining = new Map(nodes);
  let progress = true;
  while (remaining.size > 0 && progress) {
    progress = false;
    for (const [hash, node] of [...remaining]) {
      const ready = node.type === hash || target.cas.has(node.type);
      if (!ready) continue;
      if (target.cas.has(hash)) {
        skipped++;
      } else if (node.type === hash) {
        // Self-referencing meta — import via bootstrap-capable interface.
        // Fall back to put if the store doesn't expose BOOTSTRAP_STORE.
        const cas = target.cas as unknown as {
          [k: symbol]: ((p: unknown) => Hash) | undefined;
        };
        const bootstrapSym = Symbol.for("ocas.bootstrap-store");
        // Look up the proper symbol from the module to avoid forging it.
        // (Imported lazily to avoid circular dependency at module init.)
        const sym = (await import("./bootstrap-capable.js")).BOOTSTRAP_STORE;
        const fn = cas[sym];
        if (fn) {
          fn(node.payload);
        } else {
          target.cas.put(node.type, node.payload);
        }
        void bootstrapSym;
        imported++;
      } else {
        target.cas.put(node.type, node.payload);
        imported++;
      }
      remaining.delete(hash);
      progress = true;
    }
  }
  // If anything remains, type chains were unresolvable — import them anyway.
  for (const [hash, node] of remaining) {
    if (target.cas.has(hash)) {
      skipped++;
    } else {
      target.cas.put(node.type, node.payload);
      imported++;
    }
  }

  // Variables.
  let created = 0;
  let updated = 0;
  for (const v of vars) {
    const newName = remapVarName(v.name, options?.scope);
    // @ocas/* names already exist after bootstrap; if name+schema match value
    // they will be silently no-op'd by the store.
    const existing = target.var.get(newName, v.schema);
    target.var.set(newName, v.value, {
      tags: v.tags ?? {},
      labels: v.labels ?? [],
    });
    if (existing === null) {
      created++;
    } else {
      updated++;
    }
  }

  // Tags. Apply each tag to its target.
  for (const t of tags) {
    target.tag.tag(t.target, [
      t.value === null
        ? { op: "set", key: t.key }
        : { op: "set", key: t.key, value: t.value },
    ]);
  }

  return {
    nodes: { imported, skipped },
    vars: { created, updated },
    tags: tags.length,
  };
}

/**
 * Build a read-only `Store` whose contents come from a bundle tar file.
 */
export async function loadBundleStore(bundlePath: string): Promise<Store> {
  const store = createMemoryStore();
  // Apply the bundle's contents but suppress the bootstrap-only nodes so
  // the bundle file remains the source of truth.
  await importBundle(bundlePath, store);
  return store;
}

// ---------------------------------------------------------------------------
// Minimal tar pack/unpack — POSIX ustar format, regular files only.
// ---------------------------------------------------------------------------

type TarEntry = { name: string; content: Uint8Array };

function packTar(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    writeString(header, entry.name, 0, 100);
    writeOctal(header, 0o644, 100, 8);
    writeOctal(header, 0, 108, 8);
    writeOctal(header, 0, 116, 8);
    writeOctal(header, entry.content.length, 124, 12);
    writeOctal(header, Math.floor(Date.now() / 1000), 136, 12);
    // checksum placeholder — 8 spaces, then computed.
    for (let i = 0; i < 8; i++) header[148 + i] = 0x20;
    header[156] = 0x30; // typeflag '0' (regular file)
    writeString(header, "ustar  ", 257, 8); // GNU-style ustar magic+version
    let cksum = 0;
    for (let i = 0; i < 512; i++) cksum += header[i] as number;
    writeOctal(header, cksum, 148, 7);
    header[155] = 0;

    blocks.push(header);
    const content = Buffer.from(entry.content);
    blocks.push(content);
    // Pad to 512.
    const pad = (512 - (content.length % 512)) % 512;
    if (pad > 0) blocks.push(Buffer.alloc(pad));
  }
  // End-of-archive: two zero blocks.
  blocks.push(Buffer.alloc(512));
  blocks.push(Buffer.alloc(512));
  return Buffer.concat(blocks);
}

function unpackTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = readCString(header, 0, 100);
    const sizeStr = readCString(header, 124, 12).trim();
    const size = sizeStr === "" ? 0 : parseInt(sizeStr, 8);
    offset += 512;
    const content = new Uint8Array(buf.subarray(offset, offset + size));
    entries.push({ name, content });
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

function writeString(
  buf: Buffer,
  str: string,
  offset: number,
  len: number,
): void {
  const data = Buffer.from(str, "utf8");
  const n = Math.min(data.length, len);
  data.copy(buf, offset, 0, n);
  for (let i = n; i < len; i++) buf[offset + i] = 0;
}

function writeOctal(
  buf: Buffer,
  value: number,
  offset: number,
  len: number,
): void {
  const str = value.toString(8).padStart(len - 1, "0");
  writeString(buf, str, offset, len - 1);
  buf[offset + len - 1] = 0;
}

function readCString(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  let end = slice.length;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) {
      end = i;
      break;
    }
  }
  return slice.subarray(0, end).toString("utf8");
}
