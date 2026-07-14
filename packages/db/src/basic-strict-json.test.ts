import { describe, expect, test } from "vitest";

import {
  hasOnlyUnicodeScalarJsonStrings,
  parseBasicStrictJsonText,
} from "./collection/basic-strict-json.js";

const STRICT_JSON_ERROR = /^Basic strict JSON text is invalid$/;

describe("Basic strict JSON text parser", () => {
  test.each([
    ["top-level", '{"value":1,"value":2}'],
    ["nested", '{"nested":{"value":1,"value":2}}'],
    ["escaped-equivalent", '{"a":1,"\\u0061":2}'],
  ])("rejects %s duplicate object members", (_label, text) => {
    expect(() => parseBasicStrictJsonText(text)).toThrowError(STRICT_JSON_ERROR);
  });

  test("allows the same member name in sibling objects", () => {
    expect(parseBasicStrictJsonText(
      '{"left":{"value":1},"right":{"value":2}}',
    )).toEqual({ left: { value: 1 }, right: { value: 2 } });
  });

  test("keeps __proto__ as a frozen own data property", () => {
    const parsed = parseBasicStrictJsonText(
      '{"__proto__":{"polluted":true},"constructor":"data"}',
    ) as Record<string, unknown>;

    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed.__proto__).toEqual({ polluted: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.__proto__)).toBe(true);
  });

  test.each([
    ["escaped pair", '"\\uD83D\\uDE00"'],
    ["raw supplementary text", '"\u{1F600}"'],
  ])("accepts valid Unicode scalar %s", (_label, text) => {
    expect(parseBasicStrictJsonText(text)).toBe("\u{1F600}");
  });

  test.each([
    ["escaped high surrogate", '"\\uD800"'],
    ["escaped low surrogate", '"\\uDC00"'],
    ["raw high surrogate", '"\uD800"'],
    ["raw low surrogate", '"\uDC00"'],
    ["high surrogate followed by text", '"\\uD800x"'],
  ])("rejects an unpaired %s", (_label, text) => {
    expect(() => parseBasicStrictJsonText(text)).toThrowError(STRICT_JSON_ERROR);
  });

  test.each(["\uD800", "\uDC00"])(
    "rejects lone-surrogate %s values and keys in an existing JSON tree",
    (surrogate) => {
      expect(hasOnlyUnicodeScalarJsonStrings({ value: surrogate })).toBe(false);
      expect(hasOnlyUnicodeScalarJsonStrings({ [surrogate]: null })).toBe(false);
    },
  );

  test.each([
    ["empty input", ""],
    ["trailing material", "null true"],
    ["trailing comma", "[1,]"],
    ["missing comma", "[1 2]"],
    ["missing colon", '{"value" 1}'],
    ["invalid escape", '"\\x20"'],
    ["short Unicode escape", '"\\u123"'],
    ["raw control character", '"line\nfeed"'],
  ])("rejects malformed syntax: %s", (_label, text) => {
    expect(() => parseBasicStrictJsonText(text)).toThrowError(STRICT_JSON_ERROR);
  });

  test.each([
    ["0", 0],
    ["-0", -0],
    ["-12", -12],
    ["1.25", 1.25],
    ["1e2", 100],
    ["1E-2", 0.01],
  ])("accepts complete JSON number %s", (text, expected) => {
    expect(Object.is(parseBasicStrictJsonText(text), expected)).toBe(true);
  });

  test.each([
    "+1",
    "01",
    "-01",
    ".1",
    "1.",
    "1e",
    "1e+",
    "--1",
    "NaN",
    "Infinity",
    "1e400",
  ])("rejects invalid or non-finite JSON number %s", (text) => {
    expect(() => parseBasicStrictJsonText(text)).toThrowError(STRICT_JSON_ERROR);
  });

  test("enforces the nesting-depth boundary", () => {
    expect(() => parseBasicStrictJsonText(
      `${"[".repeat(64)}null${"]".repeat(64)}`,
    )).not.toThrow();
    expect(() => parseBasicStrictJsonText(
      `${"[".repeat(65)}null${"]".repeat(65)}`,
    )).toThrowError(STRICT_JSON_ERROR);
  });

  test("enforces the per-object property boundary", () => {
    expect(() => parseBasicStrictJsonText(objectWithProperties(256))).not.toThrow();
    expect(() => parseBasicStrictJsonText(objectWithProperties(257)))
      .toThrowError(STRICT_JSON_ERROR);
  });

  test("enforces the total-node boundary", () => {
    expect(() => parseBasicStrictJsonText(arrayWithNulls(65_535))).not.toThrow();
    expect(() => parseBasicStrictJsonText(arrayWithNulls(65_536)))
      .toThrowError(STRICT_JSON_ERROR);
  });

  test("enforces the decoded string-byte boundary", () => {
    expect(() => parseBasicStrictJsonText(JSON.stringify("a".repeat(65_536))))
      .not.toThrow();
    expect(() => parseBasicStrictJsonText(JSON.stringify("a".repeat(65_537))))
      .toThrowError(STRICT_JSON_ERROR);
  });

  test("returns a detached recursively frozen tree", () => {
    const text = '{"nested":{"value":1},"items":[2]}';
    const parsed = parseBasicStrictJsonText(text) as {
      nested: { value: number };
      items: number[];
    };

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.nested)).toBe(true);
    expect(Object.isFrozen(parsed.items)).toBe(true);
    expect(() => { parsed.nested.value = 2; }).toThrow();
    expect(text).toBe('{"nested":{"value":1},"items":[2]}');
  });
});

function objectWithProperties(count: number): string {
  return `{${Array.from(
    { length: count },
    (_, index) => `"key-${index}":null`,
  ).join(",")}}`;
}

function arrayWithNulls(count: number): string {
  return `[${Array.from({ length: count }, () => "null").join(",")}]`;
}
