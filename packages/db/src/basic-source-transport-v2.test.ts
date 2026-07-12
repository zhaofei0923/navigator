import { describe, expect, test } from "vitest";

import type {
  BasicSourceAcceptV2,
  BasicSourceRequestV2,
} from "./collection/basic-source-v2-contracts.js";
import {
  snapshotBasicSourceRequestV2,
} from "./collection/basic-source-metadata-v2.js";

const ACCEPTS = [
  "application/json",
  "text/csv",
  "text/html",
  "application/pdf",
] as const satisfies readonly BasicSourceAcceptV2[];

// @ts-expect-error The v2 Accept contract is intentionally closed.
const INVALID_ACCEPT: BasicSourceAcceptV2 = "application/xml";
void INVALID_ACCEPT;

const REQUEST = {
  method: "GET" as const,
  url: "https://data.example/v1/countries/VN?format=csv&lang=en",
  accept: "text/csv" as const,
  allowedOrigins: ["https://data.example", "https://mirror.example"],
  allowedQueryParameters: ["format", "lang"],
};
const SENTINEL = "V2_REQUEST_METADATA_DO_NOT_LEAK";

describe("Basic source v2 request metadata", () => {
  test.each(ACCEPTS)("reconstructs and freezes the %s request", (accept) => {
    const source: BasicSourceRequestV2 = {
      ...REQUEST,
      accept,
      allowedOrigins: [...REQUEST.allowedOrigins],
      allowedQueryParameters: [...REQUEST.allowedQueryParameters],
    };

    const result = snapshotBasicSourceRequestV2(source);

    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(result.allowedOrigins).not.toBe(source.allowedOrigins);
    expect(result.allowedQueryParameters).not.toBe(
      source.allowedQueryParameters,
    );
    expect(result.allowedOrigins).toEqual([
      "https://data.example",
      "https://mirror.example",
    ]);
    expect(result.allowedQueryParameters).toEqual(["format", "lang"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.allowedOrigins)).toBe(true);
    expect(Object.isFrozen(result.allowedQueryParameters)).toBe(true);
  });

  test.each([
    ["non-GET method", { ...REQUEST, method: "POST" }],
    ["unsupported Accept", { ...REQUEST, accept: "application/xml" }],
    ["blank URL", { ...REQUEST, url: "" }],
    ["whitespace URL", { ...REQUEST, url: ` ${REQUEST.url}` }],
    ["non-canonical URL", { ...REQUEST, url: "https://data.example:443/v1" }],
    ["duplicate origin", {
      ...REQUEST,
      allowedOrigins: ["https://data.example", "https://data.example"],
    }],
    ["unsafe origin", {
      ...REQUEST,
      allowedOrigins: ["https://data.example/path"],
    }],
    ["credentialed origin", {
      ...REQUEST,
      allowedOrigins: ["https://user:secret@data.example"],
    }],
    ["duplicate query name", {
      ...REQUEST,
      allowedQueryParameters: ["format", "format"],
    }],
    ["blank query name", {
      ...REQUEST,
      allowedQueryParameters: [""],
    }],
    ["trim-changing query name", {
      ...REQUEST,
      allowedQueryParameters: [" format"],
    }],
    ["pre-encoded query name", {
      ...REQUEST,
      allowedQueryParameters: ["format%20name"],
    }],
    ["placeholder query name", {
      ...REQUEST,
      allowedQueryParameters: ["{format}"],
    }],
    ["control-character query name", {
      ...REQUEST,
      allowedQueryParameters: ["format\nname"],
    }],
  ] as const)("rejects a request with a %s", (_label, value) => {
    expect(() => snapshotBasicSourceRequestV2(value)).toThrow(
      "basic source request metadata is invalid",
    );
  });

  test.each(["extra", "missing", "symbol", "accessor", "proxy"] as const)(
    "rejects a request with an exact-shape %s violation",
    (kind) => {
      const probe = { executions: 0 };
      const value = unsafeRecord(REQUEST, kind, probe);

      expect(() => snapshotBasicSourceRequestV2(value)).toThrow(
        "basic source request metadata is invalid",
      );
      expect(probe.executions).toBe(0);
    },
  );

  test.each(["sparse", "extra", "accessor", "custom prototype"] as const)(
    "rejects a %s request array",
    (kind) => {
      const value = {
        ...REQUEST,
        allowedOrigins: unsafeArray(
          ["https://data.example", "https://mirror.example"],
          kind,
        ),
      };

      expect(() => snapshotBasicSourceRequestV2(value)).toThrow(
        "basic source request metadata is invalid",
      );
    },
  );

  test("rejects cyclic request input", () => {
    const value: Record<string, unknown> = { ...REQUEST };
    value.allowedOrigins = [value];

    expect(() => snapshotBasicSourceRequestV2(value)).toThrow(
      "basic source request metadata is invalid",
    );
  });

  test("applies URL, string, and array limits", () => {
    expect(() => snapshotBasicSourceRequestV2({
      ...REQUEST,
      url: `https://data.example/${"a".repeat(8_171)}`,
    })).not.toThrow();
    expect(() => snapshotBasicSourceRequestV2({
      ...REQUEST,
      url: `https://data.example/${"a".repeat(8_172)}`,
    })).toThrow("basic source request metadata is invalid");
    expect(() => snapshotBasicSourceRequestV2({
      ...REQUEST,
      allowedQueryParameters: ["q".repeat(65_537)],
    })).toThrow("basic source request metadata is invalid");
    expect(() => snapshotBasicSourceRequestV2({
      ...REQUEST,
      allowedQueryParameters: Array.from(
        { length: 257 },
        (_, index) => `query${index}`,
      ),
    })).toThrow("basic source request metadata is invalid");
  });

  test("redacts hostile values", () => {
    const value = { ...REQUEST, accept: SENTINEL };

    let error: Error | null = null;
    try {
      snapshotBasicSourceRequestV2(value);
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }

    expect(error?.message).toBe("basic source request metadata is invalid");
    expect(error?.message).not.toContain(SENTINEL);
  });
});

function unsafeRecord(
  source: object,
  kind: "extra" | "missing" | "symbol" | "accessor" | "proxy",
  probe: { executions: number },
): unknown {
  const value: Record<PropertyKey, unknown> = { ...source };
  if (kind === "extra") value.extra = SENTINEL;
  if (kind === "missing") delete value.url;
  if (kind === "symbol") value[Symbol("extra")] = SENTINEL;
  if (kind === "accessor") {
    Object.defineProperty(value, "url", {
      enumerable: true,
      get() {
        probe.executions += 1;
        throw new Error(SENTINEL);
      },
    });
  }
  return kind === "proxy" ? new Proxy(value, {}) : value;
}

function unsafeArray(
  source: string[],
  kind: "sparse" | "extra" | "accessor" | "custom prototype",
): string[] {
  if (kind === "sparse") {
    const value = new Array<string>(source.length);
    value[0] = source[0]!;
    return value;
  }
  const value = [...source];
  if (kind === "extra") value.push(SENTINEL);
  if (kind === "accessor") {
    Object.defineProperty(value, "0", {
      enumerable: true,
      get() {
        throw new Error(SENTINEL);
      },
    });
  }
  if (kind === "custom prototype") {
    Object.setPrototypeOf(value, Object.create(Array.prototype));
  }
  return value;
}
