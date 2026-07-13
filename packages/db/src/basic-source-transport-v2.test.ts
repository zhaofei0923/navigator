import { describe, expect, test } from "vitest";

import type {
  BasicSourceAcceptV2,
  BasicSourceRequestV2,
} from "./collection/basic-source-v2-contracts.js";
import {
  snapshotBasicSourceRequestV2,
} from "./collection/basic-source-metadata-v2.js";
import {
  createBasicSourceTransportV2,
  isBasicSourceRequestAllowedV2,
  isBasicSourceResponseAllowedV2,
  type BasicSourceFetchResponseV2,
  type BasicSourceFetchV2,
} from "./collection/basic-source-transport-v2.js";

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

describe("Basic source v2 transport", () => {
  test.each([
    ["application/json", "application/json"],
    ["application/json", "Application/JSON; Charset=UTF-8"],
    ["application/json", "application/problem+json"],
    ["application/json", "APPLICATION/vnd.source+JSON; charset=\"utf-8\""],
    ["text/csv", "text/csv"],
    ["text/csv", "TEXT/CSV; CHARSET=utf-8"],
    ["text/html", "text/html"],
    ["text/html", "Text/HTML; charset=utf-8"],
    ["application/pdf", "application/pdf"],
    ["application/pdf", "APPLICATION/PDF; version=1.7"],
  ] as const)(
    "allows %s responses with %s",
    async (accept, contentType) => {
      const request = transportRequest(accept);
      const transport = createBasicSourceTransportV2(
        fakeFetch([
          fetchResponse(200, { "content-type": contentType }),
        ]),
        () => new Date("2026-07-12T04:00:00.000Z"),
      );

      await expect(transport.execute(request)).resolves.toMatchObject({
        status: 200,
        finalUrl: request.url,
        contentType,
        retrievedAt: "2026-07-12T04:00:00.000Z",
        redirectChain: [],
      });
    },
  );

  test.each([
    ["application/json", "text/csv"],
    ["application/json", "text/html"],
    ["application/json", "application/pdf"],
    ["text/csv", "application/json"],
    ["text/csv", "text/html"],
    ["text/csv", "application/pdf"],
    ["text/html", "application/json"],
    ["text/html", "text/csv"],
    ["text/html", "application/pdf"],
    ["application/pdf", "application/json"],
    ["application/pdf", "text/csv"],
    ["application/pdf", "text/html"],
    ["text/csv", "application/octet-stream"],
    ["text/csv", "application/vnd.ms-excel"],
    ["application/json", "application/+json"],
    ["application/json", "x+json"],
    ["application/json", "+json"],
    ["application/json", "application /json"],
    ["text/csv", "text/csv, text/html"],
    ["text/csv", "text/csv;"],
    ["text/html", "text/html; char set=utf-8"],
  ] as const)(
    "rejects %s responses with %s",
    async (accept, contentType) => {
      const transport = createBasicSourceTransportV2(
        fakeFetch([
          fetchResponse(200, { "content-type": contentType }),
        ]),
      );

      await expect(
        transport.execute(transportRequest(accept)),
      ).rejects.toThrow("source response content type is not allowed");
    },
  );

  test.each([
    ["text/html", " text/html"],
    ["application/pdf", "application/pdf "],
  ] as const)(
    "rejects whitespace-ambiguous %s Content-Type %s",
    async (accept, contentType) => {
      const transport = createBasicSourceTransportV2(async () => ({
        status: 200,
        headers: { get: () => contentType },
        body: null,
      }));

      await expect(
        transport.execute(transportRequest(accept)),
      ).rejects.toThrow("source response content type is not allowed");
    },
  );

  test("rejects missing and conflicting Content-Type values", async () => {
    const missing = createBasicSourceTransportV2(
      fakeFetch([fetchResponse(200)]),
    );
    const conflicting = createBasicSourceTransportV2(async () => ({
      status: 200,
      headers: { get: () => "text/csv, application/json" },
      body: null,
    }));

    await expect(
      missing.execute(transportRequest("text/csv")),
    ).rejects.toThrow("source response content type is not allowed");
    await expect(
      conflicting.execute(transportRequest("text/csv")),
    ).rejects.toThrow("source response content type is not allowed");
  });

  test("sends only the reviewed Accept header and leaves the body unread", async () => {
    let bodyReads = 0;
    const fetchImpl: BasicSourceFetchV2 = async (url, init) => {
      expect(url).toBe(transportRequest("application/pdf").url);
      expect(init).toEqual({
        method: "GET",
        headers: { Accept: "application/pdf" },
        redirect: "manual",
      });
      return fetchResponse(
        200,
        { "content-type": "application/pdf" },
        lazyReadable(() => { bodyReads += 1; }),
      );
    };
    const result = await createBasicSourceTransportV2(fetchImpl).execute(
      transportRequest("application/pdf"),
    );

    expect(bodyReads).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.redirectChain)).toBe(true);
  });

  test.each([301, 302, 303, 307, 308])(
    "follows a manual %s relative redirect",
    async (status) => {
      const request = transportRequest("text/html");
      const redirected = "https://data.example/redirected?format=html";
      const transport = createBasicSourceTransportV2(
        fakeFetch([
          fetchResponse(status, { location: "/redirected?format=html" }),
          fetchResponse(200, { "content-type": "text/html" }),
        ]),
      );

      await expect(transport.execute(request)).resolves.toMatchObject({
        finalUrl: redirected,
        redirectChain: [redirected],
      });
    },
  );

  test("allows exactly three redirects and rejects a fourth", async () => {
    const request = transportRequest("text/csv");
    const allowed = createBasicSourceTransportV2(fakeFetch([
      fetchResponse(302, { location: "/one?format=csv" }),
      fetchResponse(302, { location: "/two?format=csv" }),
      fetchResponse(302, { location: "/three?format=csv" }),
      fetchResponse(200, { "content-type": "text/csv" }),
    ]));
    const rejected = createBasicSourceTransportV2(fakeFetch([
      fetchResponse(302, { location: "/one?format=csv" }),
      fetchResponse(302, { location: "/two?format=csv" }),
      fetchResponse(302, { location: "/three?format=csv" }),
      fetchResponse(302, { location: "/four?format=csv" }),
    ]));

    await expect(allowed.execute(request)).resolves.toMatchObject({
      redirectChain: [
        "https://data.example/one?format=csv",
        "https://data.example/two?format=csv",
        "https://data.example/three?format=csv",
      ],
    });
    await expect(rejected.execute(request)).rejects.toThrow(
      "source redirect limit exceeded",
    );
  });

  test.each([
    "https://unreviewed.example/private?format=csv&token=SECRET",
    "/redirect?unreviewed=SECRET",
    "/redirect?format=csv&format=csv",
  ])("rejects a disallowed redirect without leaking %s", async (location) => {
    const transport = createBasicSourceTransportV2(
      fakeFetch([fetchResponse(302, { location })]),
    );

    const error = await rejection(
      transport.execute(transportRequest("text/csv")),
    );

    expect(error.message).toBe("source redirect URL is not allowed");
    expect(error.message).not.toMatch(/SECRET|unreviewed\.example/);
  });

  test.each([
    "http://data.example/source?format=csv",
    "file:///tmp/source.csv",
    "https://user:secret@data.example/source?format=csv",
    "https://data.example/source?unknown=SECRET",
    "https://data.example/source?format=csv&format=csv",
  ])("rejects an unsafe request URL without leaking %s", async (url) => {
    const request = { ...transportRequest("text/csv"), url };
    const transport = createBasicSourceTransportV2(fakeFetch([]));

    const error = await rejection(transport.execute(request));

    expect(error.message).toBe("source request URL is not allowed");
    expect(error.message).not.toMatch(/SECRET|data\.example|secret/);
  });

  test.each([
    ["duplicate origins", {
      allowedOrigins: ["https://data.example", "https://data.example"],
    }],
    ["duplicate query names", {
      allowedQueryParameters: ["format", "format"],
    }],
    ["unreviewed origin", {
      allowedOrigins: ["https://other.example"],
    }],
  ])("rejects request metadata with %s", async (_label, mutation) => {
    const request = { ...transportRequest("text/csv"), ...mutation };
    const transport = createBasicSourceTransportV2(fakeFetch([]));

    await expect(transport.execute(request)).rejects.toThrow(
      "source request URL is not allowed",
    );
    expect(isBasicSourceRequestAllowedV2(request)).toBe(false);
  });

  test.each([199, 300, 404, 429, 500])(
    "rejects non-success response status %s",
    async (status) => {
      const transport = createBasicSourceTransportV2(
        fakeFetch([fetchResponse(status)]),
      );

      await expect(
        transport.execute(transportRequest("application/json")),
      ).rejects.toThrow("source response status is not allowed");
    },
  );

  test.each([Number.NaN, 200.5, Number.POSITIVE_INFINITY])(
    "rejects malformed response status %s",
    async (status) => {
      const transport = createBasicSourceTransportV2(
        fakeFetch([{ ...fetchResponse(200), status }]),
      );

      await expect(
        transport.execute(transportRequest("application/json")),
      ).rejects.toThrow("source response status is not allowed");
    },
  );

  test.each(["status", "headers", "body"] as const)(
    "redacts response %s access failures",
    async (property) => {
      const transport = createBasicSourceTransportV2(async () =>
        throwingFetchResponse(property));

      const error = await rejection(
        transport.execute(transportRequest("application/json")),
      );

      expect(error.message).not.toContain(SENTINEL);
      expect(error.stack ?? "").not.toContain(SENTINEL);
    },
  );

  test("redacts rejected fetch, header, body-reader, and timestamp failures", async () => {
    const request = transportRequest("application/json");
    const fetchFailure = createBasicSourceTransportV2(async () => {
      throw new Error(`${SENTINEL} ${request.url}`);
    });
    const headerFailure = createBasicSourceTransportV2(async () => ({
      status: 200,
      headers: {
        get() {
          throw new Error(SENTINEL);
        },
      },
      body: null,
    }));
    const bodyFailure = createBasicSourceTransportV2(fakeFetch([
      fetchResponse(
        200,
        { "content-type": "application/json" },
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error(SENTINEL));
          },
        }),
      ),
    ]));
    const timestampFailure = createBasicSourceTransportV2(
      fakeFetch([fetchResponse(200, { "content-type": "application/json" })]),
      () => {
        throw new Error(SENTINEL);
      },
    );

    expect((await rejection(fetchFailure.execute(request))).message).toBe(
      "source fetch failed",
    );
    expect((await rejection(headerFailure.execute(request))).message).toBe(
      "source response content type is not allowed",
    );
    const bodyResult = await bodyFailure.execute(request);
    expect((await rejection(readBody(bodyResult.body))).message).toBe(
      "source response body read failed",
    );
    expect((await rejection(timestampFailure.execute(request))).message).toBe(
      "source response timestamp is invalid",
    );
  });

  test("validates response provenance without throwing", () => {
    const request = transportRequest("application/pdf");
    const redirected = "https://data.example/final?format=pdf";
    const valid = {
      status: 200,
      finalUrl: redirected,
      contentType: "application/pdf; version=1.7",
      redirectChain: [redirected],
    };

    expect(isBasicSourceRequestAllowedV2(request)).toBe(true);
    expect(isBasicSourceResponseAllowedV2(valid, request)).toBe(true);
    expect(isBasicSourceResponseAllowedV2(
      { ...valid, contentType: "text/html" },
      request,
    )).toBe(false);
    expect(isBasicSourceResponseAllowedV2(
      { ...valid, finalUrl: "https://data.example/other?format=pdf" },
      request,
    )).toBe(false);
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

function transportRequest(
  accept: BasicSourceAcceptV2,
): BasicSourceRequestV2 {
  const format = {
    "application/json": "json",
    "text/csv": "csv",
    "text/html": "html",
    "application/pdf": "pdf",
  }[accept];
  return {
    method: "GET",
    url: `https://data.example/source?format=${format}`,
    accept,
    allowedOrigins: ["https://data.example"],
    allowedQueryParameters: ["format"],
  };
}

function fakeFetch(
  responses: readonly BasicSourceFetchResponseV2[],
): BasicSourceFetchV2 {
  let index = 0;
  return async () => {
    const response = responses[index];
    index += 1;
    if (response === undefined) throw new Error("unexpected fake fetch call");
    return response;
  };
}

function fetchResponse(
  status: number,
  headers: Record<string, string> = {},
  body: ReadableStream<Uint8Array> | null = null,
): BasicSourceFetchResponseV2 {
  return { status, headers: new Headers(headers), body };
}

function lazyReadable(onRead: () => void): ReadableStream<Uint8Array> {
  return {
    getReader() {
      onRead();
      throw new Error("reader should remain lazy");
    },
  } as unknown as ReadableStream<Uint8Array>;
}

function throwingFetchResponse(
  property: "status" | "headers" | "body",
): BasicSourceFetchResponseV2 {
  const result: Record<string, unknown> = fetchResponse(
    200,
    { "content-type": "application/json" },
  ) as unknown as Record<string, unknown>;
  Object.defineProperty(result, property, {
    enumerable: true,
    get() {
      throw new Error(SENTINEL);
    },
  });
  return result as unknown as BasicSourceFetchResponseV2;
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("expected promise to reject");
}

async function readBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _chunk of body) {
    // The boundary under test is iteration failure, not payload use.
  }
}
