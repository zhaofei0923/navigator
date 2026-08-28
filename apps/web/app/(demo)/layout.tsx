import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { hasValidDemoSession } from "@/lib/demo-session";

export const dynamic = "force-dynamic";

export default async function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!(await hasValidDemoSession())) redirect("/login");
  return <Suspense fallback={null}><AppShell>{children}</AppShell></Suspense>;
}
