import { type Context, Liquid, type TagToken } from "liquidjs";
import type { Hash, Store } from "./types.js";
import type { VariableStore } from "./variable-store.js";

export type RenderOptions = {
  resolution?: number; // (0, 1], default 1.0
  decay?: number; // (0, 1], default 0.5
  epsilon?: number; // >= 0, default 0.01
};

const DEFAULT_RESOLUTION = 1.0;
const DEFAULT_DECAY = 0.5;
const DEFAULT_EPSILON = 0.01;
const FLOAT_TOLERANCE = 1e-10;

// Context for render operations
type RenderContext = {
  store: Store;
  varStore: VariableStore;
  globalDecay: number;
  epsilon: number;
  engine: Liquid | null;
};

/**
 * Render a CAS node using LiquidJS templates with resolution-based decay.
 * Templates are discovered via variables: @ucas/template/text/<type-hash>
 */
export async function renderWithTemplate(
  store: Store,
  varStore: VariableStore,
  hash: Hash,
  options?: RenderOptions,
): Promise<string> {
  const resolution = options?.resolution ?? DEFAULT_RESOLUTION;
  const decay = options?.decay ?? DEFAULT_DECAY;
  const epsilon = options?.epsilon ?? DEFAULT_EPSILON;

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
  const ctx: RenderContext = {
    store,
    varStore,
    globalDecay: decay,
    epsilon,
    engine: null,
  };

  const engine = createLiquidEngine(ctx);
  ctx.engine = engine;

  return await renderNode(ctx, hash, resolution, visited);
}

/**
 * Create a Liquid engine instance with custom render tag
 * Returns both the engine and a function to register the render tag
 */
function createLiquidEngine(ctx: RenderContext): Liquid {
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
  // We need to capture ctx in closure
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

      // Compute child resolution using decay priority:
      // 1. Template explicit decay (explicitDecay)
      // 2. Global decay (from CLI/options)
      // 3. Engine default (0.5)
      const effectiveDecay =
        explicitDecay !== undefined
          ? explicitDecay
          : (ctx.globalDecay ?? DEFAULT_DECAY);
      const childResolution = currentResolution * effectiveDecay;

      // Recursively render the referenced node
      const visited = ctxLiquid.get(["__visited"]) as Set<Hash>;
      const output = await renderNode(ctx, nodeHash, childResolution, visited);

      return output;
    },
  });

  return engine;
}

/**
 * Render a single node with template or fallback to cas: reference
 */
async function renderNode(
  ctx: RenderContext,
  hash: Hash,
  currentResolution: number,
  visited: Set<Hash>,
): Promise<string> {
  // Check if resolution is below threshold
  if (currentResolution < ctx.epsilon + FLOAT_TOLERANCE) {
    return `cas:${hash}`;
  }

  // Fetch the node
  const node = ctx.store.get(hash);
  if (node === null) {
    return `cas:${hash}`;
  }

  // Cycle detection
  if (visited.has(hash)) {
    return `cas:${hash}`;
  }
  visited.add(hash);

  try {
    // Try to find a template for this node's type
    const template = await findTemplate(ctx.store, ctx.varStore, node.type);

    if (template === null) {
      // No template found - this is handled by the caller (fallback to YAML)
      // For now, return a simple representation
      visited.delete(hash);
      return renderFallback(ctx.store, node.payload);
    }

    // Render using the template
    const context = {
      resolution: currentResolution,
      epsilon: ctx.epsilon,
      hash,
      payload: node.payload,
      type: node.type,
      timestamp: node.timestamp,
      __visited: visited, // Pass visited set through context
    };

    const output = await ctx.engine.parseAndRender(template, context);

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
  varStore: VariableStore,
  typeHash: Hash,
): Promise<string | null> {
  const varName = `@ucas/template/text/${typeHash}`;

  try {
    // Find the string schema hash (we need this to query variables)
    const stringSchemaNode = await findStringSchema(store);
    if (stringSchemaNode === null) {
      return null;
    }

    const variable = varStore.get(varName, stringSchemaNode);
    if (variable === null) {
      return null;
    }

    const templateNode = store.get(variable.value);
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
 * Find the hash of the string schema
 */
async function findStringSchema(store: Store): Promise<Hash | null> {
  // The string schema is { type: "string" }
  // We need to compute its hash or find it in the store
  // For now, we'll use a heuristic: look for a schema with this exact structure

  // Import putSchema to compute the hash
  const { putSchema } = await import("./schema.js");
  const stringSchema = await putSchema(store, { type: "string" });
  return stringSchema;
}

/**
 * Fallback renderer for nodes without templates
 */
function renderFallback(_store: Store, payload: unknown): string {
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
