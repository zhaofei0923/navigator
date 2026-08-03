from __future__ import annotations

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
from .d0_baseline_change import assess_d0_baseline_change
from .d0_review import validate_review_packet
from .paths import RepositoryPaths
from .review_packets import latest_review_packet
from .validation import APPROVED_EVIDENCE_STATES, validate_evidence

_EXPECTED_PENDING_REVIEW_CODES = {
    "D0_REVIEW_ACCEPTANCE_PENDING",
    "D0_REVIEW_FINAL_PENDING",
}
_REQUIRED_ACCEPTANCE_IDS = {"D0-AC-001", "D0-AC-002"}
_BASELINE_DECISIONS = {"approved_for_manual_adoption", "rejected"}


def _load_object(path: Path, *, label: str) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload


def _payload_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _relative_path(paths: RepositoryPaths, path: Path, *, label: str) -> str:
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


def _binding(paths: RepositoryPaths, path: Path, *, label: str) -> dict[str, str]:
    return {
        "path": _relative_path(paths, path, label=label),
        "sha256": sha256_file(path),
    }


def _latest_formal_review(paths: RepositoryPaths) -> Path:
    review = latest_review_packet(paths.d0_review_dir)
    if review is None:
        raise ValueError("No formal D0 review packet is available")
    return review.resolve()


def _approved_acceptance(review_packet: dict[str, Any]) -> list[dict[str, Any]]:
    acceptance = {
        str(item.get("acceptance_id") or ""): item
        for item in review_packet.get("acceptance_items", [])
        if isinstance(item, dict)
    }
    if not acceptance.keys() >= _REQUIRED_ACCEPTANCE_IDS:
        raise ValueError("Formal D0 review packet is missing AC-001/002")
    result: list[dict[str, Any]] = []
    for acceptance_id in sorted(_REQUIRED_ACCEPTANCE_IDS):
        item = acceptance[acceptance_id]
        if item.get("review_status") != "approved":
            raise ValueError(f"{acceptance_id} must be formally approved before baseline review")
        signatures = item.get("reviewer_signatures")
        if not isinstance(signatures, list) or not signatures:
            raise ValueError(f"{acceptance_id} has no reviewer signatures")
        result.append(
            {
                "acceptance_id": acceptance_id,
                "review_status": "approved",
                "reviewer_signatures": signatures,
            }
        )
    return result


def _project_approver(review_packet: dict[str, Any]) -> str:
    holders = {
        str(item.get("role_holder") or "").strip()
        for item in review_packet.get("role_assignments", [])
        if isinstance(item, dict) and item.get("role") == "项目批准人"
    }
    holders.discard("")
    if len(holders) != 1:
        raise ValueError("Formal D0 review packet must have one signed project approver")
    return next(iter(holders))


def _change_summary(
    resolution: dict[str, Any],
    assessment: dict[str, Any],
) -> dict[str, int]:
    entity_items = resolution.get("entity_primary_key_resolutions")
    unit_items = resolution.get("field_unit_resolutions")
    compound_items = resolution.get("compound_field_resolutions")
    entities = entity_items if isinstance(entity_items, list) else []
    units = unit_items if isinstance(unit_items, list) else []
    compounds = compound_items if isinstance(compound_items, list) else []
    splits = [
        item
        for item in compounds
        if isinstance(item, dict) and item.get("action") == "split_field_contract"
    ]
    field_assessment = assessment.get("core_field_assessment")
    inventory = field_assessment.get("inventory", {}) if isinstance(field_assessment, dict) else {}
    return {
        "entity_primary_key_decisions": len(entities),
        "added_primary_key_fields": sum(
            1
            for item in entities
            if isinstance(item, dict) and item.get("action") == "add_primary_key_field"
        ),
        "field_unit_decisions": len(units),
        "compound_fields_split": len(splits),
        "generated_atomic_fields": sum(
            len(item.get("proposed_field_contracts", []))
            for item in splits
            if isinstance(item.get("proposed_field_contracts"), list)
        ),
        "candidate_field_count": int(inventory.get("field_count") or 0),
    }


def build_d0_baseline_review_bundle(
    paths: RepositoryPaths,
    review_packet: dict[str, Any],
    review_path: Path,
    resolution: dict[str, Any],
    resolution_path: Path,
    candidate_workbook: Path,
) -> dict[str, Any]:
    if review_path.resolve() != _latest_formal_review(paths):
        raise ValueError("D0 baseline review must use the latest formal review packet")
    unexpected_checks = [
        check
        for check in validate_review_packet(paths, review_packet)
        if check.code not in _EXPECTED_PENDING_REVIEW_CODES
    ]
    if unexpected_checks:
        raise ValueError(
            "Formal D0 review packet has validation errors: "
            + "; ".join(f"{check.code}: {check.message}" for check in unexpected_checks)
        )
    approvals = _approved_acceptance(review_packet)
    project_approver = _project_approver(review_packet)
    assessment = assess_d0_baseline_change(paths, resolution, candidate_workbook)
    if assessment.get("candidate_ready_for_formal_baseline_review") is not True:
        raise ValueError("D0 candidate workbook is not ready for formal baseline review")

    return {
        "schema_version": 1,
        "stage": "D0",
        "bundle_type": "baseline_adoption_review_candidate",
        "automated_assessment_only": True,
        "does_not_activate_baseline": True,
        "does_not_complete_d0": True,
        "inputs": {
            "authoritative_workbook": _binding(
                paths,
                paths.d0_workbook,
                label="D0 authoritative workbook",
            ),
            "candidate_workbook": _binding(
                paths,
                candidate_workbook,
                label="D0 candidate workbook",
            ),
            "resolution": _binding(
                paths,
                resolution_path,
                label="D0 contract resolution",
            ),
            "review_packet": _binding(
                paths,
                review_path,
                label="D0 formal review packet",
            ),
        },
        "candidate_assessment": {
            "candidate_ready_for_formal_baseline_review": True,
            "resolution_sha256": assessment["resolution_sha256"],
            "core_entity_machine_status": assessment["core_entity_assessment"]["machine_status"],
            "core_field_machine_status": assessment["core_field_assessment"]["machine_status"],
            "checks": assessment["checks"],
        },
        "approved_acceptance_items": approvals,
        "change_summary": _change_summary(resolution, assessment),
        "required_decision": {
            "role": "项目批准人",
            "person_name": project_approver,
            "decision_values": ["approved_for_manual_adoption", "rejected"],
        },
        "review_state": "ready_for_project_baseline_decision",
        "manual_handover": [
            "Review and approve or reject this exact bundle SHA-256.",
            "If approved, a baseline steward must publish a formally revised authoritative "
            "workbook outside this command; this tool never overwrites or activates it.",
            "After publication, regenerate contracts and rerun the complete D0 gate before "
            "reviewing AC-009/010 or the final D0 decision.",
        ],
        "warning": (
            "This candidate package is not a baseline approval, does not modify the frozen "
            "workbook, does not approve AC-009/010, and does not authorize D1-D4 or user-facing "
            "development."
        ),
    }


def _resolve_binding(
    paths: RepositoryPaths,
    binding: Any,
    *,
    label: str,
) -> Path:
    if not isinstance(binding, dict):
        raise ValueError(f"{label} binding must be an object")
    relative = binding.get("path")
    expected_hash = binding.get("sha256")
    if not isinstance(relative, str) or not relative.strip():
        raise ValueError(f"{label} binding requires a repository-relative path")
    candidate = Path(relative)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError(f"{label} path must be canonical and repository-relative")
    resolved = (paths.root / candidate).resolve()
    if _relative_path(paths, resolved, label=label) != candidate.as_posix():
        raise ValueError(f"{label} path is not canonical")
    if not resolved.is_file() or sha256_file(resolved) != expected_hash:
        raise ValueError(f"{label} binding does not match the current file")
    return resolved


def load_and_validate_d0_baseline_review_bundle(
    paths: RepositoryPaths,
    bundle_path: Path,
) -> dict[str, Any]:
    _require_directory(bundle_path, paths.d0_candidates_dir, label="D0 baseline review bundle")
    bundle = _load_object(bundle_path, label="D0 baseline review bundle")
    if (
        bundle.get("schema_version") != 1
        or bundle.get("stage") != "D0"
        or bundle.get("bundle_type") != "baseline_adoption_review_candidate"
        or bundle.get("automated_assessment_only") is not True
        or bundle.get("does_not_activate_baseline") is not True
        or bundle.get("does_not_complete_d0") is not True
    ):
        raise ValueError("D0 baseline review bundle header or safety boundary is invalid")
    inputs = bundle.get("inputs")
    if not isinstance(inputs, dict):
        raise ValueError("D0 baseline review bundle inputs must be an object")
    authoritative = _resolve_binding(
        paths,
        inputs.get("authoritative_workbook"),
        label="D0 authoritative workbook",
    )
    candidate = _resolve_binding(
        paths,
        inputs.get("candidate_workbook"),
        label="D0 candidate workbook",
    )
    resolution_path = _resolve_binding(
        paths,
        inputs.get("resolution"),
        label="D0 contract resolution",
    )
    review_path = _resolve_binding(
        paths,
        inputs.get("review_packet"),
        label="D0 formal review packet",
    )
    if authoritative.resolve() != paths.d0_workbook.resolve():
        raise ValueError("D0 baseline review bundle binds the wrong authoritative workbook")
    expected = build_d0_baseline_review_bundle(
        paths,
        _load_object(review_path, label="D0 formal review packet"),
        review_path,
        _load_object(resolution_path, label="D0 contract resolution"),
        resolution_path,
        candidate,
    )
    if bundle != expected:
        raise ValueError("D0 baseline review bundle does not match a deterministic replay")
    return bundle


def build_d0_baseline_confirmation_template(
    paths: RepositoryPaths,
    bundle_path: Path,
) -> dict[str, Any]:
    bundle = load_and_validate_d0_baseline_review_bundle(paths, bundle_path)
    return {
        "schema_version": 1,
        "stage": "D0",
        "confirmation_type": "baseline_adoption_review",
        "template_only": True,
        "authorized_transcription": False,
        "bundle": {
            "path": _relative_path(paths, bundle_path, label="D0 baseline review bundle"),
            "sha256": sha256_file(bundle_path),
        },
        "expected_reviewer": bundle["required_decision"]["person_name"],
        "reviewer": None,
        "reviewed_at": None,
        "decision": None,
        "comments": None,
        "warning": (
            "Complete only after the project approver has reviewed the exact bundle SHA-256. "
            "Approval authorizes a separate manual baseline-adoption process but this record "
            "does not itself replace or activate the authoritative workbook."
        ),
    }


def _write_temporary(path: Path, content: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        temporary.write(content)
        temporary_path = Path(temporary.name)
    temporary_path.chmod(0o644)
    return temporary_path


def _iso_date_token(path: Path) -> str:
    match = re.search(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)", path.name)
    if match is None:
        raise ValueError("D0 baseline review package filenames must contain an ISO date")
    return match.group(1)


def write_d0_baseline_review_package(
    paths: RepositoryPaths,
    review_path: Path,
    resolution_path: Path,
    candidate_workbook: Path,
    bundle_output: Path,
    confirmation_output: Path,
) -> tuple[Path, Path]:
    _require_directory(bundle_output, paths.d0_candidates_dir, label="D0 baseline review bundle")
    _require_directory(
        confirmation_output,
        paths.d0_review_dir,
        label="D0 baseline confirmation template",
    )
    if _iso_date_token(bundle_output) != _iso_date_token(confirmation_output):
        raise ValueError("D0 baseline review bundle and confirmation dates must match")
    if bundle_output.exists() or confirmation_output.exists():
        raise FileExistsError("Refusing to overwrite D0 baseline review package output")

    bundle = build_d0_baseline_review_bundle(
        paths,
        _load_object(review_path, label="D0 formal review packet"),
        review_path,
        _load_object(resolution_path, label="D0 contract resolution"),
        resolution_path,
        candidate_workbook,
    )
    bundle_temporary = _write_temporary(bundle_output, _payload_bytes(bundle))
    bundle_published = False
    confirmation_published = False
    confirmation_temporary: Path | None = None
    try:
        if bundle_output.exists() or confirmation_output.exists():
            raise FileExistsError("Refusing to overwrite D0 baseline review package output")
        os.link(bundle_temporary, bundle_output)
        bundle_published = True
        confirmation = build_d0_baseline_confirmation_template(paths, bundle_output)
        confirmation_temporary = _write_temporary(
            confirmation_output,
            _payload_bytes(confirmation),
        )
        if confirmation_output.exists():
            raise FileExistsError("Refusing to overwrite D0 baseline review package output")
        os.link(confirmation_temporary, confirmation_output)
        confirmation_published = True
    except Exception:
        if bundle_published:
            bundle_output.unlink(missing_ok=True)
        if confirmation_published:
            confirmation_output.unlink(missing_ok=True)
        raise
    finally:
        bundle_temporary.unlink(missing_ok=True)
        if confirmation_temporary is not None:
            confirmation_temporary.unlink(missing_ok=True)
    return bundle_output, confirmation_output


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


def validate_d0_baseline_confirmation(
    paths: RepositoryPaths,
    confirmation: dict[str, Any],
    bundle_path: Path,
) -> tuple[dict[str, Any], str]:
    bundle = load_and_validate_d0_baseline_review_bundle(paths, bundle_path)
    if (
        confirmation.get("schema_version") != 1
        or confirmation.get("stage") != "D0"
        or confirmation.get("confirmation_type") != "baseline_adoption_review"
        or confirmation.get("template_only") is not False
        or confirmation.get("authorized_transcription") is not True
    ):
        raise ValueError("Completed D0 baseline confirmation header or authorization is invalid")
    expected_bundle = {
        "path": _relative_path(paths, bundle_path, label="D0 baseline review bundle"),
        "sha256": sha256_file(bundle_path),
    }
    if confirmation.get("bundle") != expected_bundle:
        raise ValueError(
            "D0 baseline confirmation must bind the exact current bundle path and hash"
        )
    expected_reviewer = str(bundle["required_decision"]["person_name"])
    if confirmation.get("expected_reviewer") != expected_reviewer:
        raise ValueError("D0 baseline confirmation expected reviewer does not match the bundle")
    if str(confirmation.get("reviewer") or "").strip() != expected_reviewer:
        raise ValueError("D0 baseline confirmation reviewer is not the registered project approver")
    reviewed_date = _temporal_date(confirmation.get("reviewed_at"))
    if reviewed_date is None:
        raise ValueError(
            "D0 baseline confirmation reviewed_at must be an ISO date or aware datetime"
        )
    if reviewed_date < date.fromisoformat(_iso_date_token(bundle_path)):
        raise ValueError("D0 baseline confirmation cannot predate the reviewed bundle")
    decision = str(confirmation.get("decision") or "").strip()
    if decision not in _BASELINE_DECISIONS:
        raise ValueError("D0 baseline confirmation decision is invalid")
    comments = str(confirmation.get("comments") or "").strip()
    if decision == "rejected" and not comments:
        raise ValueError("Rejected D0 baseline adoption requires comments")
    return bundle, decision


def _evidence_ids(reviewed_at: Any) -> dict[str, str]:
    reviewed_date = _temporal_date(reviewed_at)
    if reviewed_date is None:
        raise ValueError("D0 baseline confirmation reviewed_at is invalid")
    date_token = reviewed_date.strftime("%Y%m%d")
    return {
        acceptance_id: f"EVD-D0-BASELINE-ADOPTION-{acceptance_id[-3:]}-{date_token}"
        for acceptance_id in sorted(_REQUIRED_ACCEPTANCE_IDS)
    }


def _decision_evidence_status(decision: str) -> str:
    return "已批准" if decision == "approved_for_manual_adoption" else "已复核"


def _build_baseline_decision_record(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    bundle_path: Path,
    confirmation: dict[str, Any],
    confirmation_path: Path,
    decision: str,
) -> dict[str, Any]:
    evidence_ids = _evidence_ids(confirmation["reviewed_at"])
    approved = decision == "approved_for_manual_adoption"
    return {
        "schema_version": 1,
        "stage": "D0",
        "record_type": "baseline_adoption_decision",
        "decision": decision,
        "manual_baseline_adoption_authorized": approved,
        "does_not_activate_baseline": True,
        "does_not_complete_d0": True,
        "bundle": {
            "path": _relative_path(paths, bundle_path, label="D0 baseline review bundle"),
            "sha256": sha256_file(bundle_path),
        },
        "confirmation": {
            "path": _relative_path(
                paths,
                confirmation_path,
                label="D0 baseline confirmation evidence",
            ),
            "sha256": sha256_file(confirmation_path),
        },
        "inputs": deepcopy(bundle["inputs"]),
        "change_summary": deepcopy(bundle["change_summary"]),
        "reviewer_signature": {
            "role": "项目批准人",
            "person_name": confirmation["reviewer"],
            "signed_at": confirmation["reviewed_at"],
            "evidence_ids": [evidence_ids[item] for item in sorted(evidence_ids)],
        },
        "comments": confirmation.get("comments"),
        "next_required_action": (
            "A baseline steward must publish a formally revised authoritative workbook, then "
            "regenerate contracts and rerun the complete D0 gate."
            if approved
            else "The candidate must be revised and submitted as a new hash-bound review package."
        ),
        "warning": (
            "This signed record does not overwrite or activate the authoritative workbook, "
            "approve AC-009/010, complete D0/D4, or authorize user-facing development."
        ),
    }


def _build_baseline_decision_manifest(
    paths: RepositoryPaths,
    bundle_path: Path,
    confirmation: dict[str, Any],
    confirmation_path: Path,
    decision: str,
) -> dict[str, Any]:
    manifest = deepcopy(_load_object(paths.evidence_manifest, label="D0 evidence manifest"))
    entries = manifest.get("evidence")
    if not isinstance(entries, list):
        raise ValueError("D0 evidence manifest evidence must be a list")
    existing_ids = {
        str(item.get("evidence_id") or "").strip() for item in entries if isinstance(item, dict)
    }
    evidence_ids = _evidence_ids(confirmation["reviewed_at"])
    confirmation_relative = _relative_path(
        paths,
        confirmation_path,
        label="D0 baseline confirmation evidence",
    )
    confirmation_hash = sha256_file(confirmation_path)
    bundle_relative = _relative_path(paths, bundle_path, label="D0 baseline review bundle")
    bundle_hash = sha256_file(bundle_path)
    for acceptance_id, evidence_id in evidence_ids.items():
        if evidence_id in existing_ids:
            raise ValueError(f"D0 evidence ID already exists: {evidence_id}")
        entries.append(
            {
                "evidence_id": evidence_id,
                "acceptance_id": acceptance_id,
                "path": confirmation_relative,
                "sha256": confirmation_hash,
                "recorded_by": "codex (authorized transcription)",
                "recorded_at": confirmation["reviewed_at"],
                "reviewer": confirmation["reviewer"],
                "status": _decision_evidence_status(decision),
                "subject_path": bundle_relative,
                "subject_sha256": bundle_hash,
                "decision": decision,
            }
        )
        existing_ids.add(evidence_id)
    return manifest


def apply_d0_baseline_confirmation(
    paths: RepositoryPaths,
    confirmation_path: Path,
    bundle_path: Path,
    decision_output: Path,
    manifest_output: Path,
) -> tuple[Path, Path]:
    _require_directory(
        confirmation_path,
        paths.evidence_manifest.parent,
        label="D0 baseline confirmation evidence",
    )
    _require_directory(decision_output, paths.d0_review_dir, label="D0 baseline decision output")
    if manifest_output.resolve() != paths.evidence_manifest.resolve():
        raise ValueError("D0 baseline decision must update the repository evidence manifest")
    if decision_output.exists():
        raise FileExistsError(f"Refusing to overwrite {decision_output}")

    confirmation = _load_object(confirmation_path, label="D0 baseline confirmation")
    confirmation_hash = sha256_file(confirmation_path)
    bundle, decision = validate_d0_baseline_confirmation(paths, confirmation, bundle_path)
    reviewed_date = _temporal_date(confirmation["reviewed_at"])
    if reviewed_date is None or _iso_date_token(decision_output) != reviewed_date.isoformat():
        raise ValueError("D0 baseline decision output date must match reviewed_at")
    record = _build_baseline_decision_record(
        paths,
        bundle,
        bundle_path,
        confirmation,
        confirmation_path,
        decision,
    )
    manifest = _build_baseline_decision_manifest(
        paths,
        bundle_path,
        confirmation,
        confirmation_path,
        decision,
    )
    original_manifest_hash = sha256_file(paths.evidence_manifest)
    decision_temporary = _write_temporary(decision_output, _payload_bytes(record))
    manifest_temporary = _write_temporary(manifest_output, _payload_bytes(manifest))
    manifest_published = False
    decision_published = False
    try:
        validation_paths = replace(paths, evidence_manifest=manifest_temporary)
        evidence_checks = validate_evidence(validation_paths)
        if evidence_checks:
            raise ValueError(
                "Applied D0 baseline decision evidence failed validation: "
                + "; ".join(f"{check.code}: {check.message}" for check in evidence_checks)
            )
        if sha256_file(paths.evidence_manifest) != original_manifest_hash:
            raise ValueError("D0 evidence manifest changed during baseline decision application")
        if sha256_file(confirmation_path) != confirmation_hash:
            raise ValueError("D0 baseline confirmation changed during application")
        load_and_validate_d0_baseline_review_bundle(paths, bundle_path)
        if confirmation["bundle"]["sha256"] != sha256_file(bundle_path):
            raise ValueError("D0 baseline review bundle changed during application")
        if decision_output.exists():
            raise FileExistsError(f"Refusing to overwrite {decision_output}")
        os.link(decision_temporary, decision_output)
        decision_published = True
        os.replace(manifest_temporary, manifest_output)
        manifest_published = True
    except Exception:
        if decision_published:
            decision_output.unlink(missing_ok=True)
        raise
    finally:
        decision_temporary.unlink(missing_ok=True)
        if not manifest_published:
            manifest_temporary.unlink(missing_ok=True)
    return decision_output, manifest_output


def load_and_validate_d0_baseline_decision(
    paths: RepositoryPaths,
    decision_path: Path,
) -> dict[str, Any]:
    """Replay a recorded baseline decision and its two acceptance evidence bindings."""
    _require_directory(decision_path, paths.d0_review_dir, label="D0 baseline decision record")
    record = _load_object(decision_path, label="D0 baseline decision record")
    if (
        record.get("schema_version") != 1
        or record.get("stage") != "D0"
        or record.get("record_type") != "baseline_adoption_decision"
        or record.get("does_not_activate_baseline") is not True
        or record.get("does_not_complete_d0") is not True
    ):
        raise ValueError("D0 baseline decision record header or safety boundary is invalid")

    bundle_path = _resolve_binding(
        paths,
        record.get("bundle"),
        label="D0 baseline review bundle",
    )
    _require_directory(bundle_path, paths.d0_candidates_dir, label="D0 baseline review bundle")
    confirmation_path = _resolve_binding(
        paths,
        record.get("confirmation"),
        label="D0 baseline confirmation evidence",
    )
    _require_directory(
        confirmation_path,
        paths.evidence_manifest.parent,
        label="D0 baseline confirmation evidence",
    )
    confirmation = _load_object(confirmation_path, label="D0 baseline confirmation evidence")
    bundle, decision = validate_d0_baseline_confirmation(paths, confirmation, bundle_path)
    reviewed_date = _temporal_date(confirmation.get("reviewed_at"))
    if reviewed_date is None or _iso_date_token(decision_path) != reviewed_date.isoformat():
        raise ValueError("D0 baseline decision record date must match reviewed_at")

    expected_record = _build_baseline_decision_record(
        paths,
        bundle,
        bundle_path,
        confirmation,
        confirmation_path,
        decision,
    )
    if record != expected_record:
        raise ValueError("D0 baseline decision record does not match a deterministic replay")

    evidence_checks = validate_evidence(paths)
    if evidence_checks:
        raise ValueError(
            "D0 baseline decision evidence failed validation: "
            + "; ".join(f"{check.code}: {check.message}" for check in evidence_checks)
        )
    manifest = _load_object(paths.evidence_manifest, label="D0 evidence manifest")
    entries = manifest.get("evidence")
    if not isinstance(entries, list):
        raise ValueError("D0 evidence manifest evidence must be a list")
    expected_ids = _evidence_ids(confirmation["reviewed_at"])
    confirmation_binding = record["confirmation"]
    bundle_binding = record["bundle"]
    expected_status = _decision_evidence_status(decision)
    for acceptance_id, evidence_id in expected_ids.items():
        matches = [
            item
            for item in entries
            if isinstance(item, dict) and item.get("evidence_id") == evidence_id
        ]
        if len(matches) != 1:
            raise ValueError(
                f"D0 baseline decision evidence must contain exactly one {evidence_id}"
            )
        entry = matches[0]
        expected_fields = {
            "acceptance_id": acceptance_id,
            "path": confirmation_binding["path"],
            "sha256": confirmation_binding["sha256"],
            "reviewer": confirmation["reviewer"],
            "status": expected_status,
            "subject_path": bundle_binding["path"],
            "subject_sha256": bundle_binding["sha256"],
            "decision": decision,
        }
        if any(entry.get(key) != value for key, value in expected_fields.items()):
            raise ValueError(f"D0 baseline decision evidence binding is invalid: {evidence_id}")
        if entry.get("status") not in APPROVED_EVIDENCE_STATES:
            raise ValueError(
                f"D0 baseline decision evidence is not in a reviewed state: {evidence_id}"
            )
    return record
