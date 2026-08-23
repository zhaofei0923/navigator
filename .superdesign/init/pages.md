# Navigator Demo Key Page Dependency Trees

This inventory is generated from the current working tree under `apps/web`, including uncommitted UI work. It traces every local static, type-only, barrel, side-effect, and literal dynamic import reachable from each selected route entry. Package imports are intentionally omitted. A `(shared; already listed)` marker ends a repeated branch while keeping the dependency relationship visible.

These trees are the candidate source sets for Superdesign context selection, not an instruction to upload every file. Apply the Superdesign payload budget and add only the target's necessary files, compact theme tokens, and `design-system.md`.

## Shared runtime layout context

Every page uses the root layout:

- `apps/web/app/layout.tsx`
  - `apps/web/lib/i18n/client.tsx`
    - `apps/web/lib/i18n/config.ts`
    - `apps/web/lib/i18n/dictionary.ts`
      - `apps/web/lib/i18n/config.ts` (shared; already listed)
  - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
  - `apps/web/lib/i18n/server.ts`
    - `apps/web/lib/i18n/config.ts` (shared; already listed)
  - `apps/web/app/globals.css`

Every route under `app/(demo)` additionally uses the protected demo layout:

- `apps/web/app/(demo)/layout.tsx`
  - `apps/web/components/app-shell.tsx`
    - `apps/web/components/language-switcher.tsx`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
    - `apps/web/lib/format.ts`
    - `apps/web/lib/i18n/client.tsx` (shared; already listed)
    - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
  - `apps/web/lib/demo-session.ts`

Protected pages also share these segment-state branches:

- `apps/web/app/(demo)/loading.tsx`
  - `apps/web/components/page-state.tsx`
    - `apps/web/lib/i18n/index.ts`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
- `apps/web/app/(demo)/error.tsx`
  - `apps/web/components/page-state.tsx`
    - `apps/web/lib/i18n/index.ts`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)

## `/` — Home workbench

- Entry: `apps/web/app/(demo)/page.tsx`
- Layout chain: `RootLayout` -> `DemoLayout` -> `AppShell`
- Design focus: hero, WebGL globe, selected-market summary, primary journey entry, four capabilities, workflow, and demo trust statement.
- Dependencies:
  - `apps/web/components/page-state.tsx`
    - `apps/web/lib/i18n/index.ts`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
  - `apps/web/hooks/use-demo-query.ts`
    - `apps/web/lib/api-client.ts`
      - `apps/web/lib/types.ts`
    - `apps/web/lib/i18n/index.ts` (shared; already listed)
    - `apps/web/lib/types.ts` (shared; already listed)
  - `apps/web/lib/i18n/index.ts` (shared; already listed)
  - `apps/web/lib/types.ts` (shared; already listed)
  - `apps/web/components/country-globe.tsx` (literal dynamic import; client-only)
    - `apps/web/lib/types.ts` (shared; already listed)

## `/login` — Private demo entry

- Entry: `apps/web/app/login/page.tsx`
- Layout chain: `RootLayout`
- Design focus: brand, bilingual switch, demo boundary, shared passphrase form, and one primary action.
- Dependencies:
  - `apps/web/app/login/login-page-content.tsx`
    - `apps/web/components/language-switcher.tsx`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
    - `apps/web/components/login-form.tsx`
      - `apps/web/lib/i18n/client.tsx` (shared; already listed)
      - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
    - `apps/web/lib/i18n/client.tsx` (shared; already listed)
  - `apps/web/lib/demo-session.ts`

## `/countries` — Global markets

- Entry: `apps/web/app/(demo)/countries/page.tsx`
- Layout chain: `RootLayout` -> `DemoLayout` -> `AppShell`
- Design focus: market-selection context, interactive globe, readiness summary, country action, and comparison entry.
- Dependencies:
  - `apps/web/components/page-state.tsx`
    - `apps/web/lib/i18n/index.ts`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
  - `apps/web/hooks/use-demo-query.ts`
    - `apps/web/lib/api-client.ts`
      - `apps/web/lib/types.ts`
    - `apps/web/lib/i18n/index.ts` (shared; already listed)
    - `apps/web/lib/types.ts` (shared; already listed)
  - `apps/web/lib/i18n/index.ts` (shared; already listed)
  - `apps/web/lib/types.ts` (shared; already listed)
  - `apps/web/components/country-globe.tsx` (literal dynamic import; client-only)
    - `apps/web/lib/types.ts` (shared; already listed)

## `/countries/[code]` — Country detail

- Entry: `apps/web/app/(demo)/countries/[code]/page.tsx`
- Layout chain: `RootLayout` -> `DemoLayout` -> `AppShell`
- Design focus: current-market identity, five-dimension judgement, entry reasons, major risks, next actions, timeline, and related-work links.
- Dependencies:
  - `apps/web/components/country-detail-view.tsx`
    - `apps/web/components/decision-panel.tsx`
      - `apps/web/lib/i18n/index.ts`
        - `apps/web/lib/i18n/client.tsx`
          - `apps/web/lib/i18n/config.ts`
          - `apps/web/lib/i18n/dictionary.ts`
            - `apps/web/lib/i18n/config.ts` (shared; already listed)
        - `apps/web/lib/i18n/config.ts` (shared; already listed)
        - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
      - `apps/web/lib/types.ts`
    - `apps/web/components/page-state.tsx`
      - `apps/web/lib/i18n/index.ts` (shared; already listed)
    - `apps/web/components/score-strip.tsx`
      - `apps/web/lib/i18n/index.ts` (shared; already listed)
      - `apps/web/lib/types.ts` (shared; already listed)
    - `apps/web/components/signal-timeline.tsx`
      - `apps/web/lib/format.ts`
      - `apps/web/lib/i18n/index.ts` (shared; already listed)
      - `apps/web/lib/types.ts` (shared; already listed)
    - `apps/web/hooks/use-demo-query.ts`
      - `apps/web/lib/api-client.ts`
        - `apps/web/lib/types.ts` (shared; already listed)
      - `apps/web/lib/i18n/index.ts` (shared; already listed)
      - `apps/web/lib/types.ts` (shared; already listed)
    - `apps/web/lib/i18n/index.ts` (shared; already listed)
    - `apps/web/lib/types.ts` (shared; already listed)
    - `apps/web/components/radar-visualization.tsx` (literal dynamic import; client-only)
      - `apps/web/lib/types.ts` (shared; already listed)
      - `apps/web/lib/i18n/index.ts` (shared; already listed)

## `/tools` — Expansion tool hub

- Entry: `apps/web/app/(demo)/tools/page.tsx`
- Layout chain: `RootLayout` -> `DemoLayout` -> `AppShell`
- Design focus: a continuous four-step task journey rather than independent promotional cards.
- Dependencies:
  - `apps/web/lib/i18n/index.ts`
    - `apps/web/lib/i18n/client.tsx`
      - `apps/web/lib/i18n/config.ts`
      - `apps/web/lib/i18n/dictionary.ts`
        - `apps/web/lib/i18n/config.ts` (shared; already listed)
    - `apps/web/lib/i18n/config.ts` (shared; already listed)
    - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)

## `/tools/assistant` — Controlled assistant

- Entry: `apps/web/app/(demo)/tools/assistant/page.tsx`
- Layout chain: `RootLayout` -> `DemoLayout` -> `AppShell`
- Design focus: bounded market/question inputs, result states, evidence, limitations, and a clear next workflow action.
- Dependencies:
  - `apps/web/components/tool-page-shell.tsx`
    - `apps/web/lib/i18n/index.ts`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
  - `apps/web/hooks/use-demo-query.ts`
    - `apps/web/lib/api-client.ts`
      - `apps/web/lib/types.ts`
    - `apps/web/lib/i18n/index.ts` (shared; already listed)
    - `apps/web/lib/types.ts` (shared; already listed)
  - `apps/web/lib/api-client.ts` (shared; already listed)
  - `apps/web/lib/i18n/index.ts` (shared; already listed)
  - `apps/web/lib/types.ts` (shared; already listed)

## `/tools/solar-storage` — Solar-storage concept

- Entry: `apps/web/app/(demo)/tools/solar-storage/page.tsx`
- Layout chain: `RootLayout` -> `DemoLayout` -> `AppShell`
- Design focus: approximately 40/60 input/result workspace, concept summary, assumptions, risk checks, and next steps.
- Dependencies:
  - `apps/web/components/tool-page-shell.tsx`
    - `apps/web/lib/i18n/index.ts`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
  - `apps/web/hooks/use-demo-query.ts`
    - `apps/web/lib/api-client.ts`
      - `apps/web/lib/types.ts`
    - `apps/web/lib/i18n/index.ts` (shared; already listed)
    - `apps/web/lib/types.ts` (shared; already listed)
  - `apps/web/lib/api-client.ts` (shared; already listed)
  - `apps/web/lib/format.ts`
  - `apps/web/lib/i18n/index.ts` (shared; already listed)
  - `apps/web/lib/types.ts` (shared; already listed)

## `/tools/feasibility` — Feasibility draft

- Entry: `apps/web/app/(demo)/tools/feasibility/page.tsx`
- Layout chain: `RootLayout` -> `DemoLayout` -> `AppShell`
- Design focus: approximately 40/60 input/result workspace, selected report structure, draft sections, open questions, and limitations.
- Dependencies:
  - `apps/web/components/tool-page-shell.tsx`
    - `apps/web/lib/i18n/index.ts`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
  - `apps/web/hooks/use-demo-query.ts`
    - `apps/web/lib/api-client.ts`
      - `apps/web/lib/types.ts`
    - `apps/web/lib/i18n/index.ts` (shared; already listed)
    - `apps/web/lib/types.ts` (shared; already listed)
  - `apps/web/lib/api-client.ts` (shared; already listed)
  - `apps/web/lib/i18n/index.ts` (shared; already listed)
  - `apps/web/lib/types.ts` (shared; already listed)

## `/tools/tenders` — Tender preparation

- Entry: `apps/web/app/(demo)/tools/tenders/page.tsx`
- Layout chain: `RootLayout` -> `DemoLayout` -> `AppShell`
- Design focus: search and filter inputs, tender results, selection state, inline detail, loading/empty/error states, and readiness action.
- Dependencies:
  - `apps/web/components/page-state.tsx`
    - `apps/web/lib/i18n/index.ts`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
  - `apps/web/components/tool-page-shell.tsx`
    - `apps/web/lib/i18n/index.ts` (shared; already listed)
  - `apps/web/hooks/use-demo-query.ts`
    - `apps/web/lib/api-client.ts`
      - `apps/web/lib/types.ts`
    - `apps/web/lib/i18n/index.ts` (shared; already listed)
    - `apps/web/lib/types.ts` (shared; already listed)
  - `apps/web/lib/format.ts`
  - `apps/web/lib/i18n/index.ts` (shared; already listed)
  - `apps/web/lib/types.ts` (shared; already listed)

## `/compare` — Two-market comparison

- Entry: `apps/web/app/(demo)/compare/page.tsx`
- Layout chain: `RootLayout` -> `DemoLayout` -> `AppShell`
- Design focus: strong A/B identities, dimension leaders, radar profiles, recommendation path, methodology, and mobile-safe stacked comparisons.
- Dependencies:
  - `apps/web/components/page-state.tsx`
    - `apps/web/lib/i18n/index.ts`
      - `apps/web/lib/i18n/client.tsx`
        - `apps/web/lib/i18n/config.ts`
        - `apps/web/lib/i18n/dictionary.ts`
          - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/config.ts` (shared; already listed)
      - `apps/web/lib/i18n/dictionary.ts` (shared; already listed)
  - `apps/web/hooks/use-demo-query.ts`
    - `apps/web/lib/api-client.ts`
      - `apps/web/lib/types.ts`
    - `apps/web/lib/i18n/index.ts` (shared; already listed)
    - `apps/web/lib/types.ts` (shared; already listed)
  - `apps/web/lib/api-client.ts` (shared; already listed)
  - `apps/web/lib/i18n/index.ts` (shared; already listed)
  - `apps/web/lib/types.ts` (shared; already listed)
  - `apps/web/components/radar-visualization.tsx` (literal dynamic import; client-only)
    - `apps/web/lib/types.ts` (shared; already listed)
    - `apps/web/lib/i18n/index.ts` (shared; already listed)
