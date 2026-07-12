import { isProxy } from "node:util/types";

import { parse } from "csv-parse/sync";

export interface BasicCsvTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface BasicCsvCell {
  readonly locator: string;
  readonly rawValue: string;
}

const TABLE_KEYS = ["headers", "rows"] as const;
const INPUT_ERROR = "basic CSV input is invalid";
const LOCATOR_ERROR = "basic CSV locator is invalid";
const MAX_RAW_BYTES = 10 * 1024 * 1024;
const MAX_DATA_ROWS = 100_000;
const MAX_COLUMNS = 256;
const MAX_HEADER_BYTES = 256;
const MAX_CELL_BYTES = 65_536;
const MAX_RECORD_BYTES = 1_048_576;

export function parseBasicCsv(body: Uint8Array): BasicCsvTable {
  try {
    if (!(body instanceof Uint8Array) || isProxy(body)) invalidInput();
    const snapshot = new Uint8Array(body);
    if (snapshot.byteLength === 0 || snapshot.byteLength > MAX_RAW_BYTES) {
      invalidInput();
    }
    let text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(snapshot);
    if (text.startsWith("\uFEFF")) text = text.slice(1);
    if (text === "" || text.includes("\uFEFF")) invalidInput();
    validateLexicalBoundaries(text);
    const parsed: unknown = parse(text, {
      delimiter: ",",
      record_delimiter: ["\r\n", "\n"],
      relax_quotes: false,
      relax_column_count: false,
      skip_empty_lines: false,
      cast: false,
      columns: false,
      ltrim: false,
      rtrim: false,
      max_record_size: MAX_RECORD_BYTES,
    }) as unknown;
    return reconstructTable(parsed);
  } catch {
    throw new Error(INPUT_ERROR);
  }
}

export function locateBasicCsvCell(
  table: BasicCsvTable,
  zeroBasedDataRow: number,
  header: string,
): BasicCsvCell {
  try {
    validateFrozenTable(table);
    if (
      !Number.isSafeInteger(zeroBasedDataRow) ||
      zeroBasedDataRow < 0 ||
      typeof header !== "string"
    ) invalidLocator();
    const column = table.headers.indexOf(header);
    const row = table.rows[zeroBasedDataRow];
    if (column < 0 || row === undefined) invalidLocator();
    const rawValue = row[column];
    if (rawValue === undefined) invalidLocator();
    return Object.freeze({
      locator:
        `csv:/rows/${zeroBasedDataRow}/columns/${escapeBasicCsvLocatorHeader(header)}`,
      rawValue,
    });
  } catch {
    throw new Error(LOCATOR_ERROR);
  }
}

export function escapeBasicCsvLocatorHeader(header: string): string {
  try {
    validateHeader(header);
    return header.replaceAll("~", "~0").replaceAll("/", "~1");
  } catch {
    throw new Error(LOCATOR_ERROR);
  }
}

function reconstructTable(value: unknown): BasicCsvTable {
  const records = denseArray(value, MAX_DATA_ROWS + 1, false);
  const headerRecord = records[0];
  const rawHeaders = denseArray(headerRecord, MAX_COLUMNS, false);
  const headers = Object.freeze(rawHeaders.map((header) => {
    validateHeader(header);
    return header;
  }));
  if (new Set(headers).size !== headers.length) invalidInput();
  const rawRows = records.slice(1);
  if (rawRows.length > MAX_DATA_ROWS) invalidInput();
  const rows = Object.freeze(rawRows.map((rawRow) => {
    const cells = denseArray(rawRow, MAX_COLUMNS, true);
    if (cells.length !== headers.length) invalidInput();
    return Object.freeze(cells.map((cell) => {
      validateCell(cell);
      return cell;
    }));
  }));
  return Object.freeze({ headers, rows });
}

function validateFrozenTable(value: unknown): asserts value is BasicCsvTable {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Object.isFrozen(value)
  ) invalidLocator();
  const properties = exactDataProperties(value, TABLE_KEYS);
  if (properties === null) invalidLocator();
  const headers = frozenDenseStringArray(
    properties.get("headers"),
    MAX_COLUMNS,
    false,
    validateHeader,
  );
  if (new Set(headers).size !== headers.length) invalidLocator();
  const rows = frozenDenseArray(
    properties.get("rows"),
    MAX_DATA_ROWS,
    true,
  );
  for (const row of rows) {
    const cells = frozenDenseStringArray(
      row,
      MAX_COLUMNS,
      true,
      validateCell,
    );
    if (cells.length !== headers.length) invalidLocator();
  }
}

function denseArray(
  value: unknown,
  maximum: number,
  allowEmpty: boolean,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    (!allowEmpty && value.length === 0) ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) invalidInput();
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) invalidInput();
    result.push(descriptor.value);
  }
  return result;
}

function frozenDenseArray(
  value: unknown,
  maximum: number,
  allowEmpty: boolean,
): readonly unknown[] {
  if (!Object.isFrozen(value)) invalidLocator();
  try {
    return denseArray(value, maximum, allowEmpty);
  } catch {
    invalidLocator();
  }
}

function frozenDenseStringArray(
  value: unknown,
  maximum: number,
  allowEmpty: boolean,
  validate: (item: unknown) => asserts item is string,
): readonly string[] {
  const items = frozenDenseArray(value, maximum, allowEmpty);
  for (const item of items) {
    try {
      validate(item);
    } catch {
      invalidLocator();
    }
  }
  return items as readonly string[];
}

function exactDataProperties(
  value: object,
  expectedKeys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some(
        (key) => typeof key !== "string" || !expectedKeys.includes(key),
      )
    ) return null;
    const properties = new Map<string, unknown>();
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) return null;
      properties.set(key, descriptor.value);
    }
    return properties;
  } catch {
    return null;
  }
}

function validateLexicalBoundaries(value: string): void {
  let inQuotes = false;
  let lineStart = true;
  let recordStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '"') {
      if (inQuotes && value[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      lineStart = false;
      continue;
    }
    if (inQuotes) continue;
    if (lineStart && character === "#") invalidInput();
    if (character === "\r" && value[index + 1] !== "\n") invalidInput();
    if (character === "\n") {
      if (lineStart) invalidInput();
      validateRecordBytes(value.slice(recordStart, index + 1));
      recordStart = index + 1;
      lineStart = true;
      continue;
    }
    lineStart = false;
  }
  if (recordStart < value.length) {
    validateRecordBytes(value.slice(recordStart));
  }
}

function validateRecordBytes(value: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_RECORD_BYTES) invalidInput();
}

function validateHeader(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > MAX_HEADER_BYTES
  ) invalidInput();
}

function validateCell(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_CELL_BYTES
  ) invalidInput();
}

function invalidInput(): never {
  throw new Error(INPUT_ERROR);
}

function invalidLocator(): never {
  throw new Error(LOCATOR_ERROR);
}
