import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default function ApprovedBasic60Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <Suspense fallback={null}><AppShell dataProfile="approved_basic60">{children}</AppShell></Suspense>;
}
