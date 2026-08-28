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


class _Cell:
    def __init__(self, value: object) -> None:
        self.value = value
        self.data_type = "f" if isinstance(value, str) and value.startswith("=") else "s"


class _Sheet:
    def __init__(self, rows: list[list[Any]]) -> None:
        self.rows = rows

    def iter_rows(self, *, max_col: int) -> list[tuple[_Cell, ...]]:
        return [
            tuple(_Cell(value) for value in (row + [None] * max_col)[:max_col]) for row in self.rows
        ]


class _Workbook:
    def __init__(self, sheets: dict[str, list[list[Any]]]) -> None:
        self.sheets = sheets
        self.sheetnames = list(sheets)

    def __getitem__(self, name: str) -> _Sheet:
        return _Sheet(self.sheets[name])


def synthetic_extension_review() -> tuple[dict[str, Any], dict[str, Any], _Workbook]:
    """Literal-only parser stubs, never actual workbook authoring or approval."""
    _, review = synthetic_overview_review()
    review["countries"] = review["countries"][:1]
    review["content_rows"] = [row for row in review["content_rows"] if row[0] == "AAA"]
    extension = {
        "metadata": {
            "schema_version": "navigator.country-extension-review.v1",
            "extension_id": "COUNTRY-EXT-AAA-20260827-R1",
            "candidate_sha256": "b" * 64,
            "parent_seed_sha256": "c" * 64,
            "target_release_id": "BASIC61-PRIVATE-R1",
            "review_scope_country": "AAA",
            "as_of": "2026-08-27",
        },
        "headers": list(verify.EXTENSION_HEADERS),
        "rows": [["AAA", "identity", "", "/new_country/iso2", "AA", "AA", "SYNTHETIC"]],
        "source_rows": [
            {
                "id": "SYNTHETIC",
                "title": "Synthetic only",
                "url": "https://example.invalid/test-only",
                "captured_at": "2026-08-27T12:00:00.123456+08:00",
                "local_path": "raw material/synthetic.json",
                "sha256": "d" * 64,
            }
        ],
    }
    sheets = {name: [] for name in verify.SHEETS}
    sheets.update(
        {
            "新增国内容": [list(verify.EXTENSION_HEADERS), *deepcopy(extension["rows"])],
            "新增国包信息": [
                ["key", "value"],
                *[list(item) for item in extension["metadata"].items()],
            ],
            "基础数据依据": [
                list(verify.EXTENSION_SOURCE_HEADERS),
                *[
                    [
                        json.dumps(source[key], ensure_ascii=False, separators=(",", ":"))
                        if key == "captured_at"
                        else source[key]
                        for key in verify.EXTENSION_SOURCE_HEADERS
                    ]
                    for source in extension["source_rows"]
                ],
            ],
        }
    )
    return review, extension, _Workbook(sheets)


@pytest.mark.parametrize("reading_sheet", [False, True])
def test_known_extension_sheets_require_matching_frozen_metadata(reading_sheet: bool) -> None:
    review, extension, workbook = synthetic_extension_review()
    if reading_sheet:
        workbook.sheetnames.append(verify.EXTENSION_READING_SHEET)
    failures: list[str] = []
    verify.verify_sheet_inventory(review, workbook, extension, failures)
    assert failures == []
    verify.verify_sheet_inventory(review, workbook, None, failures)
    assert failures == ["extension worksheets require a frozen overview extension review"]


@pytest.mark.parametrize(
    "fault",
    [
        "unknown_sheet",
        "extra_sheet_with_reading",
        "missing_sheet",
        "base_order",
        "missing_extension_tables",
        "schema",
        "hash",
        "country",
        "date",
        "target_release",
        "extension_id",
        "metadata_original",
        "metadata_duplicate",
        "identity_changed",
        "identity_formula",
        "source_timestamp_quoted",
        "source_timestamp_raw",
        "source_timestamp_serial",
        "source_timestamp_truncated",
        "source_timestamp_timezone",
        "source_hash_changed",
        "legacy",
    ],
)
def test_unbound_extension_tables_values_and_unknown_sheets_fail_closed(fault: str) -> None:
    review, extension, workbook = synthetic_extension_review()
    if fault == "unknown_sheet":
        workbook.sheetnames.append("unreviewed")
    elif fault == "extra_sheet_with_reading":
        workbook.sheetnames.extend([verify.EXTENSION_READING_SHEET, "unreviewed"])
    elif fault == "missing_sheet":
        workbook.sheetnames.remove("基础数据依据")
    elif fault == "base_order":
        workbook.sheetnames[:2] = reversed(workbook.sheetnames[:2])
    elif fault == "missing_extension_tables":
        workbook.sheetnames = list(verify.SHEETS)
    elif fault == "schema":
        extension["metadata"]["schema_version"] = "approved"
    elif fault == "hash":
        extension["metadata"]["candidate_sha256"] = "not-a-hash"
    elif fault == "country":
        extension["metadata"]["review_scope_country"] = "BBB"
    elif fault == "date":
        extension["metadata"]["as_of"] = "2026-08-28"
    elif fault == "target_release":
        extension["metadata"]["target_release_id"] = "BASIC60-PRIVATE-R1"
    elif fault == "extension_id":
        extension["metadata"]["extension_id"] = "COUNTRY-EXT-AAA-20260827-R0"
    elif fault == "metadata_original":
        workbook.sheets["新增国包信息"][1][1] = "changed"
    elif fault == "metadata_duplicate":
        workbook.sheets["新增国包信息"].append(workbook.sheets["新增国包信息"][1])
    elif fault == "identity_changed":
        workbook.sheets["新增国内容"][1][5] = "BB"
    elif fault == "identity_formula":
        workbook.sheets["新增国内容"][1][5] = '=TEXT("AA","@")'
    elif fault == "source_timestamp_quoted":
        workbook.sheets["基础数据依据"][1][3] = "'" + workbook.sheets["基础数据依据"][1][3]
    elif fault == "source_timestamp_raw":
        workbook.sheets["基础数据依据"][1][3] = extension["source_rows"][0]["captured_at"]
    elif fault == "source_timestamp_serial":
        workbook.sheets["基础数据依据"][1][3] = 46262.1270396412
    elif fault == "source_timestamp_truncated":
        workbook.sheets["基础数据依据"][1][3] = json.dumps("2026-08-27T12:00:00+08:00")
    elif fault == "source_timestamp_timezone":
        workbook.sheets["基础数据依据"][1][3] = json.dumps("2026-08-27T12:00:00.123456")
    elif fault == "source_hash_changed":
        workbook.sheets["基础数据依据"][1][5] = "a" * 64
    elif fault == "legacy":
        for row in review["content_rows"]:
            row[3] = "/locales/zh-CN/report/title"
    failures: list[str] = []
    verify.verify_sheet_inventory(review, workbook, extension, failures)
    assert failures


def test_original_seven_sheet_inventory_remains_supported() -> None:
    _, review = synthetic_overview_review()
    workbook = _Workbook({name: [] for name in verify.SHEETS})
    failures: list[str] = []
    verify.verify_sheet_inventory(review, workbook, None, failures)
    assert failures == []


def synthetic_basic_reading() -> tuple[dict[str, Any], _Workbook, _Workbook]:
    _review, extension, _workbook = synthetic_extension_review()
    extension["rows"].append(
        [
            "AAA",
            "identity",
            "",
            "/new_country/identity/local_names",
            '["Alpha","Beta"]',
            '["Alpha","Beta"]',
            "SYNTHETIC",
        ]
    )
    for index, (code, value, unit) in enumerate(
        (
            ("population_total", "100", "COUNT"),
            ("fdi_net_inflows_usd", "-15", "USD"),
            ("gdp_growth_pct", "0", "PERCENT"),
            ("inflation_cpi_pct", "125", "PERCENT"),
            ("electricity_demand_gwh", "null", "GWH"),
        )
    ):
        fields = {
            "metric_code": code,
            "normalized_value": value,
            "period": "null" if value == "null" else "2024",
            "unit": unit,
        }
        for field, text in fields.items():
            extension["rows"].append(
                [
                    "AAA",
                    "metric",
                    "",
                    f"/new_country/metrics/{index}/{field}",
                    text,
                    text,
                    "" if value == "null" else "SYNTHETIC",
                ]
            )
    inventory = verify.extension_reading_inventory(extension)
    formula_rows = [list(verify.EXTENSION_READING_HEADERS)]
    value_rows = [list(verify.EXTENSION_READING_HEADERS)]
    for item in inventory:
        row = item["values"].copy()
        for column, formula in item["formulas"].items():
            row[ord(column) - ord("A")] = formula
        reference = f"'新增国内容'!G{row[6]}"
        row[5] = f'=IF({reference}="","",{reference})'
        formula_rows.append(row)
        value_rows.append(item["values"].copy())
    return (
        extension,
        _Workbook({verify.EXTENSION_READING_SHEET: formula_rows}),
        _Workbook({verify.EXTENSION_READING_SHEET: value_rows}),
    )


def test_basic_reading_derives_numbers_arrays_sources_and_empty_values_from_editable_cells() -> (
    None
):
    extension, formulas, values = synthetic_basic_reading()
    failures: list[str] = []
    verify.verify_extension_reading(extension, formulas, values, failures)
    assert failures == []
    rows = values.sheets[verify.EXTENSION_READING_SHEET]
    assert rows[2][3] == "Alpha；Beta"
    assert rows[3][3:5] == [100, "人"]
    assert rows[4][3] == -15
    assert rows[5][3] == 0
    assert rows[6][3] == 125
    assert rows[7][2:6] == ["—", "暂不展示", "GWh", ""]
    assert len({row[6] for row in rows[1:]}) == 7
    assert formulas.sheets[verify.EXTENSION_READING_SHEET][1][3] == "='新增国内容'!F2"


@pytest.mark.parametrize(
    "fault",
    [
        "cached_value",
        "static_duplicate",
        "wrong_fact_reference",
        "wrong_period_reference",
        "source_reference",
        "missing_source_to_zero",
        "array_not_formatted",
        "row_mapping",
        "unit",
        "missing_row",
        "duplicate_row",
        "header",
    ],
)
def test_basic_reading_rejects_unbound_values_or_changes_to_immutable_reading_map(
    fault: str,
) -> None:
    extension, formulas, values = synthetic_basic_reading()
    formula_rows = formulas.sheets[verify.EXTENSION_READING_SHEET]
    value_rows = values.sheets[verify.EXTENSION_READING_SHEET]
    if fault == "cached_value":
        value_rows[4][3] = 15
    elif fault == "static_duplicate":
        formula_rows[4][3] = value_rows[4][3]
    elif fault == "wrong_fact_reference":
        formula_rows[4][3] = "='新增国内容'!F2"
    elif fault == "wrong_period_reference":
        formula_rows[4][2] = "='新增国内容'!F2"
    elif fault == "source_reference":
        formula_rows[4][5] = "='新增国内容'!G2"
    elif fault == "missing_source_to_zero":
        formula_rows[-1][5] = f"='新增国内容'!G{formula_rows[-1][6]}"
        value_rows[-1][5] = 0
    elif fault == "array_not_formatted":
        formula_rows[2][3] = "='新增国内容'!F3"
    elif fault == "row_mapping":
        formula_rows[4][6] = value_rows[4][6] = 2
    elif fault == "unit":
        formula_rows[4][4] = value_rows[4][4] = "MW"
    elif fault == "missing_row":
        formula_rows.pop()
        value_rows.pop()
    elif fault == "duplicate_row":
        formula_rows.append(formula_rows[-1])
        value_rows.append(value_rows[-1])
    elif fault == "header":
        formula_rows[0][0] = "editable input"
    failures: list[str] = []
    verify.verify_extension_reading(extension, formulas, values, failures)
    assert failures


def test_reading_tab_may_follow_the_chinese_overview_without_reordering_existing_tabs() -> None:
    review, extension, workbook = synthetic_extension_review()
    workbook.sheetnames.insert(3, verify.EXTENSION_READING_SHEET)
    failures: list[str] = []
    verify.verify_sheet_inventory(review, workbook, extension, failures)
    assert failures == []
