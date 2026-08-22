import { AlertTriangle, DatabaseZap, LoaderCircle, RefreshCw } from "lucide-react";

export function LoadingState({ label = "正在加载合成演示数据…" }: { label?: string }) {
  return (
    <div className="page-state" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={28} aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="page-state page-state-error" role="alert">
      <AlertTriangle size={28} aria-hidden="true" />
      <div>
        <strong>暂时无法显示</strong>
        <p>{message}</p>
      </div>
      {retry ? (
        <button className="button button-secondary" type="button" onClick={retry}>
          <RefreshCw size={16} aria-hidden="true" /> 重新加载
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ message = "当前筛选条件下没有演示记录。" }: { message?: string }) {
  return (
    <div className="page-state" role="status">
      <DatabaseZap size={28} aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
