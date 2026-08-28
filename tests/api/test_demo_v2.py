"""Contract and safety tests for the bilingual expansion-workbench demo API."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

import pytest
from fastapi.testclient import TestClient

COUNTRY_CODES = ["BRA", "IDN", "SAU", "VNM", "ZAF"]
NEW_PATHS = [
    "/api/v1/demo/globe-markers",
    "/api/v1/demo/tools/tenders",
    "/api/v1/demo/tools/tenders/TND-IDN-001",
]
CJK_PATTERN = re.compile(r"[\u3400-\u9fff]")


def assert_meta(payload: Mapping[str, Any], locale: str) -> None:
    assert payload["meta"]["data_origin"] == "synthetic_demo"
    assert payload["meta"]["locale"] == locale
    expected = "Demo Data / Non-official Conclusions" if locale == "en" else "演示数据 / 非正式结论"
    assert payload["meta"]["disclaimer"] == expected


def assert_english(value: str) -> None:
    assert value.strip()
    assert CJK_PATTERN.search(value) is None


@pytest.mark.parametrize("path", NEW_PATHS)
def test_new_get_endpoints_require_demo_key(client: TestClient, path: str) -> None:
    response = client.get(path, params={"locale": "en"})
    assert response.status_code == 401
    payload = response.json()
    assert_meta(payload, "en")
    assert payload["error"]["code"] == "DEMO_KEY_REQUIRED"


def test_globe_markers_are_bilingual_local_and_complete(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    zh_response = client.get(
        "/api/v1/demo/globe-markers", headers=auth_headers, params={"locale": "zh-CN"}
    )
    en_response = client.get(
        "/api/v1/demo/globe-markers", headers=auth_headers, params={"locale": "en"}
    )
    assert zh_response.status_code == en_response.status_code == 200
    zh_payload = zh_response.json()
    en_payload = en_response.json()
    assert_meta(zh_payload, "zh-CN")
    assert_meta(en_payload, "en")
    assert zh_payload["meta"]["result_count"] == en_payload["meta"]["result_count"] == 5
    assert [item["code"] for item in en_payload["data"]] == COUNTRY_CODES
    assert [item["lat"] for item in en_payload["data"]] == [
        -14.235,
        -0.7893,
        23.8859,
        14.0583,
        -30.5595,
    ]
    for zh_item, en_item in zip(zh_payload["data"], en_payload["data"], strict=True):
        assert zh_item["name"] != en_item["name"]
        assert en_item["data_origin"] == "synthetic_demo"
        assert_english(en_item["name"])
        assert_english(en_item["summary"])


@pytest.mark.parametrize(
    "country_codes",
    (["IDN", "SAU"], ["IDN"], ["IDN", "SAU", "VNM"], ["IDN", "idn"]),
)
def test_retired_demo_comparison_does_not_accept_or_validate_selections(
    client: TestClient, auth_headers: dict[str, str], country_codes: list[str]
) -> None:
    response = client.post(
        "/api/v1/demo/country-comparisons",
        headers=auth_headers,
        params={"locale": "en"},
        json={"country_codes": country_codes},
    )
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


@pytest.mark.parametrize("country_code", COUNTRY_CODES)
def test_assistant_preview_has_complete_deterministic_english_for_every_country(
    client: TestClient, auth_headers: dict[str, str], country_code: str
) -> None:
    request = {"country_code": country_code, "question_type": "market_entry"}
    first = client.post(
        "/api/v1/demo/tools/assistant/preview",
        headers=auth_headers,
        params={"locale": "en"},
        json=request,
    )
    second = client.post(
        "/api/v1/demo/tools/assistant/preview",
        headers=auth_headers,
        params={"locale": "en"},
        json=request,
    )
    assert first.status_code == 200
    assert first.json() == second.json()
    payload = first.json()
    assert_meta(payload, "en")
    data = payload["data"]
    assert data["data_origin"] == "synthetic_demo"
    assert data["country_code"] == country_code
    assert len(data["actions"]) == 3
    assert len(data["related_items"]) == 2
    assert len(data["limitations"]) == 3
    for value in [data["summary"], *data["actions"], *data["related_items"], *data["limitations"]]:
        assert_english(value)


def test_assistant_is_controlled_and_rejects_free_form_questions(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/demo/tools/assistant/preview",
        headers=auth_headers,
        json={"country_code": "IDN", "question_type": "market_entry", "prompt": "secret"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_solar_preview_is_qualitative_and_excludes_professional_financial_outputs(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/demo/tools/solar-storage/preview",
        headers=auth_headers,
        params={"locale": "en"},
        json={
            "country_code": "VNM",
            "scenario": "commercial_industrial",
            "solar_capacity_mw": 24.5,
            "storage_duration_hours": 4,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert_meta(payload, "en")
    data = payload["data"]
    assert set(data) == {
        "data_origin",
        "country_code",
        "scenario",
        "configuration",
        "assumptions",
        "risks",
        "next_steps",
    }
    rendered = " ".join(
        [*data["configuration"], *data["assumptions"], *data["risks"], *data["next_steps"]]
    )
    assert_english(rendered)
    lowered = rendered.casefold()
    for prohibited in ("irr", "lcoe", "npv", "payback period"):
        assert prohibited not in lowered
    assert "not an engineering design" in lowered


def test_feasibility_preview_returns_only_requested_sections_and_clear_limits(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/demo/tools/feasibility-report/preview",
        headers=auth_headers,
        params={"locale": "en"},
        json={
            "country_code": "ZAF",
            "project_type": "microgrid",
            "section_keys": ["market_context", "risk_review"],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert_meta(payload, "en")
    data = payload["data"]
    assert [section["key"] for section in data["sections"]] == [
        "market_context",
        "risk_review",
    ]
    assert len(data["open_questions"]) == 3
    assert len(data["limitations"]) == 3
    values = [
        data["title"],
        *[section["title"] for section in data["sections"]],
        *[section["content"] for section in data["sections"]],
        *data["open_questions"],
        *data["limitations"],
    ]
    for value in values:
        assert_english(value)
    assert "no formal report artifact" in " ".join(data["limitations"]).casefold()


def test_tool_tenders_support_filters_keyword_and_detail(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    listed = client.get(
        "/api/v1/demo/tools/tenders",
        headers=auth_headers,
        params={
            "locale": "en",
            "country_code": "idn",
            "sector": "battery_storage",
            "stage": "demo_watchlist",
            "keyword": "eastern-region",
        },
    )
    assert listed.status_code == 200
    payload = listed.json()
    assert_meta(payload, "en")
    assert payload["meta"]["result_count"] == 1
    tender = payload["data"][0]
    assert tender["tender_id"] == "TND-IDN-001"
    assert_english(tender["title"])
    assert_english(tender["summary"])

    detail = client.get(
        f"/api/v1/demo/tools/tenders/{tender['tender_id']}",
        headers=auth_headers,
        params={"locale": "en"},
    )
    assert detail.status_code == 200
    assert detail.json()["data"] == tender

    missing = client.get("/api/v1/demo/tools/tenders/TND-XXX-001", headers=auth_headers)
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "DEMO_TENDER_NOT_FOUND"


def test_existing_country_and_catalog_endpoints_have_complete_english_copy(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for country_code in COUNTRY_CODES:
        detail_response = client.get(
            f"/api/v1/countries/{country_code}",
            headers=auth_headers,
            params={"locale": "en"},
        )
        assert detail_response.status_code == 200
        detail = detail_response.json()["data"]
        for value in [detail["region"], detail["summary"]]:
            assert_english(value)
        for item in detail["signals"]:
            assert_english(item["title"])
            assert_english(item["summary"])
        for item in detail["reasons"]:
            assert_english(item["title"])
            assert_english(item["detail"])
        for item in detail["actions"]:
            assert_english(item["title"])
            assert_english(item["detail"])
            assert_english(item["owner_hint"])
        for item in detail["risks"]:
            assert_english(item["title"])
            assert_english(item["detail"])
            assert_english(item["mitigation"])

    display_fields = {
        "policies": ("title", "summary"),
        "risks": ("title", "detail", "mitigation"),
        "opportunities": ("title", "detail", "next_step"),
        "tenders": ("title", "summary"),
        "partners": ("name", "summary"),
    }
    for endpoint, fields in display_fields.items():
        response = client.get(f"/api/v1/{endpoint}", headers=auth_headers, params={"locale": "en"})
        assert response.status_code == 200
        payload = response.json()
        assert_meta(payload, "en")
        assert payload["meta"]["result_count"] == 5
        for item in payload["data"]:
            for field in fields:
                assert_english(item[field])
            if endpoint == "partners":
                for capability in item["capabilities"]:
                    assert_english(capability)


def test_new_operation_ids_are_stable(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    assert paths["/api/v1/demo/globe-markers"]["get"]["operationId"] == "API-DEMO-GLOBE-001"
    assert "/api/v1/demo/country-comparisons" not in paths
    assert (
        paths["/api/v1/demo/tools/assistant/preview"]["post"]["operationId"]
        == "API-DEMO-ASSISTANT-PREVIEW-001"
    )
    assert (
        paths["/api/v1/demo/tools/solar-storage/preview"]["post"]["operationId"]
        == "API-DEMO-SOLAR-STORAGE-PREVIEW-001"
    )
    assert (
        paths["/api/v1/demo/tools/feasibility-report/preview"]["post"]["operationId"]
        == "API-DEMO-FEASIBILITY-PREVIEW-001"
    )
