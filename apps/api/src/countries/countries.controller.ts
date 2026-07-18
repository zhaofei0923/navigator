import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Req,
} from "@nestjs/common";
import {
  parseApiCountryQuery,
  parseCountryCodeParam,
  parseModuleKeyParam,
} from "@navigator/shared-types/country-runtime";

import { CountriesService } from "./countries.service.js";

interface RequestWithUrl {
  readonly url: string;
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
    @Headers("accept-language") acceptLanguage?: string,
  ) {
    const query = parseApiCountryQuery({
      acceptLanguage,
      searchParams: searchParamsFrom(request.url),
    });
    if (Object.keys(query.errors).length > 0) {
      throw invalidQuery(query.errors, "Invalid countries query");
    }
    return this.countriesService.list(query.filters, query.textMode);
  }

  @Get(":code")
  async detail(
    @Param("code") code: string,
    @Req() request: RequestWithUrl,
    @Headers("accept-language") acceptLanguage?: string,
  ) {
    const query = parseApiCountryQuery({
      acceptLanguage,
      searchParams: searchParamsFrom(request.url),
    });
    if (Object.keys(query.errors).length > 0) {
      throw invalidQuery(query.errors, "Invalid country detail query");
    }
    const response = await this.countriesService.detail(
      parseCountryCodeParam(code),
      { locale: query.filters.locale },
      query.textMode,
    );
    if (response === null) {
      throw countryNotFound();
    }
    return response;
  }

  @Get(":code/modules/:moduleKey")
  async module(
    @Param("code") code: string,
    @Param("moduleKey") moduleKey: string,
    @Req() request: RequestWithUrl,
    @Headers("accept-language") acceptLanguage?: string,
  ) {
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
    const response = await this.countriesService.module(
      parseCountryCodeParam(code),
      parsedModuleKey,
      {
        locale: query.filters.locale,
        page: query.filters.page,
        pageSize: query.filters.pageSize,
      },
      query.textMode,
    );
    if (response === null) {
      throw countryNotFound();
    }
    return response;
  }
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
