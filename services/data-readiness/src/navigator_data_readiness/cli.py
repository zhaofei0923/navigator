from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from .baseline import write_snapshot
from .d0_acceptance_confirmation import (
    apply_d0_acceptance_confirmation,
    write_d0_acceptance_confirmation_template,
)
from .d0_acceptance_review import write_d0_acceptance_review_bundle
from .d0_baseline_change import (
    load_and_assess_d0_baseline_change,
    load_and_generate_d0_candidate_workbook,
)
from .d0_baseline_review import write_d0_baseline_review_package
from .d0_candidates import candidate_payloads, write_candidates
from .d0_confirmation import write_confirmed_packets
from .d0_contract_resolution import load_and_validate_d0_contract_resolution
from .d0_review import load_and_validate_review_packet, write_review_template
from .d1_sources import load_and_validate_d1_admission, write_d1_candidates
from .d2_collection import load_and_validate_d2_bundle, write_d2_candidates
from .d3_processing import load_and_validate_d3_bundle, write_d3_candidates
from .d4_acceptance import load_and_validate_d4_bundle, write_d4_candidates
from .models import CheckResult
from .p0_baseline_change import (
    load_and_assess_p0_baseline_change,
    load_and_generate_p0_candidate_workbook,
)
from .p0_delivery import (
    load_and_validate_p0_delivery_bundle,
    write_p0_delivery_template,
)
from .p0_resolution import (
    load_and_validate_p0_resolution_packet,
    write_p0_resolution_template,
)
from .p0_traceability import build_p0_traceability_report, write_p0_traceability_candidates
from .paths import discover_repository
from .readiness import build_readiness_report, render_markdown
from .validation import validate_structure


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="navigator-data",
        description="Validate the frozen D0-D4 baseline without mutating source workbooks.",
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=None,
        help="Repository root or a path inside it. Defaults to the current directory.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("validate", help="Validate baseline sheets, identifiers, and dependencies.")
    commands.add_parser("snapshot", help="Write a versioned JSON contract snapshot.")
    commands.add_parser(
        "prepare-d0",
        help="Generate D0 candidate conventions, template-trial, terminology, and gap reports.",
    )
    assessment = commands.add_parser(
        "assess-d0",
        help="Print the machine-verifiable D0 acceptance assessment.",
    )
    assessment.add_argument("--format", choices=("json",), default="json")
    commands.add_parser(
        "prepare-d0-review",
        help="Generate a reviewer-fillable D0 decision and sign-off template.",
    )
    review_validation = commands.add_parser(
        "validate-d0-review",
        help="Validate a completed D0 review packet without changing the frozen workbooks.",
    )
    review_validation.add_argument("--input", type=Path, required=True)
    contract_resolution_validation = commands.add_parser(
        "validate-d0-contract-resolution",
        help=(
            "Validate proposed AC-001/002 contract remediation against the frozen baseline "
            "and signed role assignments."
        ),
    )
    contract_resolution_validation.add_argument("--input", type=Path, required=True)
    confirmation = commands.add_parser(
        "apply-d0-confirmation",
        help=(
            "Expand an authorized structured D0 confirmation into a formal review copy and "
            "complete AC-001/002 resolution without changing the frozen workbook."
        ),
    )
    confirmation.add_argument("--input", type=Path, required=True)
    confirmation.add_argument("--previous-review", type=Path, required=True)
    confirmation.add_argument("--resolution-output", type=Path, required=True)
    confirmation.add_argument("--review-output", type=Path, required=True)
    acceptance_review = commands.add_parser(
        "prepare-d0-acceptance-review",
        help=(
            "Build a hash-bound worksheet for every D0 acceptance item whose current "
            "machine and signed-input prerequisites are ready for human review."
        ),
    )
    acceptance_review.add_argument("--review", type=Path, required=True)
    acceptance_review.add_argument("--resolution", type=Path, required=True)
    acceptance_review.add_argument("--workbook", type=Path, required=True)
    acceptance_review.add_argument("--bundle-output", type=Path, required=True)
    acceptance_review.add_argument("--worksheet-output", type=Path, required=True)
    acceptance_confirmation = commands.add_parser(
        "prepare-d0-acceptance-confirmation",
        help=(
            "Generate a reviewer-fillable confirmation template bound to the exact current "
            "D0 acceptance review bundle hash."
        ),
    )
    acceptance_confirmation.add_argument("--bundle", type=Path, required=True)
    acceptance_confirmation.add_argument("--output", type=Path, required=True)
    acceptance_application = commands.add_parser(
        "apply-d0-acceptance-confirmation",
        help=(
            "Apply an authorized, hash-bound D0 acceptance confirmation to a new formal "
            "review copy and evidence manifest without activating the frozen workbook."
        ),
    )
    acceptance_application.add_argument("--input", type=Path, required=True)
    acceptance_application.add_argument("--bundle", type=Path, required=True)
    acceptance_application.add_argument("--review-output", type=Path, required=True)
    acceptance_application.add_argument("--manifest-output", type=Path, required=True)
    d0_change_validation = commands.add_parser(
        "validate-d0-baseline-change",
        help=(
            "Verify that a separate candidate D0 workbook exactly applies a completed "
            "AC-001/002 resolution without activating it."
        ),
    )
    d0_change_validation.add_argument("--resolution", type=Path, required=True)
    d0_change_validation.add_argument("--workbook", type=Path, required=True)
    d0_change_validation.add_argument("--output", type=Path)
    d0_change_generation = commands.add_parser(
        "prepare-d0-baseline-change",
        help=(
            "Generate a new, separately validated D0 candidate workbook from a completed "
            "AC-001/002 resolution."
        ),
    )
    d0_change_generation.add_argument("--resolution", type=Path, required=True)
    d0_change_generation.add_argument("--output", type=Path, required=True)
    d0_change_generation.add_argument("--assessment-output", type=Path)
    d0_baseline_review = commands.add_parser(
        "prepare-d0-baseline-review",
        help=(
            "Generate a hash-bound project-approver package for manual adoption of a validated "
            "D0 candidate workbook without activating it."
        ),
    )
    d0_baseline_review.add_argument("--review", type=Path, required=True)
    d0_baseline_review.add_argument("--resolution", type=Path, required=True)
    d0_baseline_review.add_argument("--workbook", type=Path, required=True)
    d0_baseline_review.add_argument("--bundle-output", type=Path, required=True)
    d0_baseline_review.add_argument("--confirmation-output", type=Path, required=True)
    commands.add_parser(
        "prepare-d1",
        help="Generate D1 source-admission, country-coverage, and domain-alternative templates.",
    )
    d1_validation = commands.add_parser(
        "validate-d1",
        help="Validate completed D1 registry, assignments, and hashed evidence manifest.",
    )
    d1_validation.add_argument("--registry", type=Path, required=True)
    d1_validation.add_argument("--matrix", type=Path, required=True)
    d1_validation.add_argument("--evidence", type=Path, required=True)
    commands.add_parser(
        "prepare-d2",
        help="Generate D2 collection-job, immutable raw-manifest, and stop-signal templates.",
    )
    d2_validation = commands.add_parser(
        "validate-d2",
        help="Validate a completed D2 collection bundle against an approved D1 registry.",
    )
    d2_validation.add_argument("--bundle", type=Path, required=True)
    d2_validation.add_argument("--d1-registry", type=Path, required=True)
    d2_validation.add_argument("--d1-matrix", type=Path, required=True)
    d2_validation.add_argument("--d1-evidence", type=Path, required=True)
    commands.add_parser(
        "prepare-d3",
        help="Generate D3 replayable parsing, normalization, and entity-resolution templates.",
    )
    d3_validation = commands.add_parser(
        "validate-d3",
        help="Validate a completed D3 candidate-processing bundle against a closed D2 bundle.",
    )
    d3_validation.add_argument("--bundle", type=Path, required=True)
    d3_validation.add_argument("--d2-bundle", type=Path, required=True)
    d3_validation.add_argument("--d1-registry", type=Path, required=True)
    d3_validation.add_argument("--d1-matrix", type=Path, required=True)
    d3_validation.add_argument("--d1-evidence", type=Path, required=True)
    commands.add_parser(
        "prepare-d4",
        help="Generate D4 quality, sampling, seed-package, rehearsal, and sign-off templates.",
    )
    d4_validation = commands.add_parser(
        "validate-d4",
        help="Validate a completed D4 acceptance bundle against an approved D3 bundle.",
    )
    d4_validation.add_argument("--bundle", type=Path, required=True)
    d4_validation.add_argument("--d3-bundle", type=Path, required=True)
    d4_validation.add_argument("--d2-bundle", type=Path, required=True)
    d4_validation.add_argument("--d1-registry", type=Path, required=True)
    d4_validation.add_argument("--d1-matrix", type=Path, required=True)
    d4_validation.add_argument("--d1-evidence", type=Path, required=True)
    commands.add_parser(
        "prepare-p0-traceability",
        help="Generate the P0 requirement-to-route/API/permission/test preflight artifacts.",
    )
    p0_assessment = commands.add_parser(
        "assess-p0-traceability",
        help="Print the machine-verifiable P0 traceability and delivery preflight.",
    )
    p0_assessment.add_argument("--format", choices=("json",), default="json")
    commands.add_parser(
        "prepare-p0-resolution",
        help="Generate a reviewer-fillable packet for current P0 traceability gaps.",
    )
    p0_resolution_validation = commands.add_parser(
        "validate-p0-resolution",
        help="Validate a proposed P0 traceability change packet against the frozen baseline.",
    )
    p0_resolution_validation.add_argument("--input", type=Path, required=True)
    p0_change_validation = commands.add_parser(
        "validate-p0-baseline-change",
        help=(
            "Verify that a separate candidate technical workbook exactly applies a completed "
            "P0 resolution without activating it."
        ),
    )
    p0_change_validation.add_argument("--resolution", type=Path, required=True)
    p0_change_validation.add_argument("--workbook", type=Path, required=True)
    p0_change_validation.add_argument("--output", type=Path)
    p0_change_generation = commands.add_parser(
        "prepare-p0-baseline-change",
        help=(
            "Generate a new, separately validated P0 candidate technical workbook from a "
            "completed traceability resolution."
        ),
    )
    p0_change_generation.add_argument("--resolution", type=Path, required=True)
    p0_change_generation.add_argument("--output", type=Path, required=True)
    p0_change_generation.add_argument("--assessment-output", type=Path)
    commands.add_parser(
        "prepare-p0-delivery",
        help=(
            "Generate a P0 implementation, test, acceptance, metric, and release evidence template."
        ),
    )
    p0_delivery_validation = commands.add_parser(
        "validate-p0-delivery",
        help="Validate completed P0 delivery evidence and replay the full D4 dependency chain.",
    )
    p0_delivery_validation.add_argument("--bundle", type=Path, required=True)
    p0_delivery_validation.add_argument("--d4-bundle", type=Path, required=True)
    p0_delivery_validation.add_argument("--d3-bundle", type=Path, required=True)
    p0_delivery_validation.add_argument("--d2-bundle", type=Path, required=True)
    p0_delivery_validation.add_argument("--d1-registry", type=Path, required=True)
    p0_delivery_validation.add_argument("--d1-matrix", type=Path, required=True)
    p0_delivery_validation.add_argument("--d1-evidence", type=Path, required=True)

    report = commands.add_parser("report", help="Render the current D0 readiness report.")
    report.add_argument("--format", choices=("markdown", "json"), default="markdown")
    report.add_argument("--output", type=Path)

    gate = commands.add_parser("gate", help="Enforce a formal stage gate.")
    gate.add_argument("--stage", choices=("D0",), required=True)
    gate.add_argument("--format", choices=("markdown", "json"), default="markdown")
    return parser


def _print_checks(checks: Sequence[CheckResult]) -> None:
    if not checks:
        print("Baseline validation passed.")
        return
    for check in checks:
        suffix = f" [{check.location}]" if check.location else ""
        print(f"{check.code}: {check.message}{suffix}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    paths = discover_repository(args.repo)

    if args.command == "validate":
        checks = validate_structure(paths)
        _print_checks(checks)
        return 1 if checks else 0

    if args.command == "snapshot":
        written = write_snapshot(paths)
        for path in written:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "prepare-d0":
        written = write_candidates(paths)
        for path in written:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "assess-d0":
        assessment = candidate_payloads(paths)["acceptance_assessment.json"]
        print(json.dumps(assessment, ensure_ascii=False, indent=2))
        return 0

    if args.command == "prepare-d0-review":
        path = write_review_template(paths)
        print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "validate-d0-review":
        packet_path = args.input if args.input.is_absolute() else paths.root / args.input
        checks = load_and_validate_review_packet(paths, packet_path)
        _print_checks(checks)
        return 1 if checks else 0

    if args.command == "validate-d0-contract-resolution":
        packet_path = args.input if args.input.is_absolute() else paths.root / args.input
        checks = load_and_validate_d0_contract_resolution(paths, packet_path)
        _print_checks(checks)
        return 1 if checks else 0

    if args.command == "apply-d0-confirmation":
        inputs = {
            name: value if value.is_absolute() else paths.root / value
            for name, value in (
                ("confirmation", args.input),
                ("previous_review", args.previous_review),
                ("resolution_output", args.resolution_output),
                ("review_output", args.review_output),
            )
        }
        try:
            confirmed_paths = write_confirmed_packets(
                paths,
                inputs["confirmation"],
                inputs["previous_review"],
                inputs["resolution_output"],
                inputs["review_output"],
            )
        except (OSError, ValueError) as error:
            print(str(error), file=sys.stderr)
            return 1
        for path in confirmed_paths:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "prepare-d0-acceptance-review":
        inputs = {
            name: value if value.is_absolute() else paths.root / value
            for name, value in (
                ("review", args.review),
                ("resolution", args.resolution),
                ("workbook", args.workbook),
                ("bundle_output", args.bundle_output),
                ("worksheet_output", args.worksheet_output),
            )
        }
        try:
            review_paths = write_d0_acceptance_review_bundle(
                paths,
                inputs["review"],
                inputs["resolution"],
                inputs["workbook"],
                inputs["bundle_output"],
                inputs["worksheet_output"],
            )
        except (OSError, ValueError) as error:
            print(str(error), file=sys.stderr)
            return 1
        for path in review_paths:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "prepare-d0-acceptance-confirmation":
        bundle_path = args.bundle if args.bundle.is_absolute() else paths.root / args.bundle
        output = args.output if args.output.is_absolute() else paths.root / args.output
        try:
            confirmation_path = write_d0_acceptance_confirmation_template(
                paths,
                bundle_path,
                output,
            )
        except (OSError, ValueError) as error:
            print(str(error), file=sys.stderr)
            return 1
        print(confirmation_path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "apply-d0-acceptance-confirmation":
        inputs = {
            name: value if value.is_absolute() else paths.root / value
            for name, value in (
                ("confirmation", args.input),
                ("bundle", args.bundle),
                ("review_output", args.review_output),
                ("manifest_output", args.manifest_output),
            )
        }
        try:
            applied_paths = apply_d0_acceptance_confirmation(
                paths,
                inputs["confirmation"],
                inputs["bundle"],
                inputs["review_output"],
                inputs["manifest_output"],
            )
        except (OSError, ValueError) as error:
            print(str(error), file=sys.stderr)
            return 1
        for path in applied_paths:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "validate-d0-baseline-change":
        resolution_path = (
            args.resolution if args.resolution.is_absolute() else paths.root / args.resolution
        )
        workbook_path = args.workbook if args.workbook.is_absolute() else paths.root / args.workbook
        assessment = load_and_assess_d0_baseline_change(
            paths,
            resolution_path,
            workbook_path,
        )
        output = json.dumps(assessment, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            destination = args.output if args.output.is_absolute() else paths.root / args.output
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(output, encoding="utf-8")
            try:
                display_path = destination.relative_to(paths.root).as_posix()
            except ValueError:
                display_path = str(destination)
            print(display_path)
        else:
            print(output, end="")
        return 0 if assessment.get("candidate_ready_for_formal_baseline_review") else 1

    if args.command == "prepare-d0-baseline-change":
        resolution_path = (
            args.resolution if args.resolution.is_absolute() else paths.root / args.resolution
        )
        candidate_output = args.output if args.output.is_absolute() else paths.root / args.output
        assessment_output = (
            args.assessment_output
            if args.assessment_output is None or args.assessment_output.is_absolute()
            else paths.root / args.assessment_output
        )
        if (
            assessment_output is not None
            and assessment_output.resolve() == candidate_output.resolve()
        ):
            print(
                "Assessment output must be different from the candidate workbook path",
                file=sys.stderr,
            )
            return 1
        if assessment_output is not None and assessment_output.exists():
            print(
                f"Assessment output already exists and will not be overwritten: "
                f"{assessment_output}",
                file=sys.stderr,
            )
            return 1
        assessment = load_and_generate_d0_candidate_workbook(
            paths,
            resolution_path,
            candidate_output,
        )
        serialized = json.dumps(assessment, ensure_ascii=False, indent=2) + "\n"
        if assessment_output is not None:
            assessment_output.parent.mkdir(parents=True, exist_ok=True)
            with assessment_output.open("x", encoding="utf-8") as destination:
                destination.write(serialized)
            print(str(assessment_output))
        else:
            print(serialized, end="")
        if assessment.get("candidate_written") is True:
            print(str(candidate_output))
            return 0
        return 1

    if args.command == "prepare-d0-baseline-review":
        inputs = {
            name: value if value.is_absolute() else paths.root / value
            for name, value in (
                ("review", args.review),
                ("resolution", args.resolution),
                ("workbook", args.workbook),
                ("bundle_output", args.bundle_output),
                ("confirmation_output", args.confirmation_output),
            )
        }
        try:
            baseline_review_paths = write_d0_baseline_review_package(
                paths,
                inputs["review"],
                inputs["resolution"],
                inputs["workbook"],
                inputs["bundle_output"],
                inputs["confirmation_output"],
            )
        except (OSError, ValueError) as error:
            print(str(error), file=sys.stderr)
            return 1
        for path in baseline_review_paths:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "prepare-d1":
        written = write_d1_candidates(paths)
        for path in written:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "validate-d1":
        registry_path = args.registry if args.registry.is_absolute() else paths.root / args.registry
        matrix_path = args.matrix if args.matrix.is_absolute() else paths.root / args.matrix
        evidence_path = args.evidence if args.evidence.is_absolute() else paths.root / args.evidence
        checks = load_and_validate_d1_admission(
            paths,
            registry_path,
            matrix_path,
            evidence_path,
        )
        _print_checks(checks)
        return 1 if checks else 0

    if args.command == "prepare-d2":
        written = write_d2_candidates(paths)
        for path in written:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "validate-d2":
        bundle_path = args.bundle if args.bundle.is_absolute() else paths.root / args.bundle
        d1_registry_path = (
            args.d1_registry if args.d1_registry.is_absolute() else paths.root / args.d1_registry
        )
        d1_matrix_path = (
            args.d1_matrix if args.d1_matrix.is_absolute() else paths.root / args.d1_matrix
        )
        d1_evidence_path = (
            args.d1_evidence if args.d1_evidence.is_absolute() else paths.root / args.d1_evidence
        )
        checks = load_and_validate_d2_bundle(
            paths,
            bundle_path,
            d1_registry_path,
            d1_matrix_path,
            d1_evidence_path,
        )
        _print_checks(checks)
        return 1 if checks else 0

    if args.command == "prepare-d3":
        written = write_d3_candidates(paths)
        for path in written:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "validate-d3":
        bundle_path = args.bundle if args.bundle.is_absolute() else paths.root / args.bundle
        d2_bundle_path = (
            args.d2_bundle if args.d2_bundle.is_absolute() else paths.root / args.d2_bundle
        )
        d1_registry_path = (
            args.d1_registry if args.d1_registry.is_absolute() else paths.root / args.d1_registry
        )
        d1_matrix_path = (
            args.d1_matrix if args.d1_matrix.is_absolute() else paths.root / args.d1_matrix
        )
        d1_evidence_path = (
            args.d1_evidence if args.d1_evidence.is_absolute() else paths.root / args.d1_evidence
        )
        checks = load_and_validate_d3_bundle(
            paths,
            bundle_path,
            d2_bundle_path,
            d1_registry_path,
            d1_matrix_path,
            d1_evidence_path,
        )
        _print_checks(checks)
        return 1 if checks else 0

    if args.command == "prepare-d4":
        written = write_d4_candidates(paths)
        for path in written:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "validate-d4":
        bundle_path = args.bundle if args.bundle.is_absolute() else paths.root / args.bundle
        d3_bundle_path = (
            args.d3_bundle if args.d3_bundle.is_absolute() else paths.root / args.d3_bundle
        )
        d2_bundle_path = (
            args.d2_bundle if args.d2_bundle.is_absolute() else paths.root / args.d2_bundle
        )
        d1_registry_path = (
            args.d1_registry if args.d1_registry.is_absolute() else paths.root / args.d1_registry
        )
        d1_matrix_path = (
            args.d1_matrix if args.d1_matrix.is_absolute() else paths.root / args.d1_matrix
        )
        d1_evidence_path = (
            args.d1_evidence if args.d1_evidence.is_absolute() else paths.root / args.d1_evidence
        )
        checks = load_and_validate_d4_bundle(
            paths,
            bundle_path,
            d3_bundle_path,
            d2_bundle_path,
            d1_registry_path,
            d1_matrix_path,
            d1_evidence_path,
        )
        _print_checks(checks)
        return 1 if checks else 0

    if args.command == "prepare-p0-traceability":
        written = write_p0_traceability_candidates(paths)
        for path in written:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "assess-p0-traceability":
        assessment = build_p0_traceability_report(paths)
        print(json.dumps(assessment, ensure_ascii=False, indent=2))
        return 0

    if args.command == "prepare-p0-resolution":
        path = write_p0_resolution_template(paths)
        print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "validate-p0-resolution":
        packet_path = args.input if args.input.is_absolute() else paths.root / args.input
        checks = load_and_validate_p0_resolution_packet(paths, packet_path)
        _print_checks(checks)
        return 1 if checks else 0

    if args.command == "validate-p0-baseline-change":
        resolution_path = (
            args.resolution if args.resolution.is_absolute() else paths.root / args.resolution
        )
        workbook_path = args.workbook if args.workbook.is_absolute() else paths.root / args.workbook
        assessment = load_and_assess_p0_baseline_change(
            paths,
            resolution_path,
            workbook_path,
        )
        output = json.dumps(assessment, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            destination = args.output if args.output.is_absolute() else paths.root / args.output
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(output, encoding="utf-8")
            try:
                display_path = destination.relative_to(paths.root).as_posix()
            except ValueError:
                display_path = str(destination)
            print(display_path)
        else:
            print(output, end="")
        return 0 if assessment.get("candidate_ready_for_formal_baseline_review") else 1

    if args.command == "prepare-p0-baseline-change":
        resolution_path = (
            args.resolution if args.resolution.is_absolute() else paths.root / args.resolution
        )
        candidate_output = args.output if args.output.is_absolute() else paths.root / args.output
        assessment_output = (
            args.assessment_output
            if args.assessment_output is None or args.assessment_output.is_absolute()
            else paths.root / args.assessment_output
        )
        if (
            assessment_output is not None
            and assessment_output.resolve() == candidate_output.resolve()
        ):
            print(
                "Assessment output must be different from the candidate workbook path",
                file=sys.stderr,
            )
            return 1
        if assessment_output is not None and assessment_output.exists():
            print(
                f"Assessment output already exists and will not be overwritten: "
                f"{assessment_output}",
                file=sys.stderr,
            )
            return 1
        assessment = load_and_generate_p0_candidate_workbook(
            paths,
            resolution_path,
            candidate_output,
        )
        serialized = json.dumps(assessment, ensure_ascii=False, indent=2) + "\n"
        if assessment_output is not None:
            assessment_output.parent.mkdir(parents=True, exist_ok=True)
            with assessment_output.open("x", encoding="utf-8") as destination:
                destination.write(serialized)
            print(str(assessment_output))
        else:
            print(serialized, end="")
        if assessment.get("candidate_written") is True:
            print(str(candidate_output))
            return 0
        return 1

    if args.command == "prepare-p0-delivery":
        path = write_p0_delivery_template(paths)
        print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "validate-p0-delivery":
        input_paths = {
            name: value if value.is_absolute() else paths.root / value
            for name, value in (
                ("bundle", args.bundle),
                ("d4_bundle", args.d4_bundle),
                ("d3_bundle", args.d3_bundle),
                ("d2_bundle", args.d2_bundle),
                ("d1_registry", args.d1_registry),
                ("d1_matrix", args.d1_matrix),
                ("d1_evidence", args.d1_evidence),
            )
        }
        checks = load_and_validate_p0_delivery_bundle(
            paths,
            input_paths["bundle"],
            input_paths["d4_bundle"],
            input_paths["d3_bundle"],
            input_paths["d2_bundle"],
            input_paths["d1_registry"],
            input_paths["d1_matrix"],
            input_paths["d1_evidence"],
        )
        _print_checks(checks)
        return 1 if checks else 0

    report = build_readiness_report(paths)
    output = (
        json.dumps(report.to_dict(), ensure_ascii=False, indent=2) + "\n"
        if args.format == "json"
        else render_markdown(report)
    )
    if args.command == "report" and args.output:
        destination = args.output if args.output.is_absolute() else paths.root / args.output
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(output, encoding="utf-8")
        try:
            display_path = destination.relative_to(paths.root).as_posix()
        except ValueError:
            display_path = str(destination)
        print(display_path)
    else:
        print(output, end="")

    if args.command == "gate":
        return 0 if report.ready else 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
