import type { CountryReadRepository } from "@navigator/shared-types/country-runtime";

import { COUNTRY_READ_REPOSITORY } from "../runtime/country-read-runtime.provider.js";

export const COUNTRY_READ_PROVIDER = COUNTRY_READ_REPOSITORY;
export type CountryReadProvider = CountryReadRepository;
