import { ApprovedBasic60ModulePage } from "@/components/approved-basic60-module-page";
import { approvedBasic60PageContext, type ApprovedBasic60SearchParams } from "@/lib/approved-basic60/page-context";

export default async function ApprovedBasic60PartnersPage({ searchParams }: { searchParams: ApprovedBasic60SearchParams }) {
  const { locale, countryCode } = await approvedBasic60PageContext(searchParams);
  return <ApprovedBasic60ModulePage kind="partners" locale={locale} countryCode={countryCode} />;
}
