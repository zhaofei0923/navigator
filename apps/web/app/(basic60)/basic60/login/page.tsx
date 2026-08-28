import { redirect } from "next/navigation";
import { Basic60LoginPageContent } from "./login-page-content";
import { hasValidBasic60Session } from "@/lib/basic60/session";

export const dynamic = "force-dynamic";

export default async function Basic60LoginPage() {
  if (await hasValidBasic60Session()) redirect("/basic60");
  return <Basic60LoginPageContent />;
}
