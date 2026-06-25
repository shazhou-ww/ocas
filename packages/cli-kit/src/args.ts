import type { FlagDefinition, OutputFormat, ParsedFlags } from "./types.js";

export interface ParseResult {
  positionals: string[];
  flags: ParsedFlags;
}

function buildAliasMap(
  definitions: Record<string, FlagDefinition>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.alias !== undefined) {
      map[definition.alias] = name;
    }
  }
  return map;
}

export function parseArgv(
  argv: string[],
  knownFlags: Record<string, FlagDefinition>,
  allowRenderFlag: boolean,
): ParseResult {
  const definitions: Record<string, FlagDefinition> = {
    format: { type: "string" },
    compact: { type: "boolean", default: false },
    quiet: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    ...knownFlags,
    ...(allowRenderFlag ? { render: { type: "boolean", default: false } } : {}),
  };
  const aliasMap = buildAliasMap(definitions);

  const flags: ParsedFlags = {
    compact: false,
    quiet: false,
    json: false,
  };
  if (allowRenderFlag) {
    flags.render = false;
  }
  for (const [name, definition] of Object.entries(definitions)) {
    if (name === "format") {
      continue;
    }
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
      const aliasTarget = aliasMap.r;
      if (aliasTarget !== undefined && aliasTarget !== "render") {
        const definition = definitions[aliasTarget];
        if (!definition) {
          throw new Error("Unknown option: -r");
        }
        if (definition.type === "boolean") {
          flags[aliasTarget] = true;
          continue;
        }
        const value = argv[i + 1];
        if (value === undefined || value.startsWith("-")) {
          throw new Error(`Missing value for --${aliasTarget}`);
        }
        i++;
        if (definition.type === "number") {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) {
            throw new Error(`Invalid number for --${aliasTarget}: ${value}`);
          }
          flags[aliasTarget] = parsed;
        } else {
          flags[aliasTarget] = value;
        }
        continue;
      }
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

      if (key.startsWith("no-")) {
        const baseKey = key.slice(3);
        const baseDefinition = definitions[baseKey];
        if (baseDefinition?.type === "boolean") {
          flags[baseKey] = false;
          continue;
        }
        throw new Error(`Unknown option: --${key}`);
      }
    } else {
      const body = token.slice(1);
      if (body.length !== 1) {
        throw new Error(`Unknown option: ${token}`);
      }
      key = aliasMap[body] ?? body;
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

    if (key === "format") {
      flags.format = value as OutputFormat;
      flags._formatExplicit = true;
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

  return { positionals, flags };
}
