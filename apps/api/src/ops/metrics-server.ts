import type { OnApplicationShutdown } from "@nestjs/common";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

const METRICS_HOST = "127.0.0.1";
const METRICS_PATH = "/metrics";

export interface MetricsServerOptions {
  readonly closeRegistry: () => Promise<void> | void;
  readonly createHttpServer?: MetricsHttpServerFactory;
  readonly port: number;
  readonly render: () => string;
}

export type MetricsHttpServerFactory = (
  requestListener: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => void,
) => Server;

export class MetricsServer implements OnApplicationShutdown {
  private readonly closeRegistry: () => Promise<void> | void;
  private readonly createHttpServer: MetricsHttpServerFactory;
  private readonly port: number;
  private readonly render: () => string;
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private server: Server | undefined;
  private startPromise: Promise<void> | undefined;

  constructor(options: MetricsServerOptions) {
    this.closeRegistry = options.closeRegistry;
    this.createHttpServer = options.createHttpServer ?? createServer;
    this.port = options.port;
    this.render = options.render;
  }

  listen(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("METRICS_SERVER_CLOSED"));
    }
    if (this.startPromise !== undefined) return this.startPromise;

    const server = this.createHttpServer((request, response) => {
      this.handleRequest(request, response);
    });
    server.maxHeadersCount = 32;
    server.headersTimeout = 5_000;
    server.requestTimeout = 5_000;
    server.keepAliveTimeout = 1_000;
    this.server = server;
    this.startPromise = new Promise<void>((resolve, reject) => {
      let listening = false;
      const handleError = (error: Error): void => {
        if (!listening) {
          server.removeListener("listening", handleListening);
          reject(error);
          return;
        }
        void this.close().catch(() => undefined);
      };
      const handleListening = (): void => {
        listening = true;
        resolve();
      };
      server.on("error", handleError);
      server.once("listening", handleListening);
      server.listen(this.port, METRICS_HOST);
    });
    return this.startPromise;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closed = true;
    this.closePromise = this.closeOnce();
    return this.closePromise;
  }

  onApplicationShutdown(): Promise<void> {
    return this.close();
  }

  private async closeOnce(): Promise<void> {
    try {
      if (this.startPromise !== undefined) {
        await this.startPromise.catch(() => undefined);
      }
      if (this.server?.listening === true) {
        await new Promise<void>((resolve, reject) => {
          this.server?.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        });
      }
    } finally {
      await this.closeRegistry();
    }
  }

  private handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    if (request.url !== METRICS_PATH) {
      respondEmpty(response, 404);
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("allow", "GET");
      respondEmpty(response, 405);
      return;
    }

    try {
      const body = this.render();
      response.statusCode = 200;
      response.setHeader(
        "content-type",
        "text/plain; version=0.0.4; charset=utf-8",
      );
      response.setHeader("cache-control", "no-store");
      response.setHeader("x-content-type-options", "nosniff");
      response.end(body);
    } catch {
      respondEmpty(response, 500);
    }
  }
}

function respondEmpty(response: ServerResponse, statusCode: number): void {
  response.statusCode = statusCode;
  response.setHeader("content-length", "0");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end();
}
