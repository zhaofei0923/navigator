import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Req,
  Res,
} from "@nestjs/common";
import { CountryNotFoundError } from "@navigator/db/country-read-runtime";
import {
  parseApiCountryQuery,
  parseCountryCodeParam,
  parseModuleKeyParam,
  type CountriesResponse,
  type CountryDetailResponse,
  type CountryModuleResponse,
} from "@navigator/shared-types/country-runtime";

import type { CachedRead } from "../ops/readonly-response-cache.js";
import { CountriesService } from "./countries.service.js";

interface RequestWithUrl {
  readonly url: string;
}

interface PassthroughResponse {
  removeHeader(name: string): void;
  setHeader(name: string, value: string): void;
}

@Controller("countries")
export class CountriesController {
  constructor(
    @Inject(CountriesService)
    private readonly countriesService: CountriesService,
  ) {}

  @Get()
  async list(
    @Req() request: RequestWithUrl,
    @Res({ passthrough: true }) response: PassthroughResponse,
    @Headers("accept-language") acceptLanguage?: string,
  ): Promise<CountriesResponse> {
    const query = parseApiCountryQuery({
      acceptLanguage,
      searchParams: searchParamsFrom(request.url),
    });
    if (Object.keys(query.errors).length > 0) {
      throw invalidQuery(query.errors, "Invalid countries query");
    }
    return successfulBody(
      response,
      await this.countriesService.list(query.filters, query.textMode),
    );
  }

  @Get(":code")
  async detail(
    @Param("code") code: string,
    @Req() request: RequestWithUrl,
    @Res({ passthrough: true }) response: PassthroughResponse,
    @Headers("accept-language") acceptLanguage?: string,
  ): Promise<CountryDetailResponse> {
    const query = parseApiCountryQuery({
      acceptLanguage,
      searchParams: searchParamsFrom(request.url),
    });
    if (Object.keys(query.errors).length > 0) {
      throw invalidQuery(query.errors, "Invalid country detail query");
    }
    try {
      return successfulBody(
        response,
        await this.countriesService.detail(
          parseCountryCodeParam(code),
          { locale: query.filters.locale },
          query.textMode,
        ),
      );
    } catch (error) {
      if (error instanceof CountryNotFoundError) throw countryNotFound();
      throw error;
    }
  }

  @Get(":code/modules/:moduleKey")
  async module(
    @Param("code") code: string,
    @Param("moduleKey") moduleKey: string,
    @Req() request: RequestWithUrl,
    @Res({ passthrough: true }) response: PassthroughResponse,
    @Headers("accept-language") acceptLanguage?: string,
  ): Promise<CountryModuleResponse> {
    const query = parseApiCountryQuery({
      acceptLanguage,
      searchParams: searchParamsFrom(request.url),
    });
    const parsedModuleKey = parseModuleKeyParam(moduleKey);
    const errors = { ...query.errors };
    if (parsedModuleKey === null) {
      errors.moduleKey = moduleKey;
    }
    if (parsedModuleKey === null || Object.keys(errors).length > 0) {
      throw invalidQuery(errors, "Invalid country module query");
    }
    try {
      return successfulBody(
        response,
        await this.countriesService.module(
          parseCountryCodeParam(code),
          parsedModuleKey,
          {
            locale: query.filters.locale,
            page: query.filters.page,
            pageSize: query.filters.pageSize,
          },
          query.textMode,
        ),
      );
    } catch (error) {
      if (error instanceof CountryNotFoundError) throw countryNotFound();
      throw error;
    }
  }
}

function successfulBody<T>(
  response: PassthroughResponse,
  cached: CachedRead<T>,
): T {
  response.setHeader("X-Navigator-Cache", cached.state);
  if (cached.state === "stale") {
    response.setHeader("X-Navigator-Data-Stale", "1");
  } else {
    response.removeHeader("X-Navigator-Data-Stale");
  }
  return cached.value;
}

function searchParamsFrom(rawUrl: string): URLSearchParams {
  return new URL(rawUrl, "http://127.0.0.1").searchParams;
}

function invalidQuery(
  details: Record<string, string>,
  message: string,
): BadRequestException {
  return new BadRequestException({
    error: { code: "VALIDATION_ERROR", details, message },
    success: false,
  });
}

function countryNotFound(): NotFoundException {
  return new NotFoundException({
    error: {
      code: "NOT_FOUND",
      details: null,
      message: "Country not found",
    },
    success: false,
  });
}
