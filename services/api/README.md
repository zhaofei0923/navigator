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

## Local SQLite verification

```bash
uv run --project services/api --group dev pytest -c services/api/pyproject.toml tests/api
```

## Contract

- `GET /health` is unprotected for container health checks.
- `GET /api/v1/meta`
- `GET /api/v1/countries` (`API-COUNTRY-001`)
- `GET /api/v1/countries/{code}` (`API-COUNTRY-002`)
- `POST /api/v1/country-comparisons` (`API-COMPARE-001`, two to four unique codes)
- `GET /api/v1/policies`, `/risks`, `/opportunities`, `/tenders`, `/partners`
- `POST /api/v1/demo/reset`
