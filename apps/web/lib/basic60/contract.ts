import type { Basic60Envelope, Basic60Meta } from "@/lib/basic60/types";

export const BASIC60_RELEASE_ID = "BASIC60-PRIVATE-R1" as const;
export const BASIC60_RELEASE_PROFILE = "basic60_private" as const;
export const BASIC60_FORMAL_GATE_STATUS = "pending" as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isBasic60Meta(value: unknown): value is Basic60Meta {
  if (!isObject(value)) return false;
  return (
    value.release_id === BASIC60_RELEASE_ID &&
    value.release_profile === BASIC60_RELEASE_PROFILE &&
    value.formal_gate_status === BASIC60_FORMAL_GATE_STATUS &&
    value.coverage_level === "Basic" &&
    typeof value.as_of === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.as_of) &&
    Number.isInteger(value.result_count) &&
    Number(value.result_count) >= 0 &&
    (value.next_cursor === undefined ||
      value.next_cursor === null ||
      typeof value.next_cursor === "string")
  );
}

export function isBasic60Envelope<T>(value: unknown): value is Basic60Envelope<T> {
  return isObject(value) && isBasic60Meta(value.meta) && "data" in value;
}
