import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Inject,
  Res,
} from "@nestjs/common";

import { HealthService } from "./health.service.js";

interface StatusResponse {
  status(statusCode: number): unknown;
}

@Controller("health")
export class HealthController {
  constructor(
    @Inject(HealthService) private readonly healthService: HealthService,
  ) {}

  @Get("live")
  @Header("Cache-Control", "no-store")
  live(): { readonly status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @Header("Cache-Control", "no-store")
  async ready(
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<{ readonly status: "ready" | "not_ready" }> {
    if (await this.healthService.isReady()) {
      return { status: "ready" };
    }
    response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: "not_ready" };
  }
}
