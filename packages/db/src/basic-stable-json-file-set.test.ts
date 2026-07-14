import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

const fsProbe = vi.hoisted(() => ({
  onReadCall: null as Readonly<{
    callIndex: number;
    run: () => void;
  }> | null,
  readCalls: 0,
  readTargets: [] as Uint8Array[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readSync(...args: Parameters<typeof actual.readSync>) {
      const result = Reflect.apply(actual.readSync, undefined, args) as number;
      const callIndex = fsProbe.readCalls;
      const target: unknown = args[1];
      if (target instanceof Uint8Array) fsProbe.readTargets.push(target);
      fsProbe.readCalls += 1;
      const hook = fsProbe.onReadCall;
      if (hook?.callIndex === callIndex) {
        fsProbe.onReadCall = null;
        hook.run();
      }
      return result;
    },
  };
});

import { BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES } from "./collection/basic-publication-contracts.js";
import { readBasicStableJsonFileSet } from "./collection/basic-stable-json-file-set.js";

const roots = new Set<string>();
const READ_ERROR = /^Stable JSON artifacts could not be read$/;

afterEach(() => {
  fsProbe.onReadCall = null;
  fsProbe.readCalls = 0;
  fsProbe.readTargets.length = 0;
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("stable JSON file-set reader", () => {
  test("returns exact bytes and recursively frozen JSON from an exact directory", () => {
    const { directory } = createDirectory();
    writeFileSync(join(directory, "first.json"), '{"value":1}\n', "utf8");
    writeFileSync(
      join(directory, "second.json"),
      '{"nested":{"values":[2]}}\n',
      "utf8",
    );

    const result = readBasicStableJsonFileSet({
      files: {
        first: join(directory, "first.json"),
        second: join(directory, "second.json"),
      },
      exactDirectories: [{
        pathname: directory,
        entries: ["first.json", "second.json"],
      }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    });

    expect(result.first.value).toEqual({ value: 1 });
    expect(new TextDecoder().decode(result.first.bytes)).toBe('{"value":1}\n');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.first)).toBe(true);
    expect(Object.isFrozen(result.first.value)).toBe(true);
    expect(Object.isFrozen(result.second.value)).toBe(true);
    expect(Object.isFrozen(
      (result.second.value as { nested: { values: unknown[] } }).nested.values,
    )).toBe(true);
    expect(Buffer.isBuffer(result.first.bytes)).toBe(false);
    expect(Object.isFrozen(result.first.bytes)).toBe(false);
  });

  test("returns bytes detached from the internal readSync target", () => {
    const { directory } = createDirectory();
    writeFileSync(join(directory, "first.json"), '{"value":1}\n', "utf8");

    const result = readBasicStableJsonFileSet({
      files: { first: join(directory, "first.json") },
      exactDirectories: [{ pathname: directory, entries: ["first.json"] }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    });
    const returnedBytes = new Uint8Array(result.first.bytes);
    const internalTarget = fsProbe.readTargets[0];

    expect(internalTarget).toBeInstanceOf(Uint8Array);
    if (internalTarget === undefined) throw new Error("read target was not captured");
    expect(internalTarget).not.toBe(result.first.bytes);
    internalTarget.fill(0);
    expect(result.first.bytes).toEqual(returnedBytes);
    expect(new TextDecoder().decode(result.first.bytes)).toBe('{"value":1}\n');
  });

  test("reads one stable snapshot across multiple exact directories", () => {
    const root = createRoot();
    const firstDirectory = join(root, "first");
    const secondDirectory = join(root, "second");
    mkdirSync(firstDirectory);
    mkdirSync(secondDirectory);
    writeFileSync(join(firstDirectory, "value.json"), '{"value":1}', "utf8");
    writeFileSync(join(secondDirectory, "value.json"), '{"value":2}', "utf8");

    const result = readBasicStableJsonFileSet({
      files: {
        first: join(firstDirectory, "value.json"),
        second: join(secondDirectory, "value.json"),
      },
      exactDirectories: [
        { pathname: firstDirectory, entries: ["value.json"] },
        { pathname: secondDirectory, entries: ["value.json"] },
      ],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    });

    expect(result.first.value).toEqual({ value: 1 });
    expect(result.second.value).toEqual({ value: 2 });
  });

  test("reads a manifest while asserting additional exact directory entries", () => {
    const { directory } = createDirectory();
    writeFileSync(join(directory, "country.json"), "{}", "utf8");
    writeFileSync(join(directory, "market-overview.json"), "{}", "utf8");
    writeFileSync(
      join(directory, "collection-manifest.json"),
      '{"schemaVersion":"collection-manifest/v1"}\n',
      "utf8",
    );

    const result = readBasicStableJsonFileSet({
      files: { manifest: join(directory, "collection-manifest.json") },
      exactDirectories: [{
        pathname: directory,
        entries: [
          "country.json",
          "market-overview.json",
          "collection-manifest.json",
        ],
      }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    });

    expect(result.manifest.value).toEqual({
      schemaVersion: "collection-manifest/v1",
    });
  });

  test("reads a file whose parent has no exact directory assertion", () => {
    const { directory } = createDirectory();
    writeFileSync(join(directory, "first.json"), '{"value":1}', "utf8");

    const result = readBasicStableJsonFileSet({
      files: { first: join(directory, "first.json") },
      exactDirectories: [],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    });

    expect(result.first.value).toEqual({ value: 1 });
  });

  test.each([
    ["non-absolute", "first.json"],
    ["unnormalized", "nested/../first.json"],
    ["NUL-containing", "first.json\0"],
  ])("rejects a %s target path", (_case, suffix) => {
    const { directory } = createDirectory();
    writeFileSync(join(directory, "first.json"), "{}", "utf8");
    const pathname = suffix === "first.json"
      ? suffix
      : `${directory}/${suffix}`;

    expect(() => readBasicStableJsonFileSet({
      files: { first: pathname },
      exactDirectories: [{ pathname: directory, entries: ["first.json"] }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    })).toThrowError(READ_ERROR);
  });

  test("rejects duplicate target paths", () => {
    const { directory } = createDirectory();
    const pathname = join(directory, "first.json");
    writeFileSync(pathname, "{}", "utf8");

    expect(() => readBasicStableJsonFileSet({
      files: { first: pathname, second: pathname },
      exactDirectories: [{ pathname: directory, entries: ["first.json"] }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    })).toThrowError(READ_ERROR);
  });

  test("rejects hard-linked file target aliases after snapshotting", () => {
    const { directory } = createDirectory();
    const first = join(directory, "first.json");
    const second = join(directory, "second.json");
    writeFileSync(first, "{}", "utf8");
    linkSync(first, second);

    expect(() => readBasicStableJsonFileSet({
      files: { first, second },
      exactDirectories: [{
        pathname: directory,
        entries: ["first.json", "second.json"],
      }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    })).toThrowError(READ_ERROR);
    expect(fsProbe.readCalls).toBe(0);
  });

  test("rejects non-root trailing-separator exact directory aliases", () => {
    const { directory } = createDirectory();
    const pathname = join(directory, "first.json");
    writeFileSync(pathname, "{}", "utf8");

    expect(() => readBasicStableJsonFileSet({
      files: { first: pathname },
      exactDirectories: [
        { pathname: directory, entries: ["first.json"] },
        { pathname: `${directory}/`, entries: ["first.json"] },
      ],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    })).toThrowError(READ_ERROR);
    expect(fsProbe.readCalls).toBe(0);
  });

  test.each(["missing", "extra"])(
    "rejects a directory with a %s entry relative to its allowlist",
    (kind) => {
      const { directory } = createDirectory();
      writeFileSync(join(directory, "first.json"), "{}", "utf8");
      if (kind === "extra") {
        writeFileSync(join(directory, "unexpected.json"), "{}", "utf8");
      }
      const files: Readonly<Record<string, string>> = kind === "missing"
        ? {
            first: join(directory, "first.json"),
            second: join(directory, "second.json"),
          }
        : { first: join(directory, "first.json") };

      expect(() => readBasicStableJsonFileSet({
        files,
        exactDirectories: [{
          pathname: directory,
          entries: kind === "missing"
            ? ["first.json", "second.json"]
            : ["first.json"],
        }],
        maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
      })).toThrowError(READ_ERROR);
    },
  );

  test.each(["root", "ancestor", "file"] as const)(
    "rejects a symlinked %s path component",
    (kind) => {
      const root = createRoot();
      const realDirectory = join(root, "real", "artifacts");
      mkdirSync(realDirectory, { recursive: true });
      writeFileSync(join(realDirectory, "first.json"), "{}", "utf8");

      let directory = realDirectory;
      if (kind === "root") {
        directory = join(root, "artifact-link");
        symlinkSync(realDirectory, directory, "dir");
      } else if (kind === "ancestor") {
        const ancestor = join(root, "ancestor-link");
        symlinkSync(join(root, "real"), ancestor, "dir");
        directory = join(ancestor, "artifacts");
      } else {
        const pathname = join(realDirectory, "first.json");
        const target = join(root, "target.json");
        writeFileSync(target, "{}", "utf8");
        rmSync(pathname);
        symlinkSync(target, pathname, "file");
      }

      expect(() => readBasicStableJsonFileSet({
        files: { first: join(directory, "first.json") },
        exactDirectories: [{ pathname: directory, entries: ["first.json"] }],
        maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
      })).toThrowError(READ_ERROR);
    },
  );

  test("rejects a directory used as a file target", () => {
    const { directory } = createDirectory();
    const pathname = join(directory, "first.json");
    mkdirSync(pathname);

    expect(() => readBasicStableJsonFileSet({
      files: { first: pathname },
      exactDirectories: [{ pathname: directory, entries: ["first.json"] }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    })).toThrowError(READ_ERROR);
    expect(fsProbe.readCalls).toBe(0);
  });

  test("rejects original file bytes over the publication limit before readSync", () => {
    const { directory } = createDirectory();
    writeFileSync(
      join(directory, "first.json"),
      Buffer.alloc(BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES + 1, 0x20),
    );

    expect(() => readBasicStableJsonFileSet({
      files: { first: join(directory, "first.json") },
      exactDirectories: [{ pathname: directory, entries: ["first.json"] }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    })).toThrowError(READ_ERROR);
    expect(fsProbe.readCalls).toBe(0);
  });

  test.each([
    ["malformed UTF-8", Buffer.from([0xc3, 0x28])],
    ["malformed JSON", Buffer.from("{", "utf8")],
  ])("rejects %s without exposing parser details", (_case, bytes) => {
    const { directory, root } = createDirectory();
    writeFileSync(join(directory, "first.json"), bytes);

    const message = thrownMessage(() => readBasicStableJsonFileSet({
      files: { first: join(directory, "first.json") },
      exactDirectories: [{ pathname: directory, entries: ["first.json"] }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    }));
    expect(message).toBe("Stable JSON artifacts could not be read");
    expect(message).not.toContain(root);
    expect(message).not.toMatch(/UTF-8|Unexpected|position|first\.json/);
  });

  test("rejects a target pathname replaced during its descriptor read", () => {
    const { directory, root } = createDirectory();
    const pathname = join(directory, "first.json");
    const replacement = join(root, "replacement.json");
    writeFileSync(pathname, '{"value":1}', "utf8");
    writeFileSync(replacement, '{"value":2}', "utf8");
    fsProbe.onReadCall = {
      callIndex: 0,
      run: () => renameSync(replacement, pathname),
    };

    expect(() => readBasicStableJsonFileSet({
      files: { first: pathname },
      exactDirectories: [{ pathname: directory, entries: ["first.json"] }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    })).toThrowError(READ_ERROR);
    expect(fsProbe.readCalls).toBeGreaterThan(0);
  });

  test("rejects an exact directory replaced during the set read", () => {
    const root = createRoot();
    const directory = join(root, "artifacts");
    const replacement = join(root, "replacement");
    const displaced = join(root, "displaced");
    writeTwoFileDirectory(directory, 1);
    writeTwoFileDirectory(replacement, 2);
    fsProbe.onReadCall = {
      callIndex: 0,
      run: () => {
        renameSync(directory, displaced);
        renameSync(replacement, directory);
      },
    };

    expect(() => readBasicStableJsonFileSet({
      files: {
        first: join(directory, "first.json"),
        second: join(directory, "second.json"),
      },
      exactDirectories: [{
        pathname: directory,
        entries: ["first.json", "second.json"],
      }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    })).toThrowError(READ_ERROR);
    expect(fsProbe.readCalls).toBeGreaterThan(0);
  });

  test("rejects directory A changed during a later read from directory B", () => {
    const root = createRoot();
    const firstDirectory = join(root, "a");
    const secondDirectory = join(root, "b");
    mkdirSync(firstDirectory);
    mkdirSync(secondDirectory);
    writeFileSync(join(firstDirectory, "value.json"), '{"value":1}', "utf8");
    writeFileSync(join(secondDirectory, "value.json"), '{"value":2}', "utf8");
    fsProbe.onReadCall = {
      callIndex: 2,
      run: () => {
        writeFileSync(join(firstDirectory, "unexpected.json"), "{}", "utf8");
      },
    };

    expect(() => readBasicStableJsonFileSet({
      files: {
        first: join(firstDirectory, "value.json"),
        second: join(secondDirectory, "value.json"),
      },
      exactDirectories: [
        { pathname: firstDirectory, entries: ["value.json"] },
        { pathname: secondDirectory, entries: ["value.json"] },
      ],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    })).toThrowError(READ_ERROR);
    expect(fsProbe.readCalls).toBeGreaterThan(2);
    expect(fsProbe.onReadCall).toBeNull();
  });

  test("rejects exact directory entries changed during the set read", () => {
    const { directory } = createDirectory();
    writeFileSync(join(directory, "first.json"), "{}", "utf8");
    fsProbe.onReadCall = {
      callIndex: 0,
      run: () => {
        writeFileSync(join(directory, "unexpected.json"), "{}", "utf8");
      },
    };

    expect(() => readBasicStableJsonFileSet({
      files: { first: join(directory, "first.json") },
      exactDirectories: [{ pathname: directory, entries: ["first.json"] }],
      maximumBytes: BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES,
    })).toThrowError(READ_ERROR);
    expect(fsProbe.readCalls).toBeGreaterThan(0);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "basic-stable-json-"));
  roots.add(root);
  return root;
}

function createDirectory(): { readonly root: string; readonly directory: string } {
  const root = createRoot();
  const directory = join(root, "artifacts");
  mkdirSync(directory);
  return { root, directory };
}

function writeTwoFileDirectory(directory: string, value: number): void {
  mkdirSync(directory);
  writeFileSync(join(directory, "first.json"), JSON.stringify({ value }), "utf8");
  writeFileSync(join(directory, "second.json"), JSON.stringify({ value }), "utf8");
}

function thrownMessage(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected operation to throw");
}
