import { describe, expect, test } from "vitest";

import {
  createBasicSourceTransport,
  type BasicSourceFetch,
} from "./collection/basic-source-transport.js";

const REQUEST = {
  method: "GET" as const,
  url: "https://api.worldbank.org/v2/country/VN?format=json",
  accept: "application/json",
  allowedOrigins: ["https://api.worldbank.org"],
  allowedQueryParameters: ["format"],
};

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

  test("rejects non-JSON response MIME types", async () => {
    const transport = createBasicSourceTransport(
      createFetch([response(200, { "content-type": "text/html" })]),
    );

    await expect(transport.execute(REQUEST)).rejects.toThrow(
      "source response content type is not allowed",
    );
  });
});

function createFetch(responses: readonly Response[]): BasicSourceFetch {
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
