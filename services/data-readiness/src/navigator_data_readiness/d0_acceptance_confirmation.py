from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from copy import deepcopy
from dataclasses import replace
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .baseline import sha256_file
from .d0_acceptance_review import build_d0_acceptance_review_bundle
from .d0_review import validate_review_packet
from .models import CheckResult
from .paths import RepositoryPaths
from .validation import validate_evidence

_FINAL_DECISIONS = {"approved", "rejected"}
_EXPECTED_PENDING_REVIEW_CODES = {
    "D0_REVIEW_ACCEPTANCE_PENDING",
    "D0_REVIEW_FINAL_PENDING",
}


def _load_object(path: Path, *, label: str) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload


def _load_object_and_sha256(path: Path, *, label: str) -> tuple[dict[str, Any], str]:
    content = path.read_bytes()
    payload = json.loads(content.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload, hashlib.sha256(content).hexdigest()


def _payload_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _repository_relative_path(paths: RepositoryPaths, path: Path, *, label: str) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(paths.root.resolve()).as_posix()
    except ValueError as error:
        raise ValueError(f"{label} must resolve inside the repository") from error


def _require_directory(path: Path, directory: Path, *, label: str) -> None:
    try:
        path.resolve().relative_to(directory.resolve())
    except ValueError as error:
        raise ValueError(f"{label} must resolve under {directory}") from error


def _resolve_bound_file(
    paths: RepositoryPaths,
    binding: Any,
    *,
    label: str,
) -> Path:
    if not isinstance(binding, dict):
        raise ValueError(f"{label} binding must be an object")
    relative_path = binding.get("path")
    expected_hash = binding.get("sha256")
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise ValueError(f"{label} binding requires a repository-relative path")
    candidate = Path(relative_path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError(f"{label} binding path must be canonical and repository-relative")
    resolved = (paths.root / candidate).resolve()
    canonical = _repository_relative_path(paths, resolved, label=label)
    if canonical != candidate.as_posix() or not resolved.is_file():
        raise ValueError(f"{label} binding path is missing or non-canonical")
    if not isinstance(expected_hash, str) or sha256_file(resolved) != expected_hash.lower():
        raise ValueError(f"{label} binding hash does not match the current file")
    return resolved


def load_and_validate_d0_acceptance_review_bundle(
    paths: RepositoryPaths,
    bundle_path: Path,
) -> dict[str, Any]:
    _require_directory(bundle_path, paths.d0_candidates_dir, label="D0 acceptance review bundle")
    bundle = _load_object(bundle_path, label="D0 acceptance review bundle")
    if (
        bundle.get("schema_version") != 1
        or bundle.get("stage") != "D0"
        or bundle.get("bundle_type") != "acceptance_review_candidate"
        or bundle.get("automated_assessment_only") is not True
        or bundle.get("does_not_approve_acceptance") is not True
        or bundle.get("does_not_activate_baseline") is not True
    ):
        raise ValueError("D0 acceptance review bundle header or safety boundary is invalid")
    inputs = bundle.get("inputs")
    if not isinstance(inputs, dict):
        raise ValueError("D0 acceptance review bundle inputs must be an object")
    review_path = _resolve_bound_file(
        paths,
        inputs.get("review_packet"),
        label="D0 review packet",
    )
    resolution_path = _resolve_bound_file(
        paths,
        inputs.get("resolution"),
        label="D0 contract resolution",
    )
    candidate_workbook = _resolve_bound_file(
        paths,
        inputs.get("candidate_workbook"),
        label="D0 candidate workbook",
    )
    authoritative_workbook = _resolve_bound_file(
        paths,
        inputs.get("authoritative_workbook"),
        label="D0 authoritative workbook",
    )
    if authoritative_workbook.resolve() != paths.d0_workbook.resolve():
        raise ValueError("D0 acceptance review bundle binds the wrong authoritative workbook")

    expected = build_d0_acceptance_review_bundle(
        paths,
        _load_object(review_path, label="D0 review packet"),
        review_path,
        _load_object(resolution_path, label="D0 contract resolution"),
        resolution_path,
        candidate_workbook,
        bundle_path,
    )
    if bundle != expected:
        raise ValueError(
            "D0 acceptance review bundle does not match a current deterministic replay"
        )
    return bundle


def _expected_reviewer(bundle: dict[str, Any]) -> str:
    holders = {
        str(signature.get("person_name") or "").strip()
        for item in bundle["acceptance_items"]
        if item["review_state"] == "ready_for_human_review"
        for signature in item["reviewer_signature_template"]
    }
    holders.discard("")
    if len(holders) != 1:
        raise ValueError(
            "This confirmation format requires one signed role holder for all review-ready items"
        )
    return next(iter(holders))


def build_d0_acceptance_confirmation_template(
    paths: RepositoryPaths,
    bundle_path: Path,
) -> dict[str, Any]:
    bundle = load_and_validate_d0_acceptance_review_bundle(paths, bundle_path)
    return {
        "schema_version": 1,
        "stage": "D0",
        "confirmation_type": "acceptance_review",
        "template_only": True,
        "authorized_transcription": False,
        "bundle": {
            "path": _repository_relative_path(
                paths,
                bundle_path,
                label="D0 acceptance review bundle",
            ),
            "sha256": sha256_file(bundle_path),
        },
        "expected_reviewer": _expected_reviewer(bundle),
        "reviewer": None,
        "reviewed_at": None,
        "decisions": [
            {
                "acceptance_id": item["acceptance_id"],
                "decision": None,
                "comments": None,
            }
            for item in bundle["acceptance_items"]
            if item["review_state"] == "ready_for_human_review"
        ],
        "warning": (
            "Complete only after the named reviewer has reviewed the exact bundle SHA-256. "
            "This confirmation cannot approve AC-009/010, activate the authoritative workbook, "
            "complete D0/D4, or authorize user-facing development."
        ),
    }


def _temporal_date(value: Any) -> date | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        if "T" not in text:
            return date.fromisoformat(text)
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None
        return parsed.date()
    except ValueError:
        return None


def _bundle_date(bundle_path: Path) -> date:
    match = re.search(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)", bundle_path.name)
    if match is None:
        raise ValueError("D0 acceptance review bundle filename must contain an ISO date")
    return date.fromisoformat(match.group(1))


def _decision_index(confirmation: dict[str, Any]) -> dict[str, dict[str, Any]]:
    decisions = confirmation.get("decisions")
    if not isinstance(decisions, list):
        raise ValueError("D0 acceptance confirmation decisions must be a list")
    indexed: dict[str, dict[str, Any]] = {}
    for index, decision in enumerate(decisions):
        if not isinstance(decision, dict):
            raise ValueError(f"D0 acceptance confirmation decision {index} must be an object")
        acceptance_id = str(decision.get("acceptance_id") or "").strip()
        if not acceptance_id or acceptance_id in indexed:
            raise ValueError("D0 acceptance confirmation has a missing or duplicate acceptance ID")
        indexed[acceptance_id] = decision
    return indexed


def validate_d0_acceptance_confirmation(
    paths: RepositoryPaths,
    confirmation: dict[str, Any],
    bundle_path: Path,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    bundle = load_and_validate_d0_acceptance_review_bundle(paths, bundle_path)
    template = build_d0_acceptance_confirmation_template(paths, bundle_path)
    if (
        confirmation.get("schema_version") != 1
        or confirmation.get("stage") != "D0"
        or confirmation.get("confirmation_type") != "acceptance_review"
    ):
        raise ValueError("D0 acceptance confirmation header is invalid")
    if confirmation.get("template_only") is not False:
        raise ValueError("D0 acceptance confirmation must be a completed copy, not a template")
    if confirmation.get("authorized_transcription") is not True:
        raise ValueError("D0 acceptance confirmation requires explicit transcription authorization")
    if confirmation.get("bundle") != template["bundle"]:
        raise ValueError("D0 acceptance confirmation does not bind the exact current bundle hash")
    expected_reviewer = str(template["expected_reviewer"])
    if (
        confirmation.get("expected_reviewer") != expected_reviewer
        or confirmation.get("reviewer") != expected_reviewer
    ):
        raise ValueError("D0 acceptance confirmation reviewer is not the signed role holder")
    reviewed_date = _temporal_date(confirmation.get("reviewed_at"))
    if reviewed_date is None:
        raise ValueError(
            "D0 acceptance confirmation reviewed_at must be an ISO date or aware datetime"
        )
    if reviewed_date < _bundle_date(bundle_path):
        raise ValueError("D0 acceptance confirmation cannot predate the reviewed bundle")

    decisions = _decision_index(confirmation)
    expected_ids = set(bundle["summary"]["ready_for_human_review"])
    if set(decisions) != expected_ids:
        raise ValueError("D0 acceptance confirmation decision set is incomplete or unexpected")
    for acceptance_id, decision in decisions.items():
        conclusion = decision.get("decision")
        if conclusion not in _FINAL_DECISIONS:
            raise ValueError(f"{acceptance_id} decision must be approved or rejected")
        if conclusion == "rejected" and not str(decision.get("comments") or "").strip():
            raise ValueError(f"{acceptance_id} rejection requires comments")
    return bundle, decisions


def _build_review_packet(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    decisions: dict[str, dict[str, Any]],
    confirmation: dict[str, Any],
) -> dict[str, Any]:
    review_path = _resolve_bound_file(
        paths,
        bundle["inputs"]["review_packet"],
        label="D0 review packet",
    )
    packet = deepcopy(_load_object(review_path, label="D0 review packet"))
    acceptance = {str(item["acceptance_id"]): item for item in packet["acceptance_items"]}
    bundle_items = {str(item["acceptance_id"]): item for item in bundle["acceptance_items"]}
    reviewer = str(confirmation["reviewer"])
    reviewed_at = str(confirmation["reviewed_at"])
    for acceptance_id, decision in decisions.items():
        target = acceptance[acceptance_id]
        bundle_item = bundle_items[acceptance_id]
        evidence_id = str(bundle_item["evidence_candidate_id"])
        if decision["decision"] == "approved":
            signatures = deepcopy(bundle_item["reviewer_signature_template"])
            for signature in signatures:
                if signature.get("person_name") != reviewer:
                    raise ValueError(f"{acceptance_id} signature holder differs from {reviewer}")
                signature["signed_at"] = reviewed_at
                signature["evidence_ids"] = [evidence_id]
            target.update(
                {
                    "reviewer_signatures": signatures,
                    "comments": decision.get("comments"),
                    "review_status": "approved",
                }
            )
        else:
            target.update(
                {
                    "comments": f"rejected: {str(decision['comments']).strip()}",
                    "review_status": "pending",
                }
            )
    return packet


def _build_evidence_manifest(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    decisions: dict[str, dict[str, Any]],
    confirmation: dict[str, Any],
    confirmation_path: Path,
) -> dict[str, Any]:
    manifest = deepcopy(_load_object(paths.evidence_manifest, label="D0 evidence manifest"))
    entries = manifest.get("evidence")
    if not isinstance(entries, list):
        raise ValueError("D0 evidence manifest evidence must be a list")
    existing_ids = {
        str(item.get("evidence_id") or "").strip() for item in entries if isinstance(item, dict)
    }
    bundle_items = {str(item["acceptance_id"]): item for item in bundle["acceptance_items"]}
    confirmation_relative = _repository_relative_path(
        paths,
        confirmation_path,
        label="D0 acceptance confirmation evidence",
    )
    confirmation_hash = sha256_file(confirmation_path)
    reviewer = str(confirmation["reviewer"])
    reviewed_at = str(confirmation["reviewed_at"])
    for acceptance_id, decision in decisions.items():
        evidence_id = str(bundle_items[acceptance_id]["evidence_candidate_id"])
        if evidence_id in existing_ids:
            raise ValueError(f"D0 evidence ID already exists: {evidence_id}")
        entries.append(
            {
                "evidence_id": evidence_id,
                "acceptance_id": acceptance_id,
                "path": confirmation_relative,
                "sha256": confirmation_hash,
                "recorded_by": "codex (authorized transcription)",
                "recorded_at": reviewed_at,
                "reviewer": reviewer,
                "status": "已批准" if decision["decision"] == "approved" else "已复核",
                "subject_path": str(confirmation["bundle"]["path"]),
                "subject_sha256": str(confirmation["bundle"]["sha256"]),
            }
        )
        existing_ids.add(evidence_id)
    return manifest


def _write_temporary(output: Path, content: bytes) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=output.parent,
        prefix=f".{output.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)
        temporary.write(content)
    temporary_path.chmod(0o644)
    return temporary_path


def _unexpected_review_checks(checks: list[CheckResult]) -> list[CheckResult]:
    return [check for check in checks if check.code not in _EXPECTED_PENDING_REVIEW_CODES]


def write_d0_acceptance_confirmation_template(
    paths: RepositoryPaths,
    bundle_path: Path,
    output: Path,
) -> Path:
    _require_directory(output, paths.d0_review_dir, label="D0 acceptance confirmation template")
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    temporary_path = _write_temporary(
        output,
        _payload_bytes(build_d0_acceptance_confirmation_template(paths, bundle_path)),
    )
    try:
        if output.exists():
            raise FileExistsError(f"Refusing to overwrite {output}")
        os.link(temporary_path, output)
    finally:
        temporary_path.unlink(missing_ok=True)
    return output


def apply_d0_acceptance_confirmation(
    paths: RepositoryPaths,
    confirmation_path: Path,
    bundle_path: Path,
    review_output: Path,
    manifest_output: Path,
) -> tuple[Path, Path]:
    _require_directory(
        confirmation_path,
        paths.evidence_manifest.parent,
        label="D0 acceptance confirmation evidence",
    )
    _require_directory(review_output, paths.d0_review_dir, label="D0 review output")
    _require_directory(
        manifest_output,
        paths.evidence_manifest.parent,
        label="D0 evidence manifest output",
    )
    if review_output.exists():
        raise FileExistsError(f"Refusing to overwrite {review_output}")
    if manifest_output.exists() and manifest_output.resolve() != paths.evidence_manifest.resolve():
        raise FileExistsError(f"Refusing to overwrite {manifest_output}")

    confirmation, confirmation_hash = _load_object_and_sha256(
        confirmation_path,
        label="D0 acceptance confirmation",
    )
    bundle, decisions = validate_d0_acceptance_confirmation(
        paths,
        confirmation,
        bundle_path,
    )
    packet = _build_review_packet(paths, bundle, decisions, confirmation)
    manifest = _build_evidence_manifest(
        paths,
        bundle,
        decisions,
        confirmation,
        confirmation_path,
    )
    original_manifest_hash = sha256_file(paths.evidence_manifest)
    review_temporary = _write_temporary(review_output, _payload_bytes(packet))
    manifest_temporary = _write_temporary(manifest_output, _payload_bytes(manifest))
    review_published = False
    try:
        validation_paths = replace(paths, evidence_manifest=manifest_temporary)
        evidence_checks = validate_evidence(validation_paths)
        if evidence_checks:
            raise ValueError(
                "Applied D0 evidence manifest failed validation: "
                + "; ".join(f"{check.code}: {check.message}" for check in evidence_checks)
            )
        review_checks = _unexpected_review_checks(validate_review_packet(validation_paths, packet))
        if review_checks:
            raise ValueError(
                "Applied D0 acceptance review failed validation: "
                + "; ".join(f"{check.code}: {check.message}" for check in review_checks)
            )
        if sha256_file(paths.evidence_manifest) != original_manifest_hash:
            raise ValueError("D0 evidence manifest changed during confirmation application")
        if sha256_file(confirmation_path) != confirmation_hash:
            raise ValueError("D0 acceptance confirmation changed during application")
        load_and_validate_d0_acceptance_review_bundle(paths, bundle_path)
        if sha256_file(bundle_path) != confirmation["bundle"]["sha256"]:
            raise ValueError("D0 acceptance review bundle changed during application")
        if review_output.exists():
            raise FileExistsError(f"Refusing to overwrite {review_output}")
        os.link(review_temporary, review_output)
        review_published = True
        os.replace(manifest_temporary, manifest_output)
        manifest_temporary = Path()
    except Exception:
        if review_published:
            review_output.unlink(missing_ok=True)
        raise
    finally:
        review_temporary.unlink(missing_ok=True)
        if manifest_temporary != Path():
            manifest_temporary.unlink(missing_ok=True)
    return review_output, manifest_output
