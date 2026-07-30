from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path

from navigator_data_readiness.paths import RepositoryPaths, discover_repository
from navigator_data_readiness.validation import validate_evidence


def _paths_with_manifest(tmp_path: Path) -> RepositoryPaths:
    paths = discover_repository()
    return replace(paths, evidence_manifest=tmp_path / "manifest.json")


def test_missing_evidence_manifest_is_rejected(tmp_path: Path) -> None:
    checks = validate_evidence(_paths_with_manifest(tmp_path))

    assert [check.code for check in checks] == ["EVIDENCE_MANIFEST_MISSING"]


def test_invalid_evidence_manifest_is_rejected(tmp_path: Path) -> None:
    paths = _paths_with_manifest(tmp_path)
    paths.evidence_manifest.write_text("{", encoding="utf-8")

    checks = validate_evidence(paths)

    assert [check.code for check in checks] == ["EVIDENCE_MANIFEST_INVALID"]


def test_evidence_metadata_and_required_coverage_are_checked(tmp_path: Path) -> None:
    paths = _paths_with_manifest(tmp_path)
    paths.evidence_manifest.write_text(
        json.dumps({"schema_version": 1, "stage": "D0", "evidence": [{}]}),
        encoding="utf-8",
    )

    checks = validate_evidence(paths, required_acceptance_ids={"D0-AC-001"})
    codes = {check.code for check in checks}

    assert codes == {"EVIDENCE_METADATA_INCOMPLETE", "EVIDENCE_ACCEPTANCE_MISSING"}


def test_valid_evidence_file_passes(tmp_path: Path) -> None:
    paths = _paths_with_manifest(tmp_path)
    evidence_file = paths.root / "tmp" / "test-evidence.txt"
    evidence_file.parent.mkdir(parents=True, exist_ok=True)
    evidence_file.write_text("approved evidence", encoding="utf-8")
    digest = hashlib.sha256(evidence_file.read_bytes()).hexdigest()
    payload = {
        "schema_version": 1,
        "stage": "D0",
        "evidence": [
            {
                "evidence_id": "EVD-D0-001",
                "acceptance_id": "D0-AC-001",
                "path": evidence_file.relative_to(paths.root).as_posix(),
                "sha256": digest,
                "reviewer": "Reviewer",
                "status": "已复核",
            }
        ],
    }
    paths.evidence_manifest.write_text(json.dumps(payload), encoding="utf-8")
    try:
        checks = validate_evidence(
            paths,
            required_acceptance_ids={"D0-AC-001"},
        )
    finally:
        evidence_file.unlink()

    assert checks == []


def test_unknown_unapproved_missing_evidence_is_rejected(tmp_path: Path) -> None:
    paths = _paths_with_manifest(tmp_path)
    payload = {
        "schema_version": 1,
        "stage": "D0",
        "evidence": [
            {
                "evidence_id": "EVD-D0-999",
                "acceptance_id": "D0-AC-999",
                "path": "tmp/missing-evidence.txt",
                "sha256": "0" * 64,
                "reviewer": "Reviewer",
                "status": "待复核",
            }
        ],
    }
    paths.evidence_manifest.write_text(json.dumps(payload), encoding="utf-8")

    checks = validate_evidence(
        paths,
        required_acceptance_ids={"D0-AC-001"},
    )
    codes = {check.code for check in checks}

    assert codes == {
        "EVIDENCE_ACCEPTANCE_UNKNOWN",
        "EVIDENCE_NOT_APPROVED",
        "EVIDENCE_FILE_MISSING",
        "EVIDENCE_ACCEPTANCE_MISSING",
    }


def test_duplicate_evidence_ids_are_rejected(tmp_path: Path) -> None:
    paths = _paths_with_manifest(tmp_path)
    payload = {
        "schema_version": 1,
        "stage": "D0",
        "evidence": [
            {
                "evidence_id": "EVD-D0-DUPLICATE",
                "acceptance_id": "D0-AC-001",
                "path": "tmp/missing-1.txt",
                "sha256": "0" * 64,
                "reviewer": "Reviewer",
                "status": "已复核",
            },
            {
                "evidence_id": "EVD-D0-DUPLICATE",
                "acceptance_id": "D0-AC-001",
                "path": "tmp/missing-2.txt",
                "sha256": "0" * 64,
                "reviewer": "Reviewer",
                "status": "已复核",
            },
        ],
    }
    paths.evidence_manifest.write_text(json.dumps(payload), encoding="utf-8")

    checks = validate_evidence(paths)

    assert any(check.code == "EVIDENCE_ID_DUPLICATE" for check in checks)
