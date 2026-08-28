"use client";

import { Printer, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Basic60Locale } from "@/lib/basic60/types";
import { MARKET_OVERVIEW_COPY } from "@/lib/market-content/presentation";

export function MarketOverviewRetry({ locale }: { locale: Basic60Locale }) {
  const router = useRouter();
  return <button className="market-overview-retry" type="button" onClick={() => router.refresh()}><RotateCw size={15} aria-hidden="true" />{MARKET_OVERVIEW_COPY[locale].retry}</button>;
}

export function MarketOverviewPrint({ locale }: { locale: Basic60Locale }) {
  return <button className="button button-secondary market-overview-print" type="button" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />{MARKET_OVERVIEW_COPY[locale].print}</button>;
}
