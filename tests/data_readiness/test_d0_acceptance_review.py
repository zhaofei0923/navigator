from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from navigator_data_readiness.d0_acceptance_review import (
    build_d0_acceptance_review_bundle,
    render_d0_acceptance_review_worksheet,
    write_d0_acceptance_review_bundle,
)
from navigator_data_readiness.paths import discover_repository


def _inputs() -> tuple[Path, Path, Path]:
    paths = discover_repository()
    return (
        paths.d0_review_dir / "d0_review_packet.2026-08-01.json",
        paths.d0_review_dir / "core_contract_resolution.2026-08-01.json",
        paths.d0_candidates_dir / "d0_core_contract_candidate.2026-08-01.xlsx",
    )


def _load(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


def test_bundle_exposes_every_currently_reviewable_acceptance() -> None:
    paths = discover_repository()
    review_path, resolution_path, workbook_path = _inputs()
    review = _load(review_path)
    resolution = _load(resolution_path)
    bundle_path = paths.d0_candidates_dir / "test-review-bundle.2026-08-02.json"

    bundle = build_d0_acceptance_review_bundle(
        paths,
        review,
        review_path,
        resolution,
        resolution_path,
        workbook_path,
        bundle_path,
    )

    assert bundle["summary"] == {
        "ready_for_human_review": [
            "D0-AC-001",
            "D0-AC-002",
            "D0-AC-003",
            "D0-AC-004",
            "D0-AC-005",
            "D0-AC-006",
            "D0-AC-008",
        ],
        "already_approved": ["D0-AC-007"],
        "blocked": ["D0-AC-009", "D0-AC-010"],
    }
    assert len(bundle["evidence_manifest_templates"]) == 7
    assert bundle["effective_machine_results"]["candidate_ac001"]["machine_status"] == "pass"
    assert bundle["effective_machine_results"]["candidate_ac002"]["machine_status"] == "pass"
    assert bundle["effective_machine_results"]["enum_ac003"]["machine_status"] == "pass"
    assert bundle["effective_machine_results"]["effective_template_trial"]["status"] == "pass"
    assert (
        bundle["effective_machine_results"]["effective_gold_standard"]["status"]
        == "candidate_ready_for_review"
    )

    serialized = (json.dumps(bundle, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    worksheet = render_d0_acceptance_review_worksheet(
        bundle,
        bundle_path="data/d0/candidates/test-review-bundle.2026-08-02.json",
        bundle_sha256=hashlib.sha256(serialized).hexdigest(),
    )
    assert "D0-AC-001" in worksheet
    assert "D0-AC-008" in worksheet
    assert "D0-AC-009：须等待" in worksheet
    assert hashlib.sha256(serialized).hexdigest() in worksheet


def test_writer_publishes_hash_bound_bundle_without_overwrite(tmp_path: Path) -> None:
    paths = discover_repository()
    review_path, resolution_path, workbook_path = _inputs()
    bundle_output = tmp_path / "bundle.2026-08-02.json"
    worksheet_output = tmp_path / "worksheet.md"

    written = write_d0_acceptance_review_bundle(
        paths,
        review_path,
        resolution_path,
        workbook_path,
        bundle_output,
        worksheet_output,
    )

    assert written == (bundle_output, worksheet_output)
    bundle_hash = hashlib.sha256(bundle_output.read_bytes()).hexdigest()
    assert bundle_hash in worksheet_output.read_text(encoding="utf-8")
    assert bundle_output.stat().st_mode & 0o777 == 0o644
    assert worksheet_output.stat().st_mode & 0o777 == 0o644
    assert list(tmp_path.glob(".*.tmp")) == []
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        write_d0_acceptance_review_bundle(
            paths,
            review_path,
            resolution_path,
            workbook_path,
            bundle_output,
            tmp_path / "other.md",
        )


def test_repository_acceptance_review_bundle_is_current() -> None:
    paths = discover_repository()
    review_path, resolution_path, workbook_path = _inputs()
    bundle_path = paths.d0_candidates_dir / "d0_acceptance_review_bundle.2026-08-02.json"
    worksheet_path = paths.d0_review_dir / "d0_acceptance_review_worksheet.2026-08-02.md"

    expected = build_d0_acceptance_review_bundle(
        paths,
        _load(review_path),
        review_path,
        _load(resolution_path),
        resolution_path,
        workbook_path,
        bundle_path,
    )

    assert _load(bundle_path) == expected
    assert hashlib.sha256(bundle_path.read_bytes()).hexdigest() in worksheet_path.read_text(
        encoding="utf-8"
    )


def test_bundle_rejects_invalid_review_or_candidate(tmp_path: Path) -> None:
    paths = discover_repository()
    review_path, resolution_path, workbook_path = _inputs()
    review = _load(review_path)
    resolution = _load(resolution_path)
    stale_review = deepcopy(review)
    stale_review["baseline"]["sources"]["d0_workbook"]["sha256"] = "0" * 64

    with pytest.raises(ValueError, match="non-pending validation errors"):
        build_d0_acceptance_review_bundle(
            paths,
            stale_review,
            review_path,
            resolution,
            resolution_path,
            workbook_path,
            tmp_path / "bundle.2026-08-02.json",
        )

    invalid_review = tmp_path / "invalid-review.json"
    invalid_review.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="must be a JSON object"):
        write_d0_acceptance_review_bundle(
            paths,
            invalid_review,
            resolution_path,
            workbook_path,
            tmp_path / "bundle.2026-08-02.json",
            tmp_path / "worksheet.md",
        )

    with pytest.raises(ValueError, match="filename must contain an ISO date"):
        build_d0_acceptance_review_bundle(
            paths,
            review,
            review_path,
            resolution,
            resolution_path,
            workbook_path,
            tmp_path / "undated-bundle.json",
        )
