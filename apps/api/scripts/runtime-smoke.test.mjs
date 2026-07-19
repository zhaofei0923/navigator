import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";

import { requestCountries } from "./runtime-smoke.mjs";

describe("runtime smoke HTTP request helper", () => {
  test("is exported without running the standalone smoke on import", async () => {
    const smoke = await import("./runtime-smoke.mjs");

    expect(smoke.requestCountries).toBeTypeOf("function");
  });

  test("times out and closes a response that never ends", async () => {
    const sockets = new Set();
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    const port = await listen(server);

    try {
      const timeoutSentinel = Symbol("test-timeout");
      const result = await Promise.race([
        requestCountries(port, 75),
        delay(750).then(() => timeoutSentinel),
      ]);

      expect(result).toBeNull();
      await waitForClosedConnections(sockets, 500);
      expect(sockets.size).toBe(0);
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await close(server);
    }
  }, 2_000);

  test("bounds a connect attempt that never settles and releases its resources", async () => {
    const { canConnect } = await import("./runtime-smoke.mjs");
    const socket = new EventEmitter();
    let destroyed = false;
    socket.destroy = () => {
      destroyed = true;
    };
    const timerHandle = Symbol("connect-timeout");
    let timeoutCallback;
    let timeoutMilliseconds;
    const canceledTimers = [];

    const connection = canConnect(31876, {
      cancelTimeout: (handle) => canceledTimers.push(handle),
      createSocket: () => socket,
      scheduleTimeout: (callback, milliseconds) => {
        timeoutCallback = callback;
        timeoutMilliseconds = milliseconds;
        return timerHandle;
      },
    });

    expect(timeoutMilliseconds).toBe(500);
    expect(timeoutCallback).toBeTypeOf("function");
    timeoutCallback();

    await expect(connection).resolves.toBe(false);
    expect(destroyed).toBe(true);
    expect(canceledTimers).toEqual([timerHandle]);
    expect(socket.listenerCount("connect")).toBe(0);
    expect(socket.listenerCount("error")).toBe(0);
  });
});

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectListen(new Error("TEST_HTTP_ADDRESS_UNAVAILABLE"));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

async function waitForClosedConnections(sockets, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (sockets.size > 0 && Date.now() < deadline) {
    await delay(10);
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
