import { redirect } from "next/navigation";
import { homeMarketHref } from "@/lib/approved-basic60/navigation";

export default async function ComparePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const countryCode = typeof query?.country === "string" ? query.country : null;
  redirect(homeMarketHref(countryCode));
}
