import { type Context, Liquid, type TagToken } from "liquidjs";
import { putSchema } from "./schema.js";
import type { Hash, Store } from "./types.js";

const DEFAULT_RESOLUTION = 1.0;
const DEFAULT_DECAY = 0.5;
const DEFAULT_EPSILON = 0.01;
const FLOAT_TOLERANCE = 1e-10;

/**
 * Reserved context keys that are always populated by the engine and
 * must never be shadowed by payload properties of the same name.
 */
const RESERVED_CONTEXT_KEYS = new Set<string>([
  "hash",
  "type",
  "resolution",
  "epsilon",
  "payload",
  "timestamp",
  "__visited",
  "__encountered_types",
]);

export type RenderOptionsWithFormat = {
  resolution?: number;
  decay?: number;
  epsilon?: number;
  format?: string;
};

/**
 * Render a CAS node using LiquidJS templates with resolution-based decay.
 * Templates are discovered via variables: @ocas/template/{format}/<type-hash>
 */
export async function renderWithTemplate(
  store: Store,
  hash: Hash,
  options?: RenderOptionsWithFormat,
): Promise<string> {
  const result = await renderWithTemplateInternal(store, hash, options);
  return result.output;
}

/**
 * Internal version that returns both output and encountered types.
 * Used by render.ts for the map-reduce-compose pipeline.
 */
export async function renderWithTemplateInternal(
  store: Store,
  hash: Hash,
  options?: RenderOptionsWithFormat,
): Promise<{ output: string; encounteredTypes: Set<Hash> }> {
  const resolution = options?.resolution ?? DEFAULT_RESOLUTION;
  const decay = options?.decay ?? DEFAULT_DECAY;
  const epsilon = options?.epsilon ?? DEFAULT_EPSILON;
  const format = options?.format ?? "text";

  // Validate parameters
  if (resolution < 0 || resolution > 1) {
    throw new Error("resolution must be in [0, 1]");
  }
  if (decay <= 0 || decay > 1) {
    throw new Error("decay must be in (0, 1]");
  }
  if (epsilon < 0) {
    throw new Error("epsilon must be >= 0");
  }

  const visited = new Set<Hash>();
  const encounteredTypes = new Set<Hash>();

  // Create Liquid engine
  const engine = createLiquidEngine(store, decay, format);

  const output = await renderNode(
    engine,
    store,
    hash,
    resolution,
    epsilon,
    visited,
    encounteredTypes,
    format,
  );

  return { output, encounteredTypes };
}

/**
 * Create a Liquid engine instance with custom render tag
 */
function createLiquidEngine(
  store: Store,
  globalDecay: number,
  format: string,
): Liquid {
  const engine = new Liquid({
    strictFilters: false,
    strictVariables: false,
  });

  // Type for storing parsed tag data
  type RenderTagState = {
    variable: string;
    decay: number | undefined;
  };

  // Register custom {% render %} tag
  // Capture store, globalDecay, format in closure
  engine.registerTag("render", {
    parse(token: TagToken) {
      // Parse "variable" or "variable, decay: 0.7" syntax
      const args = token.args.trim();
      const match = args.match(/^(\S+)(?:,\s*decay:\s*([\d.]+))?$/);

      if (!match) {
        throw new Error(
          `Invalid render tag syntax: ${args}. Expected: {% render variable %} or {% render variable, decay: 0.7 %}`,
        );
      }

      // Store parsed values on the tag instance
      const state = this as unknown as RenderTagState;
      state.variable = match[1] as string;
      state.decay = match[2] ? Number.parseFloat(match[2]) : undefined;

      // Validate decay if provided
      if (state.decay !== undefined) {
        if (state.decay <= 0 || state.decay > 1) {
          throw new Error("decay must be in (0, 1]");
        }
      }
    },

    async render(ctxLiquid: Context) {
      // Access parsed values
      const state = this as unknown as RenderTagState;
      const variable = state.variable;
      const explicitDecay = state.decay;

      // Resolve the variable to a hash (split on dots for nested paths)
      const variablePath = variable.split(".");
      const value = ctxLiquid.get(variablePath);

      // Handle null/undefined - render as empty
      if (value === null || value === undefined) {
        return "";
      }

      // Handle non-string values - render as empty
      if (typeof value !== "string") {
        return "";
      }

      const nodeHash = value as Hash;

      // Get current render context
      const currentResolution = ctxLiquid.get(["resolution"]) as number;
      const currentEpsilon = ctxLiquid.get(["epsilon"]) as number;

      // Compute child resolution using decay priority:
      // 1. Template explicit decay (explicitDecay)
      // 2. Global decay (from CLI/options)
      // 3. Engine default (0.5)
      const effectiveDecay =
        explicitDecay !== undefined
          ? explicitDecay
          : (globalDecay ?? DEFAULT_DECAY);
      const childResolution = currentResolution * effectiveDecay;

      // Recursively render the referenced node
      const visited = ctxLiquid.get(["__visited"]) as Set<Hash>;
      const encounteredTypes = ctxLiquid.get([
        "__encountered_types",
      ]) as Set<Hash>;
      const output = await renderNode(
        engine,
        store,
        nodeHash,
        childResolution,
        currentEpsilon,
        visited,
        encounteredTypes,
        format,
      );

      return output;
    },
  });

  return engine;
}

/**
 * Render a single node with template or fallback to cas: reference
 */
async function renderNode(
  engine: Liquid,
  store: Store,
  hash: Hash,
  currentResolution: number,
  epsilon: number,
  visited: Set<Hash>,
  encounteredTypes: Set<Hash>,
  format: string,
): Promise<string> {
  // Check if resolution is below threshold
  if (currentResolution < epsilon + FLOAT_TOLERANCE) {
    return `cas:${hash}`;
  }

  // Fetch the node
  const node = store.cas.get(hash);
  if (node === null) {
    return `cas:${hash}`;
  }

  // Cycle detection
  if (visited.has(hash)) {
    return `cas:${hash}`;
  }
  visited.add(hash);

  // Collect encountered type
  encounteredTypes.add(node.type);

  try {
    // Try to find a template for this node's type
    const template = await findTemplate(store, node.type, format);

    if (template === null) {
      // No template found - this is handled by the caller (fallback to YAML)
      // For now, return a simple representation
      visited.delete(hash);
      return renderFallback(node.payload);
    }

    // Render using the template
    const context: Record<string, unknown> = {};

    // Merge top-level payload properties (object payloads only) as Liquid
    // context variables, so templates can write `{{name}}` instead of
    // `{{payload.name}}`. Reserved engine keys take precedence — see
    // RESERVED_CONTEXT_KEYS.
    if (
      node.payload !== null &&
      typeof node.payload === "object" &&
      !Array.isArray(node.payload)
    ) {
      const payloadObj = node.payload as Record<string, unknown>;
      for (const key of Object.keys(payloadObj)) {
        if (!RESERVED_CONTEXT_KEYS.has(key)) {
          context[key] = payloadObj[key];
        }
      }
    }

    // Reserved engine-supplied keys are set last so they always win.
    context.resolution = currentResolution;
    context.epsilon = epsilon;
    context.hash = hash;
    context.payload = node.payload;
    context.type = node.type;
    context.timestamp = node.timestamp;
    context.__visited = visited; // Pass visited set through context
    context.__encountered_types = encounteredTypes; // Pass encountered types set

    const output = await engine.parseAndRender(template, context);

    visited.delete(hash);
    return output;
  } catch (error) {
    visited.delete(hash);
    throw error;
  }
}

/**
 * Find a template for a given type hash
 */
async function findTemplate(
  store: Store,
  typeHash: Hash,
  format: string,
): Promise<string | null> {
  const varName = `@ocas/template/${format}/${typeHash}`;

  try {
    // Find the string schema hash (we need this to query variables)
    const stringSchema = putSchema(store, { type: "string" });

    const variable = store.var.get(varName, stringSchema);
    if (variable === null) {
      return null;
    }

    const templateNode = store.cas.get(variable.value);
    if (templateNode === null) {
      return null;
    }

    // Template should be a string
    if (typeof templateNode.payload !== "string") {
      return null;
    }

    return templateNode.payload;
  } catch {
    return null;
  }
}

/**
 * Fallback renderer for nodes without templates
 */
function renderFallback(payload: unknown): string {
  // Simple YAML-like representation
  if (payload === null) {
    return "null\n";
  }

  if (typeof payload === "string") {
    return `${payload}\n`;
  }

  if (typeof payload === "number" || typeof payload === "boolean") {
    return `${payload}\n`;
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return "[]\n";
    }
    return `- ${payload.join("\n- ")}\n`;
  }

  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return "{}\n";
    }
    const pairs = keys.map((key) => `${key}: ${obj[key]}`);
    return `${pairs.join("\n")}\n`;
  }

  return "null\n";
}
