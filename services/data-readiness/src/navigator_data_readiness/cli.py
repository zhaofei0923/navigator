from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from .baseline import write_snapshot
from .d0_candidates import candidate_payloads, write_candidates
from .d0_review import load_and_validate_review_packet, write_review_template
from .d1_sources import load_and_validate_d1_admission, write_d1_candidates
from .models import CheckResult
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
    commands.add_parser(
        "prepare-d1",
        help="Generate D1 source-admission, country-coverage, and domain-alternative templates.",
    )
    d1_validation = commands.add_parser(
        "validate-d1",
        help="Validate completed D1 source registry and domain-source assignments.",
    )
    d1_validation.add_argument("--registry", type=Path, required=True)
    d1_validation.add_argument("--matrix", type=Path, required=True)

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

    if args.command == "prepare-d1":
        written = write_d1_candidates(paths)
        for path in written:
            print(path.relative_to(paths.root).as_posix())
        return 0

    if args.command == "validate-d1":
        registry_path = args.registry if args.registry.is_absolute() else paths.root / args.registry
        matrix_path = args.matrix if args.matrix.is_absolute() else paths.root / args.matrix
        checks = load_and_validate_d1_admission(paths, registry_path, matrix_path)
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
