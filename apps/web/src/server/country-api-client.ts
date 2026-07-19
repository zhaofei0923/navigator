import "server-only";

import type {
  CountryFilters,
  LocalizedCountriesResponse,
  LocalizedCountryDetailResponse,
  LocalizedCountryModuleResponse,
} from "@navigator/shared-types/country-api";
import { parseCountryCodeParam } from "@navigator/shared-types/country-query";
import { validateWebEnv } from "@navigator/shared-types/env";
import type { Locale, ModuleKey } from "@navigator/shared-types/schema";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface CountryApiClientOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetcher?: Fetcher;
}

export class CountryApiClientError extends Error {
  constructor() {
    super("COUNTRY_API_REQUEST_FAILED");
    this.name = "CountryApiClientError";
  }
}

export async function fetchCountries(
  filters: CountryFilters,
  options?: CountryApiClientOptions,
): Promise<LocalizedCountriesResponse> {
  const searchParams = new URLSearchParams({
    locale: filters.locale ?? "zh-CN",
    page: String(filters.page ?? 1),
    pageSize: String(filters.pageSize ?? 20),
    textMode: "localized",
  });
  if (filters.coverageLevel !== undefined) {
    searchParams.set("coverageLevel", filters.coverageLevel);
  }
  if ((filters.industryTags?.length ?? 0) > 0) {
    searchParams.set("industryTags", filters.industryTags?.join(",") ?? "");
  }
  if (filters.region !== undefined) {
    searchParams.set("region", filters.region);
  }
  if ((filters.techTags?.length ?? 0) > 0) {
    searchParams.set("techTags", filters.techTags?.join(",") ?? "");
  }

  const value = await requestCountryApi(
    `countries?${searchParams.toString()}`,
    filters.locale ?? "zh-CN",
    options,
  );
  if (!isLocalizedCountriesResponse(value)) {
    throw new CountryApiClientError();
  }
  return value;
}

export async function fetchCountryDetail(
  code: string,
  locale: Locale,
  options?: CountryApiClientOptions,
): Promise<LocalizedCountryDetailResponse | null> {
  const searchParams = new URLSearchParams({ locale, textMode: "localized" });
  const value = await requestCountryApi(
    `countries/${countryCodePath(code)}?${searchParams.toString()}`,
    locale,
    options,
    true,
  );
  if (value === null) {
    return null;
  }
  if (!isLocalizedCountryDetailResponse(value)) {
    throw new CountryApiClientError();
  }
  return value;
}

export async function fetchCountryModule(
  code: string,
  moduleKey: ModuleKey,
  locale: Locale,
  options?: CountryApiClientOptions,
): Promise<LocalizedCountryModuleResponse | null> {
  const searchParams = new URLSearchParams({
    locale,
    page: "1",
    pageSize: "20",
    textMode: "localized",
  });
  const value = await requestCountryApi(
    `countries/${countryCodePath(code)}/modules/${encodeURIComponent(moduleKey)}?${searchParams.toString()}`,
    locale,
    options,
    true,
  );
  if (value === null) {
    return null;
  }
  if (!isLocalizedCountryModuleResponse(value, moduleKey)) {
    throw new CountryApiClientError();
  }
  return value;
}

async function requestCountryApi(
  target: string,
  locale: Locale,
  options: CountryApiClientOptions | undefined,
  allowNotFound = false,
): Promise<unknown | null> {
  try {
    const config = validateWebEnv(options?.environment ?? process.env);
    const fetcher = options?.fetcher ?? globalThis.fetch;
    const response = await fetcher(
      `${config.apiInternalBaseUrl.replace(/\/+$/u, "")}/${target}`,
      {
        cache: "no-store",
        headers: { accept: "application/json", "accept-language": locale },
        method: "GET",
        redirect: "manual",
      },
    );
    if (allowNotFound && response.status === 404) {
      return null;
    }
    if (!response.ok || !isJsonContentType(response.headers.get("content-type"))) {
      throw new CountryApiClientError();
    }
    return await response.json();
  } catch {
    throw new CountryApiClientError();
  }
}

function countryCodePath(code: string): string {
  return encodeURIComponent(parseCountryCodeParam(code));
}

function isJsonContentType(value: string | null): boolean {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" ||
    (mediaType?.startsWith("application/") === true && mediaType.endsWith("+json"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalizedMeta(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    (value.locale === "zh-CN" || value.locale === "en") &&
    value.textMode === "localized";
}

function isLocalizedCountriesResponse(
  value: unknown,
): value is LocalizedCountriesResponse {
  return isRecord(value) &&
    value.success === true &&
    Array.isArray(value.data) &&
    isLocalizedMeta(value.meta) &&
    typeof value.meta.total === "number";
}

function isLocalizedCountryDetailResponse(
  value: unknown,
): value is LocalizedCountryDetailResponse {
  return isRecord(value) &&
    value.success === true &&
    isRecord(value.data) &&
    typeof value.data.code === "string" &&
    isLocalizedMeta(value.meta);
}

function isLocalizedCountryModuleResponse(
  value: unknown,
  moduleKey: ModuleKey,
): value is LocalizedCountryModuleResponse {
  return isRecord(value) &&
    value.success === true &&
    isRecord(value.data) &&
    value.data.moduleKey === moduleKey &&
    Array.isArray(value.data._i18nFallback) &&
    isLocalizedMeta(value.meta) &&
    typeof value.meta.total === "number";
}
