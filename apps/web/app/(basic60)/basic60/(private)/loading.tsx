import { getRequestLocale } from "@/lib/i18n/server";

export default async function Basic60Loading() {
  const locale = await getRequestLocale();
  return (
    <div className="basic60-page-state" role="status" aria-live="polite">
      <span className="basic60-loading-dot" aria-hidden="true" />
      <p>{locale === "en" ? "Loading market data…" : "正在加载市场数据…"}</p>
    </div>
  );
}
