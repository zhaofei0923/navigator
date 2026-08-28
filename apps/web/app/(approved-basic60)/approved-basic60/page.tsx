import { ApprovedBasic60MarketPage } from "@/components/approved-basic60-market-page";
import type { ApprovedBasic60SearchParams } from "@/lib/approved-basic60/page-context";

export default function ApprovedBasic60HomePage({
  searchParams,
}: { searchParams: ApprovedBasic60SearchParams }) {
  return <ApprovedBasic60MarketPage searchParams={searchParams} />;
}
