# BASIC60 access-controlled private trial

This deployment is isolated from `navigator-demo` and
`navigator-private-preview`. It accepts the frozen `BASIC60-PRIVATE-R1` and
the separately confirmed Zambia extension `BASIC61-PRIVATE-R1`, keeps formal
D1-D4/P0 status pending, and contains no policy search, vector, RAG, or model
service. The original fixed-count contract is not relaxed to accept extensions.

## Fail-closed prerequisites

Do not start this Compose project until all of the following are true:

1. `PBD-BASIC60-PRIVATE-001` has an effective, named project-approver decision.
2. `navigator-data validate-basic60-private` returns `private_trial_ready`.
3. The final validation report has no open checks, contains the frozen V1
   counts, and binds the exact acceptance bundle SHA-256.
4. The finalized `basic60.seed.v1` artifact embeds that validation report
   SHA-256; the release authorization binds the report, seed, and release
   bundle SHA-256 values.
5. The CLI-created runtime machine attestation has a valid HMAC-SHA256 over the
   report, release bundle, seed, release authorization, release ID, and profile.
6. The decision, validation report, release authorization, runtime attestation,
   and seed hashes have been recomputed from the exact mounted files.

The API entrypoint strictly parses and cross-checks the PBD decision, final
validation report, release authorization, seed, and active database release
before it activates or exposes data. The API also verifies the runtime
attestation MAC with a protected trust key. Candidate, hand-written
self-consistent, or `not_ready` seeds fail startup. The recorded signature
SHA-256 values are content bindings to the
CLI-validated evidence package; without a public-key signature scheme they are
not independently cryptographic proof of signer identity.

`BASIC60_RUNTIME_ATTESTATION_KEY` is an independent machine-validation trust
root, not a human signing key or approval. Generate at least 32 random bytes,
keep it outside Git in the protected environment file, and use the same value
for final CLI validation and runtime verification. A key rotation requires a
new machine attestation and SHA-256; never print or copy the key into artifacts.
The checked-in environment example deliberately uses a value shorter than 32
bytes. Both the CLI and API reject that value, the former longer placeholder,
and other repository-known placeholder/example keys even when they meet the
length threshold.

## Topology

- Web binds only to `127.0.0.1:3200` by default.
- Both Compose networks are internal: Web, API, and PostgreSQL have no outbound
  Internet route. Only Web publishes the loopback-only host port; API and
  PostgreSQL have no host port.
- PostgreSQL uses a dedicated external volume.
- The finalized seed, runtime attestation, validation report, and governance
  files are bind-mounted read-only.
- `NAVIGATOR_RUNTIME_PROFILE=basic60_private` blocks the demo, policy, tool,
  search, and AI routes in this deployment.
- The V1 runtime has no external model calls or general Internet egress.
- Browser users authenticate through a Basic60-only application passphrase;
  the API key remains server-side. This is a bounded private-trial access
  control, not a production user directory.

### Approved existing-Demo entry

For the approved internal dataset, add `compose.approved-demo.yaml`. This mode
keeps the isolated Basic60 API, PostgreSQL database, credentials, and volume,
but publishes the Web service at the original Demo address
`http://127.0.0.1:3000`. It does not require an application passphrase or
session cookie: `/login` redirects to `/`, and `/api/session` fails closed.
The approved page tree has Home, Overseas Tools and Partners as its three
top-level areas. Country data and market overviews are Home drill-down content;
planned tools stay explicit and there is no market-comparison module or separate
top-level policy/risk page. It does not import real data into the synthetic Demo database or
enable search, model execution, or legacy `/api/demo/*` routes. Only the Web
edge network is non-internal so the loopback-published page is reachable; API
and PostgreSQL remain on the internal network with no host ports.

## Current local startup: 60 overseas countries

The confirmed local deployment now uses `BASIC61-PRIVATE-R1`: 61 archived
country records including China, with **60 overseas countries** available in the
approved Demo. Use the persistent deployment bundle at
`runtime/basic61/deployment-20260828-r1`, not the historical commands below:

```bash
sh runtime/basic61/deployment-20260828-r1/restart.sh --execute
```

Run this from the repository root in WSL. Without `--execute`, the script only
checks the selected deployment. The bundle preserves the verified environment
snapshots, Compose files, fixed image references and pre-switch database backup;
its directory is `0700` and its files are `0600`, outside Git. Do not print its
environment or resolved Compose files. If the bundle is absent, recover the
verified bundle rather than falling back to the old startup command.

The entry fixes the existing `navigator-basic60-private` project, database
container and volume. It replaces API and Web sequentially using `--no-build
--pull never`; an already stopped database is started by its existing container
ID, never recreated. It keeps the new ready package and full 60-country overview
store read-only, the loopback address `http://127.0.0.1:3000`, and anonymous entry.
The original `.env` and `.env.basic60-private.local` are not rewritten.

Restarting the already-created containers preserves the new release, but
running the old two-Compose `up` command reactivates the old 59-country release.
The new package also needs its own seed and attestation filenames; changing only
`NAVIGATOR_BASIC60_RUNTIME_DIR` is not sufficient. Do not use `scripts/demo-up.ps1`
for this deployment: it starts the separate synthetic Demo.

For an explicit rollback to the preserved 59-country release:

```bash
sh runtime/basic61/deployment-20260828-r1/rollback.sh --execute
```

Rollback restores the old API/Web images, environment and overview mount in the
same project. It does not run `pg_restore`, delete a volume, or remove the newer
database history. The protected database backup is retained for separate,
explicit disaster recovery. Future image, credential or content-root changes
require an updated deployment bundle, not edits to this frozen bundle.

## Historical initial BASIC60 startup (59 overseas countries)

The commands in this section document the original deployment. They are not the
current local restart/update entry and must not be used to restart the confirmed
Zambia extension.

Create the dedicated volume once:

```bash
docker volume create \
  --label navigator.data-scope=basic60_private \
  navigator-basic60-private_navigator_basic60_pgdata
```

Copy `env.private-trial.example` to a protected untracked environment file,
replace every placeholder, set remote deployments to
`NAVIGATOR_BASIC60_COOKIE_SECURE=true`, then run:

```bash
docker compose \
  --env-file /protected/path/basic60.env \
  -f deploy/basic60/compose.private-trial.yaml \
  up --build -d
```

Check `http://127.0.0.1:3200/api/health` and open
`http://127.0.0.1:3200/basic60`. For remote access, put an approved HTTPS and
network-allowlisting layer in front of the loopback Web port.

For the approved existing-Demo entry, stop the synthetic Demo without deleting
its volume, then start the Basic60 stack with both protected environment files:

```bash
docker compose --env-file .env -f compose.yaml down
docker compose \
  --env-file .env \
  --env-file .env.basic60-private.local \
  -f deploy/basic60/compose.private-trial.yaml \
  -f deploy/basic60/compose.approved-demo.yaml \
  up --build -d
```

Open `http://127.0.0.1:3000` directly. The approved existing-Demo entry does
not use the Demo passphrase or session cookie; `/login` redirects to `/` and
`/api/session` returns `404`. Keep the Web port loopback-only. Never add `-v`,
`--volumes`, or run `docker volume prune` during this switch. The synthetic
Demo volume stays offline and recoverable.

## Historical initial stop command

This is the original initial-deployment stop command, not the current release
rollback entry. Use the protected `rollback.sh` above for a version rollback.

```bash
docker compose \
  --env-file /protected/path/basic60.env \
  -f deploy/basic60/compose.private-trial.yaml \
  down
```

Do not delete the external PostgreSQL volume during a routine stop. A release
rollback imports and activates the previously authorized immutable seed; it
does not overwrite or delete release history.

## Single country market overview

### Confirmed Zambia extension (2026-08-28)

The user confirmed `outputs/zmb-20260828-r1/赞比亚新增国家集中审核_20260828.xlsx`
with “审核通过” on 2026-08-28. Its SHA-256 is
`4f6e221bf536588d5c4552f642a47951b19d741b8a14e1cea73d00302eeab6c9`.
That one decision covers the added country's basic data, source material and
bilingual overview; it is not a re-review of the existing 59 overseas countries.

Use the separate confirmed-extension commands documented in
[COUNTRY_EXTENSIONS.md](../../services/data-readiness/COUNTRY_EXTENSIONS.md)
to build and replay `runtime/basic61/zmb-20260828-r1`. This `basic61.seed.v1`
version preserves every parent country object, source and metric definition,
then adds Zambia. The archived seed contains 61 countries including China;
the existing China exclusion makes 60 overseas countries publicly selectable.
Never relabel the old seed or change its frozen 60/300/60/2279/61 counts.

The same Excel is imported for overview package `OVERVIEW-ZMB-20260828-R1`,
with `--profiles "raw material/global_sources/61_country_profiles.csv"`.
Its candidate SHA-256 is
`6a7ae095c920857f714355ce67ad7590864dbec5f4e850acabe56bfe064346ae`.
The actual confirmation is recorded under
`runtime/country-extensions/confirmations/COUNTRY-EXT-ZMB-20260828-R1.20260828.json`;
the existing overview publisher consumes the same decision via
`runtime/market-overview/confirmations/OVERVIEW-ZMB-20260828-R1.20260828.json`.
Both bind the identical Excel and retain date-only approval precision.

The complete new content store is
`runtime/market-overview/zmb-published-20260828-r1`, copied from the previous
store before appending Zambia. Its current manifest is
`0b0b3d6bc46a18d35aeb188028c6d57210818edfdcac3810c4cb8130092f0819`;
the previous 59 active content versions remain unchanged. Old source files,
workbooks, original ready package and content store are preserved.

Deploy the compatible Web and API together, using the new ready seed,
validation, authorization and machine-attestation hashes and the complete
60-country overview store. Reuse the protected machine key, database, API key,
session settings and the existing anonymous-entry authorization. These are
runtime artifact changes, not new user accounts or another approval workflow.
Both exact release IDs remain supported so rollback can reactivate the old
authorized seed without deleting database history.

Do not run old and new API instances against the same active-release database
as a parallel preview: activating one version changes the shared active pointer.
Take a database backup, validate the new files before switching, and replace the
existing Web/API services together. Restore the previous environment, image
references and content mount for rollback. Do not delete or recreate volumes.
The Tencent deployment keeps the same domain and loopback Web port; there is no
new site, new navigation or fixed country-count marketing copy.

The approved Demo reads only
`GET /api/v1/countries/{code}/market-overview?locale=zh-CN|en` for new authored
content. The response is
`{meta:{country_code,content_version,as_of,locale},data:{title,paragraphs,disclaimer}}`.
It uses the existing server-side API key and requires the base release, country
and its identity sources to remain visible. China and unsupported countries
remain unavailable. Missing, unconfirmed, legacy-only or revoked content returns
`404 MARKET_CONTENT_UNAVAILABLE`; corrupt published content returns
`503 MARKET_CONTENT_INVALID`, never old report text or a synthetic substitute.
Internal research, source URLs, review fields and evidence are not response fields.

The retired `market-analysis` and `market-report` endpoints return
`410 MARKET_CONTENT_RETIRED` after the existing authorization and country
visibility checks, and are excluded from OpenAPI. The old
`/countries/{code}/market-report` page and approved/private aliases redirect to
the same country's detail page at `#market-overview`, retaining language and
country context. They no longer load a separate report.

The detail page has one full-text article after the identity profile and before
the existing energy and macro charts. There are no summary cards, ratings, analysis
accordions or report links. Loading and retry are independent of the charts.
Browser print styling prints the article; it does not add an export service,
membership layer or AI capability.

Set `NAVIGATOR_MARKET_CONTENT_DIR` to a **separate protected host directory**.
Only the API receives this directory, read-only, at
`/opt/navigator-api/market-content`. It is never mounted into Web or a static
directory. The default is `runtime/market-content`; an empty directory is a valid
unpublished state. Keep authored material and candidates under
`runtime/market-overview/`, outside the published volume. The old
`runtime/market-research/` manuscripts/candidates and earlier review XLSX files
are archives only: do not import, automatically convert, publish or use them as
fallback for the new overview contract. Preserve them without modification.

API UID 10001 needs directory traversal and file-read permission; the writer
creates readable immutable files and API's mount is read-only. Restrict host
access to the authorized operator. Never expose research, candidates, workbooks
or the content directory through HTTP or put secrets in content files.

### Current stage: confirmed 59-country overview release (2026-08-28)

The user accepted the style, analytical depth and judgment of the original
IDN, VNM, SAU, ZAF and BRA samples, then requested a more senior renewable-energy
expert voice for those five and the other 54 countries. The five revised
manuscripts use R2; the new 54 use R1. Preserve the original five R1 manuscripts.
The combined batch was prepared under `runtime/market-overview/full-59-20260827-r1`
and assembled separately under `runtime/market-overview/review-59-20260827-r1`.
On 2026-08-28, kevin explicitly confirmed the final 59-country Excel with
“审核通过”. That actual batch confirmation, not the earlier style feedback or
base-seed approval, authorized publication. No additional per-country signature
or permission decision was introduced.

The approved existing Demo at `http://127.0.0.1:3000` now serves package
`OVERVIEW-59-20260827-R1` from the API-only, read-only content mount. All 59
countries have both languages active; the five revised samples are R2 and the
other 54 countries are R1. Their information cutoff remains **2026-08-27**;
the publication date is not a new factual-verification date.

Publication bindings:

- Reviewed workbook: `outputs/market-overview-59-20260827/Navigator_59国新能源市场概述_集中审核_20260827_R1.xlsx`.
- Workbook SHA-256: `0f9e8a30553e2cc93b9f939df6d315862d0982901b5edd5dd53b90d957a31988`.
- Imported candidate: `runtime/market-overview/review-import-59-20260828-r1`.
- Candidate SHA-256: `e076512048f268e0568976bc1f6c8ec84bdec977dd6876aaa2fe8f048471ae2d`.
- Actual confirmation: `runtime/market-overview/confirmations/OVERVIEW-59-20260827-R1.20260828.json`.
- Active manifest SHA-256: `bcc069794f116369d8a18b37d8ab756dd2bd9535e0344cca277e12f2363844e1`.

The reviewed workbook and authored history were not rewritten. This operation
did not rebuild or reset the database, change the Basic60 release, advance
formal D1-D4/P0, expose the internal API, or add a new site. Future content edits
still require a new immutable version and one actual workbook confirmation.

The assembler reads authored bilingual country JSON and private research records;
it never pads text, generates a report template, calls AI or falls back to old
briefs. Run preparation from the repository root using the existing environment:

```bash
.venv/bin/python scripts/market_research/assemble_content.py \
  --authored-dir runtime/market-overview/samples-20260827-r1 \
  --output runtime/market-overview/sample-bundle-20260827-r1 \
  --package-id OVERVIEW-SAMPLES-20260827-R1 \
  --countries IDN VNM SAU ZAF BRA
.venv/bin/navigator-data validate-market-content \
  --candidate-dir runtime/market-overview/sample-bundle-20260827-r1/candidate
```

The commands above document the historical sample package and cannot overwrite
its existing output. For the full batch, use the authored and output directories
above, package ID `OVERVIEW-59-20260827-R1`, and explicitly pass all 59 non-CHN
codes from the read-only country profile CSV to `--countries`.
The default `--expected-scope-count=59` validates the full outbound-country
scope, while `--countries` selects the actual authored input; it is not a request to
generate missing countries. A complete batch yields `authored_review_bundle_valid`;
a subset yields `authored_sample_bundle_valid`. Both remain unpublished.
The assembler refuses an existing output and requires
separate authored/output directories under `runtime/market-overview/`.
Use a new bundle ID, country version and output directory for revisions, never
delete history to rerun a package. See [research preparation and final workbook
instructions](../../scripts/market_research/README.md) for the compatible
overview Excel authoring and read-only verification commands.

### One editable Excel review, one explicit confirmation

The workflow does not change the base seed, database, original workbooks,
historical approvals, or actual formal release/gate status. Passing a validator,
rendering a workbook or importing edits neither publishes content nor constitutes
human review. The final full-country Excel is produced after sample feedback and
the remaining writing, not as a five-country release artifact in this iteration.

Each candidate directory contains `package.json` with only `schema_version`
(`navigator.market-candidate.v1`) and `package_id`, plus `countries/ISO3.json`.
Each new country file uses `navigator.market-overview.v1` and a
`OVERVIEW-ISO3-YYYYMMDD-Rn` version (positive revision, at most 80 characters).
It contains `country_code`, `content_version`, ISO `as_of`, and exactly
`zh-CN` and `en` locale objects, each with `title`, `paragraphs` and
`disclaimer`. Each language has 6–8 paragraphs with matching paragraph counts.
The Chinese paragraph body contains 1,500–2,000 non-whitespace Unicode code points;
punctuation and numbers count. Text remains nonblank literal text, and `as_of`
cannot be later than the real calendar date in the content version. Do not create
ratings, risk arrays, chapter IDs or extra public evidence fields.

Use the following commands for a **new final overview bundle or update**.
Replace `YYYYMMDD-rN` and protected example paths with the actual final package
and reviewed workbook; they are not the current sample bundle. The current
environment can use `.venv/bin/navigator-data` without installing `uv`.

```bash
.venv/bin/navigator-data validate-market-content \
  --candidate-dir runtime/market-overview/final-bundle-YYYYMMDD-rN/candidate
.venv/bin/navigator-data import-market-review \
  --candidate-dir runtime/market-overview/final-bundle-YYYYMMDD-rN/candidate \
  --workbook /protected/path/reviewed-market-overview.xlsx \
  --output-dir runtime/market-overview/review-import-YYYYMMDD-rN
```

The review workbook's `内容编辑` sheet starts with the exact columns
`country_code, content_version, locale, json_pointer, original_value, edited_value`.
The first five columns remain unchanged; edit literal text in the sixth. Additional
readable columns and private evidence sheets are ignored by the importer. Include
every original localized string leaf exactly once. Only
`/locales/{zh-CN|en}/title`, existing `paragraphs/N` and `disclaimer` values
are editable. There are no level, score, report-chapter or verification-date rows.

Formulas, deleted rows, duplicate pointers, changed originals and unauthorized
structural edits are rejected. Original text is preserved. To change paragraph
counts, country, version, `as_of` or other structure, create a new versioned
candidate and workbook; do not splice JSON pointers or change metadata by hand.
Both languages must still have matching paragraph counts, and the Chinese body
must retain the required length. Human reviewers check the actual facts, numeric
meaning, dates, scope and translation; machine shape checks are not legal advice,
translation certification or a separate permission decision.

`包信息` starts with `key,value` and retains `schema_version` =
`navigator.market-review.v1`, `package_id`, `candidate_sha256`, `country_count`
and actual ISO `created_at`. The original candidate hash is SHA-256 of UTF-8
canonical JSON `{schema_version,package_id,countries:[...]}`, with complete
country objects sorted by ISO3, sorted object keys, no ASCII escaping, compact
separators, no NaN, and no trailing newline. The importer reports the **edited**
candidate hash and the exact reviewed workbook bytes hash. It writes a new
candidate and receipt, never the input workbook or earlier candidates.
`market_review_rows()` exposes the exact row inventory to the workbook authoring
tool. Private facts, paragraph/source mappings, uncertainties and input hashes
remain in the bundle's `review-data.json` and `research-index.json`, not the API.

After the user actually confirms that exact final workbook, record their single
decision in a protected JSON file with exactly these keys:
`schema_version` = `navigator.market-confirmation.v1`, `package_id`,
`decision` = `approved`, `approved_by` = `kevin`, ISO `approved_at`,
`workbook_sha256` and the importer's final `candidate_sha256`.
This records the user's one confirmation, not another signature request or a
machine permission verdict. Do not prefill approval, reuse an old confirmation
or treat tests/sample feedback as authorization. Import may be used as a machine
precheck; publication still requires the actual confirmation bound to those bytes.

```bash
.venv/bin/navigator-data publish-market-content \
  --candidate-dir runtime/market-overview/review-import-YYYYMMDD-rN \
  --workbook /protected/path/reviewed-market-overview.xlsx \
  --confirmation /protected/path/actual-user-confirmation.json \
  --content-root runtime/market-content
```

The publication store retains hash-addressed objects, confirmed batch payloads,
workbook/confirmation copies, immutable release descriptors and state manifests.
A single atomic `current.json` swap activates the complete batch; readers never
see half a batch. Repeating the exact publication is idempotent. Content or review
changes require a new `OVERVIEW-ISO3-YYYYMMDD-Rn` version. Only one writer may
operate at a time; a `.publish.lock` makes concurrent operations fail. If a
process crashes, check that it has stopped before an authorized operator removes
that exact stale lock. Never delete history to fix a lock.

Review/import timestamps cannot precede workbook creation or lie in the future at
publication. Date-only confirmations retain day precision and do not invent a
signing time. The content cutoff and version date cannot follow its confirmation.
No automatic expiry or freshness claim is inferred; published `as_of` remains
visible and later factual changes require manual updates. Publishing an older
version over a newer active version is rejected; use explicit rollback when
restoring a previously active, non-revoked overview is intentional.

### Single-country updates, withdrawal and rollback

After the initial full-country confirmation, later manual updates may use a new
candidate containing only the affected country, a new content version and the same
single-workbook confirmation flow. Other countries retain their active versions.
Both languages of the country's single overview move together; no parallel
analysis/report publication is retained.

The following are operator actions for genuinely confirmed, published overview
versions, not automatic acceptance steps. This is the first overview publication:
there is no earlier published overview to roll back to. The original five R1
sample manuscripts are not valid rollback targets. For a later release, use an
actual previously published version, operator and reason:

```bash
.venv/bin/navigator-data revoke-market-content --content-root runtime/market-content \
  --country IDN --actor kevin --reason 'Content withdrawn for correction'
.venv/bin/navigator-data rollback-market-content --content-root runtime/market-content \
  --country IDN --content-version OVERVIEW-IDN-YYYYMMDD-R1 \
  --actor kevin --reason 'Restore the previously confirmed overview'
```

Rollback only activates an existing, previously active, confirmed, **non-revoked
overview** of the same country. Retired `MARKET-` analysis/report content is not
a valid overview rollback target. Withdrawal writes an immutable tombstone so an
older pointer cannot resurrect withdrawn text. Corrections to a withdrawn version
require a new reviewed version. No API/DB restart is needed for a successful
pointer change; refresh the page. Back up the complete independent content store,
including revocation tombstones, not only `current.json`. None of these actions
changes the Basic60 seed or formal gate status.

### Verification and current evidence

Unconfirmed manuscripts are limited to contract, content and component tests.
Developer fixtures must remain explicitly synthetic and outside the publication
store. When no overview has been confirmed, browser checks on the running Demo
cover only the neutral empty/retry states and the existing real-data charts.
Do not add a temporary fixture route, publish a sample, or use static QA prose as
evidence that a real overview has been published or browser-verified.

Before content confirmation, the frontend implementation passed lint,
TypeScript, 66 test files with 729 passing tests, and a production build using
the existing locked dependencies. Those historical checks did not authorize
content publication.

Publication verification executed on 2026-08-28:

- Read-only workbook verification passed, and the workbook hash matched the
  delivered review file. The import preserved all approved text and metadata.
- All 118 live overview responses (59 countries × two languages) exactly
  matched the approved batch, with `Cache-Control: no-store`. The original
  country-detail endpoint remained available.
- China, unknown and invalid country codes returned `404`; missing API
  authorization returned `401`. Retired analysis/report endpoints returned
  `410`, and the comparison POST route returned `404`. OpenAPI exposed only
  the new overview contract, not the retired content or comparison routes.
- The three existing Web/API/PostgreSQL containers were healthy. Only Web
  exposed loopback port 3000; the content directory was mounted read-only
  into API and was not mounted into Web. No database reset or rebuild ran.
- Populated Indonesian content was checked at 1280×720 and 390×844. Seven
  full paragraphs and all eight existing charts remained present, with no
  horizontal overflow or page-console warnings/errors. Chinese/English
  switching, mobile reading/scrolling, returning to the homepage with IDN
  selected, tools/partners context, and the old report redirect were exercised.
- The targeted API, overview-contract and content-store regression suites
  passed **215 tests**, with no failures or skips. Their update, withdrawal,
  rollback and error cases use isolated test stores, not the live content volume.

This was a content publication, not a new frontend build or formal production
acceptance. Browser print/PDF output was not revalidated in this publication
run. The browser harness blocked navigation to the China page; its access
restriction was verified through the actual API and automated tests instead.
