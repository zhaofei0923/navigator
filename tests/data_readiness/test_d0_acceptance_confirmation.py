from __future__ import annotations

import json
import shutil
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from navigator_data_readiness.d0_acceptance_confirmation import (
    apply_d0_acceptance_confirmation,
    build_d0_acceptance_confirmation_template,
    validate_d0_acceptance_confirmation,
    write_d0_acceptance_confirmation_template,
)
from navigator_data_readiness.d0_review import validate_review_packet
from navigator_data_readiness.paths import RepositoryPaths, discover_repository


def _bundle_path(paths: RepositoryPaths) -> Path:
    return paths.d0_candidates_dir / "d0_acceptance_review_bundle.2026-08-02.json"


def _load(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


def _completed_confirmation(
    paths: RepositoryPaths,
    *,
    rejected_id: str | None = None,
) -> dict[str, Any]:
    confirmation = build_d0_acceptance_confirmation_template(paths, _bundle_path(paths))
    confirmation.update(
        {
            "template_only": False,
            "authorized_transcription": True,
            "reviewer": "kevin",
            "reviewed_at": "2026-08-02",
        }
    )
    for decision in confirmation["decisions"]:
        if decision["acceptance_id"] == rejected_id:
            decision["decision"] = "rejected"
            decision["comments"] = "需要补充证据后重新复核"
        else:
            decision["decision"] = "approved"
            decision["comments"] = "同意"
    return confirmation


def _isolated_paths(tmp_path: Path) -> RepositoryPaths:
    source = discover_repository()
    (tmp_path / "doc" / "doc").mkdir(parents=True)
    shutil.copy2(source.d0_workbook, tmp_path / "doc" / "doc" / source.d0_workbook.name)
    shutil.copy2(
        source.technical_workbook,
        tmp_path / "doc" / "doc" / source.technical_workbook.name,
    )
    for relative in (
        Path("data/contracts/current"),
        Path("data/d0/candidates"),
        Path("data/d0/research"),
        Path("data/d0/review"),
    ):
        shutil.copytree(source.root / relative, tmp_path / relative)
    evidence_dir = tmp_path / "data" / "d0" / "evidence"
    evidence_dir.mkdir(parents=True)
    shutil.copy2(source.evidence_manifest, evidence_dir / "manifest.json")
    applied_review = tmp_path / "data" / "d0" / "review" / "d0_review_packet.2026-08-02.json"
    applied_review.unlink(missing_ok=True)
    bundle = _load(tmp_path / "data" / "d0" / "candidates" / _bundle_path(source).name)
    candidate_evidence_ids = {
        str(item["evidence_candidate_id"]) for item in bundle["acceptance_items"]
    }
    manifest = _load(evidence_dir / "manifest.json")
    manifest["evidence"] = [
        entry
        for entry in manifest["evidence"]
        if str(entry["evidence_id"]) not in candidate_evidence_ids
    ]
    (evidence_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    for entry in manifest["evidence"]:
        relative = Path(str(entry["path"]))
        destination = tmp_path / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            shutil.copy2(source.root / relative, destination)
    return discover_repository(tmp_path)


def test_confirmation_template_binds_exact_reviewable_set_and_hash(tmp_path: Path) -> None:
    paths = _isolated_paths(tmp_path)
    bundle_path = _bundle_path(paths)
    output = paths.d0_review_dir / "test-confirmation.template.2026-08-02.json"
    template = build_d0_acceptance_confirmation_template(paths, bundle_path)

    assert template["template_only"] is True
    assert template["authorized_transcription"] is False
    assert template["expected_reviewer"] == "kevin"
    assert template["bundle"]["sha256"] == (
        "9ae32733d9ae3c973a63f382952f057b20d8a82a2bccb28d11a13a3be8bd86b7"
    )
    assert [item["acceptance_id"] for item in template["decisions"]] == [
        "D0-AC-001",
        "D0-AC-002",
        "D0-AC-003",
        "D0-AC-004",
        "D0-AC-005",
        "D0-AC-006",
        "D0-AC-008",
    ]

    assert write_d0_acceptance_confirmation_template(paths, bundle_path, output) == output
    assert _load(output) == template
    assert output.stat().st_mode & 0o777 == 0o644
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        write_d0_acceptance_confirmation_template(paths, bundle_path, output)


def test_confirmation_rejects_wrong_binding_authority_date_and_decisions() -> None:
    paths = discover_repository()
    bundle_path = _bundle_path(paths)
    valid = _completed_confirmation(paths)

    wrong_hash = deepcopy(valid)
    wrong_hash["bundle"]["sha256"] = "0" * 64
    with pytest.raises(ValueError, match="exact current bundle hash"):
        validate_d0_acceptance_confirmation(paths, wrong_hash, bundle_path)

    unauthorized = deepcopy(valid)
    unauthorized["authorized_transcription"] = False
    with pytest.raises(ValueError, match="explicit transcription authorization"):
        validate_d0_acceptance_confirmation(paths, unauthorized, bundle_path)

    bad_date = deepcopy(valid)
    bad_date["reviewed_at"] = "2026-08-02T09:00:00"
    with pytest.raises(ValueError, match="ISO date or aware datetime"):
        validate_d0_acceptance_confirmation(paths, bad_date, bundle_path)

    retroactive = deepcopy(valid)
    retroactive["reviewed_at"] = "2026-08-01"
    with pytest.raises(ValueError, match="cannot predate"):
        validate_d0_acceptance_confirmation(paths, retroactive, bundle_path)

    incomplete = deepcopy(valid)
    incomplete["decisions"].pop()
    with pytest.raises(ValueError, match="decision set"):
        validate_d0_acceptance_confirmation(paths, incomplete, bundle_path)

    rejected_without_comment = deepcopy(valid)
    rejected_without_comment["decisions"][0].update({"decision": "rejected", "comments": None})
    with pytest.raises(ValueError, match="rejection requires comments"):
        validate_d0_acceptance_confirmation(paths, rejected_without_comment, bundle_path)


def test_repository_confirmation_template_is_current() -> None:
    paths = discover_repository()
    template_path = paths.d0_review_dir / "d0_acceptance_confirmation.template.2026-08-02.json"

    assert _load(template_path) == build_d0_acceptance_confirmation_template(
        paths,
        _bundle_path(paths),
    )


@pytest.mark.parametrize("rejected_id", [None, "D0-AC-003"])
def test_application_writes_valid_review_and_evidence_transaction(
    tmp_path: Path,
    rejected_id: str | None,
) -> None:
    paths = _isolated_paths(tmp_path)
    bundle_path = _bundle_path(paths)
    confirmation = _completed_confirmation(paths, rejected_id=rejected_id)
    confirmation_path = (
        paths.evidence_manifest.parent / "kevin_acceptance_confirmation_20260802.json"
    )
    confirmation_path.write_text(
        json.dumps(confirmation, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    review_output = paths.d0_review_dir / "d0_review_packet.2026-08-02.json"

    written = apply_d0_acceptance_confirmation(
        paths,
        confirmation_path,
        bundle_path,
        review_output,
        paths.evidence_manifest,
    )

    assert written == (review_output, paths.evidence_manifest)
    packet = _load(review_output)
    acceptance = {item["acceptance_id"]: item for item in packet["acceptance_items"]}
    expected_approved = {
        "D0-AC-001",
        "D0-AC-002",
        "D0-AC-003",
        "D0-AC-004",
        "D0-AC-005",
        "D0-AC-006",
        "D0-AC-007",
        "D0-AC-008",
    }
    if rejected_id:
        expected_approved.remove(rejected_id)
        assert acceptance[rejected_id]["review_status"] == "pending"
        assert acceptance[rejected_id]["comments"].startswith("rejected:")
    assert {
        acceptance_id
        for acceptance_id, item in acceptance.items()
        if item["review_status"] == "approved"
    } == expected_approved

    evidence = _load(paths.evidence_manifest)["evidence"]
    new_entries = [item for item in evidence if str(item["evidence_id"]).endswith("20260802")]
    assert len(new_entries) == 7
    assert all(item["subject_sha256"] == confirmation["bundle"]["sha256"] for item in new_entries)
    if rejected_id:
        rejected = next(item for item in new_entries if item["acceptance_id"] == rejected_id)
        assert rejected["status"] == "已复核"

    allowed_codes = {
        "D0_REVIEW_ACCEPTANCE_PENDING",
        "D0_REVIEW_FINAL_PENDING",
    }
    assert {check.code for check in validate_review_packet(paths, packet)} <= allowed_codes
    assert review_output.stat().st_mode & 0o777 == 0o644
    assert paths.evidence_manifest.stat().st_mode & 0o777 == 0o644
    assert list(review_output.parent.glob(".*.tmp")) == []
    assert list(paths.evidence_manifest.parent.glob(".*.tmp")) == []

    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        apply_d0_acceptance_confirmation(
            paths,
            confirmation_path,
            bundle_path,
            review_output,
            paths.evidence_manifest,
        )
