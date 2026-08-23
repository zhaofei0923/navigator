# Extractable Superdesign Components

This catalog reflects the current dirty working tree. It lists only state, navigation URL,
visibility, and count values as eligible DraftComponent props. Business records, translated copy,
free-form text, and synthetic-demo payloads should be represented by a fixed safe snapshot when a
component is extracted; they are not proposed as DraftComponent props here.

## Layout Components

### AppShell
- Source: `apps/web/components/app-shell.tsx`
- Category: layout
- Description: Shared authenticated frame with the sticky primary navigation, language switcher, planning CTA, persistent demo boundary, content area, and footer.
- Extractable props: `activeItem` (active state, default: `"home"`; currently derived from `usePathname`), `menuOpen` (navigation state, default: `false`; currently internal), `homeHref` (URL, default: `"/"`), `toolsHref` (URL, default: `"/tools"`), `loginHref` (URL, default: `"/login"`), `showPrimaryAction` (visibility, default: `true`), `showDemoBoundary` (visibility, default: `true`), `showLogout` (visibility, default: `true`).
- Hardcoded: Navigator brand wordmark; `Compass`, `Menu`, `X`, `ArrowRight`, `LogOut`, and `ShieldAlert` Lucide icons; five navigation definitions and match rules; planning and logout behavior; bilingual labels from the repository dictionary; baseline date `2026-08-22`; all `.app-*`, `.main-nav`, `.header-*`, `.demo-warning`, `.button`, and `.icon-button` CSS classes; no image source.

### ToolPageShell
- Source: `apps/web/components/tool-page-shell.tsx`
- Category: layout
- Description: Shared heading, return navigation, controlled-input boundary, and content frame used by all four expansion tools.
- Extractable props: `backHref` (URL, default: `"/tools"`), `showBackLink` (visibility, default: `true`), `showBoundary` (visibility, default: `true`).
- Hardcoded: `ArrowLeft` and `ShieldAlert` Lucide icons; bilingual return and restricted-input boundary copy; `/tools` return URL in the current source; `.tool-page`, `.back-link`, `.tool-page-heading`, `.section-kicker`, and `.tool-boundary` CSS classes; no image source. The current `eyebrow`, `title`, `description`, and `children` inputs are content slots and intentionally are not DraftComponent props under this catalog.

### IntelligenceListPage
- Source: `apps/web/components/intelligence-list-page.tsx`
- Category: layout
- Description: Reused low-density list-page template for policy, risk, opportunity, tender, and partner routes, including heading, tabs, filters, state handling, and table.
- Extractable props: `activeKind` (active state, one of `policies`, `risks`, `opportunities`, `tenders`, `partners`), `activeCountry` (filter state, default: `"all"`), `activeCategory` (filter state, default: `"all"`), `compareHref` (URL, default: `"/compare"`), `showTabs` (visibility, default: kind-dependent), `showSearch` (visibility, default: `true`), `recordCount` (count, default: representative synthetic snapshot count).
- Hardcoded: `ArrowRight`, `Search`, and `TriangleAlert` Lucide icons; route-kind configuration, bilingual headings/descriptions/table headers, enum labels, list table markup, filter behavior, API-path construction, country-detail link pattern, status/tag treatments, and all `.page-heading`, `.section-tabs`, `.filter-*`, `.data-table`, and related CSS classes; no image source.

## Basic Components

### LanguageSwitcher
- Source: `apps/web/components/language-switcher.tsx`
- Category: basic
- Description: Compact bilingual toggle shared by the authenticated shell and login experience.
- Extractable props: `activeLocale` (active state, default: `"zh-CN"`; currently supplied by `LocaleProvider`), `isVisible` (visibility, default: `true`).
- Hardcoded: `中 / EN` labels, two-locale toggle behavior, translated accessible labels, `.button` and `.button-secondary` CSS classes; no icon or image source.

### CountryRail
- Source: `apps/web/components/country-rail.tsx`
- Category: basic
- Description: Keyboard-accessible market selector rendered as a row/rail of selected and unselected market buttons.
- Extractable props: `activeItem` (active state, current source name: `selectedCode`), `showActionIcons` (visibility, default: `true`), `visibleItemCount` (count, default: representative synthetic market count).
- Hardcoded: `Check` and `Plus` Lucide icons; bilingual group label; selected/unselected class rules; `.country-rail`, `.country-rail-item`, `.country-rail-item-selected`, and `.country-rail-action` CSS classes; market names/codes come from the safe snapshot; no image source.

### SectionTabs
- Source: `apps/web/components/section-tabs.tsx`
- Category: basic
- Description: Shared horizontal route-tab navigation with an `aria-current` active indicator.
- Extractable props: `activeItem` (active state; current source name: `active`), `tabHrefs` (navigation URLs), `visibleItemCount` (count, default: number of supplied tabs).
- Hardcoded: bilingual navigation aria label, Next.js `Link` rendering, and `.section-tabs` CSS; tab labels and destinations are supplied by the parent safe snapshot; no icon or image source.

### LoadingState
- Source: `apps/web/components/page-state.tsx`
- Category: basic
- Description: Shared polite loading state for pages and tool results.
- Extractable props: `isVisible` (visibility, default: `true`).
- Hardcoded: spinning `LoaderCircle` Lucide icon, bilingual default loading copy, `role="status"`, `.page-state` and `.spin` CSS classes; no image source.

### ErrorState
- Source: `apps/web/components/page-state.tsx`
- Category: basic
- Description: Shared alert state with an optional retry action.
- Extractable props: `isVisible` (visibility, default: `true`), `showRetry` (visibility, default: `true`).
- Hardcoded: `AlertTriangle` and `RefreshCw` Lucide icons, bilingual error/retry copy, `role="alert"`, `.page-state`, `.page-state-error`, `.button`, and `.button-secondary` CSS classes; retry is a local action rather than a navigation URL; no image source.

### EmptyState
- Source: `apps/web/components/page-state.tsx`
- Category: basic
- Description: Shared empty-result state used after successful queries with no matching records.
- Extractable props: `isVisible` (visibility, default: `true`).
- Hardcoded: `DatabaseZap` Lucide icon, bilingual default empty copy, `role="status"`, and `.page-state` CSS class; no image source.

### ResultList
- Source: `apps/web/components/tool-page-shell.tsx`
- Category: basic
- Description: Shared titled ordered/unordered result section used throughout the four expansion tools.
- Extractable props: `ordered` (presentation state, default: `false`), `isVisible` (visibility, default: `true`; current source hides when the item count is zero), `itemCount` (count, default: representative result count).
- Hardcoded: `ul`/`ol` markup switch, zero-count suppression, and `.tool-result-section` CSS class; heading and list content come from the safe synthetic snapshot; no icon or image source.

### ScoreStrip
- Source: `apps/web/components/score-strip.tsx`
- Category: basic
- Description: Five-cell institutional score summary shared by overview/detail surfaces, with an explicit risk dimension and trend text.
- Extractable props: `activeDimension` (active/emphasis state, default: none), `showTrends` (visibility, default: `true`), `visibleDimensionCount` (count, fixed default: `5`).
- Hardcoded: five score dimensions and bilingual labels; `BarChart3`, `ShieldCheck`, `Activity`, `Handshake`, and `TriangleAlert` Lucide icons; `/100` scale; risk/trend class rules; `.score-strip`, `.score-cell`, `.score-label*`, `.score-value*`, and `.score-trend*` CSS classes; no image source.

### DecisionPanel
- Source: `apps/web/components/decision-panel.tsx`
- Category: basic
- Description: Reusable three-section decision summary for entry reasons, key risks, and prioritized next actions.
- Extractable props: `showReasons` (visibility, default: `true`), `showRisks` (visibility, default: `true`), `showActions` (visibility, default: `true`), `reasonCount` (count, maximum shown: `3`), `riskCount` (count, maximum shown: `3`), `actionCount` (count, maximum shown: `4`).
- Hardcoded: `SlidersHorizontal`, `TriangleAlert`, and `CheckSquare2` Lucide icons; positive/danger section order and tones; bilingual headings/empty copy; list truncation limits; `.decision-panel`, `.panel`, and `.decision-section-*` CSS classes; no image source.

### SignalTimeline
- Source: `apps/web/components/signal-timeline.tsx`
- Category: basic
- Description: Reusable responsive data-table timeline for dated market signals with typed tags and destination actions.
- Extractable props: `showViewAction` (visibility, default: `true`), `visibleRowCount` (count, default: representative synthetic signal count), `destinationHrefs` (navigation URLs derived from signal categories).
- Hardcoded: `ArrowRight` Lucide icon; bilingual headers/empty copy; category-to-route and category-label maps; confidence percent format; `.table-scroll`, `.data-table`, `.timeline-*`, `.type-tag`, and `.table-action` CSS classes; no image source.

### RadarVisualization
- Source: `apps/web/components/radar-visualization.tsx`
- Category: basic
- Description: Shared five-axis score visualization for single-market detail and multi-market comparison.
- Extractable props: `compact` (display state, default: `false`), `seriesCount` (count, default: `1`), `showLegend` (visibility, default: `seriesCount > 1`).
- Hardcoded: five bilingual axis labels; `0–100` domain; palette `#079b98`, `#1768d4`, `#ef8d00`, `#7b61c9`; Recharts grid/axis/tooltip/legend configuration; `.radar-chart` and `.radar-chart-compact` CSS classes; no image source.

### Button
- Source: `apps/web/app/globals.css` (CSS-only primitive used by native `button` and Next.js `Link` instances)
- Category: basic
- Description: Shared 40px action treatment with primary, secondary, wide, and icon-button usages across the application.
- Extractable props: `isActive` (state, default: `false`), `isDisabled` (state, default: `false`), `href` (optional navigation URL), `showIcon` (visibility, default: instance-dependent).
- Hardcoded: `.button`, `.button-primary`, `.button-secondary`, `.button-wide`, and `.icon-button` CSS; 5px radius, typography, hover movement, focus ring, and palette; labels and Lucide icon names remain hardcoded per extracted instance; no image source.

### Panel
- Source: `apps/web/app/globals.css` (CSS-only primitive composed by multiple TSX components)
- Category: basic
- Description: Shared bordered white content surface and header treatment used for charts, timelines, lists, comparisons, and tool results.
- Extractable props: `isVisible` (visibility, default: `true`), `showHeaderAction` (visibility, default: instance-dependent), `itemCount` (count, optional where the panel presents a bounded list).
- Hardcoded: `.panel`, `.panel-header`, their border/background/radius/shadow rules, and panel-specific composition classes; titles, icons, and actions remain hardcoded in each extracted instance; no image source.

## Extraction Boundaries

- `CountryGlobe` (`apps/web/components/country-globe.tsx`) is intentionally not a DraftComponent candidate: the approved plan requires the real local WebGL implementation, geometry, accessible fallback, and interaction model to remain intact rather than being converted into a static design component.
- `LoginForm`, `CountryDetailView`, and route page components are single-purpose features, not shared primitives; keep them as page context instead of extracting them.
- No repository component uses an external image URL, external font, online map, or emoji icon. Lucide is the shared icon source, while the globe geometry is repository-local at `/data/world-countries-110m.geojson`.
