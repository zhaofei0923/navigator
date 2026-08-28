import { AlertTriangle, DatabaseZap } from "lucide-react";
import type { Basic60Locale } from "@/lib/basic60/types";

// Backend errors can contain internal release, contract, or governance details.
// Keep the optional message prop for callers, but never display it to users.
export function Basic60ErrorState({ locale }: { message?: string; locale: Basic60Locale }) {
  return (
    <div className="basic60-page-state basic60-page-state-error" role="alert">
      <AlertTriangle size={25} aria-hidden="true" />
      <div>
        <strong>{locale === "en" ? "Data is temporarily unavailable" : "暂时无法加载数据"}</strong>
        <p>{locale === "en" ? "Please refresh the page or try again later." : "请刷新页面重试，或稍后再试。"}</p>
      </div>
    </div>
  );
}

export function Basic60EmptyState({ locale }: { locale: Basic60Locale }) {
  return (
    <div className="basic60-page-state" role="status">
      <DatabaseZap size={25} aria-hidden="true" />
      <p>{locale === "en" ? "No countries match your filters. Try a different name or region." : "没有符合筛选条件的国家，请尝试其他名称或区域。"}</p>
    </div>
  );
}
