# Navigator Demo Route Map

## Routing model

- Frontend root: `apps/web`
- Framework: Next.js `16.3.2` with the App Router and React `19.2.8`
- Routing source of truth: the file tree under `apps/web/app`; there is no separate router configuration file.
- The `(demo)` folder is a route group, so it does not add a URL segment.
- `apps/web/app/layout.tsx` is the root layout for every page. It loads global CSS, resolves the request locale, supplies `LocaleProvider`, and marks page metadata as non-indexable.
- `apps/web/app/(demo)/layout.tsx` wraps every demo page in `AppShell`, forces dynamic rendering, and redirects requests without a valid demo session to `/login`.
- `apps/web/app/(demo)/loading.tsx` and `apps/web/app/(demo)/error.tsx` are the shared loading and error boundaries for the protected demo route group.
- `apps/web/app/login/page.tsx` uses only the root layout; an already-authenticated visitor is redirected to `/`.
- `apps/web/next.config.ts` adds security headers to all paths and defines no rewrites or redirects.

## Page routes

| URL path | Route component | Layouts | What it renders |
| --- | --- | --- | --- |
| `/` | `apps/web/app/(demo)/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Bilingual landing workbench with the hero, interactive WebGL market globe, selected-market summary, four expansion capabilities, workflow, and synthetic-demo boundary. |
| `/login` | `apps/web/app/login/page.tsx` | `RootLayout` | Compact bilingual shared-passphrase entry page; redirects valid sessions to `/`. |
| `/countries` | `apps/web/app/(demo)/countries/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Global market explorer with an interactive globe, selected-market readiness summary, country-detail action, and comparison entry. |
| `/countries/[code]` | `apps/web/app/(demo)/countries/[code]/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Dynamic synthetic market profile with facts, five-dimension scores, radar, opportunity timeline, reasons, risks, actions, and comparison link. |
| `/compare` | `apps/web/app/(demo)/compare/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Two-market selector and comparison workspace with dimension bars, radar profiles, recommendation, per-market reasons, and methodology. |
| `/tools` | `apps/web/app/(demo)/tools/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Four-step expansion-tool hub linking assistant, solar-storage concept, feasibility draft, and tender preparation. |
| `/tools/assistant` | `apps/web/app/(demo)/tools/assistant/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Controlled AI-assistant preview with market and question-type inputs plus structured actions, related synthetic records, and limitations. |
| `/tools/solar-storage` | `apps/web/app/(demo)/tools/solar-storage/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Controlled solar-storage concept form with market, scenario, capacity, and duration inputs plus configuration, assumptions, risks, and next steps. |
| `/tools/feasibility` | `apps/web/app/(demo)/tools/feasibility/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Structured feasibility-draft builder with market, project type, and selectable report sections plus questions and limitations. |
| `/tools/tenders` | `apps/web/app/(demo)/tools/tenders/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Synthetic tender search, filters, result cards, and an inline readiness-detail panel. |
| `/policies` | `apps/web/app/(demo)/policies/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Filterable policy intelligence table rendered by `IntelligenceListPage`. |
| `/risks` | `apps/web/app/(demo)/risks/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Filterable risk intelligence table rendered by `IntelligenceListPage`. |
| `/opportunities` | `apps/web/app/(demo)/opportunities/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Filterable project-and-opportunity table rendered by `IntelligenceListPage`. |
| `/partners` | `apps/web/app/(demo)/partners/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Filterable synthetic partner table rendered by `IntelligenceListPage`. |
| `/tenders` | `apps/web/app/(demo)/tenders/page.tsx` | `RootLayout` -> `DemoLayout` -> `AppShell` | Compatibility entry that immediately redirects to `/tools/tenders`. |

## Supported page query strings

- `/compare?countries=<ISO3>,<ISO3>` preselects up to two valid synthetic markets; missing or invalid values are filled from the available market list.
- `/opportunities?country=<ISO3>`, `/policies?country=<ISO3>`, `/risks?country=<ISO3>`, and `/partners?country=<ISO3>` initialize the shared list-page country filter.
- Tool pages are currently file routes with internal form state; the route tree itself does not define a nested tool layout.

## Route handlers

| URL path | Handler file | Methods | Purpose |
| --- | --- | --- | --- |
| `/api/session` | `apps/web/app/api/session/route.ts` | `POST`, `DELETE` | Creates or clears the private demo session cookie. No page layout applies. |
| `/api/health` | `apps/web/app/api/health/route.ts` | `GET` | Checks that the synthetic demo API is ready and returns no-store health status. No page layout applies. |
| `/api/demo/[...path]` | `apps/web/app/api/demo/[...path]/route.ts` | `GET`, `POST` | Session-protected, allowlisted proxy for approved synthetic-demo collections, country details, comparisons, globe markers, tool previews, and tender details. No page layout applies. |

The catch-all proxy accepts only the following route shapes from the web client:

- `GET /api/demo/{meta|countries|policies|risks|opportunities|tenders|partners}`
- `GET /api/demo/countries/<safe-code>`
- `GET /api/demo/demo/globe-markers`
- `GET /api/demo/demo/tools/tenders`
- `GET /api/demo/demo/tools/tenders/<safe-id>`
- `POST /api/demo/country-comparisons`
- `POST /api/demo/demo/country-comparisons`
- `POST /api/demo/demo/reset`
- `POST /api/demo/demo/tools/assistant/preview`
- `POST /api/demo/demo/tools/solar-storage/preview`
- `POST /api/demo/demo/tools/feasibility-report/preview`

## Non-route App Router files

- `apps/web/app/globals.css` supplies the global design system and route-level styling.
- `apps/web/app/icon.svg` is application metadata/static artwork, not a navigable page.
- No local `not-found.tsx`, nested page layout, parallel route, intercepted route, or middleware/proxy entry is present in the current working tree.
