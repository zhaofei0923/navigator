"""Synthetic-only validation, review import and immutable content lifecycle tests."""

from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from navigator_api.market_schemas import CountryMarketContent
from navigator_api.market_storage import (
    MarketContentError,
    MarketContentUnavailable,
    canonical_bytes,
    content_sha256,
    load_market_state,
    read_active_market_content,
    read_json,
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
)


def test_legacy_archive_schema_preserves_text_and_supports_empty_risks_gaps() -> None:
    payload = legacy_content()
    for localized in payload["locales"].values():
        localized["analysis"]["risks"] = []
    payload["locales"]["en"]["analysis"]["gaps"] = []
    payload["locales"]["zh-CN"]["report"]["introduction"] = "  第一行\n第二行  "
    assert CountryMarketContent.model_validate(payload).model_dump(mode="json") == payload


@pytest.mark.parametrize(
    "mutation",
    [
        "china",
        "wrong_country_version",
        "invalid_version_date",
        "missing_locale",
        "extra_locale",
        "missing_section",
        "duplicate_section",
        "unknown_section",
        "missing_entry",
        "duplicate_entry",
        "unknown_business",
        "unknown_technology",
        "unknown_level",
        "invalid_risk_level",
        "empty_risk_scope",
        "duplicate_scope",
        "duplicate_risk_id",
        "duplicate_chapter",
        "empty_report",
        "blank_paragraph",
        "number_as_text",
        "blank_title",
        "source_field",
        "datetime_as_of",
        "invalid_as_of",
        "future_verified_on",
        "datetime_verified_on",
        "invalid_verified_on",
        "private_evidence",
    ],
)
def test_schema_rejects_incomplete_or_private_content(mutation: str) -> None:
    payload = legacy_content()
    analysis = payload["locales"]["zh-CN"]["analysis"]
    report = payload["locales"]["zh-CN"]["report"]
    if mutation == "china":
        payload["country_code"] = "CHN"
        payload["content_version"] = "MARKET-CHN-20260827-R1"
    elif mutation == "wrong_country_version":
        payload["content_version"] = "MARKET-ZAF-20260827-R1"
    elif mutation == "invalid_version_date":
        payload["content_version"] = "MARKET-IDN-20260230-R1"
    elif mutation == "missing_locale":
        del payload["locales"]["en"]
    elif mutation == "extra_locale":
        payload["locales"]["fr"] = copy.deepcopy(payload["locales"]["en"])
    elif mutation == "missing_section":
        analysis["sections"].pop()
    elif mutation == "duplicate_section":
        analysis["sections"][1] = copy.deepcopy(analysis["sections"][0])
    elif mutation == "unknown_section":
        analysis["sections"][0]["id"] = "extra_policy"
    elif mutation == "missing_entry":
        analysis["entry_assessments"].pop()
    elif mutation == "duplicate_entry":
        analysis["entry_assessments"][1] = copy.deepcopy(analysis["entry_assessments"][0])
    elif mutation in {"unknown_business", "unknown_technology", "unknown_level"}:
        analysis["entry_assessments"][0][mutation.removeprefix("unknown_")] = "invented"
    elif mutation == "invalid_risk_level":
        analysis["risks"][0]["level"] = "excellent"
    elif mutation == "empty_risk_scope":
        analysis["risks"][0]["businesses"] = []
    elif mutation == "duplicate_scope":
        analysis["risks"][0]["technologies"] = ["wind", "wind"]
    elif mutation == "duplicate_risk_id":
        analysis["risks"].append(copy.deepcopy(analysis["risks"][0]))
    elif mutation == "duplicate_chapter":
        report["chapters"].append(copy.deepcopy(report["chapters"][0]))
    elif mutation == "empty_report":
        report["chapters"] = []
    elif mutation == "blank_paragraph":
        analysis["sections"][0]["paragraphs"] = ["  \n "]
    elif mutation == "number_as_text":
        report["introduction"] = 123
    elif mutation == "blank_title":
        report["title"] = " "
    elif mutation == "source_field":
        analysis["source_ref"] = "internal-source-not-public"
    elif mutation == "datetime_as_of":
        payload["as_of"] = "2026-08-27T00:00:00+08:00"
    elif mutation == "invalid_as_of":
        payload["as_of"] = "2026-02-30"
    elif mutation == "future_verified_on":
        analysis["entry_assessments"][0]["verified_on"] = "2026-08-28"
    elif mutation == "datetime_verified_on":
        analysis["risks"][0]["verified_on"] = "2026-08-27T00:00:00Z"
    elif mutation == "invalid_verified_on":
        analysis["risks"][0]["verified_on"] = "2026-02-30"
    elif mutation == "private_evidence":
        payload["evidence"] = [{"url": "https://invalid.example/synthetic"}]
    with pytest.raises(ValidationError):
        CountryMarketContent.model_validate(payload)


def test_batch_digest_is_canonical_sorted_and_does_not_modify_source(tmp_path: Path) -> None:
    source, profiles = candidate_files(tmp_path / "candidate", ("ZAF", "IDN"))
    before = {path: path.read_bytes() for path in source.rglob("*.json")}
    candidate = lifecycle.load_market_candidate(source, profiles)
    expected = {
        "schema_version": lifecycle.CANDIDATE_SCHEMA,
        "package_id": "SYNTHETIC-MARKET-R1",
        "countries": [synthetic_content("IDN"), synthetic_content("ZAF")],
    }
    assert candidate.payload() == expected
    encoded = json.dumps(
        expected, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()
    assert candidate.sha256 == hashlib.sha256(encoded).hexdigest()
    result = lifecycle.validate_market_content(source, profiles)
    assert result["published"] is False
    assert result["countries"] == ["IDN", "ZAF"]
    assert before == {path: path.read_bytes() for path in source.rglob("*.json")}


@pytest.mark.parametrize(
    "case",
    [
        "unsupported",
        "china",
        "bad_filename",
        "wrong_filename",
        "source_extra",
        "duplicate_profile",
        "empty",
    ],
)
def test_candidate_scope_and_file_contract(tmp_path: Path, case: str) -> None:
    source, profiles = candidate_files(tmp_path / "candidate", ("IDN",))
    if case in {"unsupported", "china"}:
        code = "ZZZ" if case == "unsupported" else "CHN"
        write_json(source / "countries" / f"{code}.json", synthetic_content(code))
    elif case == "bad_filename":
        write_json(source / "countries" / "evidence.json", {})
    elif case == "wrong_filename":
        write_json(source / "countries" / "ZAF.json", synthetic_content("IDN"))
    elif case == "source_extra":
        write_json(
            source / "package.json",
            {"schema_version": lifecycle.CANDIDATE_SCHEMA, "package_id": "TEST", "approval": True},
        )
    elif case == "duplicate_profile":
        profiles.write_text("iso3\nIDN\nIDN\n", encoding="utf-8")
    elif case == "empty":
        (source / "countries" / "IDN.json").unlink()
    with pytest.raises(MarketContentError):
        lifecycle.load_market_candidate(source, profiles)


def test_excel_edits_preserve_newlines_and_do_not_mutate_candidate(tmp_path: Path) -> None:
    source, profiles = candidate_files(tmp_path / "candidate", ("IDN",))
    candidate = lifecycle.load_market_candidate(source, profiles)
    original = candidate.payload()
    rows = [list(row) for row in lifecycle.market_review_rows(candidate)]
    edits = {
        "/locales/zh-CN/title": "  人工调整\n保留换行  ",
        "/locales/en/paragraphs/0": "Edited synthetic paragraph, still not real country advice.",
        "/locales/zh-CN/disclaimer": "人工修改的合成测试免责声明。",
    }
    for row in rows:
        if row[3] in edits:
            row[5] = edits[row[3]]
    revised = lifecycle.apply_market_review_rows(
        candidate, review_metadata(candidate), rows, frozenset({"IDN"})
    )
    assert revised.countries[0].locales["zh-CN"].title == "  人工调整\n保留换行  "
    assert revised.countries[0].locales["en"].paragraphs[0] == edits["/locales/en/paragraphs/0"]
    assert revised.countries[0].locales["zh-CN"].disclaimer == edits["/locales/zh-CN/disclaimer"]
    assert revised.sha256 != candidate.sha256
    assert candidate.payload() == original


@pytest.mark.parametrize(
    "case",
    [
        "wrong_package",
        "wrong_hash",
        "wrong_count",
        "bad_created",
        "original",
        "pointer",
        "duplicate",
        "deleted",
        "country",
        "locale",
        "version",
        "structural_id",
        "business",
        "technology",
        "scope",
        "empty",
        "number",
        "invalid_level",
        "invalid_date",
        "short_row",
        "noncanonical_index",
        "wrong_locale_pointer",
    ],
)
def test_review_fails_closed_on_tampering_or_incomplete_edits(tmp_path: Path, case: str) -> None:
    source, profiles = candidate_files(tmp_path / "candidate", ("IDN",))
    candidate = lifecycle.load_market_candidate(source, profiles)
    metadata = review_metadata(candidate)
    rows: list[list[object]] = [list(row) for row in lifecycle.market_review_rows(candidate)]
    if case == "wrong_package":
        metadata["package_id"] = "OTHER"
    elif case == "wrong_hash":
        metadata["candidate_sha256"] = "a" * 64
    elif case == "wrong_count":
        metadata["country_count"] = 2
    elif case == "bad_created":
        metadata["created_at"] = "2026-02-30"
    elif case == "original":
        rows[0][4] = "changed original"
    elif case == "pointer":
        rows[0][3] = "/locales/zh-CN/evidence/0"
    elif case == "duplicate":
        rows.append(list(rows[0]))
    elif case == "deleted":
        rows.pop()
    elif case in {"country", "version", "locale"}:
        rows[0][{"country": 0, "version": 1, "locale": 2}[case]] = "changed"
    elif case in {
        "structural_id",
        "business",
        "technology",
        "scope",
        "invalid_level",
        "invalid_date",
    }:
        suffix = {
            "structural_id": "/sections/0/id",
            "business": "/entry_assessments/0/business",
            "technology": "/entry_assessments/0/technology",
            "scope": "/risks/0/businesses/0",
            "invalid_level": "/entry_assessments/0/level",
            "invalid_date": "/entry_assessments/0/verified_on",
        }[case]
        rows[0][3] = f"/locales/zh-CN/analysis{suffix}"
        rows[0][5] = "wrong"
    elif case == "empty":
        rows[0][5] = ""
    elif case == "number":
        rows[0][5] = 42
    elif case == "short_row":
        rows[0].pop()
    elif case == "noncanonical_index":
        row = next(row for row in rows if str(row[3]).endswith("/paragraphs/0"))
        row[3] = str(row[3]).replace("/paragraphs/0", "/paragraphs/00")
    elif case == "wrong_locale_pointer":
        rows[0][3] = str(rows[0][3]).replace("/zh-CN/", "/en/")
    with pytest.raises(MarketContentError):
        lifecycle.apply_market_review_rows(candidate, metadata, rows, frozenset({"IDN"}))


class _Sheet:
    def __init__(self, rows: list[list[object]], formula: bool = False) -> None:
        self.rows = rows
        self.max_row = len(rows)
        self.formula = formula

    def iter_rows(self, max_col: int) -> Any:
        for index, row in enumerate(self.rows):
            yield tuple(
                SimpleNamespace(value=value, data_type="f" if self.formula and index else "s")
                for value in (row + [None] * max_col)[:max_col]
            )


class _Workbook:
    def __init__(self, sheets: dict[str, _Sheet]) -> None:
        self.sheets = sheets
        self.sheetnames = list(sheets)
        self.closed = False

    def __getitem__(self, name: str) -> _Sheet:
        return self.sheets[name]

    def close(self) -> None:
        self.closed = True


@pytest.mark.parametrize(
    "case",
    [
        "valid",
        "extra_columns",
        "missing_sheet",
        "headers",
        "metadata_headers",
        "duplicate_metadata",
        "formula",
        "error",
        "oversized",
    ],
)
def test_xlsx_boundary_is_read_only_and_validates_headers(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    meta = _Sheet([["key", "value"], ["schema_version", lifecycle.REVIEW_SCHEMA]])
    edit = _Sheet([list(lifecycle.EDIT_HEADERS), ["IDN", "V1", "zh-CN", "/x", "old", "new"]])
    workbook = _Workbook({"包信息": meta, "内容编辑": edit})
    if case == "extra_columns":
        edit.rows[0].append("可读标题")
        edit.rows[1].append("informational")
    elif case == "missing_sheet":
        workbook.sheetnames.remove("内容编辑")
    elif case == "headers":
        edit.rows[0][5] = "new_value"
    elif case == "metadata_headers":
        meta.rows[0][0] = "wrong"
    elif case == "duplicate_metadata":
        meta.rows.append(["schema_version", lifecycle.REVIEW_SCHEMA])
    elif case in {"formula", "error"}:
        edit.formula = True
    elif case == "oversized":
        edit.max_row = lifecycle.MAX_REVIEW_ROWS + 2

    def load(payload: object, **kwargs: object) -> _Workbook:
        assert kwargs == {"read_only": True, "data_only": False, "keep_links": False}
        return workbook

    monkeypatch.setattr(lifecycle.openpyxl, "load_workbook", load)
    if case in {"valid", "extra_columns"}:
        metadata, rows = lifecycle._read_workbook(b"synthetic boundary fixture")
        assert metadata == {"schema_version": lifecycle.REVIEW_SCHEMA}
        assert rows == [("IDN", "V1", "zh-CN", "/x", "old", "new")]
    else:
        with pytest.raises(MarketContentError):
            lifecycle._read_workbook(b"synthetic boundary fixture")
    assert workbook.closed


def test_import_creates_new_receipt_and_preserves_workbook(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = reviewed_fixture(
        tmp_path,
        monkeypatch,
        edits={
            "/locales/zh-CN/title": "人工审核修改的合成文本\n第二行",
        },
    )
    imported = lifecycle.load_market_candidate(fixture.candidate_dir, fixture.profiles_path)
    receipt = read_json(fixture.candidate_dir / "review-import.json")
    assert imported.sha256 != fixture.candidate.sha256
    assert receipt["candidate_sha256"] == imported.sha256
    assert receipt["source_candidate_sha256"] == fixture.candidate.sha256
    assert (
        receipt["workbook_sha256"] == hashlib.sha256(fixture.workbook_path.read_bytes()).hexdigest()
    )
    assert "approved_by" not in receipt and "decision" not in receipt
    with pytest.raises(MarketContentError, match="new directory"):
        lifecycle.import_market_review(
            candidate_dir=fixture.source_dir,
            workbook_path=fixture.workbook_path,
            output_dir=fixture.candidate_dir,
            profiles_path=fixture.profiles_path,
            repo_root=fixture.repo_root,
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("decision", "pending"),
        ("approved_by", "automatic"),
        ("approved_at", "2026-08-27T12:00:00"),
        ("workbook_sha256", "a" * 64),
        ("candidate_sha256", "b" * 64),
        ("package_id", "UNRELATED"),
        ("schema_version", "old"),
        ("extra", "not allowed"),
    ],
)
def test_publish_requires_exact_single_actual_confirmation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, field: str, value: str
) -> None:
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    confirmation = read_json(fixture.confirmation_path)
    confirmation[field] = value
    write_json(fixture.confirmation_path, confirmation)
    root = tmp_path / "published"
    with pytest.raises(MarketContentError):
        fixture.publish(root)
    assert not root.exists()


def test_publication_is_atomic_idempotent_and_binds_bilingual_overviews(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    root = tmp_path / "published"
    with pytest.raises(MarketContentUnavailable):
        read_active_market_content(root, "IDN")
    result = fixture.publish(root)
    pointer = (root / "current.json").read_bytes()
    result2 = fixture.publish(root)
    assert result2 == result
    assert (root / "current.json").read_bytes() == pointer
    content = read_active_market_content(root, "IDN")
    assert content.content_version == "OVERVIEW-IDN-20260827-R1"
    assert content.locales["en"] == fixture.candidate.countries[0].locales["en"]
    assert content.locales["zh-CN"] == fixture.candidate.countries[0].locales["zh-CN"]
    assert len(list((root / "objects").glob("*.json"))) == 2
    assert len(list((root / "manifests").glob("*.json"))) == 1
    assert len(list((root / "reviews").glob("*.xlsx"))) == 1


def test_failed_batch_keeps_previous_snapshot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "published"
    first = reviewed_fixture(tmp_path, monkeypatch)
    first.publish(root)
    before = (root / "current.json").read_bytes()
    next_review = reviewed_fixture(tmp_path, monkeypatch, revision=2)
    writer = lifecycle._immutable_bytes

    def fail_on_second_release(path: Path, data: bytes) -> None:
        if path.name == "OVERVIEW-ZAF-20260827-R2.json":
            raise OSError("synthetic disk failure")
        writer(path, data)

    monkeypatch.setattr(lifecycle, "_immutable_bytes", fail_on_second_release)
    with pytest.raises(OSError, match="synthetic disk failure"):
        next_review.publish(root)
    assert (root / "current.json").read_bytes() == before
    for code in ("IDN", "ZAF"):
        assert read_active_market_content(root, code).content_version.endswith("R1")
    assert not (root / ".publish.lock").exists()


def test_partial_update_rollback_and_revocation_preserve_history(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "published"
    first = reviewed_fixture(tmp_path, monkeypatch)
    first.publish(root)
    first_pointer = (root / "current.json").read_bytes()
    next_review = reviewed_fixture(tmp_path, monkeypatch, revision=2, codes=("IDN",))
    next_review.publish(root)
    assert read_active_market_content(root, "ZAF").content_version.endswith("R1")
    assert read_active_market_content(root, "IDN").content_version.endswith("R2")
    lifecycle.rollback_market_content(
        content_root=root,
        country_code="IDN",
        content_version="OVERVIEW-IDN-20260827-R1",
        reason="synthetic rollback",
        actor="test-operator",
        repo_root=first.repo_root,
    )
    assert read_active_market_content(root, "IDN").content_version.endswith("R1")
    lifecycle.revoke_market_content(
        content_root=root,
        country_code="IDN",
        reason="synthetic withdrawal",
        actor="test-operator",
        repo_root=first.repo_root,
    )
    with pytest.raises(MarketContentUnavailable):
        read_active_market_content(root, "IDN")
    assert read_active_market_content(root, "ZAF").content_version.endswith("R1")
    assert len(list((root / "objects").glob("*.json"))) == 3
    assert len(list((root / "manifests").glob("*.json"))) == 4
    # Rewinding a copied pointer cannot revive a revoked release.
    (root / "current.json").write_bytes(first_pointer)
    with pytest.raises(MarketContentUnavailable):
        read_active_market_content(root, "IDN")
    with pytest.raises(MarketContentError, match="revoked"):
        lifecycle.rollback_market_content(
            content_root=root,
            country_code="IDN",
            content_version="OVERVIEW-IDN-20260827-R1",
            reason="synthetic bad rollback",
            actor="test-operator",
            repo_root=first.repo_root,
        )


def test_version_cannot_be_changed_or_revived(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    root = tmp_path / "published"
    fixture.publish(root)
    pointer = (root / "current.json").read_bytes()
    country_file = fixture.candidate_dir / "countries" / "IDN.json"
    country = read_json(country_file)
    country["locales"]["en"]["title"] = "changed synthetic text"
    country_file.chmod(0o644)
    write_json(country_file, country)
    revised = lifecycle.load_market_candidate(fixture.candidate_dir, fixture.profiles_path)
    for path in (fixture.confirmation_path, fixture.candidate_dir / "review-import.json"):
        data = read_json(path)
        data["candidate_sha256"] = revised.sha256
        path.chmod(0o644)
        write_json(path, data)
    with pytest.raises(MarketContentError, match="cannot be rebound"):
        fixture.publish(root)
    assert (root / "current.json").read_bytes() == pointer


def test_hash_and_confirmation_membership_detect_tampering(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    root = tmp_path / "published"
    fixture.publish(root)
    release_path = root / "releases" / "OVERVIEW-IDN-20260827-R1.json"
    release = read_json(release_path)
    forged = synthetic_content()
    forged["locales"]["en"]["title"] = "unreviewed synthetic addition"
    forged_hash = content_sha256(forged)
    (root / "objects" / f"{forged_hash}.json").write_bytes(canonical_bytes(forged))
    release["object_sha256"] = forged_hash
    release_path.chmod(0o644)
    write_json(release_path, release)
    with pytest.raises(MarketContentError, match="human-confirmed batch"):
        read_active_market_content(root, "IDN")


@pytest.mark.parametrize(
    "target",
    [
        "doc",
        "data",
        "raw material",
        "apps/web/public",
        "runtime/basic60",
        "runtime/market-research",
        "runtime/market-research/candidate",
        "runtime",
        ".",
    ],
)
def test_protected_output_paths_are_refused(tmp_path: Path, target: str) -> None:
    repo = tmp_path / "repository"
    repo.mkdir()
    with pytest.raises(MarketContentError, match="frozen assets"):
        lifecycle._writable_target(repo / target, repo)


def test_symlinks_and_concurrent_writer_are_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    root = tmp_path / "published"
    root.mkdir()
    (root / ".publish.lock").write_text("synthetic active lock", encoding="utf-8")
    with pytest.raises(MarketContentError, match="lock"):
        fixture.publish(root)
    assert (root / ".publish.lock").read_text() == "synthetic active lock"
    linked = tmp_path / "linked"
    linked.symlink_to(root, target_is_directory=True)
    with pytest.raises(MarketContentError, match="symbolic"):
        read_active_market_content(linked, "IDN")


def test_json_duplicate_keys_and_unavailable_root(tmp_path: Path) -> None:
    path = tmp_path / "duplicate.json"
    path.write_text('{"a":1,"a":2}', encoding="utf-8")
    with pytest.raises(MarketContentError):
        read_json(path)
    with pytest.raises(MarketContentUnavailable):
        read_active_market_content(None, "IDN")
    state, digest = load_market_state(tmp_path / "not-created")
    assert state["active"] == {} and digest is None


def test_cli_registration_and_validation_are_nonpublishing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    from navigator_data_readiness.cli import _parser

    source, profiles = candidate_files(tmp_path / "candidate", ("IDN",))
    args = _parser().parse_args(
        ["validate-market-content", "--candidate-dir", str(source), "--profiles", str(profiles)]
    )
    assert lifecycle.run_market_content_command(args, tmp_path / "repo") == 0
    assert json.loads(capsys.readouterr().out)["published"] is False
    args.candidate_dir = tmp_path / "missing"
    assert lifecycle.run_market_content_command(args, tmp_path / "repo") == 1
    assert json.loads(capsys.readouterr().err)["status"] == "not_ready"


@pytest.mark.parametrize("case", ["missing_confirmation", "missing_receipt", "changed_workbook"])
def test_no_publication_when_review_chain_is_missing_or_changed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    if case == "missing_confirmation":
        fixture.confirmation_path.unlink()
    elif case == "missing_receipt":
        (fixture.candidate_dir / "review-import.json").unlink()
    else:
        fixture.workbook_path.write_bytes(b"different synthetic reviewed bytes")
    root = tmp_path / "published"
    with pytest.raises(MarketContentError):
        fixture.publish(root)
    assert not root.exists()


def test_failed_publication_is_not_a_rollback_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    root = tmp_path / "published"
    fixture.publish(root)
    update = reviewed_fixture(tmp_path, monkeypatch, revision=2)
    original_write_state = lifecycle._write_state

    def fail_pointer(*args: object, **kwargs: object) -> str:
        raise OSError("synthetic pointer failure")

    monkeypatch.setattr(lifecycle, "_write_state", fail_pointer)
    with pytest.raises(OSError, match="pointer failure"):
        update.publish(root)
    monkeypatch.setattr(lifecycle, "_write_state", original_write_state)
    with pytest.raises(MarketContentError, match="previously active"):
        lifecycle.rollback_market_content(
            content_root=root,
            country_code="IDN",
            content_version="OVERVIEW-IDN-20260827-R2",
            reason="synthetic orphan rollback",
            actor="test-only",
            repo_root=fixture.repo_root,
        )
    assert read_active_market_content(root, "IDN").content_version.endswith("R1")


def test_rollback_wrong_country_and_republish_revoked_version_fail(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    root = tmp_path / "published"
    fixture.publish(root)
    with pytest.raises(MarketContentError, match="different country"):
        lifecycle.rollback_market_content(
            content_root=root,
            country_code="IDN",
            content_version="OVERVIEW-ZAF-20260827-R1",
            reason="synthetic wrong country",
            actor="test-only",
            repo_root=fixture.repo_root,
        )
    lifecycle.revoke_market_content(
        content_root=root,
        country_code="IDN",
        actor="test-only",
        reason="synthetic withdrawal",
        repo_root=fixture.repo_root,
    )
    with pytest.raises(MarketContentError, match="revoked"):
        fixture.publish(root)
    assert read_active_market_content(root, "ZAF").content_version.endswith("R1")


def test_failed_revocation_pointer_still_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    root = tmp_path / "published"
    fixture.publish(root)

    def fail_pointer(*args: object, **kwargs: object) -> str:
        raise OSError("synthetic pointer failure")

    monkeypatch.setattr(lifecycle, "_write_state", fail_pointer)
    with pytest.raises(OSError):
        lifecycle.revoke_market_content(
            content_root=root,
            country_code="IDN",
            actor="test-only",
            reason="synthetic withdrawal",
            repo_root=fixture.repo_root,
        )
    assert load_market_state(root)[0]["active"]["IDN"].endswith("R1")
    with pytest.raises(MarketContentUnavailable):
        read_active_market_content(root, "IDN")


@pytest.mark.parametrize(
    "payload", ['{"value":NaN}', '{"value":Infinity}', '{"value":-Infinity}', "[]"]
)
def test_nonfinite_json_and_non_object_roots_rejected(tmp_path: Path, payload: str) -> None:
    path = tmp_path / "invalid.json"
    path.write_text(payload, encoding="utf-8")
    with pytest.raises(MarketContentError):
        read_json(path)


def test_candidate_and_store_must_not_overlap(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    with pytest.raises(MarketContentError, match="separate"):
        fixture.publish(fixture.candidate_dir / "published")
    with pytest.raises(MarketContentError, match="new directory"):
        lifecycle.import_market_review(
            candidate_dir=fixture.source_dir,
            workbook_path=fixture.workbook_path,
            output_dir=fixture.source_dir / "nested-import",
            profiles_path=fixture.profiles_path,
            repo_root=fixture.repo_root,
        )


def test_workbook_parser_rejects_non_zip_and_missing_files(tmp_path: Path) -> None:
    missing = tmp_path / "missing.xlsx"
    with pytest.raises(MarketContentError, match="missing"):
        lifecycle._workbook_bytes(missing)
    path = tmp_path / "not-a-workbook.xlsx"
    path.write_bytes(b"synthetic non-workbook")
    with pytest.raises(MarketContentError, match=r"\.xlsx"):
        lifecycle._workbook_bytes(path)


def test_real_source_workbook_is_read_only_and_not_a_market_review() -> None:
    from navigator_data_readiness.paths import discover_repository

    source = discover_repository().technical_workbook
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    payload = lifecycle._workbook_bytes(source)
    with pytest.raises(MarketContentError, match="worksheets"):
        lifecycle._read_workbook(payload)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before


@pytest.mark.parametrize(
    "case",
    [
        "entry_level",
        "entry_date",
        "risk_level",
        "risk_date",
        "risk_id",
        "risk_scope",
        "risk_technology",
        "missing_risk",
        "chapter_id",
        "missing_chapter",
        "as_of_after_version",
    ],
)
def test_bilingual_decisions_and_structures_must_agree(case: str) -> None:
    payload = legacy_content()
    zh = payload["locales"]["zh-CN"]
    if case == "entry_level":
        zh["analysis"]["entry_assessments"][0]["level"] = "high"
    elif case == "entry_date":
        zh["analysis"]["entry_assessments"][0]["verified_on"] = "2026-08-20"
    elif case == "risk_level":
        zh["analysis"]["risks"][0]["level"] = "low"
    elif case == "risk_date":
        zh["analysis"]["risks"][0]["verified_on"] = "2026-08-20"
    elif case == "risk_id":
        zh["analysis"]["risks"][0]["id"] = "different_risk"
    elif case == "risk_scope":
        zh["analysis"]["risks"][0]["businesses"] = ["project_investment"]
    elif case == "risk_technology":
        zh["analysis"]["risks"][0]["technologies"] = ["wind"]
    elif case == "missing_risk":
        zh["analysis"]["risks"] = []
    elif case == "chapter_id":
        zh["report"]["chapters"][0]["id"] = "different_chapter"
    elif case == "missing_chapter":
        chapter = copy.deepcopy(zh["report"]["chapters"][0])
        chapter["id"] = "new_chapter"
        zh["report"]["chapters"].append(chapter)
    else:
        payload["as_of"] = "2026-08-28"
    with pytest.raises(ValidationError):
        CountryMarketContent.model_validate(payload)


def test_bilingual_order_and_translation_text_may_differ() -> None:
    payload = legacy_content()
    en = payload["locales"]["en"]["analysis"]
    en["entry_assessments"].reverse()
    en["sections"].reverse()
    en["risks"][0]["businesses"].reverse()
    assert CountryMarketContent.model_validate(payload).model_dump(mode="json") == payload


@pytest.mark.parametrize("leaf,new_value", [("level", "high"), ("verified_on", "2026-08-20")])
def test_excel_retired_decision_fields_cannot_be_added(
    tmp_path: Path, leaf: str, new_value: str
) -> None:
    source, profiles = candidate_files(tmp_path / "candidate", ("IDN",))
    candidate = lifecycle.load_market_candidate(source, profiles)
    rows = [list(row) for row in lifecycle.market_review_rows(candidate)]
    pointer = f"/locales/zh-CN/analysis/entry_assessments/0/{leaf}"
    retired_row = list(rows[0])
    retired_row[3] = pointer
    retired_row[5] = new_value
    rows.append(retired_row)
    with pytest.raises(MarketContentError, match="unknown"):
        lifecycle.apply_market_review_rows(
            candidate, review_metadata(candidate), rows, frozenset({"IDN"})
        )


@pytest.mark.parametrize(
    "case",
    [
        "approval_before_created",
        "future_approval",
        "future_import",
        "import_before_created",
        "as_of_after_confirmation",
        "date_only_same_day",
    ],
)
def test_publication_timestamp_chronology(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    monkeypatch.setattr(lifecycle, "_now", lambda: "2026-08-27T12:00:00+00:00")
    fixture = reviewed_fixture(tmp_path, monkeypatch)
    confirmation = read_json(fixture.confirmation_path)
    receipt_path = fixture.candidate_dir / "review-import.json"
    receipt = read_json(receipt_path)
    if case == "approval_before_created":
        confirmation["approved_at"] = "2026-08-27T08:00:00+08:00"
    elif case == "future_approval":
        confirmation["approved_at"] = "2026-08-28T12:00:00+08:00"
    elif case == "future_import":
        receipt["imported_at"] = "2026-08-29"
    elif case == "import_before_created":
        receipt["imported_at"] = "2026-08-26"
    elif case == "as_of_after_confirmation":
        confirmation["approved_at"] = "2026-08-26"
        receipt["workbook_created_at"] = "2026-08-25"
    else:
        confirmation["approved_at"] = "2026-08-27"
    write_json(fixture.confirmation_path, confirmation)
    receipt_path.chmod(0o644)
    write_json(receipt_path, receipt)
    if case == "date_only_same_day":
        assert fixture.publish(tmp_path / "published")["status"] == "published"
    else:
        with pytest.raises(MarketContentError):
            fixture.publish(tmp_path / "published")
        assert not (tmp_path / "published").exists()


def test_old_review_cannot_silently_downgrade_active_publication(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = reviewed_fixture(tmp_path, monkeypatch)
    root = tmp_path / "published"
    first.publish(root)
    second = reviewed_fixture(tmp_path, monkeypatch, revision=2)
    second.publish(root)
    before = (root / "current.json").read_bytes()
    with pytest.raises(MarketContentError, match="explicit rollback"):
        first.publish(root)
    assert (root / "current.json").read_bytes() == before


def test_atomic_import_does_not_replace_concurrent_empty_directory(tmp_path: Path) -> None:
    temporary = tmp_path / "temporary"
    temporary.mkdir()
    (temporary / "marker").write_text("owned temporary file", encoding="utf-8")
    target = tmp_path / "concurrent-target"
    target.mkdir()
    with pytest.raises(MarketContentError, match="already exists"):
        lifecycle._publish_directory(temporary, target)
    assert target.is_dir() and list(target.iterdir()) == []
    assert (temporary / "marker").read_text() == "owned temporary file"


def test_real_concurrent_writer_fails_without_releasing_first_lock(tmp_path: Path) -> None:
    root = tmp_path / "published"
    with lifecycle._writer(root, tmp_path / "repository"):
        first_lock = (root / ".publish.lock").read_bytes()
        with (
            pytest.raises(MarketContentError, match="lock"),
            lifecycle._writer(root, tmp_path / "repository"),
        ):
            pytest.fail("second writer acquired the active lock")
        assert (root / ".publish.lock").read_bytes() == first_lock
    assert not (root / ".publish.lock").exists()
