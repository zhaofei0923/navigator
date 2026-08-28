import "@/components/country-market-content.css";
import { MarketOverviewPrint, MarketOverviewRetry } from "@/components/market-content-actions";
import type { Basic60Locale } from "@/lib/basic60/types";
import { MARKET_OVERVIEW_COPY } from "@/lib/market-content/presentation";
import type { MarketOverviewResult } from "@/lib/market-content/types";

export async function CountryMarketOverview({ result, locale }: { result: Promise<MarketOverviewResult>; locale: Basic60Locale }) {
  let response: MarketOverviewResult;
  try { response = await result; } catch { return <MarketOverviewUnavailable locale={locale} />; }
  if (response.status !== "ready") return <MarketOverviewUnavailable locale={locale} />;
  const { data, meta } = response.envelope;
  const copy = MARKET_OVERVIEW_COPY[locale];
  return (
    <article className="country-market-overview" id="market-overview" aria-labelledby="market-overview-title" lang={locale}>
      <div className="market-overview-content">
        <header className="market-overview-heading">
          <div>
            <h2 id="market-overview-title">{data.title}</h2>
            <p className="market-overview-date">{copy.asOf} <time dateTime={meta.as_of}>{meta.as_of}</time></p>
          </div>
          <MarketOverviewPrint locale={locale} />
        </header>
        <div className="market-overview-body">{data.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        <p className="market-overview-disclaimer">{data.disclaimer}</p>
      </div>
    </article>
  );
}

export function MarketOverviewLoading({ locale }: { locale: Basic60Locale }) {
  const copy = MARKET_OVERVIEW_COPY[locale];
  return (
    <article className="country-market-overview market-overview-placeholder" id="market-overview" aria-labelledby="market-overview-title" aria-busy="true" lang={locale}>
      <div className="market-overview-content">
        <h2 id="market-overview-title">{copy.title}</h2>
        <div className="market-overview-loading" role="status"><span className="basic60-loading-dot" aria-hidden="true" /><p>{copy.loading}</p></div>
      </div>
    </article>
  );
}

export function MarketOverviewUnavailable({ locale }: { locale: Basic60Locale }) {
  const copy = MARKET_OVERVIEW_COPY[locale];
  return (
    <article className="country-market-overview market-overview-placeholder" id="market-overview" aria-labelledby="market-overview-title" lang={locale}>
      <div className="market-overview-content">
        <h2 id="market-overview-title">{copy.title}</h2>
        <div className="market-overview-status" role="status"><p>{copy.unavailable}</p><p>{copy.unavailableHint}</p></div>
        <MarketOverviewRetry locale={locale} />
      </div>
    </article>
  );
}
