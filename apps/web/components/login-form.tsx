"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { useSearchParams } from "next/navigation";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("expired") ? "演示会话已结束，请重新输入口令。" : null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "无法进入演示环境。");
      window.location.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法进入演示环境。");
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="passphrase">共享演示口令</label>
      <div className="input-with-icon">
        <LockKeyhole size={18} aria-hidden="true" />
        <input
          id="passphrase"
          name="passphrase"
          type="password"
          autoComplete="current-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          required
          minLength={8}
          autoFocus
        />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button button-primary button-wide" type="submit" disabled={submitting}>
        {submitting ? "正在验证…" : "进入内部 demo"}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  );
}
