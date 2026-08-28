import type { Basic60Locale } from "@/lib/basic60/types";

export type CountryMarketOverview = {
  title: string;
  paragraphs: string[];
  disclaimer: string;
};

export type MarketOverviewEnvelope = {
  meta: {
    country_code: string;
    content_version: string;
    as_of: string;
    locale: Basic60Locale;
  };
  data: CountryMarketOverview;
};

export type MarketOverviewResult =
  | { status: "ready"; envelope: MarketOverviewEnvelope }
  | { status: "unavailable" };
