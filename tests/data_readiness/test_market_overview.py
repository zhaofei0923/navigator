"""Synthetic tests for the single-overview contract and retired archive boundary."""

from __future__ import annotations

import copy
import sys
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from navigator_api.market_schemas import (
    CountryMarketContent,
    CountryMarketOverview,
    overview_character_count,
)
from navigator_api.market_storage import (
    MarketContentError,
    MarketContentUnavailable,
    load_published_version,
    read_active_market_content,
)
from navigator_data_readiness import market_content as lifecycle
from pydantic import ValidationError

sys.path.append(str(Path(__file__).resolve().parents[2]))

from tests.api.market_fixture import (
    candidate_files,
    legacy_content,
    review_metadata,
    reviewed_fixture,
    synthetic_content,
    write_json,
    write_legacy_published,
)


def _sized_overview(length: int, paragraph_count: int = 7) -> dict[str, Any]:
    payload = synthetic_content()
    prose = "".join(payload["locales"]["zh-CN"]["paragraphs"])
    # Synthetic boundary padding, not country facts or published text.
    prose = (prose + "合成边界测试。" * length)[:length]
    width, remainder = divmod(length, paragraph_count)
    paragraphs = []
    start = 0
    for index in range(paragraph_count):
        stop = start + width + (1 if index < remainder else 0)
        paragraphs.append(prose[start:stop])
        start = stop
    payload["locales"]["zh-CN"]["paragraphs"] = paragraphs
    payload["locales"]["en"]["paragraphs"] = [
        f"Synthetic English boundary paragraph {index + 1}, not real market advice."
        for index in range(paragraph_count)
    ]
    return payload


@pytest.mark.parametrize("length", [1500, 1501, 1763, 1999, 2000])
@pytest.mark.parametrize("paragraph_count", [6, 7, 8])
def test_chinese_body_length_and_paragraph_bounds_are_inclusive(
    length: int, paragraph_count: int
) -> None:
    payload = _sized_overview(length, paragraph_count)
    content = CountryMarketOverview.model_validate(payload)
    assert overview_character_count("".join(content.locales["zh-CN"].paragraphs)) == length
    assert content.model_dump(mode="json") == payload


@pytest.mark.parametrize("length", [0, 1499, 2001, 3000])
def test_chinese_body_outside_length_range_is_rejected(length: int) -> None:
    with pytest.raises(ValidationError):
        CountryMarketOverview.model_validate(_sized_overview(length))


def test_unicode_count_preserves_punctuation_numbers_and_code_points() -> None:
    text = " 中\t文\n2024，。🙂\u3000\u00a0\u001c\r "
    assert overview_character_count(text) == 9
    assert overview_character_count("\ufeff") == 1
    payload = _sized_overview(1500)
    original = payload["locales"]["zh-CN"]["paragraphs"][0]
    payload["locales"]["zh-CN"]["paragraphs"][0] = f" \n{original}\t\u3000"
    validated = CountryMarketOverview.model_validate(payload)
    assert validated.model_dump(mode="json") == payload


def test_title_disclaimer_and_english_do_not_pad_chinese_body_count() -> None:
    payload = _sized_overview(1499)
    payload["locales"]["zh-CN"]["title"] = "标题" * 1000
    payload["locales"]["zh-CN"]["disclaimer"] = "免责声明" * 1000
    payload["locales"]["en"]["paragraphs"] = ["English body. " * 200] * 7
    with pytest.raises(ValidationError, match="1500 to 2000"):
        CountryMarketOverview.model_validate(payload)


@pytest.mark.parametrize(
    "mutation",
    [
        "old_schema",
        "old_prefix",
        "china",
        "invalid_country",
        "wrong_country_version",
        "invalid_version_date",
        "zero_revision",
        "extra_locale",
        "missing_locale",
        "unequal_paragraph_counts",
        "too_few_paragraphs",
        "too_many_paragraphs",
        "blank_paragraph",
        "non_text_paragraph",
        "blank_title",
        "blank_disclaimer",
        "source_field",
        "old_sections",
        "old_ratings",
        "old_report",
        "private_evidence",
        "datetime_as_of",
        "invalid_as_of",
        "as_of_after_version",
    ],
)
def test_overview_rejects_legacy_incomplete_and_private_contracts(mutation: str) -> None:
    payload = synthetic_content()
    zh = payload["locales"]["zh-CN"]
    if mutation == "old_schema":
        payload["schema_version"] = "navigator.market-content.v1"
    elif mutation == "old_prefix":
        payload["content_version"] = "MARKET-IDN-20260827-R1"
    elif mutation == "china":
        payload["country_code"] = "CHN"
        payload["content_version"] = "OVERVIEW-CHN-20260827-R1"
    elif mutation == "invalid_country":
        payload["country_code"] = "idn"
    elif mutation == "wrong_country_version":
        payload["content_version"] = "OVERVIEW-ZAF-20260827-R1"
    elif mutation == "invalid_version_date":
        payload["content_version"] = "OVERVIEW-IDN-20260230-R1"
    elif mutation == "zero_revision":
        payload["content_version"] = "OVERVIEW-IDN-20260827-R0"
    elif mutation == "extra_locale":
        payload["locales"]["fr"] = copy.deepcopy(payload["locales"]["en"])
    elif mutation == "missing_locale":
        del payload["locales"]["en"]
    elif mutation == "unequal_paragraph_counts":
        payload["locales"]["en"]["paragraphs"].pop()
    elif mutation == "too_few_paragraphs":
        zh["paragraphs"] = zh["paragraphs"][:5]
    elif mutation == "too_many_paragraphs":
        zh["paragraphs"].extend(zh["paragraphs"][:2])
    elif mutation == "blank_paragraph":
        zh["paragraphs"][0] = " \n\t\u3000 "
    elif mutation == "non_text_paragraph":
        zh["paragraphs"][0] = 2024
    elif mutation == "blank_title":
        zh["title"] = " "
    elif mutation == "blank_disclaimer":
        zh["disclaimer"] = " "
    elif mutation == "source_field":
        zh["source_ref"] = "internal-source"
    elif mutation == "old_sections":
        zh["sections"] = [{"id": "overview", "paragraphs": ["retired"]}]
    elif mutation == "old_ratings":
        zh["entry_assessments"] = [{"level": "low"}]
    elif mutation == "old_report":
        zh["report"] = {"title": "retired"}
    elif mutation == "private_evidence":
        payload["evidence"] = {"private_path": "not-public"}
    elif mutation == "datetime_as_of":
        payload["as_of"] = "2026-08-27T00:00:00+08:00"
    elif mutation == "invalid_as_of":
        payload["as_of"] = "2026-02-30"
    elif mutation == "as_of_after_version":
        payload["as_of"] = "2026-08-28"
    with pytest.raises(ValidationError):
        CountryMarketOverview.model_validate(payload)


def test_as_of_can_precede_version_and_accepts_typed_calendar_date() -> None:
    payload = synthetic_content()
    payload["as_of"] = date(2026, 8, 20)
    assert CountryMarketOverview.model_validate(payload).as_of == date(2026, 8, 20)


def test_review_inventory_contains_only_the_new_overview_leaf_paths(tmp_path: Path) -> None:
    source, profiles = candidate_files(tmp_path / "candidate", ("IDN",))
    candidate = lifecycle.load_market_candidate(source, profiles)
    rows = lifecycle.market_review_rows(candidate)
    assert len(rows) == 18
    expected = {
        f"/locales/{locale}/{leaf}"
        for locale in ("zh-CN", "en")
        for leaf in ("title", "disclaimer", *(f"paragraphs/{index}" for index in range(7)))
    }
    assert {row[3] for row in rows} == expected
    assert all(row[4] == row[5] for row in rows)
    assert all(lifecycle._EDITABLE.fullmatch(row[3]) for row in rows)


def test_review_revalidates_total_body_length_after_literal_edits(tmp_path: Path) -> None:
    source, profiles = candidate_files(tmp_path / "candidate", ("IDN",))
    candidate = lifecycle.load_market_candidate(source, profiles)
    rows = [list(row) for row in lifecycle.market_review_rows(candidate)]
    for row in rows:
        if str(row[3]).startswith("/locales/zh-CN/paragraphs/"):
            row[5] = "过短的合成测试文本。"
    with pytest.raises(MarketContentError, match="market-overview schema"):
        lifecycle.apply_market_review_rows(
            candidate, review_metadata(candidate), rows, frozenset({"IDN"})
        )


def test_new_candidate_does_not_convert_or_modify_retired_analysis_report(tmp_path: Path) -> None:
    source, profiles = candidate_files(tmp_path / "candidate", ("IDN",))
    country_file = source / "countries" / "IDN.json"
    write_json(country_file, legacy_content())
    before = country_file.read_bytes()
    with pytest.raises(MarketContentError, match="market-overview schema"):
        lifecycle.load_market_candidate(source, profiles)
    assert country_file.read_bytes() == before


def test_legacy_archives_are_readable_internally_but_not_public_or_rollback_targets(
    tmp_path: Path,
) -> None:
    root = tmp_path / "legacy-store"
    version = write_legacy_published(root)
    before = (root / "current.json").read_bytes()
    assert isinstance(load_published_version(root, version), CountryMarketContent)
    with pytest.raises(MarketContentUnavailable, match="retired"):
        read_active_market_content(root, "IDN")
    with pytest.raises(MarketContentError, match="retired"):
        lifecycle.rollback_market_content(
            content_root=root,
            country_code="IDN",
            content_version=version,
            actor="test-only",
            reason="synthetic forbidden legacy rollback",
            repo_root=tmp_path / "repository",
        )
    assert (root / "current.json").read_bytes() == before


def test_new_overview_can_replace_but_never_rewrite_or_restore_legacy_content(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "published"
    legacy_version = write_legacy_published(root)
    historical_bytes = {
        path: path.read_bytes()
        for path in root.rglob("*")
        if path.is_file() and path.name != "current.json"
    }
    review = reviewed_fixture(tmp_path, monkeypatch, codes=("IDN",))
    review.publish(root)
    assert read_active_market_content(root, "IDN").content_version == "OVERVIEW-IDN-20260827-R1"
    assert historical_bytes == {path: path.read_bytes() for path in historical_bytes}
    pointer = (root / "current.json").read_bytes()
    with pytest.raises(MarketContentError, match="retired"):
        lifecycle.rollback_market_content(
            content_root=root,
            country_code="IDN",
            content_version=legacy_version,
            actor="test-only",
            reason="synthetic old-body fallback is forbidden",
            repo_root=review.repo_root,
        )
    assert (root / "current.json").read_bytes() == pointer
    lifecycle.revoke_market_content(
        content_root=root,
        country_code="IDN",
        content_version=legacy_version,
        actor="test-only",
        reason="synthetic withdrawal of archived legacy content",
        repo_root=review.repo_root,
    )
    assert read_active_market_content(root, "IDN").content_version.startswith("OVERVIEW-")
    with pytest.raises(MarketContentUnavailable, match="revoked"):
        load_published_version(root, legacy_version)
