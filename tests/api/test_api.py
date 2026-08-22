"""End-to-end REST contract tests for the internal demo."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest
from fastapi.testclient import TestClient
from navigator_api.models import Country
from sqlalchemy import select

EXPECTED_COUNTRIES = ["BRA", "IDN", "SAU", "VNM", "ZAF"]
BUSINESS_PATHS = [
    "/api/v1/meta",
    "/api/v1/countries",
    "/api/v1/countries/IDN",
    "/api/v1/policies",
    "/api/v1/risks",
    "/api/v1/opportunities",
    "/api/v1/tenders",
    "/api/v1/partners",
]
DIMENSIONS = {
    "market_attractiveness",
    "policy_certainty",
    "project_activity",
    "partner_maturity",
    "risk_controllability",
}


def assert_demo_envelope(payload: Mapping[str, Any]) -> None:
    assert payload["meta"]["data_origin"] == "synthetic_demo"
    assert payload["meta"]["disclaimer"] == "演示数据 / 非正式结论"


def test_health_is_unprotected_and_checks_seeded_database(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": "ready",
        "data_origin": "synthetic_demo",
        "disclaimer": "演示数据 / 非正式结论",
        "seeded_country_count": 5,
    }
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-navigator-data-origin"] == "synthetic_demo"


@pytest.mark.parametrize("path", BUSINESS_PATHS)
def test_every_business_get_requires_demo_key(client: TestClient, path: str) -> None:
    missing = client.get(path)
    wrong = client.get(path, headers={"X-Demo-Key": "incorrect"})
    for response in (missing, wrong):
        assert response.status_code == 401
        payload = response.json()
        assert_demo_envelope(payload)
        assert payload["error"]["code"] == "DEMO_KEY_REQUIRED"


def test_post_endpoints_require_demo_key(client: TestClient) -> None:
    comparison = client.post("/api/v1/country-comparisons", json={"country_codes": ["IDN", "SAU"]})
    reset = client.post("/api/v1/demo/reset")
    assert comparison.status_code == 401
    assert reset.status_code == 401


def test_meta_declares_bounded_demo(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get("/api/v1/meta", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    assert_demo_envelope(payload)
    assert payload["data"] == {
        "data_origin": "synthetic_demo",
        "name": "Navigator 内部全栈演示",
        "baseline_decision": "PBD-ACCEL-DEMO-001",
        "mode": "bounded_internal_demo",
        "country_codes": EXPECTED_COUNTRIES,
        "external_calls_enabled": False,
        "real_data_enabled": False,
    }


def test_country_list_exposes_five_dimension_backend_scores(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/countries", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    assert_demo_envelope(payload)
    assert payload["meta"]["result_count"] == 5
    assert [item["code"] for item in payload["data"]] == EXPECTED_COUNTRIES
    for item in payload["data"]:
        assert item["data_origin"] == "synthetic_demo"
        assert set(item["scores"]) > DIMENSIONS
        assert set(item["dimension_deltas"]) == DIMENSIONS


def test_country_detail_contains_required_decision_context(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/countries/idn", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    assert_demo_envelope(payload)
    detail = payload["data"]
    assert detail["code"] == "IDN"
    assert len(detail["signals"]) == 2
    assert len(detail["reasons"]) == 2
    assert len(detail["risks"]) == 1
    assert len(detail["actions"]) == 2
    assert detail["signals"][0]["occurred_at"].startswith("2026-")
    for collection in ("signals", "reasons", "risks", "actions"):
        assert all(item["data_origin"] == "synthetic_demo" for item in detail[collection])


def test_unknown_country_uses_consistent_error_envelope(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/countries/xxx", headers=auth_headers)
    assert response.status_code == 404
    payload = response.json()
    assert_demo_envelope(payload)
    assert payload["error"]["code"] == "COUNTRY_NOT_FOUND"


def test_comparison_ranks_two_to_four_countries(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/country-comparisons",
        headers=auth_headers,
        json={"country_codes": ["idn", "SAU", "vnm", "BRA"]},
    )
    assert response.status_code == 200
    payload = response.json()
    assert_demo_envelope(payload)
    rows = payload["data"]["countries"]
    assert [row["rank"] for row in rows] == [1, 2, 3, 4]
    assert [row["overall_score"] for row in rows] == sorted(
        [row["overall_score"] for row in rows], reverse=True
    )
    assert all(set(row["dimension_deltas"]) == DIMENSIONS for row in rows)
    assert all(set(row["scores"]) > DIMENSIONS for row in rows)
    assert payload["data"]["methodology"].startswith("合成五维加权")


@pytest.mark.parametrize(
    "country_codes",
    [["IDN"], ["IDN", "SAU", "VNM", "BRA", "ZAF"], ["IDN", "idn"]],
)
def test_comparison_validates_size_and_uniqueness(
    client: TestClient, auth_headers: dict[str, str], country_codes: list[str]
) -> None:
    response = client.post(
        "/api/v1/country-comparisons",
        headers=auth_headers,
        json={"country_codes": country_codes},
    )
    assert response.status_code == 422
    payload = response.json()
    assert_demo_envelope(payload)
    assert payload["error"]["code"] == "VALIDATION_ERROR"


def test_comparison_reports_unknown_codes(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/country-comparisons",
        headers=auth_headers,
        json={"country_codes": ["IDN", "XXX"]},
    )
    assert response.status_code == 404
    payload = response.json()
    assert_demo_envelope(payload)
    assert payload["error"]["details"] == [{"missing_country_codes": ["XXX"]}]


@pytest.mark.parametrize(
    ("path", "id_field"),
    [
        ("policies", "policy_id"),
        ("risks", "risk_id"),
        ("opportunities", "opportunity_id"),
        ("tenders", "tender_id"),
        ("partners", "partner_id"),
    ],
)
def test_catalog_endpoints_filter_and_mark_records(
    client: TestClient, auth_headers: dict[str, str], path: str, id_field: str
) -> None:
    response = client.get(
        f"/api/v1/{path}", headers=auth_headers, params={"country_code": "vnm", "limit": 1}
    )
    assert response.status_code == 200
    payload = response.json()
    assert_demo_envelope(payload)
    assert payload["meta"]["result_count"] == 1
    assert payload["data"][0]["country_code"] == "VNM"
    assert payload["data"][0]["data_origin"] == "synthetic_demo"
    assert payload["data"][0][id_field]


def test_catalog_validation_errors_are_consistent(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get(
        "/api/v1/policies", headers=auth_headers, params={"country_code": "INVALID", "limit": 0}
    )
    assert response.status_code == 422
    payload = response.json()
    assert_demo_envelope(payload)
    assert payload["error"]["code"] == "VALIDATION_ERROR"


def test_reset_restores_deterministic_seed(
    app: Any, client: TestClient, auth_headers: dict[str, str]
) -> None:
    with app.state.session_factory() as session:
        country = session.scalar(select(Country).where(Country.code == "IDN"))
        assert country is not None
        country.name_zh = "已修改的演示值"
        session.commit()

    reset = client.post("/api/v1/demo/reset", headers=auth_headers)
    assert reset.status_code == 200
    payload = reset.json()
    assert_demo_envelope(payload)
    assert payload["data"]["country_count"] == 5
    assert payload["data"]["record_counts"] == {
        "countries": 5,
        "signals": 10,
        "reasons": 10,
        "actions": 10,
        "policies": 5,
        "risks": 5,
        "opportunities": 5,
        "tenders": 5,
        "partners": 5,
    }
    restored = client.get("/api/v1/countries/IDN", headers=auth_headers)
    assert restored.json()["data"]["name_zh"] == "印度尼西亚"


def test_openapi_preserves_required_contract_identifiers(client: TestClient) -> None:
    document = client.get("/openapi.json").json()
    assert document["paths"]["/api/v1/countries"]["get"]["operationId"] == "API-COUNTRY-001"
    assert (
        document["paths"]["/api/v1/countries/{country_code}"]["get"]["operationId"]
        == "API-COUNTRY-002"
    )
    assert (
        document["paths"]["/api/v1/country-comparisons"]["post"]["operationId"] == "API-COMPARE-001"
    )
