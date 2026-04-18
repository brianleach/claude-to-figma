/**
 * Resolve `var(--name, fallback)` references in a CSS value.
 *
 * Variables themselves come from the cascade — they cascade and inherit like
 * any other property. The cascade orchestrator passes a `lookup` function that
 * returns the variable's already-resolved value (or undefined if undeclared).
 */

const VAR_RE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]*))?\)/g;

/**
 * Resolve `var()` references in `value`. Stops at depth 16 to bail out of
 * infinite cycles. Returns the value unchanged if no var() is present.
 */
export function resolveVars(
  value: string,
  lookup: (name: string) => string | undefined,
  depth = 0,
): string {
  if (depth > 16) return value;
  if (!value.includes('var(')) return value;
  return value.replace(VAR_RE, (_match, name: string, fallback: string | undefined) => {
    const resolved = lookup(name);
    if (resolved != null) return resolveVars(resolved, lookup, depth + 1);
    if (fallback != null) return resolveVars(fallback.trim(), lookup, depth + 1);
    return '';
  });
}
