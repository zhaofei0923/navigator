import type { BasicCollectionJsonValue } from "./basic-collection-contracts.js";

const STRICT_JSON_ERROR = "Basic strict JSON text is invalid";
const MAXIMUM_INPUT_BYTES = 2 * 1024 * 1024;
const MAXIMUM_DEPTH = 64;
const MAXIMUM_OBJECT_PROPERTIES = 256;
const MAXIMUM_TOTAL_NODES = 65_536;
const MAXIMUM_STRING_BYTES = 65_536;
const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;
type StrictJsonFailureReason = "invalid" | "unicode-scalar";

export function parseBasicStrictJsonText(
  text: string,
): BasicCollectionJsonValue {
  try {
    if (
      typeof text !== "string" ||
      text.length > MAXIMUM_INPUT_BYTES ||
      new TextEncoder().encode(text).byteLength > MAXIMUM_INPUT_BYTES
    ) throw new Error(STRICT_JSON_ERROR);
    new StrictJsonScanner(text).validate();
    return freezeParsedJson(JSON.parse(text) as unknown);
  } catch (error) {
    throw error instanceof BasicStrictJsonError
      ? error
      : new BasicStrictJsonError("invalid");
  }
}

export function isBasicStrictJsonUnicodeScalarError(error: unknown): boolean {
  return error instanceof BasicStrictJsonError &&
    error.reason === "unicode-scalar";
}

export function hasOnlyUnicodeScalarJsonStrings(
  value: BasicCollectionJsonValue,
): boolean {
  const pending: BasicCollectionJsonValue[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) return false;
    if (typeof current === "string") {
      if (!isUnicodeScalarString(current)) return false;
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    if (current === null || typeof current !== "object") continue;
    for (const [key, item] of Object.entries(current)) {
      if (!isUnicodeScalarString(key)) return false;
      pending.push(item);
    }
  }
  return true;
}

class StrictJsonScanner {
  private index = 0;
  private totalNodes = 0;

  public constructor(private readonly text: string) {}

  public validate(): void {
    this.skipWhitespace();
    this.scanValue(0);
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail();
  }

  private scanValue(depth: number): void {
    this.totalNodes += 1;
    if (this.totalNodes > MAXIMUM_TOTAL_NODES) this.fail();
    const code = this.text.charCodeAt(this.index);
    if (code === 0x7b) {
      if (depth >= MAXIMUM_DEPTH) this.fail();
      this.scanObject(depth + 1);
      return;
    }
    if (code === 0x5b) {
      if (depth >= MAXIMUM_DEPTH) this.fail();
      this.scanArray(depth + 1);
      return;
    }
    if (code === 0x22) {
      this.scanString();
      return;
    }
    if (code === 0x74) {
      this.scanKeyword("true");
      return;
    }
    if (code === 0x66) {
      this.scanKeyword("false");
      return;
    }
    if (code === 0x6e) {
      this.scanKeyword("null");
      return;
    }
    if (code === 0x2d || isDigit(code)) {
      this.scanNumber();
      return;
    }
    this.fail();
  }

  private scanObject(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume(0x7d)) return;
    const names = new Set<string>();
    let propertyCount = 0;
    while (true) {
      if (this.text.charCodeAt(this.index) !== 0x22) this.fail();
      const name = this.scanString();
      propertyCount += 1;
      if (
        propertyCount > MAXIMUM_OBJECT_PROPERTIES ||
        names.has(name)
      ) this.fail();
      names.add(name);
      this.skipWhitespace();
      if (!this.consume(0x3a)) this.fail();
      this.skipWhitespace();
      this.scanValue(depth);
      this.skipWhitespace();
      if (this.consume(0x7d)) return;
      if (!this.consume(0x2c)) this.fail();
      this.skipWhitespace();
    }
  }

  private scanArray(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume(0x5d)) return;
    while (true) {
      this.scanValue(depth);
      this.skipWhitespace();
      if (this.consume(0x5d)) return;
      if (!this.consume(0x2c)) this.fail();
      this.skipWhitespace();
    }
  }

  private scanString(): string {
    this.index += 1;
    const decoded: string[] = [];
    let decodedBytes = 0;
    while (this.index < this.text.length) {
      if (this.text.charCodeAt(this.index) === 0x22) {
        this.index += 1;
        return decoded.join("");
      }
      const first = this.scanStringCodeUnit();
      if (first >= HIGH_SURROGATE_START && first <= HIGH_SURROGATE_END) {
        if (
          this.index >= this.text.length ||
          this.text.charCodeAt(this.index) === 0x22
        ) this.fail("unicode-scalar");
        const second = this.scanStringCodeUnit();
        if (second < LOW_SURROGATE_START || second > LOW_SURROGATE_END) {
          this.fail("unicode-scalar");
        }
        decoded.push(String.fromCharCode(first, second));
        decodedBytes += 4;
      } else {
        if (first >= LOW_SURROGATE_START && first <= LOW_SURROGATE_END) {
          this.fail("unicode-scalar");
        }
        decoded.push(String.fromCharCode(first));
        decodedBytes += utf8ByteLength(first);
      }
      if (decodedBytes > MAXIMUM_STRING_BYTES) this.fail();
    }
    this.fail();
  }

  private scanStringCodeUnit(): number {
    if (this.index >= this.text.length) this.fail();
    const code = this.text.charCodeAt(this.index);
    if (code === 0x22 || code < 0x20) this.fail();
    this.index += 1;
    if (code !== 0x5c) return code;
    if (this.index >= this.text.length) this.fail();
    const escape = this.text.charCodeAt(this.index);
    this.index += 1;
    switch (escape) {
      case 0x22: return 0x22;
      case 0x2f: return 0x2f;
      case 0x5c: return 0x5c;
      case 0x62: return 0x08;
      case 0x66: return 0x0c;
      case 0x6e: return 0x0a;
      case 0x72: return 0x0d;
      case 0x74: return 0x09;
      case 0x75: return this.scanHexCodeUnit();
      default: this.fail();
    }
  }

  private scanHexCodeUnit(): number {
    if (this.index + 4 > this.text.length) this.fail();
    let value = 0;
    for (let offset = 0; offset < 4; offset += 1) {
      const digit = hexValue(this.text.charCodeAt(this.index + offset));
      if (digit < 0) this.fail();
      value = value * 16 + digit;
    }
    this.index += 4;
    return value;
  }

  private scanNumber(): void {
    const start = this.index;
    if (this.consume(0x2d) && !isDigit(this.text.charCodeAt(this.index))) {
      this.fail();
    }
    if (this.consume(0x30)) {
      if (isDigit(this.text.charCodeAt(this.index))) this.fail();
    } else {
      const first = this.text.charCodeAt(this.index);
      if (first < 0x31 || first > 0x39) this.fail();
      this.index += 1;
      while (isDigit(this.text.charCodeAt(this.index))) this.index += 1;
    }
    if (this.consume(0x2e)) {
      if (!isDigit(this.text.charCodeAt(this.index))) this.fail();
      while (isDigit(this.text.charCodeAt(this.index))) this.index += 1;
    }
    const exponent = this.text.charCodeAt(this.index);
    if (exponent === 0x65 || exponent === 0x45) {
      this.index += 1;
      const sign = this.text.charCodeAt(this.index);
      if (sign === 0x2b || sign === 0x2d) this.index += 1;
      if (!isDigit(this.text.charCodeAt(this.index))) this.fail();
      while (isDigit(this.text.charCodeAt(this.index))) this.index += 1;
    }
    if (!Number.isFinite(Number(this.text.slice(start, this.index)))) this.fail();
  }

  private scanKeyword(keyword: string): void {
    if (this.text.slice(this.index, this.index + keyword.length) !== keyword) {
      this.fail();
    }
    this.index += keyword.length;
  }

  private skipWhitespace(): void {
    while (isJsonWhitespace(this.text.charCodeAt(this.index))) this.index += 1;
  }

  private consume(code: number): boolean {
    if (this.text.charCodeAt(this.index) !== code) return false;
    this.index += 1;
    return true;
  }

  private fail(reason: StrictJsonFailureReason = "invalid"): never {
    throw new BasicStrictJsonError(reason);
  }
}

class BasicStrictJsonError extends Error {
  public constructor(public readonly reason: StrictJsonFailureReason) {
    super(STRICT_JSON_ERROR);
  }
}

function freezeParsedJson(value: unknown): BasicCollectionJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number" && Number.isFinite(value)
  ) return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeParsedJson(item);
    return Object.freeze(value) as BasicCollectionJsonValue;
  }
  if (typeof value !== "object") throw new Error(STRICT_JSON_ERROR);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      throw new Error(STRICT_JSON_ERROR);
    }
    freezeParsedJson(descriptor.value);
  }
  return Object.freeze(value) as BasicCollectionJsonValue;
}

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= HIGH_SURROGATE_START && codeUnit <= HIGH_SURROGATE_END) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= LOW_SURROGATE_START && next <= LOW_SURROGATE_END)) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= LOW_SURROGATE_START && codeUnit <= LOW_SURROGATE_END) {
      return false;
    }
  }
  return true;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isJsonWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function hexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

function utf8ByteLength(codeUnit: number): number {
  return codeUnit <= 0x7f ? 1 : codeUnit <= 0x7ff ? 2 : 3;
}
