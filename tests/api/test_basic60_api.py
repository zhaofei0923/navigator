"""BASIC60 importer, governance guard, isolated routes, and migration tests."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from navigator_api.basic60_config import Basic60Settings
from navigator_api.basic60_governance import Basic60GovernanceError
from navigator_api.basic60_importer import (
    Basic60ImportError,
    activate_basic60_release,
    basic60_source_status_snapshot,
    import_basic60_seed_file,
    revoke_basic60_release,
    revoke_basic60_source,
    validate_basic60_manual_usage_authorization,
)
from navigator_api.basic60_main import create_app
from navigator_api.basic60_models import (
    Basic60Base,
    Basic60Country,
    Basic60DataRecordVersion,
    Basic60FieldProvenance,
    Basic60MetricValue,
    Basic60RawRecord,
    Basic60Release,
    Basic60SourceRegistry,
)
from navigator_api.database import build_engine, build_session_factory
from sqlalchemy import func, inspect, select

API_KEY = "basic60-test-key"
RUNTIME_ATTESTATION_KEY = secrets.token_hex(32)
HEX_A = "a" * 64
HEX_B = "b" * 64
HEX_C = "c" * 64
METRICS = (
    ("population_total", "identity", "COUNT"),
    ("land_area_sq_km", "identity", "KM2"),
    ("gdp_current_usd", "macro", "USD"),
    ("gdp_growth_pct", "macro", "PERCENT"),
    ("gdp_per_capita_current_usd", "macro", "USD_PER_PERSON"),
    ("inflation_cpi_pct", "macro", "PERCENT"),
    ("official_exchange_rate_lcu_per_usd", "macro", "LCU_PER_USD"),
    ("fdi_net_inflows_usd", "macro", "USD"),
    ("electricity_installed_capacity_mw", "energy", "MW"),
    ("electricity_generation_gwh", "energy", "GWH"),
    ("renewable_capacity_mw", "energy", "MW"),
    ("renewable_generation_gwh", "energy", "GWH"),
    ("renewable_share_capacity_pct", "energy", "PERCENT"),
    ("renewable_share_generation_pct", "energy", "PERCENT"),
    ("electricity_demand_gwh", "energy", "GWH"),
)
VALIDATION_COUNTS = {
    "country_count": 60,
    "macro_annual_record_count": 300,
    "energy_latest_record_count": 60,
    "available_observation_count": 2279,
    "pending_observation_count": 61,
}
# Frozen collection membership; all values in the API fixture remain synthetic.
REVIEWED_COUNTRY_CODES = [
    "ARE:AE",
    "ARG:AR",
    "AUS:AU",
    "BEL:BE",
    "BGD:BD",
    "BRA:BR",
    "CAN:CA",
    "CHL:CL",
    "CHN:CN",
    "COL:CO",
    "DEU:DE",
    "DNK:DK",
    "DOM:DO",
    "EGY:EG",
    "ESP:ES",
    "FIN:FI",
    "FRA:FR",
    "GBR:GB",
    "GHA:GH",
    "GRC:GR",
    "IDN:ID",
    "IND:IN",
    "IRL:IE",
    "ITA:IT",
    "JOR:JO",
    "JPN:JP",
    "KAZ:KZ",
    "KEN:KE",
    "KOR:KR",
    "LKA:LK",
    "MAR:MA",
    "MEX:MX",
    "MYS:MY",
    "NAM:NA",
    "NGA:NG",
    "NLD:NL",
    "NOR:NO",
    "NPL:NP",
    "NZL:NZ",
    "OMN:OM",
    "PAK:PK",
    "PAN:PA",
    "PER:PE",
    "PHL:PH",
    "POL:PL",
    "PRT:PT",
    "ROU:RO",
    "RWA:RW",
    "SAU:SA",
    "SGP:SG",
    "SWE:SE",
    "THA:TH",
    "TUR:TR",
    "TZA:TZ",
    "UGA:UG",
    "URY:UY",
    "USA:US",
    "UZB:UZ",
    "VNM:VN",
    "ZAF:ZA",
]


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()


def _write_json(path: Path, payload: dict[str, Any]) -> str:
    encoded = _json_bytes(payload)
    path.write_bytes(encoded)
    return hashlib.sha256(encoded).hexdigest()


def _assert_no_public_source_metadata(value: Any) -> None:
    forbidden = {
        "source_ref",
        "source_snapshot_ref",
        "raw_record_ref",
        "provenance",
        "terms_uri",
        "evidence_sha256",
        "manual_usage_authorization",
        "ai_usage_policy",
        "single_excel_review",
        "canonical_payload_sha256",
        "signature_sha256",
        "signoffs",
        "review_scope",
        "workbook",
    }
    if isinstance(value, dict):
        assert forbidden.isdisjoint(value)
        for item in value.values():
            _assert_no_public_source_metadata(item)
    elif isinstance(value, list):
        for item in value:
            _assert_no_public_source_metadata(item)


def _validation_report_payload() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "profile_id": "basic60_private",
        "release_id": "BASIC60-PRIVATE-R1",
        "status": "private_trial_ready",
        "ready": True,
        "formal_gate_status": "pending",
        "does_not_complete_formal_d1_d4": True,
        "does_not_authorize_p0_or_production": True,
        "release_bundle_sha256": HEX_B,
        "machine_counts": dict(VALIDATION_COUNTS),
        "checks": [],
    }


def _validation_report_digest() -> str:
    return hashlib.sha256(_json_bytes(_validation_report_payload())).hexdigest()


def _source(source_ref: str, domain: str, role: str) -> dict[str, Any]:
    return {
        "source_ref": source_ref,
        "provider": f"Provider {source_ref}",
        "dataset": f"Dataset {source_ref}",
        "data_domain": domain,
        "source_role": role,
        "status": "active",
        "terms_uri": "https://example.test/terms",
        "evidence_sha256": HEX_A,
        "access_method": "test_fixture",
        "rate_limit": None,
        "snapshots": [
            {
                "snapshot_ref": f"SNAP-{source_ref}",
                "captured_at": "2026-08-24T08:00:00+08:00",
                "content_sha256": HEX_B,
                "retrieval_uri": "https://example.test/snapshot",
                "media_type": "application/json",
            }
        ],
    }


def _trace(source_ref: str, record_ref: str) -> dict[str, str]:
    return {
        "source_ref": source_ref,
        "source_snapshot_ref": f"SNAP-{source_ref}",
        "raw_record_ref": record_ref,
    }


def _metric(
    metric_code: str,
    value: str | None,
    unit: str,
    period: str,
    source_ref: str,
    record_ref: str,
) -> dict[str, Any]:
    available = value is not None
    year = int(period)
    return {
        "metric_code": metric_code,
        "period_start": f"{year}-01-01",
        "period_end": f"{year}-12-31",
        "period_label": period,
        "original_value": value,
        "original_unit": unit,
        "normalized_value": value,
        "normalized_unit": unit,
        "value_status": "available" if available else "pending",
        "null_reason": None if available else "no_reliable_uniform_public_value",
        "quality_status": "reviewed" if available else "pending",
        "freshness_status": "current" if available else "pending",
        "reviewed_at": "2026-08-24T09:00:00+08:00" if available else None,
        **_trace(source_ref, record_ref),
    }


def _country(code: str, iso2: str, name_zh: str, name_en: str) -> dict[str, Any]:
    identity_record = f"RAW-{code}-IDENTITY"
    macro_record = f"RAW-{code}-MACRO"
    energy_record = f"RAW-{code}-ENERGY"
    identity_trace = _trace("SRC-ID-PRIMARY", identity_record)
    capitals = [{"name": "Capital", "role": "official", "display_order": 1, **identity_trace}]
    if code == "ZAF":
        capitals = [
            {
                "name": name,
                "role": role,
                "display_order": index,
                **identity_trace,
            }
            for index, (name, role) in enumerate(
                (
                    ("Pretoria", "administrative"),
                    ("Cape Town", "legislative"),
                    ("Bloemfontein", "judicial"),
                ),
                start=1,
            )
        ]
    return {
        "iso3": code,
        "iso2": iso2,
        "region_code": "TEST_REGION",
        "coverage_status": "covered",
        "coverage_level": "Basic",
        "opportunity_level": "pending",
        "policy_friendliness_level": "pending",
        "risk_assessment_status": "unknown",
        "risk_level": None,
        "last_reviewed_at": "2026-08-24T09:00:00+08:00",
        "localized_texts": [
            {
                "field_code": "short_name",
                "locale": "zh-CN",
                "text": name_zh,
                "preferred": True,
                "translation_status": "reviewed",
                "source_text_sha256": HEX_A,
                **identity_trace,
            },
            {
                "field_code": "short_name",
                "locale": "en",
                "text": name_en,
                "preferred": True,
                "translation_status": "reviewed",
                "source_text_sha256": HEX_B,
                **identity_trace,
            },
            {
                "field_code": "local_name",
                "locale": "und",
                "text": name_en,
                "preferred": True,
                "translation_status": "source",
                "source_text_sha256": HEX_C,
                **identity_trace,
            },
        ],
        "capitals": capitals,
        "languages": [
            {
                "code": "en",
                "name_en": "English",
                "name_local": "English",
                "status": "official",
                **identity_trace,
            }
        ],
        "currencies": [
            {
                "code": "USD",
                "name_en": "Test Dollar",
                "legal_tender": True,
                **identity_trace,
            }
        ],
        "timezones": [{"iana_code": "Etc/UTC", "primary": True, **identity_trace}],
        "admin_structures": [
            {
                "admin_level": 1,
                "unit_type": "province",
                "unit_count": 10,
                "as_of_year": 2025,
                "status": "reviewed",
                **identity_trace,
            }
        ],
        "metrics": [
            _metric(
                "population_total", "1000000", "COUNT", "2025", "SRC-ID-PRIMARY", identity_record
            ),
            _metric("gdp_current_usd", "5000000", "USD", "2024", "SRC-MACRO-PRIMARY", macro_record),
            _metric(
                "renewable_capacity_mw", "250", "MW", "2025", "SRC-ENERGY-PRIMARY", energy_record
            ),
            _metric(
                "electricity_demand_gwh", None, "GWH", "2025", "SRC-ENERGY-PRIMARY", energy_record
            ),
        ],
    }


def _seed_payload(
    status: str = "private_trial_ready",
    *,
    countries: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    sources = [
        _source("SRC-ID-PRIMARY", "country_identity", "primary"),
        _source("SRC-MACRO-PRIMARY", "macro", "primary"),
        _source("SRC-ENERGY-PRIMARY", "energy", "primary"),
    ]
    if countries is None:
        countries = [
            _country("IDN", "ID", "印度尼西亚", "Indonesia"),
            _country("ZAF", "ZA", "南非", "South Africa"),
        ]
    raw_records = []
    for country in countries:
        code = country["iso3"]
        for suffix, source_ref in (
            ("IDENTITY", "SRC-ID-PRIMARY"),
            ("MACRO", "SRC-MACRO-PRIMARY"),
            ("ENERGY", "SRC-ENERGY-PRIMARY"),
        ):
            raw_records.append(
                {
                    "record_ref": f"RAW-{code}-{suffix}",
                    "source_ref": source_ref,
                    "source_snapshot_ref": f"SNAP-{source_ref}",
                    "country_code": code,
                    "object_key": f"sha256/{code.lower()}-{suffix.lower()}.json",
                    "payload_sha256": HEX_C,
                    "media_type": "application/json",
                }
            )
    return {
        "schema_version": "basic60.seed.v1",
        "release": {
            "release_id": "BASIC60-PRIVATE-R1",
            "release_profile": "basic60_private",
            "formal_gate_status": "pending",
            "status": status,
            "as_of": "2026-08-24",
            "source_cutoff": "2026-08-24",
            "release_bundle_sha256": HEX_B,
            "validation_report_sha256": _validation_report_digest(),
            "counts": {
                "countries": len(countries),
                "macro_rows": len(countries),
                "energy_rows": len(countries),
                "available_metric_values": 3 * len(countries),
                "pending_metric_values": len(countries),
            },
        },
        "manual_usage_authorization": {
            "permission_basis": "PBD-BASIC60-PRIVATE-001-A1",
            "permission_authority": "project_owner_manual_decision",
            "field_scope": {
                "mode": "all_normalized_basic60_fields",
                "field_count": 42,
                "fields_sha256": HEX_C,
            },
            "allowed_uses": [
                "internal_learning_and_exchange",
                "private_display",
                "internal_ai_processing",
                "local_model_processing",
                "controlled_external_model_processing",
            ],
            "prohibited_uses": ["public_release", "model_training"],
            "v1_runtime_capabilities": {
                "ai_routes_enabled": False,
                "external_model_calls_enabled": False,
                "local_model_service_enabled": False,
                "vector_database_enabled": False,
                "embedding_enabled": False,
                "reranking_enabled": False,
                "full_text_search_enabled": False,
            },
        },
        "ai_usage_policy": {
            "projection_type": "machine_generated_all_field_scope_projection",
            "permission_basis": "PBD-BASIC60-PRIVATE-001-A1",
            "policy_reference": {
                "path": "data/basic60/candidates/basic60_ai_usage_policy.json",
                "sha256": HEX_B,
            },
            "seed_sha256": HEX_A,
            "field_count": 42,
            "fields_sha256": HEX_C,
        },
        "sources": sources,
        "raw_records": raw_records,
        "metric_definitions": [
            {
                "metric_code": code,
                "label_zh": code,
                "label_en": code,
                "data_domain": domain,
                "canonical_unit": unit,
                "period_type": "year",
                "display_precision": 2,
                "normalization_rule": "identity",
            }
            for code, domain, unit in METRICS
        ],
        "countries": countries,
    }


def _signature(person_id: str, role: str) -> dict[str, str]:
    return {
        "person_id": person_id,
        "role": role,
        "signed_at": "2026-08-24T10:00:00+08:00",
        "signature_sha256": HEX_A,
    }


def _governance_files(tmp_path: Path, seed_sha256: str) -> tuple[Path, str, Path, str, Path, str]:
    decision_path = tmp_path / "decision.json"
    decision_sha = _write_json(
        decision_path,
        {
            "decision_id": "PBD-BASIC60-PRIVATE-001",
            "status": "approved_and_effective",
            "effective_from": "2026-08-24T10:00:00+08:00",
            "scope": {
                "release_profile": "basic60_private",
                "private_trial_only": True,
                "real_data_enabled": True,
                "policies_enabled": False,
                "ai_enabled": False,
                "external_model_calls_enabled": False,
            },
            "approval": {
                "person_id": "kevin",
                "role": "project_approver",
                "signed_at": "2026-08-24T10:00:00+08:00",
                "signature_sha256": HEX_A,
            },
        },
    )
    validation_report_path = tmp_path / "basic60_private_validation.json"
    validation_report_sha = _write_json(
        validation_report_path,
        _validation_report_payload(),
    )
    authorization_path = tmp_path / "release-authorization.json"
    authorization_sha = _write_json(
        authorization_path,
        {
            "schema_version": "basic60.release-authorization.v1",
            "release_id": "BASIC60-PRIVATE-R1",
            "release_profile": "basic60_private",
            "status": "private_trial_ready",
            "formal_gate_status": "pending",
            "release_bundle_sha256": HEX_B,
            "validation_report_sha256": validation_report_sha,
            "seed_artifact_sha256": seed_sha256,
            "approved_at": "2026-08-24T10:00:00+08:00",
            "pbd_decision_id": "PBD-BASIC60-PRIVATE-001",
            "signoffs": {
                "single_excel_review": {
                    "status": "approved",
                    "review_scope": "all_basic60_data_and_sources",
                    "workbook": {
                        "path": "outputs/basic60/BASIC60-PRIVATE-R1_review.xlsx",
                        "sha256": HEX_A,
                    },
                    "canonical_payload_sha256": HEX_C,
                    "signature": _signature("kevin", "project_approver"),
                },
            },
            "does_not_complete_formal_d1_d4": True,
            "does_not_authorize_p0_or_production": True,
        },
    )
    return (
        decision_path,
        decision_sha,
        authorization_path,
        authorization_sha,
        validation_report_path,
        validation_report_sha,
    )


def _runtime_attestation(
    tmp_path: Path,
    *,
    seed_sha256: str,
    authorization_sha256: str,
    validation_report_sha256: str,
) -> tuple[Path, str]:
    claims = {
        "release_id": "BASIC60-PRIVATE-R1",
        "release_profile": "basic60_private",
        "validation_report_sha256": validation_report_sha256,
        "release_bundle_sha256": HEX_B,
        "seed_artifact_sha256": seed_sha256,
        "release_authorization_sha256": authorization_sha256,
    }
    message = json.dumps(claims, sort_keys=True, separators=(",", ":")).encode()
    payload = {
        "schema_version": "basic60.runtime-attestation.v1",
        "artifact_kind": "machine_validation_attestation",
        "algorithm": "HMAC-SHA256",
        "claims": claims,
        "mac_sha256": hmac.new(
            RUNTIME_ATTESTATION_KEY.encode(), message, hashlib.sha256
        ).hexdigest(),
    }
    path = tmp_path / "basic60-runtime-attestation.json"
    return path, _write_json(path, payload)


def _settings(tmp_path: Path, seed_path: Path, seed_sha: str) -> Basic60Settings:
    (
        decision_path,
        decision_sha,
        authorization_path,
        authorization_sha,
        validation_report_path,
        validation_report_sha,
    ) = _governance_files(tmp_path, seed_sha)
    runtime_attestation_path, runtime_attestation_sha = _runtime_attestation(
        tmp_path,
        seed_sha256=seed_sha,
        authorization_sha256=authorization_sha,
        validation_report_sha256=validation_report_sha,
    )
    return Basic60Settings(
        database_url="sqlite+pysqlite:///:memory:",
        api_key=API_KEY,
        cors_origins=("http://localhost:3000",),
        seed_path=seed_path,
        decision_path=decision_path,
        decision_sha256=decision_sha,
        release_authorization_path=authorization_path,
        release_authorization_sha256=authorization_sha,
        validation_report_path=validation_report_path,
        validation_report_sha256=validation_report_sha,
        runtime_attestation_path=runtime_attestation_path,
        runtime_attestation_sha256=runtime_attestation_sha,
        runtime_attestation_key=RUNTIME_ATTESTATION_KEY,
        auto_create_schema=True,
        auto_import_seed=True,
        enforce_baseline_counts=False,
    )


@pytest.fixture
def basic60_client(tmp_path: Path) -> Iterator[TestClient]:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    app = create_app(_settings(tmp_path, seed_path, seed_sha))
    with TestClient(app) as client:
        yield client


@pytest.fixture
def outbound_basic60_client(tmp_path: Path) -> Iterator[TestClient]:
    countries = []
    for entry in REVIEWED_COUNTRY_CODES:
        code, iso2 = entry.split(":")
        country = _country(
            code,
            iso2,
            "中国" if code == "CHN" else f"测试国家 {code}",
            "China" if code == "CHN" else f"Test country {code}",
        )
        if code in {"CHN", "JPN", "KOR"}:
            country["region_code"] = "East Asia"
        countries.append(country)
    seed_path = tmp_path / "basic60_outbound_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload(countries=countries))
    app = create_app(_settings(tmp_path, seed_path, seed_sha))
    with TestClient(app) as client:
        yield client


def test_outbound_market_pagination_keeps_all_59_targets_and_60_stored_countries(
    outbound_basic60_client: TestClient,
) -> None:
    headers = {"X-Private-Trial-Key": API_KEY}
    expected = sorted(
        entry.split(":")[0] for entry in REVIEWED_COUNTRY_CODES if not entry.startswith("CHN:")
    )
    assert len(expected) == len(set(expected)) == 59
    for limit in (1, 7, 50, 100):
        seen: list[str] = []
        cursor: str | None = None
        while True:
            params: dict[str, str | int] = {"limit": limit, "as_of": "2024-12-31"}
            if cursor is not None:
                params["cursor"] = cursor
            response = outbound_basic60_client.get(
                "/api/v1/countries", headers=headers, params=params
            )
            assert response.status_code == 200
            payload = response.json()
            codes = [country["code"] for country in payload["data"]]
            assert "CHN" not in codes
            assert set(codes).isdisjoint(seen)
            assert payload["meta"]["result_count"] == len(codes)
            assert payload["meta"]["release_id"] == "BASIC60-PRIVATE-R1"
            assert payload["meta"]["as_of"] == "2024-12-31"
            seen.extend(codes)
            cursor = payload["meta"]["next_cursor"]
            if cursor is None:
                break
            assert cursor == codes[-1]
            assert len(seen) < len(expected)
        assert seen == expected

    app = cast(FastAPI, outbound_basic60_client.app)
    with app.state.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Basic60Country)) == 60
        china = session.scalar(select(Basic60Country).where(Basic60Country.iso3 == "CHN"))
        assert china is not None
        assert len(china.metric_values) == 4
        assert (
            session.scalar(
                select(func.count())
                .select_from(Basic60RawRecord)
                .where(Basic60RawRecord.country_code == "CHN")
            )
            == 3
        )
        release = session.get(Basic60Release, "BASIC60-PRIVATE-R1")
        assert release is not None
        assert release.declared_counts["countries"] == 60
    health = outbound_basic60_client.get("/health")
    assert health.status_code == 200
    assert health.json()["country_count"] == 60


@pytest.mark.parametrize("query", ("CHN", "chn", "CN", "中国", "China"))
def test_outbound_market_search_cannot_restore_china(
    outbound_basic60_client: TestClient,
    query: str,
) -> None:
    response = outbound_basic60_client.get(
        "/api/v1/countries",
        headers={"X-Private-Trial-Key": API_KEY},
        params={"q": query, "limit": 1},
    )
    assert response.status_code == 200
    assert response.json()["data"] == []
    assert response.json()["meta"]["result_count"] == 0
    assert response.json()["meta"]["next_cursor"] is None


def test_outbound_market_region_cursor_and_as_of_cannot_restore_china(
    outbound_basic60_client: TestClient,
) -> None:
    headers = {"X-Private-Trial-Key": API_KEY}
    for cursor in ("CAN", "chn"):
        response = outbound_basic60_client.get(
            "/api/v1/countries",
            headers=headers,
            params={
                "region": "East Asia",
                "cursor": cursor,
                "as_of": "2020-12-31",
                "coverage_level": "Basic",
                "locale": "en",
            },
        )
        assert response.status_code == 200
        assert [country["code"] for country in response.json()["data"]] == ["JPN", "KOR"]
        assert all(country["latest_metrics"] == [] for country in response.json()["data"])
    china = outbound_basic60_client.get(
        "/api/v1/countries",
        headers=headers,
        params={"q": "中国", "region": "East Asia", "as_of": "2020-12-31", "cursor": "CAN"},
    )
    assert china.status_code == 200
    assert china.json()["data"] == []
    chile = outbound_basic60_client.get("/api/v1/countries", headers=headers, params={"q": "CH"})
    assert chile.status_code == 200
    assert [country["code"] for country in chile.json()["data"]] == ["CHL"]


@pytest.mark.parametrize("country_code", ("CHN", "chn", "ChN"))
def test_outbound_market_china_detail_is_not_found(
    outbound_basic60_client: TestClient,
    country_code: str,
) -> None:
    response = outbound_basic60_client.get(
        f"/api/v1/countries/{country_code}",
        headers={"X-Private-Trial-Key": API_KEY},
        params={"as_of": "2024-12-31", "expand": "identity,macro,energy"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "COUNTRY_NOT_FOUND"
    assert response.json()["meta"]["release_id"] == "BASIC60-PRIVATE-R1"


@pytest.mark.parametrize(
    "country_codes",
    (
        ["IDN", "ZAF"],
        ["CHN", "IDN"],
        ["idn", " chn "],
        ["IDN", "CHN", "ZAF"],
        ["IDN", "ZAF", "CHN", "JPN"],
    ),
)
def test_retired_market_comparison_rejects_every_selection(
    outbound_basic60_client: TestClient,
    country_codes: list[str],
) -> None:
    response = outbound_basic60_client.post(
        "/api/v1/country-comparisons",
        headers={"X-Private-Trial-Key": API_KEY},
        json={"country_codes": country_codes, "as_of": "2024-12-31"},
    )
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


@pytest.mark.parametrize(
    "path", ("/api/v1/country-comparisons", "/api/v1/demo/country-comparisons")
)
@pytest.mark.parametrize("method", ("GET", "POST"))
def test_retired_private_comparison_routes_are_absent(
    basic60_client: TestClient, path: str, method: str
) -> None:
    for headers in ({}, {"X-Private-Trial-Key": API_KEY}):
        response = basic60_client.request(
            method,
            path,
            headers=headers,
            json={"country_codes": ["IDN", "ZAF"]},
        )
        assert response.status_code == 404
        assert response.json() == {"detail": "Not Found"}


def test_private_trial_routes_require_key_and_exclude_v2_routes(
    basic60_client: TestClient,
) -> None:
    unauthorized = basic60_client.get("/api/v1/countries")
    assert unauthorized.status_code == 401
    assert unauthorized.json()["error"]["code"] == "PRIVATE_TRIAL_KEY_REQUIRED"
    assert unauthorized.json()["meta"]["coverage_level"] == "Basic"

    headers = {"X-Private-Trial-Key": API_KEY}
    for path in (
        "/api/v1/policies",
        "/api/v1/search",
        "/api/v1/ai/chat",
        "/api/v1/vector-search",
    ):
        assert basic60_client.get(path, headers=headers).status_code == 404

    openapi = basic60_client.get("/openapi.json").json()
    assert set(openapi["paths"]) == {
        "/health",
        "/api/v1/countries",
        "/api/v1/countries/{country_code}",
        "/api/v1/countries/{country_code}/market-overview",
    }
    assert not any("Comparison" in name for name in openapi["components"]["schemas"])
    public_schemas = json.dumps(openapi["components"]["schemas"], sort_keys=True)
    for field_name in (
        "source_ref",
        "source_snapshot_ref",
        "raw_record_ref",
        "provenance",
        "terms_uri",
        "evidence_sha256",
        "manual_usage_authorization",
        "ai_usage_policy",
        "single_excel_review",
        "canonical_payload_sha256",
        "signature_sha256",
        "signoffs",
        "review_scope",
        "workbook",
    ):
        assert f'"{field_name}"' not in public_schemas


def test_health_and_country_contracts(basic60_client: TestClient) -> None:
    health = basic60_client.get("/health")
    assert health.status_code == 200
    assert health.json() == {
        "status": "ok",
        "database": "ready",
        "release_profile": "basic60_private",
        "formal_gate_status": "pending",
        "release_id": "BASIC60-PRIVATE-R1",
        "release_status": "private_trial_ready",
        "country_count": 2,
        "external_calls_enabled": False,
        "ai_enabled": False,
    }

    headers = {"X-Private-Trial-Key": API_KEY}
    response = basic60_client.get(
        "/api/v1/countries",
        headers=headers,
        params={"q": "南非", "limit": 1},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"] == {
        "release_id": "BASIC60-PRIVATE-R1",
        "release_profile": "basic60_private",
        "formal_gate_status": "pending",
        "coverage_level": "Basic",
        "as_of": "2026-08-24",
        "result_count": 1,
        "next_cursor": None,
    }
    country = payload["data"][0]
    assert country["code"] == "ZAF"
    assert country["coverage_level"] == "Basic"
    assert country["risk_assessment_status"] == "unknown"
    assert country["risk_level"] is None
    assert {item["metric_code"] for item in country["latest_metrics"]} == {
        "population_total",
        "gdp_current_usd",
        "renewable_capacity_mw",
        "electricity_demand_gwh",
    }
    _assert_no_public_source_metadata(payload)


def test_detail_exposes_basic_metrics_and_preserves_missing_values(
    basic60_client: TestClient,
) -> None:
    headers = {"X-Private-Trial-Key": API_KEY}
    detail = basic60_client.get(
        "/api/v1/countries/ZAF",
        headers=headers,
        params={"expand": "identity,macro,energy"},
    )
    assert detail.status_code == 200
    data = detail.json()["data"]
    assert [item["role"] for item in data["capitals"]] == [
        "administrative",
        "legislative",
        "judicial",
    ]
    assert len(data["macro"]) == 1
    assert {item["value_status"] for item in data["energy"]} == {"available", "pending"}
    _assert_no_public_source_metadata(detail.json())

    provenance = basic60_client.get(
        "/api/v1/countries/ZAF",
        headers=headers,
        params={"expand": "provenance"},
    )
    assert provenance.status_code == 422
    assert provenance.json()["error"]["code"] == "VALIDATION_ERROR"


def test_source_revocation_retains_history_and_filters_all_read_routes(
    basic60_client: TestClient,
) -> None:
    headers = {"X-Private-Trial-Key": API_KEY}
    app = cast(FastAPI, basic60_client.app)
    session_factory = app.state.session_factory
    with session_factory() as session:
        before = basic60_source_status_snapshot(
            session,
            "BASIC60-PRIVATE-R1",
            "SRC-MACRO-PRIMARY",
        )
        total_counts_before = {
            "sources": session.scalar(select(func.count()).select_from(Basic60SourceRegistry)),
            "raw": session.scalar(select(func.count()).select_from(Basic60RawRecord)),
            "metrics": session.scalar(select(func.count()).select_from(Basic60MetricValue)),
            "provenance": session.scalar(select(func.count()).select_from(Basic60FieldProvenance)),
            "versions": session.scalar(select(func.count()).select_from(Basic60DataRecordVersion)),
        }
        revoked = revoke_basic60_source(
            session,
            "BASIC60-PRIVATE-R1",
            "SRC-MACRO-PRIMARY",
        )
        repeated = revoke_basic60_source(
            session,
            "BASIC60-PRIVATE-R1",
            "SRC-MACRO-PRIMARY",
        )
        total_counts_after = {
            "sources": session.scalar(select(func.count()).select_from(Basic60SourceRegistry)),
            "raw": session.scalar(select(func.count()).select_from(Basic60RawRecord)),
            "metrics": session.scalar(select(func.count()).select_from(Basic60MetricValue)),
            "provenance": session.scalar(select(func.count()).select_from(Basic60FieldProvenance)),
            "versions": session.scalar(select(func.count()).select_from(Basic60DataRecordVersion)),
        }
        source = session.scalar(
            select(Basic60SourceRegistry).where(
                Basic60SourceRegistry.release_id == "BASIC60-PRIVATE-R1",
                Basic60SourceRegistry.source_ref == "SRC-MACRO-PRIMARY",
            )
        )
        assert source is not None
        assert source.status == "revoked"
        assert total_counts_after == total_counts_before
        assert revoked["changed"] is True
        assert repeated["changed"] is False
        for field in (
            "stored_raw_records",
            "stored_metric_values",
            "stored_provenance_rows",
            "stored_record_versions",
        ):
            assert revoked[field] == before[field]
            assert repeated[field] == before[field]
        assert revoked["visible_metric_values"] == 0
        assert revoked["visible_provenance_rows"] == 0
        with pytest.raises(Basic60ImportError, match="Unknown BASIC60 source"):
            revoke_basic60_source(
                session,
                "BASIC60-PRIVATE-R1",
                "SRC-UNKNOWN",
            )

    countries = basic60_client.get("/api/v1/countries", headers=headers)
    assert countries.status_code == 200
    assert len(countries.json()["data"]) == 2
    for country in countries.json()["data"]:
        codes = {metric["metric_code"] for metric in country["latest_metrics"]}
        assert "gdp_current_usd" not in codes
        assert "renewable_capacity_mw" in codes

    detail = basic60_client.get(
        "/api/v1/countries/IDN",
        headers=headers,
        params={"expand": "identity,macro,energy"},
    )
    assert detail.status_code == 200
    assert detail.json()["data"]["macro"] == []
    assert detail.json()["data"]["energy"]
    _assert_no_public_source_metadata(detail.json())

    comparison = basic60_client.post(
        "/api/v1/country-comparisons",
        headers=headers,
        json={
            "country_codes": ["IDN", "ZAF"],
            "metric_codes": ["gdp_current_usd", "renewable_capacity_mw"],
        },
    )
    assert comparison.status_code == 404
    assert comparison.json() == {"detail": "Not Found"}


def test_identity_source_revocation_hides_countries_fail_closed(
    basic60_client: TestClient,
) -> None:
    app = cast(FastAPI, basic60_client.app)
    with app.state.session_factory() as session:
        result = revoke_basic60_source(
            session,
            "BASIC60-PRIVATE-R1",
            "SRC-ID-PRIMARY",
        )
        assert result["visible_identity_values"] == 0

    headers = {"X-Private-Trial-Key": API_KEY}
    countries = basic60_client.get("/api/v1/countries", headers=headers)
    assert countries.status_code == 200
    assert countries.json()["data"] == []
    assert countries.json()["meta"]["result_count"] == 0

    detail = basic60_client.get("/api/v1/countries/IDN", headers=headers)
    assert detail.status_code == 404
    comparison = basic60_client.post(
        "/api/v1/country-comparisons",
        headers=headers,
        json={"country_codes": ["IDN", "ZAF"]},
    )
    assert comparison.status_code == 404


def test_candidate_mode_never_activates_or_serves_seed(tmp_path: Path) -> None:
    seed_path = tmp_path / "candidate.json"
    _write_json(seed_path, _seed_payload(status="not_ready"))
    settings = Basic60Settings(
        database_url="sqlite+pysqlite:///:memory:",
        api_key=API_KEY,
        cors_origins=("http://localhost:3000",),
        seed_path=seed_path,
        candidate_only=True,
        auto_create_schema=True,
        auto_import_seed=True,
        enforce_baseline_counts=False,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "BASIC60_NO_ACTIVE_RELEASE"
        with app.state.session_factory() as session:
            release = session.get(Basic60Release, "BASIC60-PRIVATE-R1")
            assert release is not None
            assert release.status == "not_ready"
            assert release.is_active is False


def test_non_candidate_environment_requires_validation_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BASIC60_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("BASIC60_API_KEY", API_KEY)
    monkeypatch.setenv("BASIC60_DECISION_PATH", "/governance/decision.json")
    monkeypatch.setenv("BASIC60_DECISION_SHA256", HEX_A)
    monkeypatch.setenv("BASIC60_RELEASE_AUTHORIZATION_PATH", "/governance/auth.json")
    monkeypatch.setenv("BASIC60_RELEASE_AUTHORIZATION_SHA256", HEX_B)
    monkeypatch.delenv("BASIC60_VALIDATION_REPORT_PATH", raising=False)
    monkeypatch.delenv("BASIC60_VALIDATION_REPORT_SHA256", raising=False)
    with pytest.raises(RuntimeError, match="BASIC60_VALIDATION_REPORT_PATH"):
        Basic60Settings.from_env()


def test_non_candidate_environment_requires_runtime_attestation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BASIC60_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("BASIC60_API_KEY", API_KEY)
    monkeypatch.setenv("BASIC60_DECISION_PATH", "/governance/decision.json")
    monkeypatch.setenv("BASIC60_DECISION_SHA256", HEX_A)
    monkeypatch.setenv("BASIC60_RELEASE_AUTHORIZATION_PATH", "/governance/auth.json")
    monkeypatch.setenv("BASIC60_RELEASE_AUTHORIZATION_SHA256", HEX_B)
    monkeypatch.setenv("BASIC60_VALIDATION_REPORT_PATH", "/governance/report.json")
    monkeypatch.setenv("BASIC60_VALIDATION_REPORT_SHA256", HEX_C)
    monkeypatch.delenv("BASIC60_RUNTIME_ATTESTATION_PATH", raising=False)
    monkeypatch.delenv("BASIC60_RUNTIME_ATTESTATION_SHA256", raising=False)
    monkeypatch.delenv("BASIC60_RUNTIME_ATTESTATION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="BASIC60_RUNTIME_ATTESTATION_PATH"):
        Basic60Settings.from_env()

    monkeypatch.setenv("BASIC60_RUNTIME_ATTESTATION_PATH", "/runtime/attestation.json")
    monkeypatch.setenv("BASIC60_RUNTIME_ATTESTATION_SHA256", HEX_A)
    with pytest.raises(RuntimeError, match="BASIC60_RUNTIME_ATTESTATION_KEY"):
        Basic60Settings.from_env()

    settings = Basic60Settings(
        database_url="sqlite+pysqlite:///:memory:",
        api_key=API_KEY,
        cors_origins=(),
        runtime_attestation_key=RUNTIME_ATTESTATION_KEY,
        candidate_only=True,
    )
    assert RUNTIME_ATTESTATION_KEY not in repr(settings)


@pytest.mark.parametrize(
    "trust_key",
    (
        "replace-me",
        "replace-with-at-least-32-random-bytes",
        "test-runtime-attestation-key-with-32-bytes",
        "basic60-test-runtime-attestation-key-32-bytes",
        "placeholder-runtime-attestation-key-32-bytes",
    ),
)
def test_non_candidate_environment_rejects_known_attestation_key_examples(
    monkeypatch: pytest.MonkeyPatch,
    trust_key: str,
) -> None:
    monkeypatch.setenv("BASIC60_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("BASIC60_API_KEY", API_KEY)
    monkeypatch.setenv("BASIC60_DECISION_PATH", "/governance/decision.json")
    monkeypatch.setenv("BASIC60_DECISION_SHA256", HEX_A)
    monkeypatch.setenv("BASIC60_RELEASE_AUTHORIZATION_PATH", "/governance/auth.json")
    monkeypatch.setenv("BASIC60_RELEASE_AUTHORIZATION_SHA256", HEX_B)
    monkeypatch.setenv("BASIC60_VALIDATION_REPORT_PATH", "/governance/report.json")
    monkeypatch.setenv("BASIC60_VALIDATION_REPORT_SHA256", HEX_C)
    monkeypatch.setenv("BASIC60_RUNTIME_ATTESTATION_PATH", "/runtime/attestation.json")
    monkeypatch.setenv("BASIC60_RUNTIME_ATTESTATION_SHA256", HEX_A)
    monkeypatch.setenv("BASIC60_RUNTIME_ATTESTATION_KEY", trust_key)

    with pytest.raises(RuntimeError, match="known placeholder or example value"):
        Basic60Settings.from_env()


def test_handwritten_ready_packet_without_valid_machine_mac_is_rejected(
    tmp_path: Path,
) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = _settings(tmp_path, seed_path, seed_sha)
    assert settings.runtime_attestation_path is not None

    handwritten = json.loads(settings.runtime_attestation_path.read_text(encoding="utf-8"))
    handwritten["mac_sha256"] = "0" * 64
    handwritten_sha = _write_json(settings.runtime_attestation_path, handwritten)
    broken = replace(settings, runtime_attestation_sha256=handwritten_sha)

    with (
        pytest.raises(Basic60ImportError, match="runtime attestation MAC is invalid"),
        TestClient(create_app(broken)),
    ):
        pass


@pytest.mark.parametrize(
    ("settings_change", "message"),
    (
        ({"runtime_attestation_path": None}, "attestation path, SHA-256, and trust key"),
        ({"runtime_attestation_sha256": None}, "attestation path, SHA-256, and trust key"),
        ({"runtime_attestation_key": None}, "attestation path, SHA-256, and trust key"),
        ({"runtime_attestation_key": "too-short"}, "must contain at least 32"),
        (
            {"runtime_attestation_key": "replace-with-at-least-32-random-bytes"},
            "known placeholder or example value",
        ),
    ),
)
def test_runtime_attestation_activation_inputs_are_required(
    tmp_path: Path,
    settings_change: dict[str, Any],
    message: str,
) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = replace(_settings(tmp_path, seed_path, seed_sha), **settings_change)
    with pytest.raises(Basic60ImportError, match=message), TestClient(create_app(settings)):
        pass


def test_valid_mac_for_different_artifacts_is_rejected_as_stale(tmp_path: Path) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = _settings(tmp_path, seed_path, seed_sha)
    assert settings.runtime_attestation_path is not None

    stale = json.loads(settings.runtime_attestation_path.read_text(encoding="utf-8"))
    stale["claims"]["release_bundle_sha256"] = HEX_A
    message = json.dumps(stale["claims"], sort_keys=True, separators=(",", ":")).encode()
    stale["mac_sha256"] = hmac.new(
        RUNTIME_ATTESTATION_KEY.encode(), message, hashlib.sha256
    ).hexdigest()
    stale_sha = _write_json(settings.runtime_attestation_path, stale)
    broken = replace(settings, runtime_attestation_sha256=stale_sha)

    with (
        pytest.raises(Basic60ImportError, match="runtime attestation binding mismatch"),
        TestClient(create_app(broken)),
    ):
        pass


def test_governance_hash_mismatch_refuses_startup(tmp_path: Path) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = _settings(tmp_path, seed_path, seed_sha)
    broken = replace(settings, decision_sha256=HEX_C)
    app = create_app(broken)
    with pytest.raises(Basic60ImportError, match="decision file SHA-256"), TestClient(app):
        pass


@pytest.mark.parametrize(
    ("settings_change", "message"),
    (
        ({"validation_report_path": None}, "validation report path and SHA-256 are required"),
        ({"validation_report_sha256": None}, "validation report path and SHA-256 are required"),
        ({"validation_report_sha256": HEX_C}, "validation report file SHA-256"),
    ),
)
def test_validation_report_path_and_hash_are_required(
    tmp_path: Path,
    settings_change: dict[str, Any],
    message: str,
) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = replace(_settings(tmp_path, seed_path, seed_sha), **settings_change)
    with pytest.raises(Basic60ImportError, match=message), TestClient(create_app(settings)):
        pass


def test_missing_validation_report_file_refuses_activation(tmp_path: Path) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = _settings(tmp_path, seed_path, seed_sha)
    missing = replace(settings, validation_report_path=tmp_path / "missing-validation.json")
    with (
        pytest.raises(Basic60ImportError, match="Cannot read BASIC60 validation report file"),
        TestClient(create_app(missing)),
    ):
        pass


@pytest.mark.parametrize("invalid_field", ("checks", "country_count"))
def test_validation_report_rejects_open_checks_and_wrong_counts(
    tmp_path: Path,
    invalid_field: str,
) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = _settings(tmp_path, seed_path, seed_sha)
    assert settings.validation_report_path is not None
    report = _validation_report_payload()
    if invalid_field == "checks":
        report["checks"] = [
            {
                "code": "B60_FORGED_READY",
                "message": "ready cannot retain an open check",
                "severity": "error",
                "location": "checks",
            }
        ]
    else:
        report["machine_counts"]["country_count"] = 59
    report_sha = _write_json(settings.validation_report_path, report)
    broken = replace(settings, validation_report_sha256=report_sha)
    with (
        pytest.raises(Basic60ImportError, match="validation report is invalid"),
        TestClient(create_app(broken)),
    ):
        pass


def test_validation_report_bundle_and_seed_bindings_are_enforced(tmp_path: Path) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = _settings(tmp_path, seed_path, seed_sha)
    assert settings.validation_report_path is not None
    assert settings.release_authorization_path is not None

    report = _validation_report_payload()
    report["release_bundle_sha256"] = HEX_A
    report_sha = _write_json(settings.validation_report_path, report)
    bundle_mismatch = replace(settings, validation_report_sha256=report_sha)
    with (
        pytest.raises(Basic60ImportError, match="validation report binding mismatch"),
        TestClient(create_app(bundle_mismatch)),
    ):
        pass

    _write_json(settings.validation_report_path, _validation_report_payload())
    authorization = json.loads(settings.release_authorization_path.read_text())
    authorization["seed_artifact_sha256"] = HEX_C
    authorization_sha = _write_json(settings.release_authorization_path, authorization)
    seed_mismatch = replace(settings, release_authorization_sha256=authorization_sha)
    with (
        pytest.raises(
            Basic60ImportError,
            match="release authorization binding mismatch: seed_artifact_sha256",
        ),
        TestClient(create_app(seed_mismatch)),
    ):
        pass


def test_direct_activation_and_startup_revalidate_report(tmp_path: Path) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = _settings(tmp_path, seed_path, seed_sha)
    assert settings.validation_report_path is not None

    engine = build_engine("sqlite+pysqlite:///:memory:")
    Basic60Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        import_basic60_seed_file(session, seed_path, settings, activate=False)
        report = _validation_report_payload()
        report["checks"] = [{"code": "OPEN"}]
        report_sha = _write_json(settings.validation_report_path, report)
        with pytest.raises(Basic60ImportError, match="validation report is invalid"):
            activate_basic60_release(
                session,
                "BASIC60-PRIVATE-R1",
                replace(settings, validation_report_sha256=report_sha),
            )
    engine.dispose()

    _write_json(settings.validation_report_path, _validation_report_payload())
    database_path = tmp_path / "startup.sqlite"
    database_settings = replace(
        settings,
        database_url=f"sqlite+pysqlite:///{database_path}",
    )
    with TestClient(create_app(database_settings)) as client:
        assert client.get("/health").status_code == 200

    report = _validation_report_payload()
    report["checks"] = [{"code": "OPEN"}]
    report_sha = _write_json(settings.validation_report_path, report)
    startup_settings = replace(
        database_settings,
        validation_report_sha256=report_sha,
        auto_create_schema=False,
        auto_import_seed=False,
    )
    with (
        pytest.raises(Basic60GovernanceError, match="validation report is invalid"),
        TestClient(create_app(startup_settings)),
    ):
        pass


def test_import_is_idempotent_and_release_id_is_immutable(tmp_path: Path) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = _settings(tmp_path, seed_path, seed_sha)
    engine = build_engine("sqlite+pysqlite:///:memory:")
    Basic60Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        first = import_basic60_seed_file(session, seed_path, settings, activate=True)
        second = import_basic60_seed_file(session, seed_path, settings, activate=True)
        assert first == second
        assert first["countries"] == 2
        release = session.get(Basic60Release, "BASIC60-PRIVATE-R1")
        assert release is not None
        authorization = _seed_payload()["manual_usage_authorization"]
        assert release.manual_usage_authorization == authorization
        expected_authorization_sha256 = hashlib.sha256(
            json.dumps(
                authorization,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        assert release.manual_usage_authorization_sha256 == expected_authorization_sha256
        assert not hasattr(next(iter(release.sources)), "license_scope")

        changed = _seed_payload()
        changed["release"]["source_cutoff"] = "2026-08-23"
        changed_path = tmp_path / "changed.json"
        _write_json(changed_path, changed)
        with pytest.raises(Basic60ImportError, match="different immutable seed artifact hash"):
            import_basic60_seed_file(session, changed_path, settings, activate=False)
    engine.dispose()


def test_revocation_preserves_history_and_prevents_reactivation(tmp_path: Path) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = _settings(tmp_path, seed_path, seed_sha)
    engine = build_engine("sqlite+pysqlite:///:memory:")
    Basic60Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        import_basic60_seed_file(session, seed_path, settings, activate=True)
        version_count = session.scalar(select(func.count()).select_from(Basic60DataRecordVersion))
        revoke_basic60_release(session, "BASIC60-PRIVATE-R1", settings)
        release = session.get(Basic60Release, "BASIC60-PRIVATE-R1")
        assert release is not None
        assert release.status == "revoked"
        assert release.is_active is False
        assert (
            session.scalar(select(func.count()).select_from(Basic60DataRecordVersion))
            == version_count
        )
        statuses = set(session.scalars(select(Basic60DataRecordVersion.record_status)))
        assert statuses == {"revoked"}
        with pytest.raises(Basic60ImportError, match="private_trial_ready"):
            activate_basic60_release(session, "BASIC60-PRIVATE-R1", settings)
    engine.dispose()


def test_manual_usage_authorization_hash_is_fail_closed(tmp_path: Path) -> None:
    seed_path = tmp_path / "basic60_seed.json"
    seed_sha = _write_json(seed_path, _seed_payload())
    settings = _settings(tmp_path, seed_path, seed_sha)
    engine = build_engine("sqlite+pysqlite:///:memory:")
    Basic60Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        import_basic60_seed_file(session, seed_path, settings, activate=False)
        release = session.get(Basic60Release, "BASIC60-PRIVATE-R1")
        assert release is not None
        release.manual_usage_authorization = {
            **release.manual_usage_authorization,
            "permission_authority": "tampered",
        }
        with pytest.raises(Basic60ImportError, match="authorization hash mismatch"):
            validate_basic60_manual_usage_authorization(release)
    engine.dispose()


def test_basic60_alembic_chain_is_separate_from_demo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database_path = tmp_path / "migration.sqlite"
    database_url = f"sqlite+pysqlite:///{database_path}"
    monkeypatch.setenv("BASIC60_DATABASE_URL", database_url)
    config_path = Path(__file__).parents[2] / "services/api/alembic-basic60.ini"
    config = Config(str(config_path))
    config.set_main_option(
        "script_location", str(Path(__file__).parents[2] / "services/api/alembic_basic60")
    )
    command.upgrade(config, "head")

    engine = build_engine(database_url)
    table_names = set(inspect(engine).get_table_names())
    assert "basic60_countries" in table_names
    assert "basic60_metric_values" in table_names
    assert "countries" not in table_names
    assert "policies" not in table_names
    source_checks = {
        item["name"]: item["sqltext"]
        for item in inspect(engine).get_check_constraints("basic60_source_registry")
    }
    assert "ck_basic60_source_status" in source_checks
    assert "revoked" in source_checks["ck_basic60_source_status"]
    assert "ck_basic60_source_active" not in source_checks
    source_columns = {
        item["name"] for item in inspect(engine).get_columns("basic60_source_registry")
    }
    assert {
        "license_scope",
        "ai_processing",
        "cloud_processing",
        "local_model_processing",
        "controlled_external_model_processing",
        "model_training",
    }.isdisjoint(source_columns)
    release_columns = {
        item["name"] for item in inspect(engine).get_columns("basic60_release_snapshots")
    }
    assert {
        "manual_usage_authorization",
        "manual_usage_authorization_sha256",
    } <= release_columns
    release_checks = {
        item["name"]: item["sqltext"]
        for item in inspect(engine).get_check_constraints("basic60_release_snapshots")
    }
    assert "ck_basic60_manual_usage_authorization_sha256" in release_checks
    command.downgrade(config, "base")
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}
    engine.dispose()
