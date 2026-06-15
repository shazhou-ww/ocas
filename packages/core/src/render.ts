import { Liquid } from "liquidjs";
import { CasNodeNotFoundError } from "./errors.js";
import { renderWithTemplateInternal } from "./liquid-render.js";
import { collectRefs, getSchema, putSchema, refs } from "./schema.js";
import type { Hash, Store } from "./types.js";

export type RenderOptions = {
  resolution?: number; // (0, 1], default 1.0
  decay?: number; // (0, 1], default 0.5
  epsilon?: number; // >= 0, default 0.01
  format?: string; // default 'text'
};

/**
 * Type statics structure: slot name → raw content
 */
export type TypeStatics = Record<string, string>;

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
  store: Store,
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
 * Uses map-reduce-compose pipeline:
 * 1. Map phase: DFS rendering with type collection
 * 2. Reduce phase: Collect type statics from encountered types
 * 3. Compose phase: Apply compose template or identity transformation
 */
export async function renderAsync(
  store: Store,
  hash: Hash,
  options?: RenderOptions,
): Promise<string> {
  const { resolution, decay, epsilon } = validateAndExtractOptions(options);
  const format = options?.format ?? "text";

  // Check if root node exists
  if (store.cas.get(hash) === null) {
    throw new CasNodeNotFoundError(hash);
  }

  // Phase 1: Map - DFS rendering with type collection
  let content: string;
  let encounteredTypes: Set<Hash>;

  // Try template rendering first
  try {
    const node = store.cas.get(hash);
    if (node !== null) {
      // Check if a template exists for this type
      const templateExists = await hasTemplate(store, node.type, format);
      if (templateExists) {
        const result = await renderWithTemplateInternal(store, hash, {
          resolution,
          decay,
          epsilon,
          format,
        });
        content = result.output;
        encounteredTypes = result.encounteredTypes;
      } else {
        // Fallback to YAML rendering
        const visited = new Set<Hash>();
        const yamlContent = renderNode(
          store,
          hash,
          resolution,
          decay,
          epsilon,
          visited,
        );
        // For HTML format, wrap YAML in <pre><code> tags
        content =
          format === "html"
            ? `<pre><code>${escapeHtml(yamlContent)}</code></pre>`
            : yamlContent;
        encounteredTypes = new Set<Hash>();
      }
    } else {
      // Fallback to YAML rendering
      const visited = new Set<Hash>();
      content = renderNode(store, hash, resolution, decay, epsilon, visited);
      encounteredTypes = new Set<Hash>();
    }
  } catch {
    // Fall through to YAML rendering
    const visited = new Set<Hash>();
    const yamlContent = renderNode(
      store,
      hash,
      resolution,
      decay,
      epsilon,
      visited,
    );
    // For HTML format, wrap YAML in <pre><code> tags
    content =
      format === "html"
        ? `<pre><code>${escapeHtml(yamlContent)}</code></pre>`
        : yamlContent;
    encounteredTypes = new Set<Hash>();
  }

  // Phase 2: Reduce - Collect type statics
  const typeStatics = await collectTypeStatics(store, encounteredTypes, format);

  // Phase 3: Compose - Apply compose template or identity
  const composeTemplate = await findComposeTemplate(store, format);

  if (composeTemplate === null) {
    // For HTML format without compose template, use builtin HTML shell
    if (format === "html") {
      return applyBuiltinHtmlShell(content);
    }
    // Identity compose: no template, return content as-is
    return content;
  }

  // Render with compose template
  // Liquid imported statically at top of file
  const engine = new Liquid({
    strictFilters: false,
    strictVariables: false,
  });

  const composedOutput = await engine.parseAndRender(composeTemplate, {
    content,
    type_statics: typeStatics,
  });

  return composedOutput;
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
  store: Store | null,
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
async function hasTemplate(
  store: Store,
  typeHash: Hash,
  format: string,
): Promise<boolean> {
  const varName = `@ocas/template/${format}/${typeHash}`;
  try {
    const stringSchema = putSchema(store, { type: "string" });
    const variable = store.var.get(varName, stringSchema);
    return variable !== null;
  } catch {
    return false;
  }
}

/**
 * Collect type statics for encountered types (reduce phase)
 */
async function collectTypeStatics(
  store: Store,
  types: Set<Hash>,
  format: string,
): Promise<Record<Hash, TypeStatics>> {
  const result: Record<Hash, TypeStatics> = {};

  for (const typeHash of types) {
    const staticVarName = `@ocas/template/${format}/${typeHash}/static`;

    try {
      const stringSchema = putSchema(store, { type: "string" });
      const variable = store.var.get(staticVarName, stringSchema);

      if (variable === null) {
        continue; // No static template for this type
      }

      const templateNode = store.cas.get(variable.value);
      if (templateNode === null || typeof templateNode.payload !== "string") {
        continue;
      }

      // Render the static template (no context needed)
      // Liquid imported statically at top of file
      const engine = new Liquid({
        strictFilters: false,
        strictVariables: false,
      });

      const staticOutput = await engine.parseAndRender(
        templateNode.payload,
        {},
      );

      // Parse the output as JSON to get TypeStatics structure
      try {
        const parsed = JSON.parse(staticOutput);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          // Convert all values to strings
          const typeStatics: TypeStatics = {};
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "string") {
              typeStatics[key] = value;
            } else if (value !== null && value !== undefined) {
              typeStatics[key] = String(value);
            }
          }
          result[typeHash] = typeStatics;
        }
      } catch {
        // If parsing fails, skip this type's statics
      }
    } catch {
      // If any error occurs, skip this type
    }
  }

  return result;
}

/**
 * Find compose template for a given format (compose phase)
 */
async function findComposeTemplate(
  store: Store,
  format: string,
): Promise<string | null> {
  const composeVarName = `@ocas/template/${format}/_compose`;

  try {
    const stringSchema = putSchema(store, { type: "string" });
    const variable = store.var.get(composeVarName, stringSchema);

    if (variable === null) {
      return null;
    }

    const templateNode = store.cas.get(variable.value);
    if (templateNode === null || typeof templateNode.payload !== "string") {
      return null;
    }

    return templateNode.payload;
  } catch {
    return null;
  }
}

function renderNode(
  store: Store | null,
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
  store: Store | null,
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

/**
 * Escape HTML special characters for safe inclusion in HTML
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Apply builtin HTML document shell (used when no custom compose template is registered)
 */
function applyBuiltinHtmlShell(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OCAS Render</title>
</head>
<body>
  ${content}
</body>
</html>`;
}
