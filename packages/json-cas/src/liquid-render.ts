import { type Context, Liquid, type TagToken } from "liquidjs";
import type { RenderOptions } from "./render.js";
import { putSchema } from "./schema.js";
import type { Hash, Store } from "./types.js";
import type { VariableStore } from "./variable-store.js";

const DEFAULT_RESOLUTION = 1.0;
const DEFAULT_DECAY = 0.5;
const DEFAULT_EPSILON = 0.01;
const FLOAT_TOLERANCE = 1e-10;

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

  // Create Liquid engine
  const engine = createLiquidEngine(store, varStore, decay);

  return await renderNode(
    engine,
    store,
    varStore,
    hash,
    resolution,
    epsilon,
    visited,
  );
}

/**
 * Create a Liquid engine instance with custom render tag
 */
function createLiquidEngine(
  store: Store,
  varStore: VariableStore,
  globalDecay: number,
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
  // Capture store, varStore, globalDecay in closure
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
      const output = await renderNode(
        engine,
        store,
        varStore,
        nodeHash,
        childResolution,
        currentEpsilon,
        visited,
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
  varStore: VariableStore,
  hash: Hash,
  currentResolution: number,
  epsilon: number,
  visited: Set<Hash>,
): Promise<string> {
  // Check if resolution is below threshold
  if (currentResolution < epsilon + FLOAT_TOLERANCE) {
    return `cas:${hash}`;
  }

  // Fetch the node
  const node = store.get(hash);
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
    const template = await findTemplate(store, varStore, node.type);

    if (template === null) {
      // No template found - this is handled by the caller (fallback to YAML)
      // For now, return a simple representation
      visited.delete(hash);
      return renderFallback(store, node.payload);
    }

    // Render using the template
    const context = {
      resolution: currentResolution,
      epsilon,
      hash,
      payload: node.payload,
      type: node.type,
      timestamp: node.timestamp,
      __visited: visited, // Pass visited set through context
    };

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
  varStore: VariableStore,
  typeHash: Hash,
): Promise<string | null> {
  const varName = `@ucas/template/text/${typeHash}`;

  try {
    // Find the string schema hash (we need this to query variables)
    const stringSchema = await putSchema(store, { type: "string" });

    const variable = varStore.get(varName, stringSchema);
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
