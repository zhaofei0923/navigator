import "reflect-metadata";

import {
  RequestMethod,
  type INestApplication,
  type NestInterceptor,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AppModule } from "./app.module.js";
import { type ApiEnvironment, validateApiEnv } from "./api-config.js";
import { JsonLogger } from "./ops/json-logger.js";
import {
  METRICS_REGISTRY,
  MetricsRegistry,
  type MetricsRecorder,
} from "./ops/metrics-registry.js";
import { MetricsServer } from "./ops/metrics-server.js";
import { ObservabilityInterceptor } from "./ops/observability.interceptor.js";

export async function bootstrap(
  environment: ApiEnvironment = process.env,
): Promise<INestApplication> {
  const config = validateApiEnv(environment);
  const registry = new MetricsRegistry();
  let app: INestApplication | undefined;

  try {
    app = await NestFactory.create(AppModule.register(config, registry), {
      abortOnError: false,
      logger: false,
    });
    const metrics = app.get<MetricsRecorder>(METRICS_REGISTRY);
    const metricsServer = app.get(MetricsServer);
    configureApplication(app, metrics);
    await app.listen(config.port, "127.0.0.1");
    await metricsServer.listen();
    return app;
  } catch (error) {
    if (app === undefined) {
      registry.close();
    } else {
      try {
        await app.close();
      } catch {
        registry.close();
      }
    }
    throw error;
  }
}

export function configureApplication(
  app: ApiApplicationConfigurationTarget,
  metrics?: MetricsRecorder,
): void {
  const observability = new ObservabilityInterceptor({ metrics });
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health/live", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
    ],
  });
  app.use(observability.middleware);
  app.useGlobalInterceptors(observability);
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
}

export interface ApiApplicationConfigurationTarget {
  setGlobalPrefix(prefix: string, options: {
    exclude: { path: string; method: RequestMethod }[];
  }): unknown;
  enableShutdownHooks(signals: string[]): unknown;
  use(middleware: unknown): unknown;
  useGlobalInterceptors(...interceptors: NestInterceptor[]): unknown;
}

if (isEntrypoint()) {
  void bootstrap().catch(() => {
    new JsonLogger().logBootstrapFailure();
    process.exitCode = 1;
  });
}

export function isEntrypoint(entrypoint = process.argv[1]): boolean {
  return (
    entrypoint !== undefined &&
    fileURLToPath(import.meta.url) === resolve(entrypoint)
  );
}
