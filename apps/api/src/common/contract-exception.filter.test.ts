import {
  Controller,
  Get,
  HttpException,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { ContractExceptionFilter } from "./contract-exception.filter.js";

@Controller("explode")
class ExplodingController {
  @Get()
  explode(): never {
    throw new Error(
      "SELECT secret at postgresql://user:password@db.internal:5432/navigator /home/kevin/navigator/data/staging embeddingZh fileUrl",
    );
  }

  @Get("http-exception")
  httpException(): never {
    throw new HttpException(
      {
        error: {
          code: "DATABASE_UNAVAILABLE",
          message:
            "SELECT secret at postgresql://user:password@db.internal:5432/navigator /home/kevin/navigator/data/staging",
        },
        success: false,
      },
      503,
    );
  }
}

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [ExplodingController],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.useGlobalFilters(new ContractExceptionFilter());
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("TEST_HTTP_ADDRESS_UNAVAILABLE");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
});

describe("ContractExceptionFilter", () => {
  test("returns only the fixed internal-error contract over HTTP", async () => {
    const response = await fetch(`${baseUrl}/explode`);
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toMatch(/^application\/json\b/i);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
      success: false,
    });
    expect(JSON.stringify(body)).not.toMatch(
      /SELECT|postgresql|password|db\.internal|\/home\/|staging|embedding|fileUrl/,
    );
  });

  test("does not pass through an untrusted HttpException body", async () => {
    const response = await fetch(`${baseUrl}/explode/http-exception`);
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toMatch(/^application\/json\b/i);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
      success: false,
    });
    expect(JSON.stringify(body)).not.toMatch(
      /SELECT|postgresql|password|db\.internal|\/home\/|staging/,
    );
  });

  test("maps an unknown router path to a fixed 404 without reflecting the path", async () => {
    const secretPath =
      "/api/v1/health/live/postgresql%3A%2F%2Fuser%3Apassword%40db.internal";
    const response = await fetch(`${baseUrl}${secretPath}`);
    const body: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/^application\/json\b/i);
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        details: null,
        message: "Resource not found",
      },
      success: false,
    });
    expect(JSON.stringify(body)).not.toMatch(
      /health|postgresql|password|db\.internal|Cannot GET/i,
    );
  });
});
