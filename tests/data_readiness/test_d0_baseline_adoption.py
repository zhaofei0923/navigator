from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from navigator_data_readiness.cli import main
from navigator_data_readiness.d0_baseline_adoption import (
    assess_d0_baseline_adoption,
    load_and_validate_d0_baseline_publication_authorization,
    write_d0_baseline_publication_authorization,
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


def _git(root: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *arguments],
        check=True,
        capture_output=True,
    )
    return result.stdout.decode("utf-8").strip()


def _isolated_repository(tmp_path: Path) -> tuple[RepositoryPaths, str]:
    source = discover_repository()
    (tmp_path / "doc" / "doc").mkdir(parents=True)
    shutil.copy2(source.d0_workbook, tmp_path / "doc" / "doc" / source.d0_workbook.name)
    shutil.copy2(
        source.technical_workbook,
        tmp_path / "doc" / "doc" / source.technical_workbook.name,
    )
    for relative in (
        Path("data/d0/candidates"),
        Path("data/d0/review"),
        Path("data/d0/evidence"),
    ):
        shutil.copytree(source.root / relative, tmp_path / relative)
    for path in (tmp_path / "data" / "d0" / "candidates").glob(
        "d0_baseline_publication_authorization.*.json"
    ):
        path.unlink()
    _git(tmp_path, "init", "--quiet")
    _git(tmp_path, "config", "user.name", "Navigator Tests")
    _git(tmp_path, "config", "user.email", "navigator-tests@example.invalid")
    _git(tmp_path, "add", "--all")
    _git(tmp_path, "commit", "--quiet", "-m", "approval state")
    return discover_repository(tmp_path), _git(tmp_path, "rev-parse", "HEAD")


def _inputs(paths: RepositoryPaths) -> tuple[Path, Path, Path]:
    staged = list((paths.d0_candidates_dir / "publication-staging" / "2026-08-02").glob("*.xlsx"))
    assert len(staged) == 1
    return (
        paths.d0_review_dir / "d0_baseline_adoption_decision.2026-08-02.json",
        paths.d0_candidates_dir / "d0_baseline_publication_readiness.2026-08-02.json",
        staged[0],
    )


def _authorization_output(paths: RepositoryPaths) -> Path:
    return paths.d0_candidates_dir / "d0_baseline_publication_authorization.2026-08-03.json"


def _prepare(paths: RepositoryPaths, approval_commit: str) -> Path:
    decision, readiness, staged = _inputs(paths)
    return write_d0_baseline_publication_authorization(
        paths,
        approval_commit,
        decision,
        readiness,
        staged,
        _authorization_output(paths),
    )


def _codes(report: dict[str, Any]) -> set[str]:
    return {str(check["code"]) for check in report["checks"]}


def test_repository_authorization_is_current_and_waiting_for_publication() -> None:
    paths = discover_repository()
    authorization = _authorization_output(paths)

    packet = load_and_validate_d0_baseline_publication_authorization(paths, authorization)
    report = assess_d0_baseline_adoption(paths, authorization)

    assert packet["approval_commit"] == "70de3b3001a8b556393a17dcf6c1c13ff7756539"
    assert packet["expected_publication"] == {
        "path": paths.d0_workbook.relative_to(paths.root).as_posix(),
        "previous_sha256": "224e9a35bcbb363cf41c007499ba32aa6394cfdbf06331830c02d994e1c7ddff",
        "adopted_sha256": "123394d0ee1744edf86e201bd1c683cafdd222d1ff5c55221eb1f0798e2f0712",
        "required_git_mode": "100644",
        "requires_descendant_commit": True,
    }
    assert report["ready_for_post_publication_d0_rebuild"] is False
    assert _codes(report) == {"D0_ADOPTION_NOT_PUBLISHED"}


def test_writer_binds_git_objects_and_refuses_overwrite(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    output = _prepare(paths, approval_commit)

    packet = load_and_validate_d0_baseline_publication_authorization(paths, output)

    assert packet["approval_commit"] == approval_commit
    assert (
        packet["bindings"]["approved_candidate_workbook"]["git_blob"]
        == packet["bindings"]["staged_workbook"]["git_blob"]
    )
    assert packet["publication_state_at_authorization"] == "authorized_not_published"
    assert output.stat().st_mode & 0o777 == 0o644
    assert list(output.parent.glob(f".{output.name}.*.tmp")) == []
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        _prepare(paths, approval_commit)


def test_adoption_requires_publication_commit_then_passes(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    _decision, _readiness, staged = _inputs(paths)

    before = assess_d0_baseline_adoption(paths, authorization)
    assert _codes(before) == {"D0_ADOPTION_NOT_PUBLISHED"}

    shutil.copy2(staged, paths.d0_workbook)
    uncommitted = assess_d0_baseline_adoption(paths, authorization)
    assert _codes(uncommitted) == {"D0_ADOPTION_NOT_COMMITTED"}

    _git(paths.root, "add", "--all")
    _git(paths.root, "commit", "--quiet", "-m", "publish approved D0 baseline")
    published = assess_d0_baseline_adoption(paths, authorization)
    assert published["ready_for_post_publication_d0_rebuild"] is True
    assert published["checks"] == []
    assert published["current_head"] != approval_commit
    assert published["current_authoritative_workbook"]["git_blob"]


def test_adoption_rejects_unexpected_hash_and_packet_tampering(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    authorization = _prepare(paths, approval_commit)
    paths.d0_workbook.write_bytes(paths.d0_workbook.read_bytes() + b"unexpected")

    unexpected = assess_d0_baseline_adoption(paths, authorization)
    assert _codes(unexpected) == {"D0_ADOPTION_UNEXPECTED_HASH"}

    packet = _load(authorization)
    packet["expected_publication"]["adopted_sha256"] = "0" * 64
    _write(authorization, packet)
    tampered = assess_d0_baseline_adoption(paths, authorization)
    assert _codes(tampered) == {"D0_ADOPTION_AUTHORIZATION_INVALID"}


def test_cli_prepares_authorization_and_reports_pending_adoption(tmp_path: Path) -> None:
    paths, approval_commit = _isolated_repository(tmp_path)
    decision, readiness, staged = _inputs(paths)
    authorization = _authorization_output(paths)

    prepare_exit = main(
        [
            "--repo",
            str(paths.root),
            "prepare-d0-baseline-publication-authorization",
            "--approval-commit",
            approval_commit,
            "--decision",
            str(decision),
            "--readiness",
            str(readiness),
            "--workbook",
            str(staged),
            "--output",
            str(authorization),
        ]
    )
    report_output = paths.d0_candidates_dir / "d0_baseline_adoption_assessment.test.json"
    validate_exit = main(
        [
            "--repo",
            str(paths.root),
            "validate-d0-baseline-adoption",
            "--authorization",
            str(authorization),
            "--output",
            str(report_output),
        ]
    )

    assert prepare_exit == 0
    assert validate_exit == 1
    assert _codes(_load(report_output)) == {"D0_ADOPTION_NOT_PUBLISHED"}
