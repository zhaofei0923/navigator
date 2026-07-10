const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const QUOTED_STRING = /^"(?:[\t !#-\[\]-~]|\\[\t !-~])*"$/;

export function isBasicJsonContentType(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim()) return false;
  const parts = value.split(";");
  const mediaType = parts.shift();
  if (mediaType === undefined) return false;
  const slash = mediaType.indexOf("/");
  if (slash <= 0 || slash !== mediaType.lastIndexOf("/")) return false;
  const type = mediaType.slice(0, slash);
  const subtype = mediaType.slice(slash + 1);
  if (!TOKEN.test(type) || !TOKEN.test(subtype)) return false;
  const normalizedType = type.toLowerCase();
  const normalizedSubtype = subtype.toLowerCase();
  return (
    (normalizedType === "application" && normalizedSubtype === "json") ||
    (normalizedSubtype.length > "+json".length && normalizedSubtype.endsWith("+json"))
  ) && parts.every(isParameter);
}

function isParameter(value: string): boolean {
  const parameter = value.trim();
  const equals = parameter.indexOf("=");
  if (equals <= 0) return false;
  const name = parameter.slice(0, equals);
  const parameterValue = parameter.slice(equals + 1);
  return TOKEN.test(name) && (
    TOKEN.test(parameterValue) || QUOTED_STRING.test(parameterValue)
  );
}
