from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from navigator_data_readiness.d0_baseline_review import (
    build_d0_baseline_confirmation_template,
    build_d0_baseline_review_bundle,
    load_and_validate_d0_baseline_review_bundle,
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
