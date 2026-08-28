import { notFound, redirect } from "next/navigation";
import { Basic60ApiError, getBasic60Country } from "@/lib/basic60/api";
import { getRequestLocale } from "@/lib/i18n/server";
import { BASIC60_PRIVATE_RUNTIME_PROFILE, currentRuntimeProfile } from "@/lib/runtime-profile";

export default async function LegacyCountryReportRedirect({ params }: { params: Promise<{ code: string }> }) {
  const [{ code }, locale] = await Promise.all([params, getRequestLocale()]);
  const normalizedCode = code.toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCode) || normalizedCode === "CHN") notFound();
  try {
    await getBasic60Country(normalizedCode, locale);
  } catch (reason: unknown) {
    if (reason instanceof Basic60ApiError && reason.status === 404) notFound();
    // The detail page owns neutral, retryable data errors; no report is loaded.
  }
  const basePath = currentRuntimeProfile() === BASIC60_PRIVATE_RUNTIME_PROFILE ? "/basic60" : "";
  redirect(`${basePath}/countries/${normalizedCode}#market-overview`);
}
