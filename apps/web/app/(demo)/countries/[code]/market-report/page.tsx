import { notFound } from "next/navigation";
import LegacyCountryReportRedirect from "@/app/(basic60)/basic60/(private)/countries/[code]/market-report/page";
import { APPROVED_BASIC60_DEMO_RUNTIME_PROFILE, currentRuntimeProfile } from "@/lib/runtime-profile";

export default async function CanonicalLegacyCountryReportRedirect(props: { params: Promise<{ code: string }> }) {
  // The approved runtime rewrites to its own shell. Never let the separate
  // synthetic Demo route initiate a real-content request.
  if (currentRuntimeProfile() !== APPROVED_BASIC60_DEMO_RUNTIME_PROFILE) notFound();
  return LegacyCountryReportRedirect(props);
}
