import { posix, resolve, win32 } from "node:path";

const DRIVE_QUALIFIED = /^[A-Za-z]:/;

export function parseBasicCandidateRelativePath(value: unknown): readonly string[] {
  if (
    typeof value !== "string" || value === "" || value.includes("\0") ||
    value.includes("\\") || posix.isAbsolute(value) || win32.isAbsolute(value) ||
    DRIVE_QUALIFIED.test(value) || posix.normalize(value) !== value
  ) invalid();
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    invalid();
  }
  return Object.freeze(segments);
}

export function parseBasicCandidatePathComponent(value: unknown): string {
  const segments = parseBasicCandidateRelativePath(value);
  if (segments.length !== 1) invalid();
  return segments[0]!;
}

export function parseBasicCandidateRepositoryRoot(value: unknown): string {
  if (
    typeof value !== "string" || value.includes("\0") || value.includes("\\") ||
    !posix.isAbsolute(value) || value.startsWith("//") || DRIVE_QUALIFIED.test(value)
  ) invalid();
  const normalized = resolve(value);
  if (normalized !== value) invalid();
  return normalized;
}

function invalid(): never {
  throw new Error("basic candidate path is invalid");
}
