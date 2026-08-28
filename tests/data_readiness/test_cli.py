from __future__ import annotations

import secrets
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
    assert '"ready": true' in captured.out


def test_gate_command_passes_current_d0(capsys: CaptureFixture[str]) -> None:
    paths = discover_repository()

    exit_code = main(["--repo", str(paths.root), "gate", "--stage", "D0"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "门禁结论：通过" in captured.out


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


def test_prepare_d0_acceptance_review_command_lists_outputs(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    review = paths.d0_review_dir / "review.json"
    resolution = paths.d0_review_dir / "resolution.json"
    workbook = paths.d0_candidates_dir / "candidate.xlsx"
    bundle = paths.d0_candidates_dir / "acceptance-review.2026-08-02.json"
    worksheet = paths.d0_review_dir / "acceptance-review.2026-08-02.md"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_d0_acceptance_review_bundle",
        lambda *_args: (bundle, worksheet),
    )

    exit_code = main(
        [
            "prepare-d0-acceptance-review",
            "--review",
            str(review),
            "--resolution",
            str(resolution),
            "--workbook",
            str(workbook),
            "--bundle-output",
            str(bundle),
            "--worksheet-output",
            str(worksheet),
        ]
    )

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/d0/candidates/acceptance-review.2026-08-02.json" in captured.out
    assert "data/d0/review/acceptance-review.2026-08-02.md" in captured.out


def test_prepare_d0_acceptance_confirmation_command_lists_template(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    bundle = paths.d0_candidates_dir / "acceptance-review.2026-08-02.json"
    output = paths.d0_review_dir / "acceptance-confirmation.template.2026-08-02.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_d0_acceptance_confirmation_template",
        lambda *_args: output,
    )

    exit_code = main(
        [
            "prepare-d0-acceptance-confirmation",
            "--bundle",
            str(bundle),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/d0/review/acceptance-confirmation.template.2026-08-02.json" in captured.out


def test_apply_d0_acceptance_confirmation_command_lists_outputs(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    confirmation = paths.evidence_manifest.parent / "confirmation.json"
    bundle = paths.d0_candidates_dir / "acceptance-review.2026-08-02.json"
    review = paths.d0_review_dir / "review.2026-08-02.json"
    manifest = paths.evidence_manifest
    monkeypatch.setattr(
        "navigator_data_readiness.cli.apply_d0_acceptance_confirmation",
        lambda *_args: (review, manifest),
    )

    exit_code = main(
        [
            "apply-d0-acceptance-confirmation",
            "--input",
            str(confirmation),
            "--bundle",
            str(bundle),
            "--review-output",
            str(review),
            "--manifest-output",
            str(manifest),
        ]
    )

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "data/d0/review/review.2026-08-02.json" in captured.out
    assert "data/d0/evidence/manifest.json" in captured.out


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


def test_validate_d0_baseline_change_command_writes_assessment(
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
        "navigator_data_readiness.cli.load_and_assess_d0_baseline_change",
        lambda *_args: {
            "candidate_ready_for_formal_baseline_review": False,
            "checks": [{"code": "D0_CHANGE_TEST_BLOCKER"}],
        },
    )

    exit_code = main(
        [
            "validate-d0-baseline-change",
            "--resolution",
            str(resolution),
            "--workbook",
            str(workbook),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 1
    assert "D0_CHANGE_TEST_BLOCKER" in output.read_text(encoding="utf-8")
    captured = capsys.readouterr()
    assert str(output) in captured.out


def test_prepare_d0_baseline_change_command_reports_generated_candidate(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    resolution = tmp_path / "resolution.json"
    candidate = tmp_path / "candidate.xlsx"
    assessment = tmp_path / "assessment.json"
    resolution.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        "navigator_data_readiness.cli.load_and_generate_d0_candidate_workbook",
        lambda *_args: {
            "candidate_written": True,
            "candidate_ready_for_formal_baseline_review": True,
            "checks": [],
        },
    )

    exit_code = main(
        [
            "prepare-d0-baseline-change",
            "--resolution",
            str(resolution),
            "--output",
            str(candidate),
            "--assessment-output",
            str(assessment),
        ]
    )

    assert exit_code == 0
    assert '"candidate_written": true' in assessment.read_text(encoding="utf-8")
    captured = capsys.readouterr()
    assert str(candidate) in captured.out
    assert str(assessment) in captured.out


def test_prepare_d0_baseline_change_rejects_conflicting_outputs(
    tmp_path: Path,
    capsys: CaptureFixture[str],
) -> None:
    resolution = tmp_path / "resolution.json"
    output = tmp_path / "candidate.xlsx"
    resolution.write_text("{}", encoding="utf-8")

    same_path_exit = main(
        [
            "prepare-d0-baseline-change",
            "--resolution",
            str(resolution),
            "--output",
            str(output),
            "--assessment-output",
            str(output),
        ]
    )
    report = tmp_path / "existing.json"
    report.write_text("keep", encoding="utf-8")
    existing_exit = main(
        [
            "prepare-d0-baseline-change",
            "--resolution",
            str(resolution),
            "--output",
            str(output),
            "--assessment-output",
            str(report),
        ]
    )

    assert same_path_exit == 1
    assert existing_exit == 1
    assert report.read_text(encoding="utf-8") == "keep"
    captured = capsys.readouterr()
    assert "must be different" in captured.err
    assert "will not be overwritten" in captured.err


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


def test_prepare_basic60_private_command_lists_isolated_outputs(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    seed = paths.root / "runtime/basic60/basic60_seed.json"
    template = paths.root / "data/basic60/candidates/basic60_private_acceptance.template.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.prepare_basic60_private",
        lambda *_args: (
            [seed, template],
            {"status": "not_ready", "checks": [{"code": "B60_HUMAN_APPROVALS_PENDING"}]},
        ),
    )

    exit_code = main(["prepare-basic60-private"])

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "runtime/basic60/basic60_seed.json" in captured.out
    assert "data/basic60/candidates/basic60_private_acceptance.template.json" in captured.out


def test_materialize_basic60_l0_command_lists_three_unsigned_batch_manifests(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    manifests = [
        paths.root / "data/basic60/evidence/l0-run" / name
        for name in (
            "basic60-batch-profile.l0-manifest.json",
            "basic60-batch-macro.l0-manifest.json",
            "basic60-batch-energy.l0-manifest.json",
        )
    ]
    monkeypatch.setattr(
        "navigator_data_readiness.cli.materialize_basic60_l0",
        lambda *_args: manifests,
    )

    exit_code = main(
        [
            "materialize-basic60-l0",
            "--bundle",
            "data/basic60/review/d1-approved.json",
            "--l0-dir",
            "/tmp/navigator-basic60-l0",
            "--evidence-dir",
            "data/basic60/evidence/l0-run",
            "--volume-id",
            "basic60-volume-01",
        ]
    )

    assert exit_code == 0
    captured = capsys.readouterr()
    assert all(path.relative_to(paths.root).as_posix() in captured.out for path in manifests)


def test_collect_basic60_machine_evidence_command_lists_single_report(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    paths = discover_repository()
    report = paths.root / "runtime/basic60/machine/basic60_machine_evidence.json"
    monkeypatch.setattr(
        "navigator_data_readiness.cli.collect_basic60_machine_evidence",
        lambda *_args: report,
    )

    exit_code = main(
        [
            "collect-basic60-machine-evidence",
            "--bundle",
            "data/basic60/review/d1-d3-frozen.json",
            "--operation-logs",
            "runtime/basic60/machine-input/operations.json",
            "--api-observations",
            "runtime/basic60/machine-input/api.json",
            "--route-probes",
            "runtime/basic60/machine-input/routes.json",
        ]
    )

    assert exit_code == 0
    assert report.relative_to(paths.root).as_posix() in capsys.readouterr().out


def test_validate_basic60_private_command_uses_only_private_terminal_statuses(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.cli.load_and_assess_basic60_private",
        lambda *_args: {
            "status": "revoked",
            "formal_gate_status": "pending",
            "checks": [],
        },
    )

    exit_code = main(["validate-basic60-private"])

    assert exit_code == 2
    captured = capsys.readouterr()
    assert '"status": "revoked"' in captured.out
    assert '"formal_gate_status": "pending"' in captured.out


def test_validate_basic60_ready_requires_runtime_attestation_key(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.cli.load_and_assess_basic60_private",
        lambda *_args: {
            "status": "private_trial_ready",
            "formal_gate_status": "pending",
            "checks": [],
        },
    )
    monkeypatch.delenv("BASIC60_RUNTIME_ATTESTATION_KEY", raising=False)

    exit_code = main(["validate-basic60-private"])

    assert exit_code == 1
    assert "BASIC60_RUNTIME_ATTESTATION_KEY must contain at least 32" in capsys.readouterr().err


def test_validate_basic60_ready_rejects_known_attestation_key_examples(
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.cli.load_and_assess_basic60_private",
        lambda *_args: {
            "status": "private_trial_ready",
            "formal_gate_status": "pending",
            "checks": [],
        },
    )
    for trust_key in (
        "replace-me",
        "replace-with-at-least-32-random-bytes",
        "test-runtime-attestation-key-with-32-bytes",
        "basic60-test-runtime-attestation-key-32-bytes",
        "example-value-runtime-attestation-key-32-bytes",
    ):
        monkeypatch.setenv("BASIC60_RUNTIME_ATTESTATION_KEY", trust_key)

        assert main(["validate-basic60-private"]) == 1
        assert "known placeholder or example value" in capsys.readouterr().err


def test_validate_basic60_ready_emits_runtime_machine_attestation(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    ready_seed = tmp_path / "ready-seed.json"
    authorization = tmp_path / "authorization.json"
    attestation = tmp_path / "attestation.json"
    called: dict[str, str] = {}
    monkeypatch.setattr(
        "navigator_data_readiness.cli.load_and_assess_basic60_private",
        lambda *_args: {
            "status": "private_trial_ready",
            "formal_gate_status": "pending",
            "checks": [],
        },
    )
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_basic60_ready_seed",
        lambda *_args, **_kwargs: ready_seed,
    )
    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_basic60_release_authorization",
        lambda *_args, **_kwargs: authorization,
    )

    def fake_attestation(*_args: object, **kwargs: object) -> Path:
        called["trust_key"] = str(kwargs["trust_key"])
        return attestation

    monkeypatch.setattr(
        "navigator_data_readiness.cli.write_basic60_runtime_attestation",
        fake_attestation,
    )
    trust_key = secrets.token_hex(32)
    monkeypatch.setenv("BASIC60_RUNTIME_ATTESTATION_KEY", trust_key)

    exit_code = main(
        [
            "validate-basic60-private",
            "--output",
            str(tmp_path / "validation.json"),
        ]
    )

    assert exit_code == 0
    assert called["trust_key"] == trust_key
    assert f"Runtime machine attestation: {attestation}" in capsys.readouterr().err


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


def test_prepare_p0_baseline_change_command_reports_generated_candidate(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
    capsys: CaptureFixture[str],
) -> None:
    resolution = tmp_path / "resolution.json"
    candidate = tmp_path / "candidate.xlsx"
    assessment = tmp_path / "assessment.json"
    resolution.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        "navigator_data_readiness.cli.load_and_generate_p0_candidate_workbook",
        lambda *_args: {
            "candidate_written": True,
            "candidate_ready_for_formal_baseline_review": True,
            "checks": [],
        },
    )

    exit_code = main(
        [
            "prepare-p0-baseline-change",
            "--resolution",
            str(resolution),
            "--output",
            str(candidate),
            "--assessment-output",
            str(assessment),
        ]
    )

    assert exit_code == 0
    assert '"candidate_written": true' in assessment.read_text(encoding="utf-8")
    captured = capsys.readouterr()
    assert str(candidate) in captured.out
    assert str(assessment) in captured.out


def test_prepare_p0_baseline_change_rejects_conflicting_outputs(
    tmp_path: Path,
    capsys: CaptureFixture[str],
) -> None:
    resolution = tmp_path / "resolution.json"
    output = tmp_path / "candidate.xlsx"
    resolution.write_text("{}", encoding="utf-8")

    same_path_exit = main(
        [
            "prepare-p0-baseline-change",
            "--resolution",
            str(resolution),
            "--output",
            str(output),
            "--assessment-output",
            str(output),
        ]
    )
    report = tmp_path / "existing.json"
    report.write_text("keep", encoding="utf-8")
    existing_exit = main(
        [
            "prepare-p0-baseline-change",
            "--resolution",
            str(resolution),
            "--output",
            str(output),
            "--assessment-output",
            str(report),
        ]
    )

    assert same_path_exit == 1
    assert existing_exit == 1
    assert report.read_text(encoding="utf-8") == "keep"
    captured = capsys.readouterr()
    assert "must be different" in captured.err
    assert "will not be overwritten" in captured.err


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
