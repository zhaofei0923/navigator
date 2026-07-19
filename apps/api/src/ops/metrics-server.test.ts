import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";

import { afterEach, describe, expect, test, vi } from "vitest";

import { MetricsServer } from "./metrics-server.js";

const servers: MetricsServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("MetricsServer", () => {
  test("binds only loopback and exposes only the exact GET /metrics contract", async () => {
    const port = await availablePort();
    const render = vi.fn(() => "navigator_process_cpu_seconds_total 1\n");
    const closeRegistry = vi.fn();
    const server = new MetricsServer({
      closeRegistry,
      port,
      render,
    });
    servers.push(server);

    await server.listen();
    await server.listen();

    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("content-type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    expect(metrics.headers.get("cache-control")).toBe("no-store");
    await expect(metrics.text()).resolves.toBe(
      "navigator_process_cpu_seconds_total 1\n",
    );

    const query = await fetch(
      `http://127.0.0.1:${port}/metrics?requestId=private-ID-VN`,
    );
    expect(query.status).toBe(404);
    await expect(query.text()).resolves.toBe("");

    const otherPath = await fetch(
      `http://127.0.0.1:${port}/private-ID-VN`,
    );
    expect(otherPath.status).toBe(404);
    await expect(otherPath.text()).resolves.toBe("");

    const otherMethod = await fetch(`http://127.0.0.1:${port}/metrics`, {
      method: "POST",
    });
    expect(otherMethod.status).toBe(405);
    expect(otherMethod.headers.get("allow")).toBe("GET");
    await expect(otherMethod.text()).resolves.toBe("");
    expect(render).toHaveBeenCalledOnce();
  });

  test("returns a fixed empty 500 when rendering fails without exposing the error", async () => {
    const port = await availablePort();
    const server = new MetricsServer({
      closeRegistry: () => undefined,
      port,
      render: () => {
        throw new Error("postgresql://user:secret@db.internal/private");
      },
    });
    servers.push(server);

    await server.listen();
    const response = await fetch(`http://127.0.0.1:${port}/metrics`);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("");
  });

  test("closes a listening server and its registry exactly once", async () => {
    const port = await availablePort();
    const closeRegistry = vi.fn();
    const server = new MetricsServer({
      closeRegistry,
      port,
      render: () => "",
    });

    await server.listen();
    await Promise.all([
      server.close(),
      server.close(),
      server.onApplicationShutdown(),
    ]);

    expect(closeRegistry).toHaveBeenCalledOnce();
    await expect(fetch(`http://127.0.0.1:${port}/metrics`)).rejects.toThrow();
    await expect(server.listen()).rejects.toThrow("METRICS_SERVER_CLOSED");
  });

  test("does not close a caller-owned HTTP server when bind fails", async () => {
    const port = await availablePort();
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(port, "127.0.0.1", resolve);
    });
    const closeRegistry = vi.fn();
    const server = new MetricsServer({
      closeRegistry,
      port,
      render: () => "",
    });

    try {
      await expect(server.listen()).rejects.toMatchObject({ code: "EADDRINUSE" });
      await server.close();
      expect(closeRegistry).toHaveBeenCalledOnce();
      expect(occupied.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        occupied.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });

  test("contains runtime server errors and closes metrics resources exactly once", async () => {
    const port = await availablePort();
    const closeRegistry = vi.fn();
    let underlyingServer: Server | undefined;
    const server = new MetricsServer({
      closeRegistry,
      createHttpServer: (handler) => {
        underlyingServer = createHttpServer(handler);
        return underlyingServer;
      },
      port,
      render: () => "",
    });
    servers.push(server);

    await server.listen();
    underlyingServer?.emit(
      "error",
      new Error("postgresql://user:secret@db.internal/private"),
    );

    await vi.waitFor(() => expect(closeRegistry).toHaveBeenCalledOnce());
    await server.close();
    expect(closeRegistry).toHaveBeenCalledOnce();
    await expect(fetch(`http://127.0.0.1:${port}/metrics`)).rejects.toThrow();
  });
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("TEST_PORT_UNAVAILABLE");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}
