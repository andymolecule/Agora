export function normalizeOptionalAddress(
  value: string | null | undefined,
): string | null {
  return typeof value === "string" && value.length > 0
    ? value.toLowerCase()
    : null;
}
