import { CasNodeNotFoundError } from "./errors.js";
import { renderWithTemplate } from "./liquid-render.js";
import { collectRefs, getSchema, putSchema, refs } from "./schema.js";
import type { Hash, OcasStore } from "./types.js";

export type RenderOptions = {
  resolution?: number; // (0, 1], default 1.0
  decay?: number; // (0, 1], default 0.5
  epsilon?: number; // >= 0, default 0.01
};

const DEFAULT_RESOLUTION = 1.0;
const DEFAULT_DECAY = 0.5;
const DEFAULT_EPSILON = 0.01;
// Small tolerance for floating point comparison
const FLOAT_TOLERANCE = 1e-10;

/**
 * Extract and validate resolution/decay/epsilon from options.
 */
function validateAndExtractOptions(options: RenderOptions | null | undefined): {
  resolution: number;
  decay: number;
  epsilon: number;
} {
  const resolution = options?.resolution ?? DEFAULT_RESOLUTION;
  const decay = options?.decay ?? DEFAULT_DECAY;
  const epsilon = options?.epsilon ?? DEFAULT_EPSILON;

  if (resolution < 0 || resolution > 1) {
    throw new Error("resolution must be in [0, 1]");
  }
  if (decay <= 0 || decay > 1) {
    throw new Error("decay must be in (0, 1]");
  }
  if (epsilon < 0) {
    throw new Error("epsilon must be >= 0");
  }

  return { resolution, decay, epsilon };
}

/**
 * Render a CAS node as YAML with resolution-based decay.
 * When resolution ≤ epsilon, nodes are rendered as opaque `cas:<hash>` references.
 * This is the synchronous version without template support.
 * For template support, use renderAsync().
 */
export function render(
  store: OcasStore,
  hash: Hash,
  options?: RenderOptions,
): string {
  const { resolution, decay, epsilon } = validateAndExtractOptions(options);

  // Check if root node exists
  if (store.cas.get(hash) === null) {
    throw new CasNodeNotFoundError(hash);
  }

  const visited = new Set<Hash>();
  return renderNode(store, hash, resolution, decay, epsilon, visited);
}

/**
 * Async render with LiquidJS template support.
 * When resolution ≤ epsilon, nodes are rendered as opaque `cas:<hash>` references.
 * Attempts to use LiquidJS templates first, falling back to YAML.
 */
export async function renderAsync(
  store: OcasStore,
  hash: Hash,
  options?: RenderOptions,
): Promise<string> {
  const { resolution, decay, epsilon } = validateAndExtractOptions(options);

  // Check if root node exists
  if (store.cas.get(hash) === null) {
    throw new CasNodeNotFoundError(hash);
  }

  // Try template rendering first
  try {
    const node = store.cas.get(hash);
    if (node !== null) {
      // Check if a template exists for this type
      const templateExists = await hasTemplate(store, node.type);
      if (templateExists) {
        return await renderWithTemplate(store, hash, {
          resolution,
          decay,
          epsilon,
        });
      }
    }
  } catch {
    // Fall through to YAML rendering
  }

  // Fallback to YAML rendering
  const visited = new Set<Hash>();
  return renderNode(store, hash, resolution, decay, epsilon, visited);
}

/**
 * Render a value directly (in-memory) without requiring it to be stored.
 * Accepts a raw { type, value } pair. Store is optional and read-only —
 * used only for schema lookup and expanding nested ocas_ref references.
 * No data is written to the store.
 */
export function renderDirect(
  typeHash: Hash,
  value: unknown,
  store: OcasStore | null,
  options: RenderOptions | null,
): string {
  const { resolution, decay, epsilon } = validateAndExtractOptions(options);

  // Try to get schema from store to identify ocas_ref fields
  let refSet = new Set<Hash>();
  if (store !== null) {
    const schema = getSchema(store, typeHash);
    if (schema !== null) {
      refSet = new Set(collectRefs(schema, value));
    }
  }

  const childResolution = resolution * decay;
  const visited = new Set<Hash>();

  return renderValue(
    store,
    value,
    refSet,
    childResolution,
    decay,
    epsilon,
    visited,
  );
}

/**
 * Check if a template exists for a given type
 */
async function hasTemplate(store: OcasStore, typeHash: Hash): Promise<boolean> {
  const varName = `@ocas/template/text/${typeHash}`;
  try {
    const stringSchema = await putSchema(store, { type: "string" });
    const variable = store.var.get(varName, stringSchema);
    return variable !== null;
  } catch {
    return false;
  }
}

function renderNode(
  store: OcasStore | null,
  hash: Hash,
  currentResolution: number,
  decay: number,
  epsilon: number,
  visited: Set<Hash>,
): string {
  // Check if resolution is below threshold (with floating point tolerance)
  if (currentResolution < epsilon + FLOAT_TOLERANCE) {
    return `cas:${hash}`;
  }

  // Fetch the node
  const node = store !== null ? store.cas.get(hash) : null;
  if (node === null) {
    // Missing node - render as cas: reference
    return `cas:${hash}`;
  }

  // Cycle detection
  if (visited.has(hash)) {
    return `cas:${hash}`;
  }
  visited.add(hash);

  // Get references from this node's schema
  const nodeRefs = store !== null ? refs(store, node) : [];
  const refSet = new Set(nodeRefs);

  // Calculate child resolution for next level
  const childResolution = currentResolution * decay;

  // Render the payload with recursive expansion of ocas_ref fields
  const rendered = renderValue(
    store,
    node.payload,
    refSet,
    childResolution,
    decay,
    epsilon,
    visited,
  );

  visited.delete(hash);

  return rendered;
}

function renderValue(
  store: OcasStore | null,
  value: unknown,
  refHashes: Set<Hash>,
  childResolution: number,
  decay: number,
  epsilon: number,
  visited: Set<Hash>,
): string {
  // Handle null
  if (value === null) {
    return "null\n";
  }

  // Handle primitives
  if (typeof value === "string") {
    // Check if this string is a ocas_ref
    if (refHashes.has(value as Hash)) {
      // Recursively render the referenced node
      return renderNode(
        store,
        value as Hash,
        childResolution,
        decay,
        epsilon,
        visited,
      );
    }
    // Otherwise, render as YAML string
    return toYamlString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${value}\n`;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]\n";
    }

    const items = value.map((item) => {
      const itemYaml = renderValue(
        store,
        item,
        refHashes,
        childResolution,
        decay,
        epsilon,
        visited,
      );
      return indent(itemYaml.trim(), 2);
    });

    return `- ${items.join("\n- ")}\n`;
  }

  // Handle objects
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);

    if (keys.length === 0) {
      return "{}\n";
    }

    const pairs = keys.map((key) => {
      const val = obj[key];
      const valYaml = renderValue(
        store,
        val,
        refHashes,
        childResolution,
        decay,
        epsilon,
        visited,
      );

      const trimmedVal = valYaml.trim();

      // If value is multiline, indent it
      if (trimmedVal.includes("\n")) {
        return `${key}:\n${indent(trimmedVal, 2)}`;
      }

      return `${key}: ${trimmedVal}`;
    });

    return `${pairs.join("\n")}\n`;
  }

  return "null\n";
}

function toYamlString(str: string): string {
  // Handle special characters
  if (
    str.includes("\n") ||
    str.includes(":") ||
    str.includes("#") ||
    str.includes("[") ||
    str.includes("]") ||
    str.includes("{") ||
    str.includes("}") ||
    str.includes("'") ||
    str.includes('"') ||
    str.startsWith(" ") ||
    str.endsWith(" ")
  ) {
    // Use double-quoted string with escaping
    const escaped = str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
    return `"${escaped}"\n`;
  }

  return `${str}\n`;
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? prefix + line : line))
    .join("\n");
}
