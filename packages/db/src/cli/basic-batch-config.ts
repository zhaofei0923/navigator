export interface BasicBatchConfig {
  readonly countries: readonly string[];
  readonly batchId: string;
}

const ISO2 = /^[A-Z]{2}$/;
const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function parseBasicBatchArguments(args: readonly string[]): BasicBatchConfig {
  try {
    if (!Array.isArray(args) || args.length !== 2) invalid();
    const values: readonly string[] = args;
    const countriesArg = values.find((value) => value.startsWith("--countries="));
    const batchArg = values.find((value) => value.startsWith("--batch-id="));
    if (countriesArg === undefined || batchArg === undefined) invalid();
    const countries = countriesArg.slice("--countries=".length).split(",");
    const batchId = batchArg.slice("--batch-id=".length);
    if (
      countries.length < 1 || countries.length > 3 ||
      countries.some((country: string) => !ISO2.test(country)) ||
      new Set(countries).size !== countries.length || !SAFE_ID.test(batchId)
    ) invalid();
    return Object.freeze({ countries: Object.freeze([...countries]), batchId });
  } catch {
    throw new Error("basic batch config is invalid");
  }
}

export function validateBasicBatchConfig(value: BasicBatchConfig): BasicBatchConfig {
  return parseBasicBatchArguments([
    `--countries=${value.countries.join(",")}`,
    `--batch-id=${value.batchId}`,
  ]);
}

function invalid(): never {
  throw new Error("invalid");
}
