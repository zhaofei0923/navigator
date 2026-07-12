import { describe, expect, test } from "vitest";

import {
  escapeBasicCsvLocatorHeader,
  locateBasicCsvCell,
  parseBasicCsv,
  type BasicCsvTable,
} from "./collection/basic-csv-parser.js";

const encoder = new TextEncoder();
const INPUT_ERROR = "basic CSV input is invalid";
const LOCATOR_ERROR = "basic CSV locator is invalid";
const RAW_LIMIT = 10 * 1024 * 1024;

describe("Basic strict CSV parser", () => {
  test.each([
    ["LF", "country,value\nVN,42\n"],
    ["CRLF", "country,value\r\nVN,42\r\n"],
    ["no final newline", "country,value\nVN,42"],
  ])("parses ordinary %s records", (_label, csv) => {
    expect(parseBasicCsv(bytes(csv))).toEqual({
      headers: ["country", "value"],
      rows: [["VN", "42"]],
    });
  });

  test("strips exactly one optional leading UTF-8 BOM", () => {
    expect(parseBasicCsv(bytes("\uFEFFcountry,value\nVN,42\n"))).toEqual({
      headers: ["country", "value"],
      rows: [["VN", "42"]],
    });
  });

  test("preserves empty cells and header-only tables", () => {
    expect(parseBasicCsv(bytes("a,b,c\n,mid,\n"))).toEqual({
      headers: ["a", "b", "c"],
      rows: [["", "mid", ""]],
    });
    expect(parseBasicCsv(bytes("a,b\n"))).toEqual({
      headers: ["a", "b"],
      rows: [],
    });
  });

  test("applies RFC 4180 quoting without changing raw cell strings", () => {
    const table = parseBasicCsv(bytes(
      "name,notes,raw\r\n" +
      "\"Doe, Jane\",\"line one\r\nline two\",\" 001.00 \"\r\n" +
      "\"quote\",\"He said \"\"yes\"\"\",\"\"\r\n",
    ));

    expect(table).toEqual({
      headers: ["name", "notes", "raw"],
      rows: [
        ["Doe, Jane", "line one\r\nline two", " 001.00 "],
        ["quote", "He said \"yes\"", ""],
      ],
    });
  });

  test("preserves decoded UTF-8 and byte-significant text", () => {
    expect(parseBasicCsv(bytes(
      "label,value\n\"\u80fd\u6e90\",\"001.2300\"\n",
    ))).toEqual({
      headers: ["label", "value"],
      rows: [["\u80fd\u6e90", "001.2300"]],
    });
  });

  test("reconstructs and recursively freezes the table", () => {
    const table = parseBasicCsv(bytes("a,b\n1,2\n"));

    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.headers)).toBe(true);
    expect(Object.isFrozen(table.rows)).toBe(true);
    expect(Object.isFrozen(table.rows[0])).toBe(true);
  });

  test.each([
    ["empty input", ""],
    ["only a newline", "\n"],
    ["blank header", ",b\n1,2\n"],
    ["whitespace header", " a,b\n1,2\n"],
    ["trailing-whitespace header", "a ,b\n1,2\n"],
    ["duplicate header", "a,a\n1,2\n"],
    ["short row", "a,b\n1\n"],
    ["long row", "a,b\n1,2,3\n"],
    ["empty physical line", "a\n\nb\n"],
    ["empty CRLF physical line", "a\r\n\r\nb\r\n"],
    ["comment line", "a\n# comment\n"],
    ["malformed quote", "a,b\n\"unterminated,2\n"],
    ["relaxed quote", "a,b\ninvalid\"quote,2\n"],
    ["second leading BOM", "\uFEFF\uFEFFa\n1\n"],
    ["interior BOM", "a,b\n1,\uFEFF2\n"],
  ])("rejects %s", (_label, csv) => {
    expect(() => parseBasicCsv(bytes(csv))).toThrow(INPUT_ERROR);
  });

  test("uses fatal UTF-8 decoding", () => {
    expect(() => parseBasicCsv(new Uint8Array([0x61, 0x0a, 0xc3, 0x28])))
      .toThrow(INPUT_ERROR);
  });

  test.each([
    new Uint8Array(),
    new DataView(new ArrayBuffer(1)),
    { 0: 1, length: 1 },
  ])("rejects non-Uint8Array input %#", (value) => {
    expect(() => parseBasicCsv(value as Uint8Array)).toThrow(INPUT_ERROR);
  });

  test("enforces the raw payload limit exactly", () => {
    const exact = csvAtRawLimit(RAW_LIMIT);
    expect(exact.byteLength).toBe(RAW_LIMIT);
    expect(() => parseBasicCsv(exact)).not.toThrow();

    const oversized = new Uint8Array(RAW_LIMIT + 1);
    oversized.set(exact);
    oversized[RAW_LIMIT] = 0x61;
    expect(() => parseBasicCsv(oversized)).toThrow(INPUT_ERROR);
  });

  test("enforces the data-row limit exactly", () => {
    expect(parseBasicCsv(repeatedRows(100_000)).rows).toHaveLength(100_000);
    expect(() => parseBasicCsv(repeatedRows(100_001))).toThrow(INPUT_ERROR);
  });

  test("enforces the column limit exactly", () => {
    expect(parseBasicCsv(columnCsv(256)).headers).toHaveLength(256);
    expect(() => parseBasicCsv(columnCsv(257))).toThrow(INPUT_ERROR);
  });

  test("enforces the header UTF-8 byte limit exactly", () => {
    expect(parseBasicCsv(bytes(`${"h".repeat(256)}\nvalue\n`)).headers[0])
      .toHaveLength(256);
    expect(() => parseBasicCsv(bytes(
      `${"h".repeat(257)}\nvalue\n`,
    ))).toThrow(INPUT_ERROR);
  });

  test("measures header limits in UTF-8 bytes", () => {
    expect(() => parseBasicCsv(bytes(`${"\u80fd".repeat(85)}a\nvalue\n`)))
      .not.toThrow();
    expect(() => parseBasicCsv(bytes(`${"\u80fd".repeat(86)}\nvalue\n`)))
      .toThrow(INPUT_ERROR);
  });

  test("enforces the cell UTF-8 byte limit exactly", () => {
    expect(parseBasicCsv(bytes(
      `value\n${"a".repeat(65_536)}\n`,
    )).rows[0]?.[0]).toHaveLength(65_536);
    expect(() => parseBasicCsv(bytes(
      `value\n${"a".repeat(65_537)}\n`,
    ))).toThrow(INPUT_ERROR);
  });

  test("enforces the parser record-byte limit exactly", () => {
    const exact = recordLimitCsv(1_048_576);
    const oversized = recordLimitCsv(1_048_577);

    expect(() => parseBasicCsv(exact)).not.toThrow();
    expect(() => parseBasicCsv(oversized)).toThrow(INPUT_ERROR);
  });
});

describe("Basic CSV locator", () => {
  test("locates a raw cell by zero-based data row and exact header", () => {
    const table = parseBasicCsv(bytes("country,gdp\nVN,476300000000\n"));

    expect(locateBasicCsvCell(table, 0, "gdp")).toEqual({
      locator: "csv:/rows/0/columns/gdp",
      rawValue: "476300000000",
    });
  });

  test("escapes RFC 6901 header tokens in the locator", () => {
    const table = parseBasicCsv(bytes("a/b,til~de,/~\n1,2,3\n"));

    expect(escapeBasicCsvLocatorHeader("/~")).toBe("~1~0");
    expect(locateBasicCsvCell(table, 0, "a/b")).toEqual({
      locator: "csv:/rows/0/columns/a~1b",
      rawValue: "1",
    });
    expect(locateBasicCsvCell(table, 0, "til~de")).toEqual({
      locator: "csv:/rows/0/columns/til~0de",
      rawValue: "2",
    });
    expect(locateBasicCsvCell(table, 0, "/~")).toEqual({
      locator: "csv:/rows/0/columns/~1~0",
      rawValue: "3",
    });
  });

  test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid row index %s",
    (row) => {
      const table = parseBasicCsv(bytes("a\n1\n"));
      expect(() => locateBasicCsvCell(table, row, "a")).toThrow(
        LOCATOR_ERROR,
      );
    },
  );

  test("rejects absent rows and headers", () => {
    const table = parseBasicCsv(bytes("a\n1\n"));

    expect(() => locateBasicCsvCell(table, 1, "a")).toThrow(LOCATOR_ERROR);
    expect(() => locateBasicCsvCell(table, 0, "missing")).toThrow(
      LOCATOR_ERROR,
    );
  });

  test.each(["table", "headers", "rows", "row"] as const)(
    "rejects non-frozen %s input",
    (kind) => {
      const parsed = parseBasicCsv(bytes("a\n1\n"));
      const table = mutableTable(parsed, kind);

      expect(() => locateBasicCsvCell(table, 0, "a")).toThrow(
        LOCATOR_ERROR,
      );
    },
  );

  test.each(["extra", "symbol", "accessor", "proxy"] as const)(
    "rejects an exact-shape %s table violation",
    (kind) => {
      const probe = { executions: 0 };
      const table = unsafeTable(kind, probe);

      expect(() => locateBasicCsvCell(table, 0, "a")).toThrow(
        LOCATOR_ERROR,
      );
      expect(probe.executions).toBe(0);
    },
  );

  test("returns a frozen cell snapshot", () => {
    const table = parseBasicCsv(bytes("a\n1\n"));
    const cell = locateBasicCsvCell(table, 0, "a");

    expect(Object.isFrozen(cell)).toBe(true);
  });

  test("rejects malformed Unicode in a forged frozen table", () => {
    const malformedHeader = Object.freeze({
      headers: Object.freeze(["\uD800"]),
      rows: Object.freeze([Object.freeze(["1"])]),
    });
    const malformedCell = Object.freeze({
      headers: Object.freeze(["a"]),
      rows: Object.freeze([Object.freeze(["\uDFFF"])]),
    });

    expect(() => locateBasicCsvCell(malformedHeader, 0, "\uD800")).toThrow(
      LOCATOR_ERROR,
    );
    expect(() => locateBasicCsvCell(malformedCell, 0, "a")).toThrow(
      LOCATOR_ERROR,
    );
  });
});

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function csvAtRawLimit(target: number): Uint8Array {
  const chunks = ["h\n"];
  let remaining = target - 2;
  const rowCount = Math.ceil(remaining / 65_537);
  for (let index = 0; index < rowCount; index += 1) {
    const rowsLeft = rowCount - index;
    const rowBytes = Math.min(65_537, remaining - 2 * (rowsLeft - 1));
    chunks.push(`${"a".repeat(rowBytes - 1)}\n`);
    remaining -= rowBytes;
  }
  return bytes(chunks.join(""));
}

function repeatedRows(count: number): Uint8Array {
  return bytes(`h\n${"x\n".repeat(count)}`);
}

function columnCsv(count: number): Uint8Array {
  const headers = Array.from({ length: count }, (_, index) => `h${index}`);
  const row = Array.from({ length: count }, () => "x");
  return bytes(`${headers.join(",")}\n${row.join(",")}\n`);
}

function recordLimitCsv(recordBytes: number): Uint8Array {
  const columns = 256;
  const delimiterBytes = columns;
  const valueBytes = recordBytes - delimiterBytes;
  const base = Math.floor(valueBytes / columns);
  let remainder = valueBytes % columns;
  const headers = Array.from({ length: columns }, (_, index) => `h${index}`);
  const row = Array.from({ length: columns }, () => {
    const length = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return "a".repeat(length);
  });
  return bytes(`${headers.join(",")}\n${row.join(",")}\n`);
}

function mutableTable(
  parsed: BasicCsvTable,
  kind: "table" | "headers" | "rows" | "row",
): BasicCsvTable {
  const headers = kind === "headers" ? [...parsed.headers] : parsed.headers;
  const row = kind === "row" ? [...parsed.rows[0]!] : parsed.rows[0]!;
  const rows = kind === "rows" ? [row] : Object.freeze([row]);
  const table = { headers, rows };
  return kind === "table" ? table : Object.freeze(table);
}

function unsafeTable(
  kind: "extra" | "symbol" | "accessor" | "proxy",
  probe: { executions: number },
): BasicCsvTable {
  const value: Record<PropertyKey, unknown> = {
    headers: Object.freeze(["a"]),
    rows: Object.freeze([Object.freeze(["1"])]),
  };
  if (kind === "extra") value.extra = "unsafe";
  if (kind === "symbol") value[Symbol("extra")] = "unsafe";
  if (kind === "accessor") {
    Object.defineProperty(value, "headers", {
      enumerable: true,
      get() {
        probe.executions += 1;
        throw new Error("CSV_LOCATOR_DO_NOT_LEAK");
      },
    });
  }
  const table = kind === "proxy" ? new Proxy(value, {}) : value;
  Object.freeze(table);
  return table as unknown as BasicCsvTable;
}
