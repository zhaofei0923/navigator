"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionary";

type LoginErrorKey = Extract<TranslationKey, `login.error.${string}`>;

function errorKeyForStatus(status: number): LoginErrorKey {
  if (status === 400) return "login.error.invalidRequest";
  if (status === 401) return "login.error.invalidPassphrase";
  if (status === 503) return "login.error.notConfigured";
  return "login.error.default";
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const t = useTranslations();
  const [passphrase, setPassphrase] = useState("");
  const [errorKey, setErrorKey] = useState<LoginErrorKey | null>(
    searchParams.get("expired") ? "login.error.expired" : null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKey(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!response.ok) {
        setErrorKey(errorKeyForStatus(response.status));
        setSubmitting(false);
        return;
      }
      window.location.replace("/");
    } catch {
      setErrorKey("login.error.default");
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
        value="navigator-demo"
        readOnly
        tabIndex={-1}
        aria-hidden="true"
      />
      <label htmlFor="passphrase">{t("login.passphrase")}</label>
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
      {errorKey ? (
        <p className="form-error" role="alert">
          {t(errorKey)}
        </p>
      ) : null}
      <button className="button button-primary button-wide" type="submit" disabled={submitting}>
        {submitting ? t("login.submitting") : t("login.submit")}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  );
}
