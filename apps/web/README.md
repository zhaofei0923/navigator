# Navigator internal demo web

This Next.js application is the private synthetic-data demo authorized by
`PBD-ACCEL-DEMO-001`. It never calls the FastAPI service directly from the
browser: `/api/demo/*` is a same-origin server proxy that adds `X-Demo-Key`.

Required server-only settings are documented in `.env.example`. The shared
passphrase creates an HTTP-only, same-site demo cookie; it is not an account or
an enterprise authorization system.

Run `npm ci`, `npm run dev`, `npm run typecheck`, `npm run lint`,
`npm run test`, and `npm run build` from this directory.

## BASIC60 private-trial runtime

Deploy BASIC60 as a separate web service with
`NAVIGATOR_RUNTIME_PROFILE=basic60_private` and the `BASIC60_*` settings from
`.env.example`. This profile fails closed: only `/basic60`, `/basic60/*`,
`/api/health`, and the bounded framework/globe assets are reachable; unprefixed
demo, policy, search, tool, and AI routes return 404. The private homepage,
country details, tools, and partners reuse the current product components under
the `/basic60` prefix. The BASIC60 session cookie is distinct and scoped to
`/basic60`, while the upstream API key remains server-only.

The V1 passphrase is a bounded app-level access control, not an enterprise user
directory. Remote use also requires HTTPS and an outer IP/VPN allowlist. Named
enterprise identities, SSO, and production authorization remain out of scope
until a separately approved baseline change.

## Approved Basic60 in the existing Demo

After the frozen Basic60 workbook and payload have been approved, use
`NAVIGATOR_RUNTIME_PROFILE=approved_basic60_demo` through
`deploy/basic60/compose.approved-demo.yaml`. This keeps the original Demo URL,
header, and public routes while serving approved Basic60 data directly at `/`
and `/countries/{code}`. This approved loopback-only mode
has no shared-passphrase login; `/login` redirects to `/` and `/api/session`
fails closed. Primary navigation has three destinations: Home, Overseas Tools,
and Partners. The homepage globe is the country-selection entry point; tools
contain the market advisor, project-planning, and tender workflows. Modules
without approved V1 data are explicit coming-soon pages:
they do not fabricate results or call legacy synthetic, model, or external APIs.
Search, model execution, and legacy `/api/demo/*` routes still fail closed. The
Basic60 API and PostgreSQL services remain on their isolated network and volumes;
the synthetic Demo database is not imported or modified.

Navigator is an overseas-market guide for Chinese new energy enterprises. China (`CHN` /
`CN`) is not an application target market: the reviewed source package retains
all 60 country records, while the current application scope contains 59 overseas
target markets. The original workbook, source records, and technical
`BASIC60-PRIVATE-R1` release identity are preserved. User-facing copy describes
overseas target markets instead of claiming a fixed 60-country application;
country-list counts come from the returned `result_count` metadata.

Selected country context is carried in the `country` query parameter between the
homepage, tools, and partners. Without a valid selection there is no implicit
default country. Country details return to `/?country={code}#markets`; private
routes use the same link with the `/basic60` prefix. Legacy `/countries` and
`/compare` routes redirect to the homepage map, `/policies` and `/risks` redirect
to `/tools`, and `/opportunities` and `/tenders` redirect to `/tools/tenders`.
Safe country context is preserved, while retired comparison parameters are
dropped. Approved-runtime `/basic60` aliases canonicalize to the same product
routes, and internal `/approved-basic60` paths cannot be accessed directly.
Both frontend API proxies reject country-comparison requests before fetching
the upstream service. The underlying historical data and backend contracts are
not removed by this frontend navigation change.
The synthetic runtime also retires `/compare` to the homepage map and removes
comparison actions from its country and intelligence pages. Historical
comparison algorithms can remain in the repository without a rendered route or
frontend API entry point; synthetic disclaimers and access isolation remain.

Product-facing presentation is separate from internal release metadata. The
approved data experience uses Navigator branding rather than review banners,
dataset-tier labels, or internal release IDs. This is a display-only change, not
a formal production release: D1–D4/P0 status, API metadata, runtime profiles,
permissions, and deployment boundaries are unchanged. The `synthetic_demo`
runtime keeps its persistent demo disclaimer and existing access controls.

The homepage region/country filters use seven broad navigation groups, in a
stable order: Asia, Middle East, Europe, Africa, North America, Latin America,
and Oceania. Asian and African subregions are merged into their parent group;
Central America and the Caribbean are included in Latin America. The reviewed
`Europe / West Asia` value (Türkiye) is included in Europe for navigation only.
The source `region_code`, APIs, and approved data remain unchanged. Country and
globe selections share the same state, so changing either updates the filters,
summary, and detail links. Groups without countries are hidden; an unrecognised
future source region appears under `Other` instead of dropping its countries.

## Single country market overview

Country details show one full-text article at `#market-overview`, after the
identity profile and before the existing energy and macroeconomic charts.
Its only server-side content request is
`GET /api/v1/countries/{code}/market-overview?locale=zh-CN|en`, using the existing
private API key, `no-store`, and a strict same-country/same-locale contract.
The article has a title, six to eight paragraphs, an as-of date, a concise
disclaimer, and browser printing. Chinese prose contains 1,500–2,000 non-whitespace
Unicode code points; English keeps the published paragraph structure. This
does not add an export API, AI processing, a membership layer, or a new page.

The former summary cards, difficulty matrix, analysis accordions and separate
report body are retired. Their clients and data types are not used as a fallback.
Only `OVERVIEW-{ISO3}-{YYYYMMDD}-R{n}` content is accepted. Missing, revoked,
invalid or unavailable content has one neutral retryable state, while the
country charts load independently. No sources, release tiers, review state,
scores or internal content versions are rendered in the article.

Legacy `/countries/{code}/market-report` and protected/approved aliases redirect
to that country's `#market-overview`; the existing locale cookie and private
prefix are retained. Excluded/malformed countries and upstream country 404s
remain 404. The browser print action prints the article, hiding navigation,
other country panels and action buttons through print CSS. Publication and
release status are unchanged; test fixtures remain developer-only synthetic
prose and are never loaded by runtime routes.
