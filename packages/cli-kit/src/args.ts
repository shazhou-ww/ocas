import type { FlagDefinition, ParsedFlags } from "./types.js";

export interface ParseResult {
  positionals: string[];
  flags: ParsedFlags;
}

export function parseArgv(
  argv: string[],
  knownFlags: Record<string, FlagDefinition>,
  allowRenderFlag: boolean,
): ParseResult {
  const definitions: Record<string, FlagDefinition> = {
    format: { type: "string", default: "yaml" },
    compact: { type: "boolean", default: false },
    quiet: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    ...knownFlags,
    ...(allowRenderFlag ? { render: { type: "boolean", default: false } } : {}),
  };
  const flags: ParsedFlags = {
    format: "yaml",
    compact: false,
    quiet: false,
    json: false,
  };
  if (allowRenderFlag) {
    flags.render = false;
  }
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.default !== undefined) {
      flags[name] = definition.default;
    } else if (definition.type === "boolean") {
      flags[name] = false;
    }
  }

  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === "-r") {
      if (!allowRenderFlag) {
        throw new Error("Unknown option: -r");
      }
      flags.render = true;
      continue;
    }
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    let key = "";
    let inlineValue: string | undefined;
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eqIdx = body.indexOf("=");
      if (eqIdx >= 0) {
        key = body.slice(0, eqIdx);
        inlineValue = body.slice(eqIdx + 1);
      } else {
        key = body;
      }
    } else {
      const body = token.slice(1);
      if (body.length !== 1) {
        throw new Error(`Unknown option: ${token}`);
      }
      key = body;
    }

    const definition = definitions[key];
    if (!definition) {
      throw new Error(`Unknown option: --${key}`);
    }

    if (definition.type === "boolean") {
      flags[key] = true;
      continue;
    }

    const value = inlineValue ?? argv[i + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new Error(`Missing value for --${key}`);
    }
    if (inlineValue === undefined) {
      i++;
    }

    if (definition.type === "number") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid number for --${key}: ${value}`);
      }
      flags[key] = parsed;
      continue;
    }

    const existing = flags[key];
    if (
      key === "tag" &&
      definition.type === "string" &&
      existing !== undefined &&
      existing !== definition.default
    ) {
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        flags[key] = [String(existing), value];
      }
      continue;
    }

    flags[key] = value;
  }

  // --json implies compact JSON output, but does NOT override --format
  // (which may be used for command-specific purposes like --format html).
  // The json→format mapping is handled in cli.ts's run() instead.

  return { positionals, flags };
}
