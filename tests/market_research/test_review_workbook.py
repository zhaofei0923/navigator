"""The review reader must preserve content and avoid exposing structural rows."""

from __future__ import annotations

import importlib.util
import json
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from navigator_api.market_schemas import CountryMarketOverview
from navigator_data_readiness.market_content import (
    MarketCandidate,
    _read_workbook,
    apply_market_review_rows,
    market_review_rows,
)

MODULE_PATH = Path(__file__).parents[2] / "scripts/market_research/verify_review_workbook.py"
SPEC = importlib.util.spec_from_file_location("market_review_verify", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
verify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify)


@pytest.mark.parametrize(
    "pointer,visible",
    [
        ("analysis/summary/market_character", True),
        ("analysis/sections/0/paragraphs/0", True),
        ("analysis/sections/0/id", False),
        ("analysis/entry_assessments/0/business", False),
        ("analysis/entry_assessments/0/technology", False),
        ("analysis/entry_assessments/0/level", True),
        ("analysis/entry_assessments/0/verified_on", False),
        ("analysis/risks/0/businesses/0", False),
        ("analysis/risks/0/technologies/0", False),
        ("analysis/risks/0/mitigation", True),
        ("report/chapters/0/actions/0", True),
        ("report/chapters/0/id", False),
    ],
)
def test_reading_view_excludes_only_internal_structure(pointer: str, visible: bool) -> None:
    row = ["AAA", "MARKET-AAA-20260827-R1", "zh-CN", f"/locales/zh-CN/{pointer}", "测试", "测试"]
    assert verify.reading_row(row) is visible


def test_english_rows_remain_in_editor_not_chinese_reading_view() -> None:
    assert not verify.reading_row(
        ["AAA", "MARKET-AAA-20260827-R1", "en", "/locales/en/report/title", "Test", "Test"]
    )


def test_insufficient_information_is_not_translated_as_low_risk() -> None:
    assert verify.LEVEL_LABELS["insufficient"] == "信息不足"
    assert len(set(verify.LEVEL_LABELS.values())) == 4


@pytest.mark.parametrize("stamp", ["2026-08-27", "2026-08-27T11:41:57.405+00:00"])
def test_workbook_metadata_retains_iso_creation_day_and_candidate_hash(stamp: str) -> None:
    metadata = {"created_at": stamp, "candidate_sha256": "a" * 64, "country_count": 59}
    output = verify.workbook_metadata(metadata)
    assert output == {**metadata, "created_at": "2026-08-27"}
    assert metadata["created_at"] == stamp


def synthetic_overview_review(
    *, with_research: bool = True
) -> tuple[MarketCandidate, dict[str, Any]]:
    """Engineering fixtures only; never mistaken for a real country manuscript."""
    payloads = []
    inventory = []
    for code, name, count in (("AAA", "合成甲", 7), ("BBB", "合成乙", 6)):
        paragraphs = []
        for index in range(count):
            prefix = f"{name}合成测试第{index + 1}段，2026年仅为测试日期。"
            repeated = "这些文字仅用于验证审核工具的字符计数与字段联动，不描述任何真实市场事实。"
            body = prefix + (repeated * 10)[: 270 - len(prefix)]
            paragraphs.append(body[:35] + " \t\n\u3000\u00a0" + body[35:])
        payload = {
            "schema_version": "navigator.market-overview.v1",
            "country_code": code,
            "content_version": f"OVERVIEW-{code}-20260827-R1",
            "as_of": "2026-08-27",
            "locales": {
                "zh-CN": {
                    # The leading equals sign must stay literal, never a formula.
                    "title": ("=" if code == "BBB" else "") + name + "新能源市场概述",
                    "paragraphs": paragraphs,
                    "disclaimer": "此文件仅含合成工程测试数据，不是国家研究或审批文件。",
                },
                "en": {
                    "title": f"Synthetic {code} renewable-energy overview",
                    "paragraphs": [
                        f"Synthetic {code}, paragraph {index + 1}: 2026 is only a test date. "
                        "This text checks character counting and linked review cells; "
                        "it makes no claims about a real market."
                        for index in range(count)
                    ],
                    "disclaimer": "Synthetic engineering data only; not research or approval.",
                },
            },
        }
        payloads.append(CountryMarketOverview.model_validate(payload))
        inventory.append(
            {
                "code": code,
                "country_name": name,
                "country_name_en": f"Synthetic {code}",
                "content_version": payload["content_version"],
                "as_of": payload["as_of"],
                "overview_zh_chars": verify.character_count("".join(paragraphs)),
                "paragraph_count": count,
            }
        )
    candidate = MarketCandidate("SYNTHETIC-OVERVIEW-20260827-R1", tuple(payloads))
    rows = [list(row) for row in market_review_rows(candidate)]
    names = {item["code"]: item for item in inventory}
    labels = []
    for row in rows:
        leaf = row[3].rsplit("/", 1)[-1]
        label = {"title": "标题", "disclaimer": "适用说明"}.get(leaf)
        labels.append(
            {
                "country_code": row[0],
                "country_name": names[row[0]]["country_name"],
                "country_name_en": names[row[0]]["country_name_en"],
                "locale": row[2],
                "json_pointer": row[3],
                "layer": "overview",
                "section_label": "新能源市场概述",
                "leaf_label": label or f"第{int(leaf) + 1}自然段",
                "claim_kind": "scope" if leaf == "disclaimer" else "analysis",
                "claim_id": f"{row[0]}-SYNTHETIC",
                "evidence_ids": ["AAA-TEST-SOURCE"] if with_research and row[0] == "AAA" else [],
            }
        )
    review = {
        "metadata": {
            "schema_version": "navigator.market-review.v1",
            "package_id": candidate.package_id,
            "candidate_sha256": candidate.sha256,
            "country_count": len(payloads),
            "created_at": "2026-08-27",
        },
        "countries": inventory,
        "content_headers": list(verify.HEADERS),
        "content_rows": rows,
        "row_labels": labels,
        "evidence_rows": [
            {
                "country_code": "AAA",
                "country_name": "合成甲",
                "evidence_id": "AAA-TEST-SOURCE",
                "title": "合成来源记录（不是真实法规）",  # noqa: RUF001 - Chinese fixture
                "url": "https://example.invalid/synthetic-test-only",
                "locator": "仅为测试定位，不声称已读真实原文",
                "checked_on": "2026-08-27",
                "verification": "synthetic_test_only",
                "notes": "=NOT_A_FORMULA; this source cell must remain literal",
                "source_path": "synthetic-test-only/original.pdf",
                "sha256": "b" * 64,
            }
        ]
        if with_research
        else [],
        "gap_rows": [
            {
                "country_code": "AAA",
                "country_name": "合成甲",
                "claim_id": "AAA-SYNTHETIC-GAP",
                "topic": "research_gap",
                "text_zh": "合成研究缺口：仅用于独立工作表测试。",
                "text_en": "",
                "verification": "unresolved",
                "checked_on": "2026-08-27",
                "notes": "不得发布这些合成内容。",
            }
        ]
        if with_research
        else [],
        "quality": {
            "country_count": 2,
            "overview_zh_char_range": [1620, 1890],
            "synthetic": True,
        },
    }
    return candidate, review


@pytest.mark.parametrize("with_research", [True, False])
def test_overview_inventory_uses_public_schema_and_literal_import_contract(
    with_research: bool,
) -> None:
    candidate, review = synthetic_overview_review(with_research=with_research)
    before = json.dumps(review, ensure_ascii=False, sort_keys=True)
    statistics = verify.overview_statistics(review)
    assert verify.review_profile(review) == "overview"
    assert statistics["AAA"]["overview_zh_chars"] == 1890
    assert statistics["BBB"]["overview_zh_chars"] == 1620
    assert statistics["AAA"]["paragraph_count"] == 7
    assert statistics["BBB"]["paragraph_count"] == 6
    assert set(statistics) == {"AAA", "BBB"}
    replayed = apply_market_review_rows(
        candidate, review["metadata"], review["content_rows"], frozenset(statistics)
    )
    assert replayed.sha256 == candidate.sha256
    assert json.dumps(review, ensure_ascii=False, sort_keys=True) == before


def test_overview_character_count_excludes_whitespace_title_and_disclaimer() -> None:
    _, review = synthetic_overview_review()
    statistics = verify.overview_statistics(review)
    public_text = "".join(row[5] for row in review["content_rows"] if row[2] == "zh-CN")
    assert verify.character_count(public_text) > sum(
        item["overview_zh_chars"] for item in statistics.values()
    )
    assert verify.character_count("甲 \t\n\r\u0085\u00a0\u3000乙2026，") == 7
    # Supplementary characters count once in the contract, twice in Excel LEN.
    assert verify.character_count("甲😀 \n") == 2
    assert verify.excel_length("甲😀 \n", exclude_whitespace=True) == 3


def test_old_review_is_detected_for_read_only_checks_not_converted() -> None:
    review = {
        "content_rows": [
            [
                "AAA",
                "MARKET-AAA-20260827-R1",
                "zh-CN",
                "/locales/zh-CN/report/title",
                "旧稿",
                "旧稿",
            ]
        ]
    }
    original = deepcopy(review)
    assert verify.review_profile(review) == "legacy_analysis_report"
    with pytest.raises(ValueError, match="legacy reviews are read-only"):
        verify.overview_statistics(review)
    assert review == original


@pytest.mark.parametrize("pointer", ["title", "paragraphs/0", "paragraphs/7", "disclaimer"])
def test_overview_reading_view_keeps_title_paragraphs_and_disclaimer(pointer: str) -> None:
    assert verify.reading_row(
        ["AAA", "OVERVIEW-AAA-20260827-R1", "zh-CN", f"/locales/zh-CN/{pointer}", "测试", "测试"]
    )


@pytest.mark.parametrize(
    "fault",
    [
        "legacy_mixed",
        "unknown_pointer",
        "duplicate_pointer",
        "missing_paragraph",
        "paragraph_gap",
        "locale_mismatch",
        "as_of_invalid",
        "version_mismatch",
        "changed_original",
        "label_pointer",
        "label_layer",
        "label_missing",
        "count_mismatch",
        "country_count",
        "out_of_scope_source",
        "out_of_scope_gap",
        "china",
        "missing_locale",
        "paragraph_count",
        "missing_research_array",
        "headers",
        "hash",
        "too_short",
    ],
)
def test_invalid_overview_review_fails_closed(fault: str) -> None:
    _, review = synthetic_overview_review()
    row = review["content_rows"][1]
    if fault == "legacy_mixed":
        row[3] = "/locales/zh-CN/analysis/summary/market_character"
    elif fault == "unknown_pointer":
        row[3] = "/locales/zh-CN/source/url"
    elif fault == "duplicate_pointer":
        review["content_rows"].append(row.copy())
        review["row_labels"].append(review["row_labels"][1].copy())
    elif fault == "missing_paragraph":
        del review["content_rows"][1]
        del review["row_labels"][1]
    elif fault == "paragraph_gap":
        row[3] = "/locales/zh-CN/paragraphs/9"
        review["row_labels"][1]["json_pointer"] = row[3]
    elif fault == "locale_mismatch":
        row[2] = "en"
    elif fault == "as_of_invalid":
        review["countries"][0]["as_of"] = "2026-02-30"
    elif fault == "version_mismatch":
        row[1] = "OVERVIEW-AAA-20260827-R2"
    elif fault == "changed_original":
        row[5] += "预改稿"
    elif fault == "label_pointer":
        review["row_labels"][1]["json_pointer"] = "/locales/zh-CN/paragraphs/4"
    elif fault == "label_layer":
        review["row_labels"][1]["layer"] = "report"
    elif fault == "label_missing":
        review["row_labels"].pop()
    elif fault == "count_mismatch":
        review["countries"][0]["overview_zh_chars"] += 1
    elif fault == "country_count":
        review["metadata"]["country_count"] = 59
    elif fault in {"out_of_scope_source", "out_of_scope_gap"}:
        review["evidence_rows" if fault.endswith("source") else "gap_rows"][0]["country_code"] = (
            "ZZZ"
        )
    elif fault == "china":
        review["countries"][0]["code"] = "CHN"
    elif fault == "missing_locale":
        kept = [
            index
            for index, item in enumerate(review["content_rows"])
            if not (item[0] == "AAA" and item[2] == "en")
        ]
        review["content_rows"] = [review["content_rows"][index] for index in kept]
        review["row_labels"] = [review["row_labels"][index] for index in kept]
    elif fault == "paragraph_count":
        review["countries"][0]["paragraph_count"] = 8
    elif fault == "missing_research_array":
        review.pop("evidence_rows")
    elif fault == "headers":
        review["content_headers"][5] = "source"
    elif fault == "hash":
        review["metadata"]["candidate_sha256"] = "not-a-hash"
    elif fault == "too_short":
        for item in review["content_rows"]:
            if item[0] == "AAA" and item[2] == "zh-CN" and "/paragraphs/" in item[3]:
                item[4] = item[5] = "合成短段。"
        review["countries"][0]["overview_zh_chars"] = 7 * len("合成短段。")
    with pytest.raises(ValueError):
        verify.overview_statistics(review)


@pytest.mark.parametrize("case", ["with-research", "without-research"])
def test_artifact_authored_overview_round_trips_read_only(case: str) -> None:
    """Opt-in check of actual artifact-authored files, not openpyxl-authored fixtures.

    Set NAVIGATOR_OVERVIEW_WORKBOOK_QA to a temporary directory containing the
    two synthetic inputs and outputs authored by build_review_workbook.mjs.
    No workbook is created, approved, published or modified by this test.
    """
    root = os.environ.get("NAVIGATOR_OVERVIEW_WORKBOOK_QA")
    if not root:
        pytest.skip("set NAVIGATOR_OVERVIEW_WORKBOOK_QA after bundled artifact-tool QA authoring")
    review_path = Path(root) / case / "review-data.json"
    workbook_path = Path(root) / case / "review.xlsx"
    candidate, expected_review = synthetic_overview_review(with_research=case == "with-research")
    assert json.loads(review_path.read_text(encoding="utf-8")) == expected_review
    before = workbook_path.read_bytes()
    result = verify.verify(review_path, workbook_path)
    assert result["status"] == "passed", result["failures"]
    assert result["content_profile"] == "overview"
    assert result["overview_zh_chars"] == {"AAA": 1890, "BBB": 1620}
    assert result["formula_error_count"] == 0
    assert result["sheet_count"] == 7
    assert result["published"] is False
    assert result["workbook_modified"] is False
    metadata, rows = _read_workbook(before)
    replayed = apply_market_review_rows(candidate, metadata, rows, frozenset({"AAA", "BBB"}))
    assert replayed.sha256 == candidate.sha256
    assert all(verify.OVERVIEW_POINTER.fullmatch(row[3]) for row in rows)
    assert workbook_path.read_bytes() == before


def write_synthetic_inputs(root: Path) -> None:
    """Prepare new JSON-only QA inputs; actual XLSX authoring is the bundled JS tool."""
    for name in ("with-research", "without-research"):
        target = root / name
        target.mkdir(parents=True, exist_ok=False)
        _candidate, review = synthetic_overview_review(with_research=name == "with-research")
        (target / "review-data.json").write_text(
            json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
