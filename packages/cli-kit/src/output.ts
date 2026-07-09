import { renderTemplate } from "./render.js";
import type { FormatRenderer, OutputFormat } from "./types.js";

export function envelopeToNdjson(type: string, value: unknown): string {
  return `${JSON.stringify({ type, value })}\n`;
}

export function renderFinalOutput(
  format: OutputFormat,
  compact: boolean,
  type: string,
  value: unknown,
  formats: Record<string, FormatRenderer>,
): string {
  const renderer = formats[format];
  if (renderer !== undefined) {
    if (typeof renderer === "function") {
      return renderer(value);
    }
    return `${renderTemplate(renderer, value)}\n`;
  }
  const envelope = { type, value };
  if (format === "json") {
    return compact
      ? `${JSON.stringify(envelope)}\n`
      : `${JSON.stringify(envelope, null, 2)}\n`;
  }
  return `${toYaml(envelope)}\n`;
}

function formatYamlScalar(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value === null) return "null";
  return JSON.stringify(value);
}

function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          return `${pad}-\n${toYaml(item, indent + 2)}`;
        }
        return `${pad}- ${formatYamlScalar(item)}`;
      })
      .join("\n");
  }
  if (value !== null && typeof value === "object") {
    const rows: string[] = [];
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        item !== null &&
        typeof item === "object" &&
        !(Array.isArray(item) && item.length === 0)
      ) {
        rows.push(`${pad}${key}:`);
        rows.push(toYaml(item, indent + 2));
      } else {
        rows.push(`${pad}${key}: ${formatYamlScalar(item)}`);
      }
    }
    return rows.join("\n");
  }
  return `${pad}${formatYamlScalar(value)}`;
}
