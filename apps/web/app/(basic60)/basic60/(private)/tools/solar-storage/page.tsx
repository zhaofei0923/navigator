import { ApprovedBasic60ToolPlaceholder } from "@/components/approved-basic60-module-page";
import { approvedBasic60PageContext, type ApprovedBasic60SearchParams } from "@/lib/approved-basic60/page-context";

export default async function Basic60ToolPage({ searchParams }: { searchParams: ApprovedBasic60SearchParams }) {
  const { locale, countryCode } = await approvedBasic60PageContext(searchParams);
  return <ApprovedBasic60ToolPlaceholder step="solar-storage" locale={locale} countryCode={countryCode} basePath="/basic60" />;
}
