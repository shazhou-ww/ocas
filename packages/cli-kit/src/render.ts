import type { CliPlugin } from "./types.js";

function lookupPath(value: unknown, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return "";
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function renderTemplate(template: string, value: unknown): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
    const resolved = lookupPath(value, key);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

export function ocasRenderPlugin(openStore: () => unknown): CliPlugin {
  return {
    name: "ocas-render",
    enableRenderFlag: true,
    openStore,
  };
}
