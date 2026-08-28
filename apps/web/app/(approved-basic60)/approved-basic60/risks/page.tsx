import { redirect } from "next/navigation";
import { toolHref } from "@/lib/tool-journey";
import { approvedBasic60PageContext, type ApprovedBasic60SearchParams } from "@/lib/approved-basic60/page-context";

export default async function RetiredRisksPage({ searchParams }: { searchParams: ApprovedBasic60SearchParams }) {
  const { countryCode } = await approvedBasic60PageContext(searchParams);
  redirect(toolHref("/tools", countryCode ?? ""));
}
