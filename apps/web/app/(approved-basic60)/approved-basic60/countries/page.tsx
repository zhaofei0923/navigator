import { redirect } from "next/navigation";
import { homeMarketHref } from "@/lib/approved-basic60/navigation";
import { approvedBasic60PageContext, type ApprovedBasic60SearchParams } from "@/lib/approved-basic60/page-context";

export default async function RetiredCountriesPage({ searchParams }: { searchParams: ApprovedBasic60SearchParams }) {
  const { countryCode } = await approvedBasic60PageContext(searchParams);
  redirect(homeMarketHref(countryCode));
}
