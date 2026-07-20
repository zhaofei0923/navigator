import type { LocalizedText } from "@navigator/shared-types/i18n";

export interface BasicNumericTemplateInput {
  readonly value: string | number;
  readonly unit: string;
  readonly year: string | number;
  readonly sourceIds: readonly string[];
}

const TOKEN = /^[^\u0000-\u001f\u007f]+$/;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function renderBasicNumericTemplate(
  input: BasicNumericTemplateInput,
): LocalizedText {
  try {
    const value = token(input.value);
    const year = token(input.year);
    if (
      value === null || !validToken(input.unit) || year === null ||
      !Array.isArray(input.sourceIds) || input.sourceIds.length === 0 ||
      input.sourceIds.some((sourceId) => !SOURCE_ID.test(sourceId)) ||
      new Set(input.sourceIds).size !== input.sourceIds.length
    ) invalid();
    const sourceIds = [...input.sourceIds];
    return Object.freeze({
      zh: `${year}年该指标为${value} ${input.unit}（来源：${sourceIds.join("、")}）`,
      en: `The indicator was ${value} ${input.unit} in ${year} (Sources: ${sourceIds.join(", ")})`,
    });
  } catch {
    throw new Error("BASIC numeric template input is invalid");
  }
}

function token(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  return validToken(value) ? value : null;
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && TOKEN.test(value);
}

function invalid(): never {
  throw new Error("invalid");
}
