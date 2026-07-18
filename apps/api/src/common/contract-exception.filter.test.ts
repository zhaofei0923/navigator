import { Controller, Get, type INestApplication } from "@nestjs/common";
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
});
