# Navigator internal demo API

This service is authorized only by `PBD-ACCEL-DEMO-001`. It is a private, bounded demo and
contains repository-owned `synthetic_demo` fixtures only. It does not call external sources,
models, or users. Every business response carries `演示数据 / 非正式结论`.

## Runtime

- Python 3.13
- FastAPI and SQLAlchemy 2
- PostgreSQL through `DATABASE_URL`
- Alembic migrations before startup
- `X-Demo-Key` on every `/api/v1/**` request

Environment variables:

- `DATABASE_URL` (required; no embedded database credentials)
- `DEMO_API_KEY` (required; no fallback key)
- `DEMO_CORS_ORIGINS` (comma-separated private frontend origins)

The container entrypoint applies migrations, seeds the five-country dataset only when empty,
and starts Uvicorn. `POST /api/v1/demo/reset` deterministically restores all fixtures.

## Separate BASIC60 private-trial runtime

`navigator-api-basic60-entrypoint` uses the independent `alembic-basic60.ini` migration chain,
`BASIC60_DATABASE_URL`, and `X-Private-Trial-Key`. It never registers demo, policy, search, or AI
routes. A non-candidate runtime also requires content-addressed paths for all three activation
artifacts:

- `BASIC60_DECISION_PATH` and `BASIC60_DECISION_SHA256`;
- `BASIC60_VALIDATION_REPORT_PATH` and `BASIC60_VALIDATION_REPORT_SHA256`;
- `BASIC60_RELEASE_AUTHORIZATION_PATH` and `BASIC60_RELEASE_AUTHORIZATION_SHA256`;
- `BASIC60_RUNTIME_ATTESTATION_PATH` and `BASIC60_RUNTIME_ATTESTATION_SHA256`;
- `BASIC60_RUNTIME_ATTESTATION_KEY` (at least 32 UTF-8 bytes, supplied only from
  a protected runtime environment; known placeholder/example values are
  rejected even when they are long enough).

The validation report must be the strict `private_trial_ready` CLI output with no checks, the
frozen V1 counts, and the exact release-bundle hash. The API cross-binds that file to the ready
seed, final authorization, and active database release. Signature hashes bind CLI-validated
evidence content; they do not provide independent public-key proof of signer identity.
For the simplified private-trial path, the release bundle contains exactly one human gate:
project approver `kevin` must approve the frozen Basic60 review workbook after inspecting it.
That approval is valid only when both the workbook SHA-256 and canonical data/source payload
SHA-256 match. Before it exists the only human blocker is
`B60_EXCEL_REVIEW_APPROVAL_PENDING`; after it passes the maximum status is
`private_trial_ready`, while formal D1-D4, P0, and production remain `pending`.
The runtime attestation is a separate HMAC-SHA256 machine-validation proof bound to the report,
release bundle, seed, authorization, release ID, and profile. It is never a human signature.
The ready seed carries one release-level `manual_usage_authorization` and its canonical SHA-256,
plus a machine-generated all-field scope/hash projection. Source rows contain audit metadata only
and carry no permission fields. These internal governance records are not exposed by the ordinary
country list or detail API; source details are visible only in the review workbook
and backend audit chain. Once the exact workbook is approved, all normalized fields may be used
for private display, internal AI, local models, and controlled external-model processing. V1 still
registers no AI, RAG, search, vector, embedding, reranker, or model route.

### Overseas target-market scope

Navigator serves Chinese enterprises expanding overseas. The read-only country list and detail
queries therefore exclude China (`CHN`) from target markets. This scope applies before search,
region filters, pagination, and date projections; requesting a China detail returns
`COUNTRY_NOT_FOUND` (HTTP 404), including lowercase codes.
The current approved release exposes 59 overseas markets while retaining the immutable 60-country
source package, imported records, audit history, and `BASIC60-PRIVATE-R1` release ID. The health
endpoint's `country_count` remains the stored release count (60), not the target-market count.
No source approval, source-revocation filter, activation count, or import gate is relaxed.

### Retired market comparison

Market comparison is no longer part of either current runtime. The former
`/api/v1/country-comparisons` and `/api/v1/demo/country-comparisons` endpoints are unregistered,
return HTTP 404, and do not appear in OpenAPI. Country list and detail GET contracts retain their
existing identifiers and semantics. New runtime evidence checks those two country interfaces
and verifies that the retired comparison URLs return 404; historical contracts, source packages,
review evidence, and signatures are not rewritten. Formal D1-D4 and P0 status remain unchanged.

### Single renewable energy market overview

The approved Basic60 runtime exposes one independent read-only content contract:
`GET /api/v1/countries/{code}/market-overview?locale=zh-CN|en`, under the same
`X-Private-Trial-Key` boundary. Its `{meta, data}` response has the country, content
version, information date and locale, plus a title, 6–8 natural paragraphs and a
short applicability note. It does not change the base-data `release_id`.

New candidates use `navigator.market-overview.v1` and
`OVERVIEW-{ISO3}-{YYYYMMDD}-R{n}` versions. Chinese body text must have 1500–2000
non-whitespace Unicode characters; title, date and note are excluded. Both locales
share the same paragraph count. The protected content volume retains immutable
objects, a current index and revocation history. Missing, retired or revoked text
is never replaced by old analysis/report content.

The former `/market-analysis` and `/market-report` API paths return HTTP 410 for
valid countries and are excluded from OpenAPI. China and invalid country paths
remain HTTP 404. Historical schema support exists for archival verification only.
The five-country manuscript phase does not authorize publication. See
`scripts/market_research/README.md` for the sample-first editorial workflow and
`deploy/basic60/README.md` for the eventual single-confirmation update procedure.

## Local SQLite verification

```bash
uv run --project services/api --group dev pytest -c services/api/pyproject.toml tests/api
```

## Contract

- `GET /health` is unprotected for container health checks.
- `GET /api/v1/meta`
- `GET /api/v1/countries` (`API-COUNTRY-001`)
- `GET /api/v1/countries/{code}` (`API-COUNTRY-002`)
- `GET /api/v1/policies`, `/risks`, `/opportunities`, `/tenders`, `/partners`
- `POST /api/v1/demo/reset`
