"""Offline API regression for the synthetic Zambia extension, never a real release.

The shared producer fixture creates its complete confirmation chain below pytest's
temporary directory. No repository raw data, approvals or published stores are read.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from collections.abc import Iterator
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, cast

import market_fixture
import pytest
import test_basic60_api as legacy
from fastapi import FastAPI
from fastapi.testclient import TestClient
from navigator_api.basic60_config import Basic60Settings
from navigator_api.basic60_importer import (
    Basic60ImportError,
    activate_basic60_release,
    database_counts,
    import_basic60_seed_file,
    load_seed_artifact,
    revoke_basic60_source,
    validate_basic60_release_counts,
)
from navigator_api.basic60_main import create_app
from navigator_api.basic60_models import (
    Basic60Base,
    Basic60Country,
    Basic60DataRecordVersion,
    Basic60MetricValue,
    Basic60Release,
)
from navigator_api.basic60_seed_contract import Basic60SeedArtifact
from navigator_api.basic61_seed_contract import (
    ADDED_SOURCE_REFS,
    EXPECTED_COUNTS,
    Basic61SeedArtifact,
)
from navigator_api.database import build_engine, build_session_factory
from navigator_api.market_storage import canonical_bytes
from navigator_data_readiness import country_extension_release as extension_release
from navigator_data_readiness.market_content import revoke_market_content
from sqlalchemy import func, select
from sqlalchemy.orm import Session

PARENT_ID = "BASIC60-PRIVATE-R1"
EXTENDED_ID = "BASIC61-PRIVATE-R1"
HEADERS = {"X-Private-Trial-Key": legacy.API_KEY}
EXPECTED_DATABASE_COUNTS = {
    "countries": 61,
    "available_metric_values": 2317,
    "pending_metric_values": 62,
    "unavailable_metric_values": 0,
}


@dataclass(frozen=True)
class SyntheticReleases:
    parent: Basic60Settings
    extended: Basic60Settings


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_json(path: Path, payload: Any) -> str:
    path.write_bytes(canonical_bytes(payload))
    return _sha256(path)


@pytest.fixture(scope="module")
def releases(tmp_path_factory: pytest.TempPathFactory) -> SyntheticReleases:
    spec = importlib.util.spec_from_file_location(
        "basic61_api_synthetic_release_fixture",
        Path(__file__).parents[1] / "data_readiness/test_country_extension_release.py",
    )
    assert spec is not None and spec.loader is not None
    fixture_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture_module)
    root = tmp_path_factory.mktemp("basic61-offline-api")
    inputs = fixture_module.synthetic_confirmed_inputs(root)
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(extension_release, "_now", lambda: "2026-08-29T12:00:00+08:00")
        report = extension_release.prepare_country_extension_release(**inputs)
    assert report["activated"] is False
    parent_path = inputs["repo_root"] / "runtime/basic60/basic60_seed.private_trial_ready.json"
    governance_dir = root / "synthetic-parent-governance"
    governance_dir.mkdir()
    parent = replace(
        legacy._settings(governance_dir, parent_path, _sha256(parent_path)),
        enforce_baseline_counts=True,
    )
    release_dir = inputs["output_dir"]
    authorization = release_dir / extension_release.AUTHORIZATION_NAME
    validation = release_dir / extension_release.VALIDATION_NAME
    attestation = release_dir / extension_release.ATTESTATION_NAME
    extended = replace(
        parent,
        seed_path=release_dir / extension_release.READY_SEED_NAME,
        release_authorization_path=authorization,
        release_authorization_sha256=_sha256(authorization),
        validation_report_path=validation,
        validation_report_sha256=_sha256(validation),
        runtime_attestation_path=attestation,
        runtime_attestation_sha256=_sha256(attestation),
        runtime_attestation_key=inputs["trust_key"],
    )
    return SyntheticReleases(parent, extended)


@pytest.fixture
def session(releases: SyntheticReleases) -> Iterator[Session]:
    engine = build_engine(releases.extended.database_url)
    Basic60Base.metadata.create_all(engine)
    try:
        with build_session_factory(engine)() as opened:
            yield opened
    finally:
        engine.dispose()


@pytest.fixture
def client(releases: SyntheticReleases) -> Iterator[TestClient]:
    with TestClient(create_app(releases.extended)) as opened:
        yield opened


def _countries(client: TestClient, *, limit: int = 100) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    cursor: str | None = None
    seen_cursors: set[str] = set()
    while True:
        params: dict[str, str | int] = {"limit": limit, "as_of": "2026-08-24"}
        if cursor is not None:
            params["cursor"] = cursor
        response = client.get("/api/v1/countries", headers=HEADERS, params=params)
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        body = response.json()
        assert body["meta"]["result_count"] == len(body["data"])
        rows.extend(body["data"])
        cursor = body["meta"]["next_cursor"]
        if cursor is None:
            return rows
        assert cursor not in seen_cursors
        seen_cursors.add(cursor)


def _detail(
    client: TestClient, code: str, locale: str = "zh-CN", *, as_of: str = "2026-08-24"
) -> dict[str, Any]:
    response = client.get(
        f"/api/v1/countries/{code}",
        headers=HEADERS,
        params={"locale": locale, "as_of": as_of, "expand": "identity,macro,energy"},
    )
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    legacy._assert_no_public_source_metadata(response.json())
    return cast(dict[str, Any], response.json()["data"])


def test_seed_dispatch_preserves_frozen_parent_contract(releases: SyntheticReleases) -> None:
    parent, parent_sha = load_seed_artifact(releases.parent.seed_path)
    extended, extended_sha = load_seed_artifact(releases.extended.seed_path)
    assert isinstance(parent, Basic60SeedArtifact)
    assert isinstance(extended, Basic61SeedArtifact)
    assert parent_sha == _sha256(releases.parent.seed_path)
    assert extended_sha == _sha256(releases.extended.seed_path)
    assert extended.release.counts.model_dump() == EXPECTED_COUNTS
    original = json.loads(releases.parent.seed_path.read_bytes())
    added = json.loads(releases.extended.seed_path.read_bytes())
    assert added["countries"][:60] == original["countries"]
    assert added["countries"][-1]["iso3"] == "ZMB"
    with pytest.raises(ValueError):
        Basic60SeedArtifact.model_validate(added)


@pytest.mark.parametrize(
    ("field", "value"),
    [("schema_version", "basic62.seed.v1"), ("release_id", "BASIC62-PRIVATE-R1")],
)
def test_unknown_extension_schema_and_release_rejected(
    releases: SyntheticReleases, tmp_path: Path, field: str, value: str
) -> None:
    payload = json.loads(releases.extended.seed_path.read_bytes())
    if field == "schema_version":
        payload[field] = value
    else:
        payload["release"][field] = value
    path = tmp_path / "unknown-extension.json"
    _write_json(path, payload)
    with pytest.raises(Basic60ImportError, match="seed artifact is invalid"):
        load_seed_artifact(path)


def test_new_import_is_idempotent_and_append_only(
    releases: SyntheticReleases, session: Session, tmp_path: Path
) -> None:
    settings = releases.extended
    assert import_basic60_seed_file(session, settings.seed_path, settings, activate=True) == (
        EXPECTED_DATABASE_COUNTS
    )
    first_versions = session.scalar(select(func.count()).select_from(Basic60DataRecordVersion))
    assert import_basic60_seed_file(session, settings.seed_path, settings, activate=True) == (
        EXPECTED_DATABASE_COUNTS
    )
    assert session.scalar(select(func.count()).select_from(Basic60DataRecordVersion)) == (
        first_versions
    )
    assert session.scalar(select(func.count()).select_from(Basic60Release)) == 1
    stored = session.get(Basic60Release, EXTENDED_ID)
    assert stored is not None and stored.is_active
    assert stored.artifact_schema_version == "basic61.seed.v1"
    payload = json.loads(settings.seed_path.read_bytes())
    payload["countries"][-1]["capitals"][0]["name"] = "Different synthetic capital"
    altered = tmp_path / "same-version-different-payload.json"
    _write_json(altered, payload)
    with pytest.raises(Basic60ImportError, match="different immutable seed artifact hash"):
        import_basic60_seed_file(session, altered, settings, activate=False)
    assert database_counts(session, EXTENDED_ID) == EXPECTED_DATABASE_COUNTS


def test_extension_counts_cannot_be_disabled(
    releases: SyntheticReleases, session: Session, tmp_path: Path
) -> None:
    settings = replace(releases.extended, enforce_baseline_counts=False)
    payload = json.loads(settings.seed_path.read_bytes())
    payload["release"]["counts"]["countries"] = 60
    altered = tmp_path / "wrong-declared-counts.json"
    _write_json(altered, payload)
    with pytest.raises(Basic60ImportError):
        import_basic60_seed_file(session, altered, settings, activate=True)
    assert session.scalar(select(func.count()).select_from(Basic60Release)) == 0
    import_basic60_seed_file(session, settings.seed_path, settings, activate=True)
    stored = session.get(Basic60Release, EXTENDED_ID)
    assert stored is not None
    stored.declared_counts = {**stored.declared_counts, "countries": 60}
    with pytest.raises(Basic60ImportError, match="Stored BASIC60 release counts"):
        validate_basic60_release_counts(session, stored, settings)
    session.rollback()
    stored = session.get(Basic60Release, EXTENDED_ID)
    assert stored is not None
    metric = session.scalar(select(Basic60MetricValue).limit(1))
    assert metric is not None
    session.delete(metric)
    session.flush()
    with pytest.raises(Basic60ImportError, match="Stored BASIC60 row counts"):
        validate_basic60_release_counts(session, stored, settings)


def test_old_59_countries_unchanged_and_both_versions_survive_rollback(
    releases: SyntheticReleases, tmp_path: Path
) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'versioned-synthetic.db'}"
    old_settings = replace(releases.parent, database_url=database_url)
    new_settings = replace(releases.extended, database_url=database_url)
    with TestClient(create_app(old_settings)) as old_client:
        previous_codes = [row["code"] for row in _countries(old_client)]
        assert len(previous_codes) == 59 and "CHN" not in previous_codes
        previous = {
            (code, locale): _detail(old_client, code, locale)
            for code in previous_codes
            for locale in ("zh-CN", "en")
        }
        assert old_client.get("/api/v1/countries/ZMB", headers=HEADERS).status_code == 404
    with TestClient(create_app(new_settings)) as new_client:
        assert {row["code"] for row in _countries(new_client)} == {*previous_codes, "ZMB"}
        for (code, locale), data in previous.items():
            assert _detail(new_client, code, locale) == data
        app = cast(FastAPI, new_client.app)
        with app.state.session_factory() as opened:
            old = opened.get(Basic60Release, PARENT_ID)
            new = opened.get(Basic60Release, EXTENDED_ID)
            assert old is not None and new is not None
            assert not old.is_active and new.is_active
            assert old.artifact_sha256 == _sha256(releases.parent.seed_path)
            assert database_counts(opened, PARENT_ID)["countries"] == 60
            assert database_counts(opened, EXTENDED_ID) == EXPECTED_DATABASE_COUNTS
            versions = list(
                opened.scalars(
                    select(Basic60DataRecordVersion.version_number)
                    .where(
                        Basic60DataRecordVersion.entity_type == "country",
                        Basic60DataRecordVersion.entity_key == "IDN",
                    )
                    .order_by(Basic60DataRecordVersion.version_number)
                )
            )
            assert versions == [1, 2]
            activate_basic60_release(opened, PARENT_ID, old_settings)
        # A process authorized for R61 must not silently read the newly active R60.
        assert new_client.get("/api/v1/countries", headers=HEADERS).status_code == 503
    with TestClient(create_app(old_settings)) as restored:
        assert [row["code"] for row in _countries(restored)] == previous_codes
        assert _detail(restored, "IDN") == previous[("IDN", "zh-CN")]
        assert restored.get("/api/v1/countries/ZMB", headers=HEADERS).status_code == 404
        with cast(FastAPI, restored.app).state.session_factory() as opened:
            assert opened.scalar(select(func.count()).select_from(Basic60Release)) == 2
            assert opened.scalar(select(func.count()).select_from(Basic60Country)) == 121
            assert opened.scalar(select(func.count()).select_from(Basic60MetricValue)) == 4719
            assert database_counts(opened, EXTENDED_ID) == EXPECTED_DATABASE_COUNTS


def test_list_filters_pagination_and_release_identity(client: TestClient) -> None:
    expected = sorted(
        [code.split(":")[0] for code in legacy.REVIEWED_COUNTRY_CODES if code != "CHN:CN"] + ["ZMB"]
    )
    for limit in (7, 50, 100):
        assert [row["code"] for row in _countries(client, limit=limit)] == expected
    for query in ("ZMB", "赞比亚", "Zambia"):
        response = client.get(
            "/api/v1/countries",
            params={"q": query, "region": "Southern Africa"},
            headers=HEADERS,
        )
        assert response.status_code == 200
        assert [row["code"] for row in response.json()["data"]] == ["ZMB"]
        assert response.json()["meta"]["release_id"] == EXTENDED_ID
        assert response.json()["meta"]["release_profile"] == "basic60_private"
        assert response.json()["meta"]["formal_gate_status"] == "pending"
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["country_count"] == 61
    assert health.json()["release_id"] == EXTENDED_ID
    assert health.json()["ai_enabled"] is False
    assert health.json()["external_calls_enabled"] is False


@pytest.mark.parametrize("locale", ["zh-CN", "en"])
def test_zmb_identity_values_periods_and_missing_semantics(client: TestClient, locale: str) -> None:
    data = _detail(client, "zmb", locale, as_of="2026-08-28")
    assert data["code"] == "ZMB" and data["iso2"] == "ZM"
    assert data["name_zh"] == "赞比亚合成测试"
    assert data["name_en"] == "Synthetic Zambia"
    assert data["region_code"] == "Southern Africa"
    assert [item["code"] for item in data["languages"]] == ["en"]
    assert [item["code"] for item in data["currencies"]] == ["ZMW"]
    assert data["timezones"] == [{"iana_code": "Africa/Lusaka", "primary": True}]
    assert data["admin_structures"][0]["unit_count"] == 10
    assert len(data["macro"]) == 30 and len(data["energy"]) == 7
    for code, expected in (
        ("gdp_growth_pct", -2.5),
        ("fdi_net_inflows_usd", -100),
        ("inflation_cpi_pct", 125),
    ):
        metrics = [item for item in data["macro"] if item["metric_code"] == code]
        assert [item["period"]["label"] for item in metrics] == [
            "2020",
            "2021",
            "2022",
            "2023",
            "2024",
        ]
        assert all(item["value"] == expected for item in metrics)
        assert all(item["value_status"] == "available" for item in metrics)
    energy = {item["metric_code"]: item for item in data["energy"]}
    assert energy["electricity_installed_capacity_mw"]["period"]["label"] == "2025"
    assert energy["electricity_generation_gwh"]["period"]["label"] == "2023"
    assert energy["renewable_share_capacity_pct"]["value"] == 50
    assert energy["renewable_share_generation_pct"]["value"] == 50
    demand = energy["electricity_demand_gwh"]
    assert demand["value_status"] == "pending" and demand.get("value") is None
    assert demand["null_reason"] and demand["period"]["label"] == "pending"
    # The pending observation is dated at extension creation, not a invented prior year.
    assert len(_detail(client, "ZMB", locale, as_of="2026-08-24")["energy"]) == 6
    exchange = next(
        item
        for item in _detail(client, "LKA", locale)["macro"]
        if item["metric_code"] == "official_exchange_rate_lcu_per_usd"
        and item["period"]["label"] == "2024"
    )
    assert exchange["value_status"] == "pending" and exchange.get("value") is None


def test_zmb_auth_invalid_country_and_retired_routes_fail_closed(client: TestClient) -> None:
    for path in (
        "/api/v1/countries",
        "/api/v1/countries/ZMB",
        "/api/v1/countries/ZMB/market-overview",
        "/api/v1/countries/ZMB/market-analysis",
        "/api/v1/countries/ZMB/market-report",
    ):
        for headers in ({}, {"X-Private-Trial-Key": "incorrect"}):
            response = client.get(path, headers=headers)
            assert response.status_code == 401
            assert response.headers["Cache-Control"] == "no-store"
    for code in ("CHN", "chn", "CN", "ZZZ", "ZMBX", "12N"):
        for suffix in ("", "/market-overview", "/market-analysis", "/market-report"):
            response = client.get(f"/api/v1/countries/{code}{suffix}", headers=HEADERS)
            assert response.status_code == 404
            assert response.json()["error"]["code"] == "COUNTRY_NOT_FOUND"
    for suffix in ("market-analysis", "market-report"):
        response = client.get(f"/api/v1/countries/ZMB/{suffix}", headers=HEADERS)
        assert response.status_code == 410
        assert response.json()["error"]["code"] == "MARKET_CONTENT_RETIRED"
        assert "data" not in response.json()
        assert response.headers["Cache-Control"] == "no-store"
    for path in ("country-comparisons", "countries/compare", "comparisons", "compare"):
        response = client.post(
            f"/api/v1/{path}", json={"country_codes": ["ZMB", "IDN"]}, headers=HEADERS
        )
        assert response.status_code in {404, 405}
    assert set(client.get("/openapi.json").json()["paths"]) == {
        "/health",
        "/api/v1/countries",
        "/api/v1/countries/{country_code}",
        "/api/v1/countries/{country_code}/market-overview",
    }
    response = client.get("/api/v1/countries/ZMB/market-overview", headers=HEADERS)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "MARKET_CONTENT_UNAVAILABLE"
    assert _detail(client, "ZMB")["energy"]


@pytest.mark.parametrize("release_name", ["parent", "extended"])
@pytest.mark.parametrize("tamper", ["mac", "claims", "trust_key", "report", "authorization"])
def test_both_release_governance_reject_tampering_with_rehashed_outer_files(
    releases: SyntheticReleases,
    session: Session,
    tmp_path: Path,
    release_name: str,
    tamper: str,
) -> None:
    settings: Basic60Settings = getattr(releases, release_name)
    if tamper == "trust_key":
        changed = replace(settings, runtime_attestation_key="f" * 64)
    else:
        field = {
            "mac": "runtime_attestation",
            "claims": "runtime_attestation",
            "report": "validation_report",
            "authorization": "release_authorization",
        }[tamper]
        original_path = cast(Path, getattr(settings, f"{field}_path"))
        payload = json.loads(original_path.read_bytes())
        if tamper == "mac":
            payload["mac_sha256"] = "0" * 64
        elif tamper == "claims":
            payload["claims"]["seed_artifact_sha256"] = "0" * 64
        elif tamper == "report":
            payload["machine_counts"]["country_count"] += 1
        else:
            payload["seed_artifact_sha256"] = "0" * 64
        path = tmp_path / f"synthetic-tampered-{field}.json"
        digest = _write_json(path, payload)
        # Rehashing the outer file must not defeat the signature or inner bindings.
        changed = replace(settings, **{f"{field}_path": path, f"{field}_sha256": digest})
    with pytest.raises(Basic60ImportError):
        import_basic60_seed_file(session, settings.seed_path, changed, activate=True)
    assert session.scalar(select(func.count()).select_from(Basic60Release)) == 0
    assert session.scalar(select(func.count()).select_from(Basic60Country)) == 0


@pytest.mark.parametrize("release_name", ["parent", "extended"])
def test_old_and_new_authorizations_are_not_interchangeable(
    releases: SyntheticReleases, session: Session, release_name: str
) -> None:
    target: Basic60Settings = getattr(releases, release_name)
    other = releases.extended if release_name == "parent" else releases.parent
    with pytest.raises(Basic60ImportError):
        import_basic60_seed_file(session, target.seed_path, other, activate=True)
    assert session.scalar(select(func.count()).select_from(Basic60Release)) == 0


def test_zmb_overview_reads_both_locales_and_withdrawal_preserves_country_charts(
    releases: SyntheticReleases, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    original_candidates = market_fixture.candidate_files

    def zmb_candidates(path: Path, codes: tuple[str, ...], revision: int) -> tuple[Path, Path]:
        candidate, profiles = original_candidates(path, codes, revision)
        profiles.write_text("iso3\nZMB\nCHN\n", encoding="utf-8")
        return candidate, profiles

    monkeypatch.setattr(market_fixture, "candidate_files", zmb_candidates)
    review = market_fixture.reviewed_fixture(tmp_path, monkeypatch, codes=("ZMB",))
    root = tmp_path / "synthetic-published-overview"
    review.publish(root)
    before = copy.deepcopy(review.candidate.payload()["countries"][0])
    settings = replace(releases.extended, market_content_root=root)
    with TestClient(create_app(settings)) as opened:
        for locale in ("zh-CN", "en"):
            response = opened.get(
                "/api/v1/countries/zmb/market-overview", params={"locale": locale}, headers=HEADERS
            )
            assert response.status_code == 200
            assert response.headers["Cache-Control"] == "no-store"
            assert response.json()["data"] == before["locales"][locale]
            assert response.json()["meta"] == {
                "country_code": "ZMB",
                "locale": locale,
                "as_of": before["as_of"],
                "content_version": before["content_version"],
            }
            legacy._assert_no_public_source_metadata(response.json())
        chart_data = _detail(opened, "ZMB")
        revoke_market_content(
            content_root=root,
            country_code="ZMB",
            actor="test-only",
            reason="Synthetic test withdrawal only",
            repo_root=review.repo_root,
        )
        response = opened.get("/api/v1/countries/ZMB/market-overview", headers=HEADERS)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "MARKET_CONTENT_UNAVAILABLE"
        assert _detail(opened, "ZMB") == chart_data


def test_zmb_source_withdrawal_does_not_remove_parent_countries(client: TestClient) -> None:
    app = cast(FastAPI, client.app)
    before = _detail(client, "IDN")
    with app.state.session_factory() as opened:
        result = revoke_basic60_source(opened, EXTENDED_ID, ADDED_SOURCE_REFS["country_identity"])
        assert result["changed"] is True
        assert database_counts(opened, EXTENDED_ID) == EXPECTED_DATABASE_COUNTS
    visible = _countries(client)
    assert len(visible) == 59 and all(row["code"] not in {"ZMB", "CHN"} for row in visible)
    for suffix in ("", "/market-overview"):
        response = client.get(f"/api/v1/countries/ZMB{suffix}", headers=HEADERS)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "COUNTRY_NOT_FOUND"
    assert _detail(client, "IDN") == before
