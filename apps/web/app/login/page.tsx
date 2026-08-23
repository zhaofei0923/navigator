import { redirect } from "next/navigation";
import { LoginPageContent } from "@/app/login/login-page-content";
import { hasValidDemoSession } from "@/lib/demo-session";

export default async function LoginPage() {
  if (await hasValidDemoSession()) redirect("/");

  return <LoginPageContent />;
}
