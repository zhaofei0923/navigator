from __future__ import annotations

import json
import shutil
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from navigator_data_readiness.d0_baseline_review import (
    apply_d0_baseline_confirmation,
    build_d0_baseline_confirmation_template,
    build_d0_baseline_review_bundle,
    load_and_validate_d0_baseline_review_bundle,
    validate_d0_baseline_confirmation,
    write_d0_baseline_review_package,
)
from navigator_data_readiness.paths import RepositoryPaths, discover_repository
from pytest import MonkeyPatch


def _load(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


def _inputs(paths: RepositoryPaths) -> tuple[Path, Path, Path]:
    return (
        paths.d0_review_dir / "d0_review_packet.2026-08-02.json",
        paths.d0_review_dir / "core_contract_resolution.2026-08-01.json",
        paths.d0_candidates_dir / "d0_core_contract_candidate.2026-08-01.xlsx",
    )


def _build(paths: RepositoryPaths) -> dict[str, Any]:
    review, resolution, candidate = _inputs(paths)
    return build_d0_baseline_review_bundle(
        paths,
        _load(review),
        review,
        _load(resolution),
        resolution,
        candidate,
    )


def _completed_confirmation(
    paths: RepositoryPaths,
    *,
    decision: str = "approved_for_manual_adoption",
) -> dict[str, Any]:
    bundle_path = paths.d0_candidates_dir / "d0_baseline_adoption_review_bundle.2026-08-02.json"
    confirmation = build_d0_baseline_confirmation_template(paths, bundle_path)
    confirmation.update(
        {
            "template_only": False,
            "authorized_transcription": True,
            "reviewer": "kevin",
            "reviewed_at": "2026-08-02",
            "decision": decision,
            "comments": "同意" if decision == "approved_for_manual_adoption" else "暂不采用",
        }
    )
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
        Path("data/d0/candidates"),
        Path("data/d0/research"),
        Path("data/d0/review"),
        Path("data/d0/evidence"),
    ):
        shutil.copytree(source.root / relative, tmp_path / relative)
    return discover_repository(tmp_path)


def test_current_candidate_is_ready_for_project_baseline_decision() -> None:
    paths = discover_repository()

    bundle = _build(paths)

    assert bundle["review_state"] == "ready_for_project_baseline_decision"
    assert bundle["does_not_activate_baseline"] is True
    assert bundle["does_not_complete_d0"] is True
    assert bundle["required_decision"] == {
        "role": "项目批准人",
        "person_name": "kevin",
        "decision_values": ["approved_for_manual_adoption", "rejected"],
    }
    assert [item["acceptance_id"] for item in bundle["approved_acceptance_items"]] == [
        "D0-AC-001",
        "D0-AC-002",
    ]
    assert bundle["change_summary"] == {
        "entity_primary_key_decisions": 29,
        "added_primary_key_fields": 29,
        "field_unit_decisions": 92,
        "compound_fields_split": 20,
        "generated_atomic_fields": 57,
        "candidate_field_count": 158,
    }
    assert bundle["candidate_assessment"]["checks"] == []


def test_writer_publishes_hash_bound_package_without_overwrite(tmp_path: Path) -> None:
    paths = _isolated_paths(tmp_path)
    review, resolution, candidate = _inputs(paths)
    bundle_output = paths.d0_candidates_dir / "d0_baseline_adoption_review_bundle.2026-08-03.json"
    confirmation_output = (
        paths.d0_review_dir / "d0_baseline_adoption_confirmation.template.2026-08-03.json"
    )

    written = write_d0_baseline_review_package(
        paths,
        review,
        resolution,
        candidate,
        bundle_output,
        confirmation_output,
    )

    assert written == (bundle_output, confirmation_output)
    assert load_and_validate_d0_baseline_review_bundle(paths, bundle_output) == _load(bundle_output)
    confirmation = _load(confirmation_output)
    assert confirmation == build_d0_baseline_confirmation_template(paths, bundle_output)
    assert confirmation["template_only"] is True
    assert confirmation["authorized_transcription"] is False
    assert confirmation["expected_reviewer"] == "kevin"
    assert bundle_output.stat().st_mode & 0o777 == 0o644
    assert confirmation_output.stat().st_mode & 0o777 == 0o644
    assert list(bundle_output.parent.glob(f".{bundle_output.name}.*.tmp")) == []
    assert list(confirmation_output.parent.glob(f".{confirmation_output.name}.*.tmp")) == []

    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        write_d0_baseline_review_package(
            paths,
            review,
            resolution,
            candidate,
            bundle_output,
            confirmation_output,
        )


def test_bundle_replay_rejects_tampering(tmp_path: Path) -> None:
    paths = _isolated_paths(tmp_path)
    review, resolution, candidate = _inputs(paths)
    bundle_output = paths.d0_candidates_dir / "d0_baseline_adoption_review_bundle.2026-08-03.json"
    confirmation_output = (
        paths.d0_review_dir / "d0_baseline_adoption_confirmation.template.2026-08-03.json"
    )
    write_d0_baseline_review_package(
        paths,
        review,
        resolution,
        candidate,
        bundle_output,
        confirmation_output,
    )
    tampered = _load(bundle_output)
    tampered["change_summary"]["added_primary_key_fields"] = 30
    bundle_output.write_text(
        json.dumps(tampered, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="deterministic replay"):
        load_and_validate_d0_baseline_review_bundle(paths, bundle_output)


def test_writer_rejects_mismatched_dates_and_preserves_racing_output(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    paths = _isolated_paths(tmp_path)
    review, resolution, candidate = _inputs(paths)
    bundle_output = paths.d0_candidates_dir / "d0_baseline_adoption_review_bundle.2026-08-03.json"
    mismatched_confirmation = (
        paths.d0_review_dir / "d0_baseline_adoption_confirmation.template.2026-08-04.json"
    )
    with pytest.raises(ValueError, match="dates must match"):
        write_d0_baseline_review_package(
            paths,
            review,
            resolution,
            candidate,
            bundle_output,
            mismatched_confirmation,
        )

    confirmation_output = (
        paths.d0_review_dir / "d0_baseline_adoption_confirmation.template.2026-08-03.json"
    )
    real_link = __import__("os").link

    def racing_link(source: Path, destination: Path) -> None:
        if Path(destination) == confirmation_output:
            confirmation_output.write_text("concurrent owner\n", encoding="utf-8")
            raise FileExistsError("synthetic publication race")
        real_link(source, destination)

    monkeypatch.setattr(
        "navigator_data_readiness.d0_baseline_review.os.link",
        racing_link,
    )
    with pytest.raises(FileExistsError, match="synthetic publication race"):
        write_d0_baseline_review_package(
            paths,
            review,
            resolution,
            candidate,
            bundle_output,
            confirmation_output,
        )

    assert not bundle_output.exists()
    assert confirmation_output.read_text(encoding="utf-8") == "concurrent owner\n"


def test_review_requires_latest_formal_packet_and_valid_candidate() -> None:
    paths = discover_repository()
    _review, resolution, candidate = _inputs(paths)
    stale_review = paths.d0_review_dir / "d0_review_packet.2026-08-01.json"

    with pytest.raises(ValueError, match="latest formal review"):
        build_d0_baseline_review_bundle(
            paths,
            _load(stale_review),
            stale_review,
            _load(resolution),
            resolution,
            candidate,
        )

    current_review = paths.d0_review_dir / "d0_review_packet.2026-08-02.json"
    with pytest.raises(ValueError, match="not ready for formal baseline review"):
        build_d0_baseline_review_bundle(
            paths,
            _load(current_review),
            current_review,
            _load(resolution),
            resolution,
            paths.d0_workbook,
        )


def test_repository_baseline_review_artifacts_are_current() -> None:
    paths = discover_repository()
    bundle_path = paths.d0_candidates_dir / "d0_baseline_adoption_review_bundle.2026-08-02.json"
    confirmation_path = (
        paths.d0_review_dir / "d0_baseline_adoption_confirmation.template.2026-08-02.json"
    )

    assert _load(bundle_path) == _build(paths)
    assert _load(confirmation_path) == build_d0_baseline_confirmation_template(
        paths,
        bundle_path,
    )


def test_completed_confirmation_rejects_wrong_binding_authority_date_and_decision() -> None:
    paths = discover_repository()
    bundle_path = paths.d0_candidates_dir / "d0_baseline_adoption_review_bundle.2026-08-02.json"
    valid = _completed_confirmation(paths)

    wrong_hash = deepcopy(valid)
    wrong_hash["bundle"]["sha256"] = "0" * 64
    with pytest.raises(ValueError, match="exact current bundle"):
        validate_d0_baseline_confirmation(paths, wrong_hash, bundle_path)

    unauthorized = deepcopy(valid)
    unauthorized["authorized_transcription"] = False
    with pytest.raises(ValueError, match="header or authorization"):
        validate_d0_baseline_confirmation(paths, unauthorized, bundle_path)

    wrong_reviewer = deepcopy(valid)
    wrong_reviewer["reviewer"] = "peter"
    with pytest.raises(ValueError, match="registered project approver"):
        validate_d0_baseline_confirmation(paths, wrong_reviewer, bundle_path)

    naive_datetime = deepcopy(valid)
    naive_datetime["reviewed_at"] = "2026-08-02T09:00:00"
    with pytest.raises(ValueError, match="ISO date or aware datetime"):
        validate_d0_baseline_confirmation(paths, naive_datetime, bundle_path)

    retroactive = deepcopy(valid)
    retroactive["reviewed_at"] = "2026-08-01"
    with pytest.raises(ValueError, match="cannot predate"):
        validate_d0_baseline_confirmation(paths, retroactive, bundle_path)

    invalid_decision = deepcopy(valid)
    invalid_decision["decision"] = "approved"
    with pytest.raises(ValueError, match="decision is invalid"):
        validate_d0_baseline_confirmation(paths, invalid_decision, bundle_path)

    rejected_without_comment = _completed_confirmation(paths, decision="rejected")
    rejected_without_comment["comments"] = None
    with pytest.raises(ValueError, match="requires comments"):
        validate_d0_baseline_confirmation(paths, rejected_without_comment, bundle_path)


@pytest.mark.parametrize(
    ("decision", "expected_status", "authorized"),
    [
        ("approved_for_manual_adoption", "已批准", True),
        ("rejected", "已复核", False),
    ],
)
def test_application_writes_decision_and_evidence_atomically(
    tmp_path: Path,
    decision: str,
    expected_status: str,
    authorized: bool,
) -> None:
    paths = _isolated_paths(tmp_path)
    bundle_path = paths.d0_candidates_dir / "d0_baseline_adoption_review_bundle.2026-08-02.json"
    confirmation_path = (
        paths.evidence_manifest.parent / "kevin_baseline_adoption_confirmation_20260802.json"
    )
    confirmation_path.write_text(
        json.dumps(
            _completed_confirmation(paths, decision=decision),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    decision_output = paths.d0_review_dir / "d0_baseline_adoption_decision.2026-08-02.json"
    source_hash = paths.d0_workbook.read_bytes()

    written = apply_d0_baseline_confirmation(
        paths,
        confirmation_path,
        bundle_path,
        decision_output,
        paths.evidence_manifest,
    )

    assert written == (decision_output, paths.evidence_manifest)
    record = _load(decision_output)
    assert record["decision"] == decision
    assert record["manual_baseline_adoption_authorized"] is authorized
    assert record["does_not_activate_baseline"] is True
    assert record["does_not_complete_d0"] is True
    assert record["reviewer_signature"] == {
        "role": "项目批准人",
        "person_name": "kevin",
        "signed_at": "2026-08-02",
        "evidence_ids": [
            "EVD-D0-BASELINE-ADOPTION-001-20260802",
            "EVD-D0-BASELINE-ADOPTION-002-20260802",
        ],
    }
    entries = [
        item
        for item in _load(paths.evidence_manifest)["evidence"]
        if item.get("path") == "data/d0/evidence/kevin_baseline_adoption_confirmation_20260802.json"
    ]
    assert len(entries) == 2
    assert {item["acceptance_id"] for item in entries} == {
        "D0-AC-001",
        "D0-AC-002",
    }
    assert {item["status"] for item in entries} == {expected_status}
    assert all(
        item["subject_sha256"] == "b128177436355394b5a271c307f388020904b252c232b64be5fd7cb5e0ec82e2"
        for item in entries
    )
    assert paths.d0_workbook.read_bytes() == source_hash
    assert decision_output.stat().st_mode & 0o777 == 0o644
    assert paths.evidence_manifest.stat().st_mode & 0o777 == 0o644
    assert list(decision_output.parent.glob(f".{decision_output.name}.*.tmp")) == []
    assert list(paths.evidence_manifest.parent.glob(".manifest.json.*.tmp")) == []

    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        apply_d0_baseline_confirmation(
            paths,
            confirmation_path,
            bundle_path,
            decision_output,
            paths.evidence_manifest,
        )


def test_application_rejects_wrong_output_date_and_manifest(tmp_path: Path) -> None:
    paths = _isolated_paths(tmp_path)
    bundle_path = paths.d0_candidates_dir / "d0_baseline_adoption_review_bundle.2026-08-02.json"
    confirmation_path = (
        paths.evidence_manifest.parent / "kevin_baseline_adoption_confirmation_20260802.json"
    )
    confirmation_path.write_text(
        json.dumps(
            _completed_confirmation(paths),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    wrong_date = paths.d0_review_dir / "d0_baseline_adoption_decision.2026-08-03.json"
    with pytest.raises(ValueError, match="date must match"):
        apply_d0_baseline_confirmation(
            paths,
            confirmation_path,
            bundle_path,
            wrong_date,
            paths.evidence_manifest,
        )

    correct_date = paths.d0_review_dir / "d0_baseline_adoption_decision.2026-08-02.json"
    with pytest.raises(ValueError, match="repository evidence manifest"):
        apply_d0_baseline_confirmation(
            paths,
            confirmation_path,
            bundle_path,
            correct_date,
            paths.evidence_manifest.parent / "alternate.json",
        )
