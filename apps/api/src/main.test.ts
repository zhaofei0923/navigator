import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";
import { RequestMethod, type INestApplication } from "@nestjs/common";

import * as main from "./main.js";
import { MetricsRegistry } from "./ops/metrics-registry.js";
import { ObservabilityInterceptor } from "./ops/observability.interceptor.js";

const applications: INestApplication[] = [];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("bootstrap", () => {
  test("recognizes both absolute and cwd-relative production entrypoints", () => {
    const isEntrypoint = Reflect.get(main, "isEntrypoint") as
      | ((entrypoint?: string) => boolean)
      | undefined;
    const mainPath = fileURLToPath(new URL("./main.ts", import.meta.url));

    expect(isEntrypoint).toBeTypeOf("function");
    expect(isEntrypoint?.(mainPath)).toBe(true);
    expect(isEntrypoint?.(relative(process.cwd(), mainPath))).toBe(true);
    expect(isEntrypoint?.("apps/api/dist/not-main.js")).toBe(false);
    expect(isEntrypoint?.(undefined)).toBe(false);
  });

  test("listens only on the loopback address", async () => {
    const metricsPort = await availablePort();
    const app = await main.bootstrap({
      API_PORT: String(await availablePort()),
      METRICS_PORT: String(metricsPort),
      COUNTRY_READ_SOURCE: "canonical",
      CANONICAL_REPOSITORY_ROOT: repositoryRoot,
    });
    applications.push(app);

    expect(app.getHttpServer().address()).toMatchObject({ address: "127.0.0.1" });
    const metrics = await fetch(`http://127.0.0.1:${metricsPort}/metrics`);
    expect(metrics.status).toBe(200);
    await expect(metrics.text()).resolves.toContain(
      "navigator_process_cpu_capacity_cores",
    );
  });

  test("rejects dependency initialization failures without process teardown", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(
      (() => {
        throw new Error("UNEXPECTED_PROCESS_EXIT");
      }) as typeof process.exit,
    );
    const abort = vi.spyOn(process, "abort").mockImplementation(() => {
      throw new Error("UNEXPECTED_PROCESS_ABORT");
    });
    const closeMetrics = vi.spyOn(MetricsRegistry.prototype, "close");
    try {
      await expect(
        main.bootstrap({
          API_PORT: String(await availablePort()),
          METRICS_PORT: String(await availablePort()),
          COUNTRY_READ_SOURCE: "canonical",
          CANONICAL_REPOSITORY_ROOT: resolve(
            repositoryRoot,
            "missing-bootstrap-repository",
          ),
        }),
      ).rejects.toThrow();
      expect(exit).not.toHaveBeenCalled();
      expect(abort).not.toHaveBeenCalled();
      expect(closeMetrics).toHaveBeenCalledOnce();
    } finally {
      exit.mockRestore();
      abort.mockRestore();
      closeMetrics.mockRestore();
    }
  });

  test("closes the API listener when the metrics listener cannot bind", async () => {
    const apiPort = await availablePort();
    const metricsPort = await availablePort();
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(metricsPort, "127.0.0.1", resolve);
    });

    try {
      await expect(
        main.bootstrap({
          API_PORT: String(apiPort),
          METRICS_PORT: String(metricsPort),
          COUNTRY_READ_SOURCE: "canonical",
          CANONICAL_REPOSITORY_ROOT: repositoryRoot,
        }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
      await expect(fetch(`http://127.0.0.1:${apiPort}/health/live`)).rejects.toThrow();
      expect(occupied.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        occupied.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      });
    }
  });

  test("observes matched and unmatched HTTP requests without reflecting raw URLs", async () => {
    const writes: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(
      ((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      }) as typeof process.stdout.write,
    );
    try {
      const metricsPort = await availablePort();
      const app = await main.bootstrap({
        API_PORT: String(await availablePort()),
        METRICS_PORT: String(metricsPort),
        COUNTRY_READ_SOURCE: "canonical",
        CANONICAL_REPOSITORY_ROOT: repositoryRoot,
      });
      applications.push(app);
      const address = app.getHttpServer().address();
      expect(address).not.toBeNull();
      expect(typeof address).not.toBe("string");
      if (address === null || typeof address === "string") return;
      const origin = `http://127.0.0.1:${address.port}`;

      const live = await fetch(`${origin}/health/live`, {
        headers: {
          traceparent:
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          "x-request-id": "matched_request-123",
        },
      });
      await expect(live.json()).resolves.toEqual({ status: "ok" });
      expect(live.headers.get("x-request-id")).toBe("matched_request-123");
      expect(live.headers.get("traceparent")).toMatch(
        /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/,
      );

      const unmatched = await fetch(
        `${origin}/api/v1/health/live/postgresql%3Asecret?email=person%40example.com`,
        { headers: { "x-request-id": "person@example.com" } },
      );
      expect(unmatched.status).toBe(404);
      await unmatched.text();
      expect(unmatched.headers.get("x-request-id")).toMatch(
        /^[A-Za-z0-9_-]{16,64}$/,
      );
      expect(unmatched.headers.get("traceparent")).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/,
      );

      await new Promise<void>((resolve) => setImmediate(resolve));
      const records = writes
        .filter((line) => line.endsWith("\n"))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((record) =>
          String(record.event).startsWith("http_request_"),
        );
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        method: "GET",
        requestId: "matched_request-123",
        route: "/health/live",
        status: 200,
      });
      expect(records[1]).toMatchObject({
        errorCode: "NOT_FOUND",
        method: "GET",
        route: "UNMATCHED",
        status: 404,
      });
      expect(JSON.stringify(records)).not.toMatch(
        /postgresql|secret|person@|example\.com|health\/live\/postgresql/i,
      );
      const firstCountries = await fetch(`${origin}/api/v1/countries?locale=en`);
      const secondCountries = await fetch(`${origin}/api/v1/countries?locale=en`);
      expect(firstCountries.headers.get("x-navigator-cache")).toBe("miss");
      expect(secondCountries.headers.get("x-navigator-cache")).toBe("hit");
      await firstCountries.text();
      await secondCountries.text();
      const metrics = await fetch(`http://127.0.0.1:${metricsPort}/metrics`);
      const exposition = await metrics.text();
      expect(exposition).toContain(
        'navigator_http_requests_total{method="GET",route="/health/live",status="200"} 1',
      );
      expect(exposition).toContain(
        'navigator_http_requests_total{method="GET",route="UNMATCHED",status="404"} 1',
      );
      expect(exposition).toContain(
        'navigator_cache_requests_total{route="/api/v1/countries",state="miss"} 1',
      );
      expect(exposition).toContain(
        'navigator_cache_requests_total{route="/api/v1/countries",state="hit"} 1',
      );
      expect(exposition).toContain(
        'navigator_db_operation_duration_seconds_count{operation="country_list"} 0',
      );
    } finally {
      stdout.mockRestore();
    }
  });

  test("guards the listener source against implicit or public binding", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain('app.listen(config.port, "127.0.0.1")');
    expect(source).not.toMatch(/app\.listen\(config\.port\s*\)/);
    expect(source).not.toContain('app.listen(config.port, "0.0.0.0")');
    expect(source).toContain("metricsServer.listen()");
  });

  test("configures the exact API prefix exclusions and shutdown signals", () => {
    const setGlobalPrefix = vi.fn();
    const enableShutdownHooks = vi.fn();
    const use = vi.fn();
    const useGlobalInterceptors = vi.fn();
    const configureApplication = Reflect.get(main, "configureApplication") as
      | ApplicationConfigurator
      | undefined;

    expect(configureApplication).toBeTypeOf("function");
    configureApplication?.({
      enableShutdownHooks,
      setGlobalPrefix,
      use,
      useGlobalInterceptors,
    });

    expect(setGlobalPrefix).toHaveBeenCalledExactlyOnceWith("api/v1", {
      exclude: [
        { path: "health/live", method: RequestMethod.GET },
        { path: "health/ready", method: RequestMethod.GET },
      ],
    });
    expect(enableShutdownHooks).toHaveBeenCalledExactlyOnceWith([
      "SIGTERM",
      "SIGINT",
    ]);
    expect(use).toHaveBeenCalledTimes(1);
    expect(useGlobalInterceptors).toHaveBeenCalledTimes(1);
    const middleware = use.mock.calls[0]?.[0];
    const interceptor = useGlobalInterceptors.mock.calls[0]?.[0];
    expect(interceptor).toBeInstanceOf(ObservabilityInterceptor);
    expect(middleware).toBe(interceptor.middleware);
  });

  test("never writes an arbitrary bootstrap exception message", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).not.toContain("error.message");
    expect(source).toContain("logBootstrapFailure()");
  });
});

type ApplicationConfigurator = (application: {
  setGlobalPrefix(prefix: string, options: {
    exclude: { path: string; method: RequestMethod }[];
  }): unknown;
  enableShutdownHooks(signals: string[]): unknown;
  use(middleware: unknown): unknown;
  useGlobalInterceptors(interceptor: unknown): unknown;
}) => void;

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    throw new Error("TEST_PORT_UNAVAILABLE");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
