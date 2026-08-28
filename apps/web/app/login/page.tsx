import { redirect } from "next/navigation";
import { LoginPageContent } from "@/app/login/login-page-content";
import { hasValidDemoSession } from "@/lib/demo-session";
import {
  APPROVED_BASIC60_DEMO_RUNTIME_PROFILE,
  currentRuntimeProfile,
} from "@/lib/runtime-profile";

export default async function LoginPage() {
  if (currentRuntimeProfile() === APPROVED_BASIC60_DEMO_RUNTIME_PROFILE) {
    redirect("/");
    return null;
  }

  if (await hasValidDemoSession()) redirect("/");

  return <LoginPageContent />;
}
