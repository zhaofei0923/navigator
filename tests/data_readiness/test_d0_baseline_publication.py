from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from navigator_data_readiness.baseline import sha256_file
from navigator_data_readiness.cli import main
from navigator_data_readiness.d0_baseline_publication import (
    assess_d0_baseline_publication,
)
from navigator_data_readiness.d0_baseline_review import (
    apply_d0_baseline_confirmation,
    build_d0_baseline_confirmation_template,
    load_and_validate_d0_baseline_decision,
)
from navigator_data_readiness.paths import RepositoryPaths, discover_repository


def _load(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


def _write(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


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
    paths = discover_repository(tmp_path)
    manifest = _load(paths.evidence_manifest)
    manifest["evidence"] = [
        item
        for item in manifest["evidence"]
        if not str(item.get("evidence_id") or "").startswith("EVD-D0-BASELINE-ADOPTION-")
    ]
    _write(paths.evidence_manifest, manifest)
    for path in paths.evidence_manifest.parent.glob("*baseline_adoption_confirmation*.json"):
        path.unlink()
    for path in paths.d0_review_dir.glob("d0_baseline_adoption_decision.*.json"):
        path.unlink()
    return paths


def _apply_decision(
    paths: RepositoryPaths,
    *,
    decision: str = "approved_for_manual_adoption",
) -> Path:
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
    confirmation_path = (
        paths.evidence_manifest.parent / "kevin_baseline_adoption_confirmation_20260802.json"
    )
    _write(confirmation_path, confirmation)
    decision_path = paths.d0_review_dir / "d0_baseline_adoption_decision.2026-08-02.json"
    apply_d0_baseline_confirmation(
        paths,
        confirmation_path,
        bundle_path,
        decision_path,
        paths.evidence_manifest,
    )
    return decision_path


def _staged_workbook(paths: RepositoryPaths, directory: Path | None = None) -> Path:
    candidate = paths.d0_candidates_dir / "d0_core_contract_candidate.2026-08-01.xlsx"
    staging_dir = directory or paths.root / "data" / "d0" / "publication-staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    staged = staging_dir / paths.d0_workbook.name
    shutil.copy2(candidate, staged)
    return staged


def _codes(report: dict[str, Any]) -> set[str]:
    return {str(check["code"]) for check in report["checks"]}


def test_approved_decision_and_exact_staged_workbook_are_ready(tmp_path: Path) -> None:
    paths = _isolated_paths(tmp_path)
    source_hash = sha256_file(paths.d0_workbook)
    decision_path = _apply_decision(paths)
    staged = _staged_workbook(paths)

    record = load_and_validate_d0_baseline_decision(paths, decision_path)
    report = assess_d0_baseline_publication(paths, decision_path, staged)

    assert record["decision"] == "approved_for_manual_adoption"
    assert report["ready_for_manual_baseline_publication"] is True
    assert report["checks"] == []
    assert report["does_not_publish_baseline"] is True
    assert report["does_not_activate_baseline"] is True
    assert report["expected_candidate_workbook"]["sha256"] == sha256_file(staged)
    assert (
        report["baseline_change_assessment"]["candidate_ready_for_formal_baseline_review"] is True
    )
    assert len(report["baseline_change_assessment"]["resolution_sha256"]) == 64
    assert report["baseline_change_assessment"]["checks"] == []
    assert sha256_file(paths.d0_workbook) == source_hash


def test_repository_approved_publication_artifacts_are_current() -> None:
    paths = discover_repository()
    decision_path = paths.d0_review_dir / "d0_baseline_adoption_decision.2026-08-02.json"
    staged_items = list(
        (paths.d0_candidates_dir / "publication-staging" / "2026-08-02").glob("*.xlsx")
    )
    assert len(staged_items) == 1
    report_path = paths.d0_candidates_dir / "d0_baseline_publication_readiness.2026-08-02.json"

    assert load_and_validate_d0_baseline_decision(paths, decision_path)["decision"] == (
        "approved_for_manual_adoption"
    )
    assert _load(report_path) == assess_d0_baseline_publication(
        paths,
        decision_path,
        staged_items[0],
    )


def test_rejected_decision_is_valid_but_not_publishable(tmp_path: Path) -> None:
    paths = _isolated_paths(tmp_path)
    decision_path = _apply_decision(paths, decision="rejected")
    staged = _staged_workbook(paths)

    assert load_and_validate_d0_baseline_decision(paths, decision_path)["decision"] == "rejected"
    report = assess_d0_baseline_publication(paths, decision_path, staged)

    assert report["ready_for_manual_baseline_publication"] is False
    assert "D0_PUBLICATION_DECISION_NOT_APPROVED" in _codes(report)


def test_decision_replay_rejects_record_tampering(tmp_path: Path) -> None:
    paths = _isolated_paths(tmp_path)
    decision_path = _apply_decision(paths)
    staged = _staged_workbook(paths)
    record = _load(decision_path)
    record["change_summary"]["added_primary_key_fields"] = 30
    _write(decision_path, record)

    report = assess_d0_baseline_publication(paths, decision_path, staged)

    assert report["ready_for_manual_baseline_publication"] is False
    assert _codes(report) == {"D0_PUBLICATION_DECISION_INVALID"}


def test_decision_replay_rejects_missing_manifest_evidence(tmp_path: Path) -> None:
    paths = _isolated_paths(tmp_path)
    decision_path = _apply_decision(paths)
    staged = _staged_workbook(paths)
    manifest = _load(paths.evidence_manifest)
    manifest["evidence"] = [
        item
        for item in manifest["evidence"]
        if item.get("evidence_id") != "EVD-D0-BASELINE-ADOPTION-001-20260802"
    ]
    _write(paths.evidence_manifest, manifest)

    report = assess_d0_baseline_publication(paths, decision_path, staged)

    assert report["ready_for_manual_baseline_publication"] is False
    assert _codes(report) == {"D0_PUBLICATION_DECISION_INVALID"}


def test_staged_workbook_requires_safe_path_filename_and_exact_hash(tmp_path: Path) -> None:
    paths = _isolated_paths(tmp_path)
    decision_path = _apply_decision(paths)

    source_report = assess_d0_baseline_publication(paths, decision_path, paths.d0_workbook)
    assert {
        "D0_PUBLICATION_SOURCE_WORKBOOK_FORBIDDEN",
        "D0_PUBLICATION_DOC_STAGING_FORBIDDEN",
        "D0_PUBLICATION_STAGED_HASH_MISMATCH",
    } <= _codes(source_report)

    candidate = paths.d0_candidates_dir / "d0_core_contract_candidate.2026-08-01.xlsx"
    wrong_name = paths.root / "data" / "d0" / "publication-staging" / "wrong-name.xlsx"
    wrong_name.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(candidate, wrong_name)
    wrong_name_report = assess_d0_baseline_publication(paths, decision_path, wrong_name)
    assert _codes(wrong_name_report) == {"D0_PUBLICATION_FILENAME_MISMATCH"}

    tampered = _staged_workbook(paths, paths.root / "data" / "d0" / "other-staging")
    tampered.write_bytes(tampered.read_bytes() + b"tampered")
    tampered_report = assess_d0_baseline_publication(paths, decision_path, tampered)
    assert _codes(tampered_report) == {"D0_PUBLICATION_STAGED_HASH_MISMATCH"}


def test_cli_writes_read_only_publication_report(tmp_path: Path) -> None:
    paths = _isolated_paths(tmp_path)
    decision_path = _apply_decision(paths)
    staged = _staged_workbook(paths)
    output = paths.root / "data" / "d0" / "publication-readiness.json"

    exit_code = main(
        [
            "--repo",
            str(paths.root),
            "validate-d0-baseline-publication",
            "--decision",
            str(decision_path),
            "--workbook",
            str(staged),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 0
    assert _load(output)["ready_for_manual_baseline_publication"] is True

    forbidden_output = paths.d0_workbook.parent / "publication-readiness.json"
    forbidden_exit = main(
        [
            "--repo",
            str(paths.root),
            "validate-d0-baseline-publication",
            "--decision",
            str(decision_path),
            "--workbook",
            str(staged),
            "--output",
            str(forbidden_output),
        ]
    )
    assert forbidden_exit == 1
    assert not forbidden_output.exists()
