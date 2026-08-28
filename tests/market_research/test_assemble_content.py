"""Author-only review packaging with synthetic fixtures; no real approvals."""

from __future__ import annotations

import copy
import csv
import json
import runpy
from pathlib import Path
from types import SimpleNamespace

import pytest
from navigator_api.market_schemas import CountryMarketOverview, overview_character_count
from navigator_data_readiness.market_content import load_market_candidate, market_review_rows

MODULE_PATH = Path(__file__).parents[2] / "scripts/market_research/assemble_content.py"
assembly = SimpleNamespace(**runpy.run_path(str(MODULE_PATH)))


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def manuscript(code: str = "IDN") -> dict:
    return {
        "schema_version": "navigator.market-overview.v1",
        "country_code": code,
        "content_version": f"OVERVIEW-{code}-20260827-R1",
        "as_of": "2026-08-27",
        "locales": {
            "zh-CN": {
                "title": "合成测试概述",
                "paragraphs": [
                    f"合成测试{index}。"
                    + "此处是测试作者提供的完整段落，不代表任何国家的真实市场条件。" * 8
                    for index in range(7)
                ],
                "disclaimer": "测试内容不能发布。",
            },
            "en": {
                "title": "Synthetic test overview",
                "paragraphs": [
                    f"Synthetic paragraph {index}. This is authored test prose, not real evidence."
                    for index in range(7)
                ],
                "disclaimer": "Test content, not for publication.",
            },
        },
    }


def research(code: str = "IDN") -> dict:
    return {
        "schema_version": assembly.RESEARCH_SCHEMA,
        "country_code": code,
        "content_version": f"OVERVIEW-{code}-20260827-R1",
        "as_of": "2026-08-27",
        "evidence": [
            {
                "id": f"{code}-SOURCE",
                "title": "Synthetic source",
                "url": "https://example.invalid/source",
                "locator": "Test page",
                "checked_on": "2026-08-27",
                "verification_scope": "Synthetic testing only.",
            }
        ],
        "facts": [
            {
                "id": f"{code}-F{index}",
                "statement": "Synthetic statement.",
                "source_ids": [f"{code}-SOURCE"],
                "commercial_implication": "Synthetic implication.",
            }
            for index in range(7)
        ],
        "paragraph_map": [
            {
                "paragraph": index + 1,
                "fact_ids": [f"{code}-F{index}"],
                "analysis_note": "Test mapping, not editorial approval.",
            }
            for index in range(7)
        ],
        "uncertainties": ["Internal-only test gap."],
    }


def fixture_repo(root: Path) -> tuple[Path, Path]:
    profiles = root / "raw material/global_sources/60_country_profiles.csv"
    profiles.parent.mkdir(parents=True)
    with profiles.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["iso3", "country_name_zh", "country_name_en"])
        writer.writeheader()
        writer.writerows(
            [
                {"iso3": code, "country_name_zh": name, "country_name_en": code}
                for code, name in [("IDN", "合成甲"), ("VNM", "合成乙"), ("CHN", "中国")]
            ]
        )
    authored = root / "runtime/market-overview/authored"
    write_json(authored / "countries/IDN.json", manuscript())
    write_json(authored / "research/IDN.json", research())
    return root, authored


def run(root: Path, authored: Path, target: Path, countries: tuple[str, ...] = ("IDN",)) -> dict:
    return assembly.assemble(
        root,
        authored,
        target,
        package_id="OVERVIEW-SYNTHETIC-R1",
        countries=countries,
        expected_scope_count=2,
    )


def test_exact_authored_prose_preserved_and_replayable(tmp_path: Path) -> None:
    root, authored = fixture_repo(tmp_path)
    before = {path: assembly.sha256(path) for path in root.rglob("*") if path.is_file()}
    target = root / "runtime/market-overview/run-a"
    result = run(root, authored, target)
    second = run(root, authored, target.with_name("run-b"))
    assert result["candidate_sha256"] == second["candidate_sha256"]
    assert not result["published"]
    assert result["status"] == "authored_sample_bundle_valid"
    assert result["input_hash_mismatches"] == []
    original = manuscript()
    assert assembly.read_json(target / "candidate/countries/IDN.json") == original
    review = assembly.read_json(target / "review-data.json")
    candidate = load_market_candidate(
        target / "candidate", root / "raw material/global_sources/60_country_profiles.csv"
    )
    assert review["content_rows"] == [list(row) for row in market_review_rows(candidate)]
    assert len(review["row_labels"]) == len(review["content_rows"]) == 18
    assert all(
        "/analysis/" not in row[3] and "/report/" not in row[3] for row in review["content_rows"]
    )
    text = (target / "reading-zh-CN.md").read_text()
    for paragraph in original["locales"]["zh-CN"]["paragraphs"]:
        assert paragraph in text
    assert "https://" not in text and "Internal-only" not in text
    assert not (root / "runtime/market-content").exists()
    assert all(assembly.sha256(path) == digest for path, digest in before.items())


def test_numeric_transcription_counts_whitespace_dates_signs_and_ranges() -> None:
    assert assembly.numeric_signature("2026年8月14日") == assembly.numeric_signature(
        "14 August 2026"
    )
    assert assembly.numeric_signature("2025—2034年，1580兆瓦") == assembly.numeric_signature(
        "2025\u20132034, 1,580 MW"
    )
    assert assembly.numeric_signature("2026-08-27") == assembly.numeric_signature("2026年8月27日")
    assert assembly.numeric_signature("-5.00%") != assembly.numeric_signature("5%")
    assert assembly.numeric_signature("1.161 MW") != assembly.numeric_signature("1,161 MW")
    assert assembly.numeric_signature("This may require review.") == {}
    assert overview_character_count("中 文\t标点，12\n") == 7


def test_complete_scope_is_a_review_bundle_not_a_publication(tmp_path: Path) -> None:
    root, authored = fixture_repo(tmp_path)
    second = manuscript("VNM")
    for locale in second["locales"].values():
        locale["paragraphs"] = [f"VNM {paragraph}" for paragraph in locale["paragraphs"]]
    write_json(authored / "countries/VNM.json", second)
    write_json(authored / "research/VNM.json", research("VNM"))
    target = root / "runtime/market-overview/full-review"
    result = run(root, authored, target, ("IDN", "VNM"))
    assert result["status"] == "authored_review_bundle_valid"
    assert result["country_count"] == 2
    assert result["published"] is False
    assert "一次确认" in result["editorial_note"]
    assert "样稿仅供文风校准" not in result["editorial_note"]
    assert not (root / "runtime/market-content").exists()


@pytest.mark.parametrize(
    "mutation",
    [
        "short",
        "missing_en",
        "old_schema",
        "list",
        "source",
        "title_source",
        "disclaimer_source",
        "number",
    ],
)
def test_no_template_padding_or_internal_leaks(tmp_path: Path, mutation: str) -> None:
    root, authored = fixture_repo(tmp_path)
    payload = manuscript()
    if mutation == "short":
        payload["locales"]["zh-CN"]["paragraphs"] = ["不足字数。"] * 7
    elif mutation == "missing_en":
        del payload["locales"]["en"]
    elif mutation == "old_schema":
        payload["schema_version"] = "navigator.market-content.v1"
    elif mutation == "list":
        payload["locales"]["zh-CN"]["paragraphs"][0] += "\n- 列表"
    elif mutation == "source":
        payload["locales"]["zh-CN"]["paragraphs"][0] += "https://example.invalid"
    elif mutation == "title_source":
        payload["locales"]["zh-CN"]["title"] += " source_ref"
    elif mutation == "disclaimer_source":
        payload["locales"]["en"]["disclaimer"] += " https://example.invalid"
    else:
        payload["locales"]["en"]["paragraphs"][0] += " In 2040."
    write_json(authored / "countries/IDN.json", payload)
    target = root / "runtime/market-overview/refused"
    with pytest.raises(ValueError):
        run(root, authored, target)
    assert not target.exists()


@pytest.mark.parametrize("countries", [(), ("CHN",), ("XXX",), ("IDN", "IDN"), ("VNM",)])
def test_country_scope_missing_and_duplicates_fail(
    tmp_path: Path, countries: tuple[str, ...]
) -> None:
    root, authored = fixture_repo(tmp_path)
    with pytest.raises((ValueError, FileNotFoundError)):
        run(root, authored, root / "runtime/market-overview/refused", countries)


@pytest.mark.parametrize(
    "kind", ["fact_count", "orphan_source", "orphan_fact", "mapping", "future"]
)
def test_research_references_are_required(tmp_path: Path, kind: str) -> None:
    root, _authored = fixture_repo(tmp_path)
    private = research()
    if kind == "fact_count":
        private["facts"] = private["facts"][:5]
    elif kind == "orphan_source":
        private["facts"][0]["source_ids"] = ["MISSING"]
    elif kind == "orphan_fact":
        private["paragraph_map"][0]["fact_ids"] = ["MISSING"]
    elif kind == "mapping":
        private["paragraph_map"][0]["paragraph"] = 2
    else:
        private["evidence"][0]["checked_on"] = "2026-08-28"
    with pytest.raises(ValueError):
        assembly.validate_research(
            private, CountryMarketOverview.model_validate(manuscript()), root
        )


def test_duplicate_paragraphs_across_countries_are_rejected(tmp_path: Path) -> None:
    root, authored = fixture_repo(tmp_path)
    write_json(authored / "countries/VNM.json", manuscript("VNM"))
    write_json(authored / "research/VNM.json", research("VNM"))
    with pytest.raises(ValueError, match="duplicate authored paragraph"):
        run(root, authored, root / "runtime/market-overview/refused", ("IDN", "VNM"))


def test_no_overwrite_output_escape_or_author_input_overlap(tmp_path: Path) -> None:
    root, authored = fixture_repo(tmp_path)
    target = root / "runtime/market-overview/run-a"
    run(root, authored, target)
    before = assembly.sha256(target / "review-data.json")
    with pytest.raises(FileExistsError, match="overwrite"):
        run(root, authored, target)
    assert before == assembly.sha256(target / "review-data.json")
    with pytest.raises(ValueError, match="within runtime"):
        run(root, authored, root / "raw material/refused")
    with pytest.raises(ValueError, match="disjoint"):
        run(root, authored, authored / "refused")
    assert not (authored / "refused").exists()


def test_original_hash_and_symlink_protection(tmp_path: Path) -> None:
    root, authored = fixture_repo(tmp_path)
    original = root / "raw material/synthetic.txt"
    original.write_text("SYNTHETIC ORIGINAL", encoding="utf-8")
    private = research()
    private["evidence"][0].update(
        {
            "local_path": "raw material/synthetic.txt",
            "local_sha256": assembly.sha256(original),
        }
    )
    assembly.validate_research(private, CountryMarketOverview.model_validate(manuscript()), root)
    broken = copy.deepcopy(private)
    broken["evidence"][0]["local_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="source hash"):
        assembly.validate_research(broken, CountryMarketOverview.model_validate(manuscript()), root)
    link = root / "runtime/market-overview/link"
    link.symlink_to(authored, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic links"):
        run(root, link, root / "runtime/market-overview/refused")


def test_atomic_publish_race_preserves_competing_directory(tmp_path: Path) -> None:
    root, authored = fixture_repo(tmp_path)
    target = root / "runtime/market-overview/race"
    original_publish = assembly.assemble.__globals__["_publish_directory"]

    def race(staging: Path, output: Path) -> None:
        output.mkdir()
        (output / "sentinel").write_text("OTHER WRITER", encoding="utf-8")
        original_publish(staging, output)

    assembly.assemble.__globals__["_publish_directory"] = race
    try:
        with pytest.raises(ValueError, match="exists"):
            run(root, authored, target)
    finally:
        assembly.assemble.__globals__["_publish_directory"] = original_publish
    assert (target / "sentinel").read_text() == "OTHER WRITER"
    assert not list(target.parent.glob(".overview-assembling-*"))


def test_digest_binds_exact_parsed_bytes_when_author_edits_concurrently(tmp_path: Path) -> None:
    root, authored = fixture_repo(tmp_path)
    original_read = assembly.assemble.__globals__["_read_input"]
    path = authored / "countries/IDN.json"

    def race(source: Path, repo: Path, fingerprints: dict[str, str]) -> bytes:
        payload = original_read(source, repo, fingerprints)
        if source == path:
            changed = json.loads(payload)
            changed["locales"]["zh-CN"]["title"] = "并发修改标题"
            write_json(source, changed)
        return payload

    assembly.assemble.__globals__["_read_input"] = race
    target = root / "runtime/market-overview/race-input"
    try:
        with pytest.raises(ValueError, match="inputs changed"):
            run(root, authored, target)
    finally:
        assembly.assemble.__globals__["_read_input"] = original_read
    assert not target.exists()
    assert not list(target.parent.glob(".overview-assembling-*"))
