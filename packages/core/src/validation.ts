import { InvalidVariableNameError } from "./errors.js";

/**
 * Validate that a variable name follows the `@scope/name` format.
 *
 * Rules:
 * - Must start with `@<scope>/` where scope is `[a-zA-Z][a-zA-Z0-9]*`
 * - Must have at least one segment after the scope
 * - Each segment may contain only `[a-zA-Z0-9._-]`
 * - No empty segments (consecutive slashes) or trailing slash
 *
 * Note: this function does NOT enforce reservation of the `@ocas/*` scope —
 * that is enforced at the CLI / bootstrap layer.
 *
 * @throws InvalidVariableNameError when name is malformed
 */
export function validateName(name: string): void {
  if (name === "") {
    throw new InvalidVariableNameError(name, "Name cannot be empty");
  }
  const match = name.match(/^@([a-zA-Z][a-zA-Z0-9]*)\/(.+)$/);
  if (!match) {
    throw new InvalidVariableNameError(
      name,
      "Name must follow @scope/name format (e.g. @myapp/config)",
    );
  }
  const rest = match[2] as string;
  if (rest.endsWith("/")) {
    throw new InvalidVariableNameError(
      name,
      "Name cannot end with trailing slash",
    );
  }
  for (const segment of rest.split("/")) {
    if (segment === "") {
      throw new InvalidVariableNameError(
        name,
        "Name contains empty segment (consecutive slashes //)",
      );
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(segment)) {
      throw new InvalidVariableNameError(
        name,
        `Segment "${segment}" contains invalid characters (only a-z, A-Z, 0-9, ., _, - allowed)`,
      );
    }
  }
}
