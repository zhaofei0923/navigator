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


def test_validate_d0_contract_resolution_command_reports_blockers(
    tmp_path: Path,
    capsys: CaptureFixture[str],
) -> None:
    packet = tmp_path / "resolution.json"
    packet.write_text("{}", encoding="utf-8")

    exit_code = main(["validate-d0-contract-resolution", "--input", str(packet)])

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "D0_CONTRACT_RESOLUTION_HEADER_INVALID" in captured.err


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
    d1_matrix = tmp_path / "d1_matrix.json"
    d1_evidence = tmp_path / "d1_evidence.json"
    bundle.write_text("{}", encoding="utf-8")
    d1_registry.write_text('{"sources": []}', encoding="utf-8")
    d1_matrix.write_text("{}", encoding="utf-8")
    d1_evidence.write_text("{}", encoding="utf-8")

    exit_code = main(
        [
            "validate-d2",
            "--bundle",
            str(bundle),
            "--d1-registry",
            str(d1_registry),
            "--d1-matrix",
            str(d1_matrix),
            "--d1-evidence",
            str(d1_evidence),
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
    d1_registry = tmp_path / "d1_registry.json"
    d1_matrix = tmp_path / "d1_matrix.json"
    d1_evidence = tmp_path / "d1_evidence.json"
    bundle.write_text("{}", encoding="utf-8")
    d2_bundle.write_text("{}", encoding="utf-8")
    d1_registry.write_text("{}", encoding="utf-8")
    d1_matrix.write_text("{}", encoding="utf-8")
    d1_evidence.write_text("{}", encoding="utf-8")

    exit_code = main(
        [
            "validate-d3",
            "--bundle",
            str(bundle),
            "--d2-bundle",
            str(d2_bundle),
            "--d1-registry",
            str(d1_registry),
            "--d1-matrix",
            str(d1_matrix),
            "--d1-evidence",
            str(d1_evidence),
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


def test_prepare_p0_traceability_command_lists_candidates(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    candidate = paths.p0_candidates_dir / "p0_traceability_assessment.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_p0_traceability_candidates",
        lambda _paths: [candidate],
    )

    exit_code = main(["prepare-p0-traceability"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/p0/candidates/p0_traceability_assessment.json" in captured.out


def test_assess_p0_traceability_command_outputs_machine_boundary(
    capsys: CaptureFixture[str],
) -> None:
    exit_code = main(["assess-p0-traceability", "--format", "json"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert '"p0_requirements": 90' in captured.out
    assert '"does_not_authorize_user_facing_development": true' in captured.out


def test_prepare_p0_resolution_command_lists_template(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    template = paths.p0_candidates_dir / "p0_traceability_resolution.template.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_p0_resolution_template",
        lambda _paths: template,
    )

    exit_code = main(["prepare-p0-resolution"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/p0/candidates/p0_traceability_resolution.template.json" in captured.out


def test_validate_p0_resolution_command_reports_blockers(
    tmp_path: Path,
    capsys: CaptureFixture[str],
) -> None:
    packet = tmp_path / "resolution.json"
    packet.write_text("{}", encoding="utf-8")

    exit_code = main(["validate-p0-resolution", "--input", str(packet)])

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "P0_RESOLUTION_HEADER_INVALID" in captured.err


def test_validate_p0_baseline_change_command_writes_assessment(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    resolution = tmp_path / "resolution.json"
    workbook = tmp_path / "candidate.xlsx"
    output = tmp_path / "assessment.json"
    resolution.write_text("{}", encoding="utf-8")
    workbook.write_bytes(b"candidate")
    monkeypatch.setattr(
        "navigator_data_readiness.cli.load_and_assess_p0_baseline_change",
        lambda *_args: {
            "candidate_ready_for_formal_baseline_review": False,
            "checks": [{"code": "P0_CHANGE_TEST_BLOCKER"}],
        },
    )

    exit_code = main(
        [
            "validate-p0-baseline-change",
            "--resolution",
            str(resolution),
            "--workbook",
            str(workbook),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 1
    assert "P0_CHANGE_TEST_BLOCKER" in output.read_text(encoding="utf-8")
    captured = capsys.readouterr()
    assert str(output) in captured.out


def test_prepare_p0_delivery_command_lists_template(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    template = paths.p0_candidates_dir / "p0_delivery_evidence.template.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_p0_delivery_template",
        lambda _paths: template,
    )

    exit_code = main(["prepare-p0-delivery"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/p0/candidates/p0_delivery_evidence.template.json" in captured.out


def test_validate_p0_delivery_command_reports_blockers(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    inputs = [tmp_path / f"input-{index}.json" for index in range(7)]
    for path in inputs:
        path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        "navigator_data_readiness.cli.load_and_validate_p0_delivery_bundle",
        lambda *_args: [CheckResult(code="P0_DELIVERY_TEST_BLOCKER", message="failed")],
    )

    exit_code = main(
        [
            "validate-p0-delivery",
            "--bundle",
            str(inputs[0]),
            "--d4-bundle",
            str(inputs[1]),
            "--d3-bundle",
            str(inputs[2]),
            "--d2-bundle",
            str(inputs[3]),
            "--d1-registry",
            str(inputs[4]),
            "--d1-matrix",
            str(inputs[5]),
            "--d1-evidence",
            str(inputs[6]),
        ]
    )

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "P0_DELIVERY_TEST_BLOCKER" in captured.err


def test_validate_d4_command_reports_blockers(
    tmp_path: Path,
    capsys: CaptureFixture[str],
) -> None:
    bundle = tmp_path / "bundle.json"
    d3_bundle = tmp_path / "d3.json"
    d2_bundle = tmp_path / "d2.json"
    d1_registry = tmp_path / "d1_registry.json"
    d1_matrix = tmp_path / "d1_matrix.json"
    d1_evidence = tmp_path / "d1_evidence.json"
    bundle.write_text("{}", encoding="utf-8")
    d3_bundle.write_text("{}", encoding="utf-8")
    d2_bundle.write_text("{}", encoding="utf-8")
    d1_registry.write_text("{}", encoding="utf-8")
    d1_matrix.write_text("{}", encoding="utf-8")
    d1_evidence.write_text("{}", encoding="utf-8")

    exit_code = main(
        [
            "validate-d4",
            "--bundle",
            str(bundle),
            "--d3-bundle",
            str(d3_bundle),
            "--d2-bundle",
            str(d2_bundle),
            "--d1-registry",
            str(d1_registry),
            "--d1-matrix",
            str(d1_matrix),
            "--d1-evidence",
            str(d1_evidence),
        ]
    )

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "D4_HEADER_INVALID" in captured.err
