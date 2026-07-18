import "reflect-metadata";

import { RequestMethod, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { fileURLToPath } from "node:url";

import { AppModule } from "./app.module.js";
import { type ApiEnvironment, validateApiEnv } from "./api-config.js";

export async function bootstrap(
  environment: ApiEnvironment = process.env,
): Promise<INestApplication> {
  const config = validateApiEnv(environment);
  const app = await NestFactory.create(AppModule.register(config), { logger: false });

  configureApplication(app);
  await app.listen(config.port, "127.0.0.1");
  return app;
}

export function configureApplication(
  app: ApiApplicationConfigurationTarget,
): void {
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health/live", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
}

export interface ApiApplicationConfigurationTarget {
  setGlobalPrefix(prefix: string, options: {
    exclude: { path: string; method: RequestMethod }[];
  }): unknown;
  enableShutdownHooks(signals: string[]): unknown;
}

if (isEntrypoint()) {
  void bootstrap().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "API_BOOTSTRAP_FAILED");
    process.exitCode = 1;
  });
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && fileURLToPath(import.meta.url) === entrypoint;
}
