import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { hasValidDemoSession } from "@/lib/demo-session";

export const dynamic = "force-dynamic";

export default async function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!(await hasValidDemoSession())) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
