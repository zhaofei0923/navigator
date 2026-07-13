import { describe, expect, test } from "vitest";

import {
  createBasicSourceTransport,
  type BasicSourceFetch,
  type BasicSourceFetchResponse,
} from "./collection/basic-source-transport.js";

const REQUEST = {
  method: "GET" as const,
  url: "https://api.worldbank.org/v2/country/VN?format=json",
  accept: "application/json",
  allowedOrigins: ["https://api.worldbank.org"],
  allowedQueryParameters: ["format"],
};
const METADATA_SENTINEL = "METADATA_DO_NOT_LEAK_7bb1";

describe("Basic source transport", () => {
  test("returns a validated response without consuming its body", async () => {
    let bodyReads = 0;
    const transport = createBasicSourceTransport(
      createFetch([
        response(200, { "content-type": "application/json; charset=utf-8" }, stream([new Uint8Array([1])], () => {
          bodyReads += 1;
        })),
      ]),
      () => new Date("2026-07-10T09:40:00.000Z"),
    );

    const result = await transport.execute(REQUEST);

    expect(result).toMatchObject({
      status: 200,
      finalUrl: REQUEST.url,
      contentType: "application/json; charset=utf-8",
      retrievedAt: "2026-07-10T09:40:00.000Z",
      redirectChain: [],
    });
    expect(bodyReads).toBe(0);
  });

  test.each(["extra string key", "symbol key", "accessor key"] as const)(
    "rejects a request with an %s without executing metadata accessors",
    async (kind) => {
      const probe = { executions: 0 };
      const unsafeRequest = requestWithUnsafeKey(kind, probe);
      const transport = createBasicSourceTransport(createFetch([]));

      const error = await rejectWith(transport.execute(unsafeRequest));

      expect(error.message).toBe("source request URL is not allowed");
      expect(error.message).not.toContain(METADATA_SENTINEL);
      expect(probe.executions).toBe(0);
    },
  );

  test.each(["sparse", "extra property", "custom prototype"] as const)(
    "rejects %s origin allowlists",
    async (kind) => {
      const unsafeRequest = {
        ...REQUEST,
        allowedOrigins: unsafeStringArray(
          ["https://api.worldbank.org"],
          kind,
        ),
      };
      const transport = createBasicSourceTransport(
        createFetch([
          response(200, { "content-type": "application/json" }),
        ]),
      );

      const error = await rejectWith(transport.execute(unsafeRequest));

      expect(error.message).toBe("source request URL is not allowed");
      expect(error.message).not.toContain(METADATA_SENTINEL);
    },
  );

  test.each(["sparse", "extra property", "custom prototype"] as const)(
    "rejects %s query-parameter allowlists",
    async (kind) => {
      const unsafeRequest = {
        ...REQUEST,
        allowedQueryParameters: unsafeStringArray(["format"], kind),
      };
      const transport = createBasicSourceTransport(
        createFetch([
          response(200, { "content-type": "application/json" }),
        ]),
      );

      const error = await rejectWith(transport.execute(unsafeRequest));

      expect(error.message).toBe("source request URL is not allowed");
      expect(error.message).not.toContain(METADATA_SENTINEL);
    },
  );

  test("uses an immutable request snapshot across fetch awaits", async () => {
    const mutableRequest = {
      ...REQUEST,
      allowedOrigins: [...REQUEST.allowedOrigins],
      allowedQueryParameters: [...REQUEST.allowedQueryParameters],
    };
    let calls = 0;
    const fetchImpl: BasicSourceFetch = async (_url, init) => {
      calls += 1;
      expect(init.headers.Accept).toBe("application/json");
      if (calls === 1) {
        mutableRequest.url = `https://mutated.example/${METADATA_SENTINEL}`;
        mutableRequest.accept = METADATA_SENTINEL;
        mutableRequest.allowedOrigins[0] = "https://mutated.example";
        mutableRequest.allowedQueryParameters[0] = "mutated";
        return response(302, { location: "/redirected?format=json" });
      }
      return response(200, { "content-type": "application/json" });
    };
    const transport = createBasicSourceTransport(fetchImpl);

    const result = await transport.execute(mutableRequest);

    expect(result.finalUrl).toBe(
      "https://api.worldbank.org/redirected?format=json",
    );
    expect(result.redirectChain).toEqual([
      "https://api.worldbank.org/redirected?format=json",
    ]);
    expect(Object.isFrozen(result.redirectChain)).toBe(true);
  });

  test.each([
    "http://api.worldbank.org/v2/country/VN",
    "file:///tmp/source.json",
    "https://user:secret@api.worldbank.org/v2/country/VN",
    "https://127.0.0.1/source",
    "https://api.worldbank.org/source?unreviewed_credential=DO_NOT_LEAK",
  ])("rejects unsafe URL %s without revealing request data", async (url) => {
    const transport = createBasicSourceTransport(createFetch([]));

    const error = await rejectWith(transport.execute({ ...REQUEST, url }));

    expect(error.message).toBe("source request URL is not allowed");
    expect(error.message).not.toMatch(
      /DO_NOT_LEAK|api\.worldbank\.org|127\.0\.0\.1|secret/,
    );
  });

  test("rejects a redirect to an unreviewed origin without revealing its URL", async () => {
    const transport = createBasicSourceTransport(
      createFetch([
        response(302, { location: "https://unreviewed.example/secret?token=DO_NOT_LEAK" }),
      ]),
    );

    const error = await rejectWith(transport.execute(REQUEST));

    expect(error.message).toBe("source redirect URL is not allowed");
    expect(error.message).not.toMatch(/DO_NOT_LEAK|unreviewed\.example|token/);
  });

  test("rejects a fourth redirect", async () => {
    const transport = createBasicSourceTransport(
      createFetch([
        response(302, { location: "/one?format=json" }),
        response(302, { location: "/two?format=json" }),
        response(302, { location: "/three?format=json" }),
        response(302, { location: "/four?format=json" }),
      ]),
    );

    await expect(transport.execute(REQUEST)).rejects.toThrow(
      "source redirect limit exceeded",
    );
  });

  test("rejects non-successful responses", async () => {
    const transport = createBasicSourceTransport(createFetch([response(429)]));

    await expect(transport.execute(REQUEST)).rejects.toThrow(
      "source response status is not allowed",
    );
  });

  test.each([Number.NaN, 200.5, 600])(
    "rejects invalid response status %s",
    async (status) => {
      const transport = createBasicSourceTransport(
        createFetch([responseWithStatus(status)]),
      );

      await expect(transport.execute(REQUEST)).rejects.toThrow(
        "source response status is not allowed",
      );
    },
  );

  test("redacts injected fetch failures", async () => {
    const fetchImpl: BasicSourceFetch = async () => {
      throw new Error(`${REQUEST.url}&secret=FETCH_DO_NOT_LEAK`);
    };
    const transport = createBasicSourceTransport(fetchImpl);

    const error = await rejectWith(transport.execute(REQUEST));

    expect(error.message).toBe("source fetch failed");
    expect(error.message).not.toMatch(/FETCH_DO_NOT_LEAK|worldbank|secret/);
  });

  test.each(["status", "headers", "body"] as const)(
    "redacts native fetch response %s access failures",
    async (property) => {
      const transport = createBasicSourceTransport(
        async () => fetchResponseWithThrowingProperty(property),
      );

      const error = await rejectWith(transport.execute(REQUEST));

      expect(error.message).not.toContain(METADATA_SENTINEL);
      expect(error.message).not.toContain(REQUEST.url);
    },
  );

  test("redacts response body reader failures", async () => {
    const leakingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(
          new Error(`${REQUEST.url} RESPONSE_BODY_DO_NOT_LEAK`),
        );
      },
    });
    const transport = createBasicSourceTransport(
      createFetch([
        response(200, { "content-type": "application/json" }, leakingBody),
      ]),
    );
    const result = await transport.execute(REQUEST);

    const error = await rejectWith(readAll(result.body));

    expect(error.message).toBe("source response body read failed");
    expect(error.message).not.toMatch(/RESPONSE_BODY_DO_NOT_LEAK|worldbank/);
  });

  test("rejects non-JSON response MIME types", async () => {
    const transport = createBasicSourceTransport(
      createFetch([response(200, { "content-type": "text/html" })]),
    );

    await expect(transport.execute(REQUEST)).rejects.toThrow(
      "source response content type is not allowed",
    );
  });

  test.each(["text/csv", "text/html", "application/pdf"])(
    "keeps the v1 request boundary closed to %s",
    async (accept) => {
      const transport = createBasicSourceTransport(createFetch([]));

      await expect(
        transport.execute({ ...REQUEST, accept }),
      ).rejects.toThrow("source request URL is not allowed");
    },
  );

  test.each([
    ["application/json", true],
    ["application/problem+json", true],
    ["application/vnd.source+json; charset=utf-8", true],
    ["application/json; charset=\"utf-8\"", true],
    ["x+json", false],
    ["+json", false],
    ["application/+json", false],
    ["application/", false],
    ["/json", false],
    ["application /json", false],
    ["application/json; char set=utf-8", false],
    ["application/json;", false],
  ])("accepts only complete JSON media types: %s", async (contentType, accepted) => {
    const transport = createBasicSourceTransport(
      createFetch([response(200, { "content-type": contentType })]),
    );

    if (accepted) {
      await expect(transport.execute(REQUEST)).resolves.toMatchObject({ contentType });
    } else {
      await expect(transport.execute(REQUEST)).rejects.toThrow(
        "source response content type is not allowed",
      );
    }
  });

  test.each([
    ["URL", { ...REQUEST, url: ` ${REQUEST.url} ` }],
    ["origin", { ...REQUEST, allowedOrigins: [` ${REQUEST.allowedOrigins[0]} `] }],
    ["query name", { ...REQUEST, allowedQueryParameters: [" format "] }],
  ])("rejects request %s with surrounding whitespace", async (_label, request) => {
    const transport = createBasicSourceTransport(
      createFetch([response(200, { "content-type": "application/json" })]),
    );

    await expect(transport.execute(request)).rejects.toThrow(
      "source request URL is not allowed",
    );
  });
});

function createFetch(
  responses: readonly BasicSourceFetchResponse[],
): BasicSourceFetch {
  let index = 0;
  return async () => {
    const response = responses[index];
    index += 1;
    if (response === undefined) {
      throw new Error("unexpected fake fetch call");
    }
    return response;
  };
}

function requestWithUnsafeKey(
  kind: "extra string key" | "symbol key" | "accessor key",
  probe: { executions: number },
): typeof REQUEST {
  const request: Record<PropertyKey, unknown> = {
    ...REQUEST,
    allowedOrigins: [...REQUEST.allowedOrigins],
    allowedQueryParameters: [...REQUEST.allowedQueryParameters],
  };
  const property =
    kind === "extra string key"
      ? "unexpected"
      : kind === "symbol key"
        ? Symbol("unexpected")
        : "url";
  Object.defineProperty(request, property, {
    configurable: true,
    enumerable: true,
    ...(kind === "extra string key"
      ? { value: METADATA_SENTINEL, writable: true }
      : {
          get() {
            probe.executions += 1;
            throw new Error(METADATA_SENTINEL);
          },
        }),
  });
  return request as unknown as typeof REQUEST;
}

function unsafeStringArray(
  values: readonly string[],
  kind: "sparse" | "extra property" | "custom prototype",
): string[] {
  if (kind === "sparse") {
    const sparse = new Array<string>(2);
    sparse[0] = values[0]!;
    return sparse;
  }
  const result = [...values];
  if (kind === "extra property") {
    Object.defineProperty(result, "unexpected", {
      enumerable: true,
      value: METADATA_SENTINEL,
    });
    return result;
  }
  Object.setPrototypeOf(result, Object.create(Array.prototype));
  return result;
}

function fetchResponseWithThrowingProperty(
  property: "status" | "headers" | "body",
): BasicSourceFetchResponse {
  const result: Record<string, unknown> = {
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    body: null,
  };
  Object.defineProperty(result, property, {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error(METADATA_SENTINEL);
    },
  });
  return result as unknown as BasicSourceFetchResponse;
}

function responseWithStatus(status: number): BasicSourceFetchResponse {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    body: null,
  };
}

function response(
  status: number,
  headers: Record<string, string> = {},
  body: ReadableStream<Uint8Array> | null = null,
): Response {
  return new Response(body, { status, headers });
}

function stream(
  chunks: readonly Uint8Array[],
  onRead: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
    pull() {
      onRead();
    },
  });
}

async function rejectWith(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("expected promise to reject");
}

async function readAll(body: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _chunk of body) {
    // The regression exercises lower-layer iteration failure, not payload use.
  }
}
