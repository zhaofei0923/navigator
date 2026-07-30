from __future__ import annotations

from pathlib import Path

from navigator_data_readiness.cli import main
from navigator_data_readiness.models import CheckResult
from navigator_data_readiness.paths import discover_repository
from pytest import CaptureFixture, MonkeyPatch


def test_validate_command_passes(capsys: CaptureFixture[str]) -> None:
    paths = discover_repository()

    exit_code = main(["--repo", str(paths.root), "validate"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "Baseline validation passed." in captured.out


def test_report_command_outputs_json(capsys: CaptureFixture[str]) -> None:
    paths = discover_repository()

    exit_code = main(["--repo", str(paths.root), "report", "--format", "json"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert '"ready": false' in captured.out


def test_gate_command_blocks_current_d0(capsys: CaptureFixture[str]) -> None:
    paths = discover_repository()

    exit_code = main(["--repo", str(paths.root), "gate", "--stage", "D0"])

    assert exit_code == 2
    captured = capsys.readouterr()
    assert "门禁结论：未通过" in captured.out


def test_report_command_writes_file(tmp_path: Path, capsys: CaptureFixture[str]) -> None:
    paths = discover_repository()
    destination = tmp_path / "report.json"

    exit_code = main(
        [
            "--repo",
            str(paths.root),
            "report",
            "--format",
            "json",
            "--output",
            str(destination),
        ]
    )

    assert exit_code == 0
    assert destination.is_file()
    captured = capsys.readouterr()
    assert str(destination) in captured.out


def test_validate_command_prints_checks(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.cli.validate_structure",
        lambda _paths: [CheckResult(code="TEST_ERROR", message="failed")],
    )

    exit_code = main(["validate"])

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "TEST_ERROR: failed" in captured.err


def test_prepare_d0_command_lists_candidates(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    candidate = paths.d0_candidates_dir / "candidate.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_candidates",
        lambda _paths: [candidate],
    )

    exit_code = main(["prepare-d0"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/d0/candidates/candidate.json" in captured.out


def test_assess_d0_command_outputs_machine_boundary(capsys: CaptureFixture[str]) -> None:
    exit_code = main(["assess-d0", "--format", "json"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert '"automated_assessment_only": true' in captured.out
    assert '"overall_status": "not_ready"' in captured.out
