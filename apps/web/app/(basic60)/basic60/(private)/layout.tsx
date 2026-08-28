import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Basic60Shell } from "@/components/basic60-shell";
import { hasValidBasic60Session } from "@/lib/basic60/session";

export const dynamic = "force-dynamic";

export default async function Basic60PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!(await hasValidBasic60Session())) redirect("/basic60/login?expired=1");
  return <Suspense fallback={null}><Basic60Shell>{children}</Basic60Shell></Suspense>;
}
