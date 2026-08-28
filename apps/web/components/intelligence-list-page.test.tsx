import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntelligenceListPage } from "@/components/intelligence-list-page";
import { LocaleProvider } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ useDemoQuery: vi.fn(), reload: vi.fn(), refresh: vi.fn() }));

vi.mock("@/hooks/use-demo-query", () => ({ useDemoQuery: mocks.useDemoQuery }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("country=ZAF"),
  useRouter: () => ({ refresh: mocks.refresh }),
}));

describe("synthetic intelligence pages without market comparison", () => {
  beforeEach(() => {
    mocks.useDemoQuery.mockReset();
    mocks.useDemoQuery.mockReturnValue({ data: [], loading: false, error: null, reload: mocks.reload });
  });

  it.each(["zh-CN", "en"] as const)("keeps policy, risk, opportunity, tender and partner pages free of comparison links in %s", (locale) => {
    const kinds = ["policies", "risks", "opportunities", "tenders", "partners"] as const;
    const { container } = render(
      <LocaleProvider initialLocale={locale}>
        {kinds.map((kind) => <IntelligenceListPage key={kind} kind={kind} />)}
      </LocaleProvider>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(kinds.length);
    expect(screen.queryByRole("link", { name: /对比|比较|compar/i })).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="/compare"]')).toBeNull();
  });
});
