"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useLocale } from "@/lib/i18n/client";

const COPY = {
  "zh-CN": {
    passphrase: "访问口令",
    submit: "进入 Navigator",
    submitting: "正在验证…",
    expired: "登录状态已过期，请重新登录。",
    invalid: "口令不正确。",
    invalidRequest: "请求格式无效。",
    notConfigured: "访问服务尚未配置，请联系管理员。",
    unavailable: "暂时无法验证，请稍后重试。",
  },
  en: {
    passphrase: "Access passphrase",
    submit: "Enter Navigator",
    submitting: "Verifying…",
    expired: "Your session has expired. Sign in again.",
    invalid: "The passphrase is incorrect.",
    invalidRequest: "The request is invalid.",
    notConfigured: "Access is not configured. Contact your administrator.",
    unavailable: "Unable to verify access. Try again shortly.",
  },
} as const;

export function Basic60LoginForm() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const searchParams = useSearchParams();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("expired") ? copy.expired : null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/basic60/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!response.ok) {
        setError(
          response.status === 400
            ? copy.invalidRequest
            : response.status === 401
              ? copy.invalid
              : response.status === 503
                ? copy.notConfigured
                : copy.unavailable,
        );
        setSubmitting(false);
        return;
      }
      window.location.replace("/basic60");
    } catch {
      setError(copy.unavailable);
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <input
        className="sr-only"
        name="username"
        type="text"
        autoComplete="username"
        value="navigator-basic60-private"
        readOnly
        tabIndex={-1}
        aria-hidden="true"
      />
      <label htmlFor="basic60-passphrase">{copy.passphrase}</label>
      <div className="input-with-icon">
        <LockKeyhole size={18} aria-hidden="true" />
        <input
          id="basic60-passphrase"
          name="passphrase"
          type="password"
          autoComplete="current-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          required
          minLength={12}
          autoFocus
        />
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-primary button-wide" type="submit" disabled={submitting}>
        {submitting ? copy.submitting : copy.submit}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  );
}
