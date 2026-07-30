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


def test_prepare_d0_review_command_lists_template(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    template = paths.d0_review_dir / "d0_review_packet.template.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_review_template",
        lambda _paths: template,
    )

    exit_code = main(["prepare-d0-review"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/d0/review/d0_review_packet.template.json" in captured.out


def test_validate_d0_review_command_reports_blockers(
    tmp_path: Path,
    capsys: CaptureFixture[str],
) -> None:
    packet = tmp_path / "review.json"
    packet.write_text("{}", encoding="utf-8")

    exit_code = main(["validate-d0-review", "--input", str(packet)])

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "D0_REVIEW_HEADER_INVALID" in captured.err


def test_prepare_d1_command_lists_candidates(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    candidate = paths.d1_candidates_dir / "candidate.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_d1_candidates",
        lambda _paths: [candidate],
    )

    exit_code = main(["prepare-d1"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/d1/candidates/candidate.json" in captured.out


def test_validate_d1_command_reports_blockers(
    tmp_path: Path,
    capsys: CaptureFixture[str],
) -> None:
    registry = tmp_path / "registry.json"
    matrix = tmp_path / "matrix.json"
    evidence = tmp_path / "evidence.json"
    registry.write_text("{}", encoding="utf-8")
    matrix.write_text("{}", encoding="utf-8")
    evidence.write_text("{}", encoding="utf-8")

    exit_code = main(
        [
            "validate-d1",
            "--registry",
            str(registry),
            "--matrix",
            str(matrix),
            "--evidence",
            str(evidence),
        ]
    )

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "D1_REGISTRY_HEADER_INVALID" in captured.err


def test_prepare_d2_command_lists_candidates(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    candidate = paths.d2_candidates_dir / "candidate.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_d2_candidates",
        lambda _paths: [candidate],
    )

    exit_code = main(["prepare-d2"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/d2/candidates/candidate.json" in captured.out


def test_validate_d2_command_reports_blockers(
    tmp_path: Path,
    capsys: CaptureFixture[str],
) -> None:
    bundle = tmp_path / "bundle.json"
    d1_registry = tmp_path / "d1.json"
    bundle.write_text("{}", encoding="utf-8")
    d1_registry.write_text('{"sources": []}', encoding="utf-8")

    exit_code = main(
        [
            "validate-d2",
            "--bundle",
            str(bundle),
            "--d1-registry",
            str(d1_registry),
        ]
    )

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "D2_HEADER_INVALID" in captured.err


def test_prepare_d3_command_lists_candidates(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    candidate = paths.d3_candidates_dir / "candidate.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_d3_candidates",
        lambda _paths: [candidate],
    )

    exit_code = main(["prepare-d3"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/d3/candidates/candidate.json" in captured.out


def test_validate_d3_command_reports_blockers(
    tmp_path: Path,
    capsys: CaptureFixture[str],
) -> None:
    bundle = tmp_path / "bundle.json"
    d2_bundle = tmp_path / "d2.json"
    bundle.write_text("{}", encoding="utf-8")
    d2_bundle.write_text("{}", encoding="utf-8")

    exit_code = main(
        [
            "validate-d3",
            "--bundle",
            str(bundle),
            "--d2-bundle",
            str(d2_bundle),
        ]
    )

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "D3_HEADER_INVALID" in captured.err


def test_prepare_d4_command_lists_candidates(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    candidate = paths.d4_candidates_dir / "candidate.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_d4_candidates",
        lambda _paths: [candidate],
    )

    exit_code = main(["prepare-d4"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/d4/candidates/candidate.json" in captured.out


def test_validate_d4_command_reports_blockers(
    tmp_path: Path,
    capsys: CaptureFixture[str],
) -> None:
    bundle = tmp_path / "bundle.json"
    d3_bundle = tmp_path / "d3.json"
    bundle.write_text("{}", encoding="utf-8")
    d3_bundle.write_text("{}", encoding="utf-8")

    exit_code = main(
        [
            "validate-d4",
            "--bundle",
            str(bundle),
            "--d3-bundle",
            str(d3_bundle),
        ]
    )

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "D4_HEADER_INVALID" in captured.err
