export function isBasicV2ReviewedSourceUrl(value: unknown): value is string {
  if (
    typeof value !== "string" || value.trim().length === 0 ||
    value.trim() !== value
  ) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" &&
      parsed.password === "" && parsed.hash === "";
  } catch {
    return false;
  }
}
