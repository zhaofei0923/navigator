from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, cast

from .baseline import sha256_file
from .d0_baseline_change import assess_d0_baseline_change
from .d0_baseline_review import load_and_validate_d0_baseline_decision
from .models import CheckResult
from .paths import RepositoryPaths


def _display_path(paths: RepositoryPaths, path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(paths.root.resolve()).as_posix()
    except ValueError:
        return str(resolved)


def _repository_binding_path(
    paths: RepositoryPaths,
    binding: Any,
    *,
    label: str,
) -> Path:
    if not isinstance(binding, dict):
        raise ValueError(f"{label} binding must be an object")
    relative = binding.get("path")
    if not isinstance(relative, str) or not relative.strip():
        raise ValueError(f"{label} binding requires a repository-relative path")
    candidate = Path(relative)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError(f"{label} path must be canonical and repository-relative")
    resolved = (paths.root / candidate).resolve()
    if resolved.relative_to(paths.root.resolve()).as_posix() != candidate.as_posix():
        raise ValueError(f"{label} path is not canonical")
    if not resolved.is_file() or sha256_file(resolved) != binding.get("sha256"):
        raise ValueError(f"{label} binding does not match the current file")
    return resolved


def _load_bound_object(path: Path, expected_hash: str, *, label: str) -> dict[str, Any]:
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != expected_hash:
        raise ValueError(f"{label} changed after its binding was validated")
    payload = json.loads(content.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload


def _report(paths: RepositoryPaths, decision_path: Path, staged_workbook: Path) -> dict[str, Any]:
    source = paths.d0_workbook.resolve()
    decision = decision_path.resolve()
    staged = staged_workbook.resolve()
    return {
        "schema_version": 1,
        "stage": "D0",
        "assessment_scope": "approved D0 baseline manual-publication handoff",
        "operation": "validate manual D0 baseline publication readiness",
        "automated_assessment_only": True,
        "does_not_publish_baseline": True,
        "does_not_activate_baseline": True,
        "does_not_complete_d0": True,
        "source_workbook": {
            "path": _display_path(paths, source),
            "sha256": sha256_file(source),
        },
        "decision_record": {
            "path": _display_path(paths, decision),
            "sha256": sha256_file(decision) if decision.is_file() else None,
            "decision": None,
        },
        "expected_candidate_workbook": None,
        "staged_workbook": {
            "path": _display_path(paths, staged),
            "sha256": sha256_file(staged) if staged.is_file() else None,
        },
        "baseline_change_assessment": None,
        "ready_for_manual_baseline_publication": False,
        "checks": [],
        "warning": (
            "A passing report is a read-only handoff check. It does not replace or activate the "
            "authoritative workbook, approve AC-009/010, complete D0/D4, or authorize "
            "user-facing development."
        ),
    }


def assess_d0_baseline_publication(
    paths: RepositoryPaths,
    decision_path: Path,
    staged_workbook: Path,
) -> dict[str, Any]:
    """Assess an approved decision and staged workbook without publishing either file."""
    report = _report(paths, decision_path, staged_workbook)
    checks: list[CheckResult] = []
    try:
        decision = load_and_validate_d0_baseline_decision(paths, decision_path)
    except (OSError, ValueError) as error:
        checks.append(
            CheckResult(
                code="D0_PUBLICATION_DECISION_INVALID",
                message=f"The baseline adoption decision is invalid: {error}",
                location=str(decision_path.resolve()),
            )
        )
        report["checks"] = [check.to_dict() for check in checks]
        return report

    decision_summary = report["decision_record"]
    if isinstance(decision_summary, dict):
        decision_summary["decision"] = decision["decision"]
    if decision.get("decision") != "approved_for_manual_adoption" or (
        decision.get("manual_baseline_adoption_authorized") is not True
    ):
        checks.append(
            CheckResult(
                code="D0_PUBLICATION_DECISION_NOT_APPROVED",
                message="The project approver did not authorize manual baseline adoption",
                location=str(decision_path.resolve()),
            )
        )

    inputs = decision.get("inputs")
    if not isinstance(inputs, dict):
        checks.append(
            CheckResult(
                code="D0_PUBLICATION_INPUTS_INVALID",
                message="The approved decision has no replayable baseline inputs",
                location=str(decision_path.resolve()),
            )
        )
        report["checks"] = [check.to_dict() for check in checks]
        return report
    candidate_binding = inputs.get("candidate_workbook")
    resolution_binding = inputs.get("resolution")
    try:
        candidate_path = _repository_binding_path(
            paths,
            candidate_binding,
            label="D0 approved candidate workbook",
        )
        resolution_path = _repository_binding_path(
            paths,
            resolution_binding,
            label="D0 approved contract resolution",
        )
    except (OSError, ValueError) as error:
        checks.append(
            CheckResult(
                code="D0_PUBLICATION_INPUT_BINDING_INVALID",
                message=f"The approved baseline input binding is invalid: {error}",
                location=str(decision_path.resolve()),
            )
        )
        report["checks"] = [check.to_dict() for check in checks]
        return report
    candidate_binding_object = cast(dict[str, Any], candidate_binding)
    resolution_binding_object = cast(dict[str, Any], resolution_binding)
    expected_candidate_hash = str(candidate_binding_object["sha256"])
    expected_resolution_hash = str(resolution_binding_object["sha256"])
    report["expected_candidate_workbook"] = {
        "path": _display_path(paths, candidate_path),
        "sha256": expected_candidate_hash,
    }

    source = paths.d0_workbook.resolve()
    staged = staged_workbook.resolve()
    if staged == source:
        checks.append(
            CheckResult(
                code="D0_PUBLICATION_SOURCE_WORKBOOK_FORBIDDEN",
                message="The current authoritative workbook cannot be used as the staged target",
                location=str(staged),
            )
        )
    if staged.is_relative_to((paths.root / "doc").resolve()):
        checks.append(
            CheckResult(
                code="D0_PUBLICATION_DOC_STAGING_FORBIDDEN",
                message="The staged workbook must remain outside the authoritative doc tree",
                location=str(staged),
            )
        )
    if staged.name != source.name:
        checks.append(
            CheckResult(
                code="D0_PUBLICATION_FILENAME_MISMATCH",
                message="The staged workbook filename must match the authoritative workbook",
                location=str(staged),
            )
        )
    if not staged.is_file():
        checks.append(
            CheckResult(
                code="D0_PUBLICATION_STAGED_WORKBOOK_MISSING",
                message="The staged authoritative workbook does not exist",
                location=str(staged),
            )
        )
    elif sha256_file(staged) != expected_candidate_hash:
        checks.append(
            CheckResult(
                code="D0_PUBLICATION_STAGED_HASH_MISMATCH",
                message="The staged workbook does not match the approved candidate SHA-256",
                location=str(staged),
            )
        )

    staged_hash_matches = staged.is_file() and sha256_file(staged) == expected_candidate_hash
    if staged_hash_matches:
        try:
            resolution_payload = _load_bound_object(
                resolution_path,
                expected_resolution_hash,
                label="D0 approved contract resolution",
            )
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            checks.append(
                CheckResult(
                    code="D0_PUBLICATION_RESOLUTION_INVALID",
                    message=f"The approved D0 contract resolution is invalid: {error}",
                    location=str(resolution_path),
                )
            )
        else:
            baseline_assessment = assess_d0_baseline_change(
                paths,
                resolution_payload,
                staged,
            )
            report["baseline_change_assessment"] = {
                "candidate_ready_for_formal_baseline_review": baseline_assessment.get(
                    "candidate_ready_for_formal_baseline_review"
                ),
                "resolution_sha256": baseline_assessment.get("resolution_sha256"),
                "checks": baseline_assessment.get("checks"),
            }
            if baseline_assessment.get("candidate_ready_for_formal_baseline_review") is not True:
                checks.append(
                    CheckResult(
                        code="D0_PUBLICATION_BASELINE_REPLAY_FAILED",
                        message=(
                            "The staged workbook failed the complete AC-001/002 baseline replay"
                        ),
                        location=str(staged),
                    )
                )

    report["ready_for_manual_baseline_publication"] = not checks
    report["checks"] = [check.to_dict() for check in checks]
    return report
