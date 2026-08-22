import { Compass } from "lucide-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { hasValidDemoSession } from "@/lib/demo-session";

export default async function LoginPage() {
  if (await hasValidDemoSession()) redirect("/");

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="brand-icon" aria-hidden="true">
            <Compass size={32} strokeWidth={1.8} />
          </span>
          <span>Navigator</span>
        </div>
        <h1 id="login-title">内部演示入口</h1>
        <p>输入共享演示口令，进入合成数据环境。</p>
        <div className="login-notice" role="note">
          演示数据 / 非正式结论
        </div>
        <Suspense fallback={<p className="login-boundary">正在准备安全登录…</p>}>
          <LoginForm />
        </Suspense>
        <p className="login-boundary">
          本环境不连接外部数据、模型或真实用户系统，也不构成专业结论。
        </p>
      </section>
    </main>
  );
}
