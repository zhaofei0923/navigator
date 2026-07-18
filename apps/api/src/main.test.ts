import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";
import { RequestMethod, type INestApplication } from "@nestjs/common";

import * as main from "./main.js";

const applications: INestApplication[] = [];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("bootstrap", () => {
  test("listens only on the loopback address", async () => {
    const app = await main.bootstrap({
      API_PORT: String(await availablePort()),
      COUNTRY_READ_SOURCE: "canonical",
      CANONICAL_REPOSITORY_ROOT: repositoryRoot,
    });
    applications.push(app);

    expect(app.getHttpServer().address()).toMatchObject({ address: "127.0.0.1" });
  });

  test("guards the listener source against implicit or public binding", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain('app.listen(config.port, "127.0.0.1")');
    expect(source).not.toMatch(/app\.listen\(config\.port\s*\)/);
    expect(source).not.toContain('app.listen(config.port, "0.0.0.0")');
  });

  test("configures the exact API prefix exclusions and shutdown signals", () => {
    const setGlobalPrefix = vi.fn();
    const enableShutdownHooks = vi.fn();
    const configureApplication = Reflect.get(main, "configureApplication") as
      | ApplicationConfigurator
      | undefined;

    expect(configureApplication).toBeTypeOf("function");
    configureApplication?.({ setGlobalPrefix, enableShutdownHooks });

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
  });
});

type ApplicationConfigurator = (application: {
  setGlobalPrefix(prefix: string, options: {
    exclude: { path: string; method: RequestMethod }[];
  }): unknown;
  enableShutdownHooks(signals: string[]): unknown;
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
