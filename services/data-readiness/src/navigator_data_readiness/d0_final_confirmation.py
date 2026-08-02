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
from .d0_closure import load_and_validate_d0_final_review_bundle
from .d0_review import validate_review_packet
from .paths import RepositoryPaths
from .readiness import build_readiness_report
from .validation import validate_evidence

_CONFIRMATION_FIELDS = {
    "schema_version",
    "stage",
    "confirmation_type",
    "template_only",
    "authorized_transcription",
    "bundle",
    "bound_current_head",
    "source_review",
    "review_output",
    "expected_approver",
    "decision",
    "comments",
    "acceptance_signature",
    "final_signature",
    "warning",
}
_SIGNATURE_FIELDS = {"role", "person_name", "signed_at"}
_ISO_DATE_IN_NAME = re.compile(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)")


def _payload_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _load_object_and_sha256(path: Path, *, label: str) -> tuple[dict[str, Any], str]:
    content = path.read_bytes()
    payload = json.loads(content.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload, hashlib.sha256(content).hexdigest()


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


def _dated_artifact(path: Path, *, label: str) -> date:
    match = _ISO_DATE_IN_NAME.search(path.name)
    if match is None:
        raise ValueError(f"{label} filename must contain an ISO date")
    return date.fromisoformat(match.group(1))


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


def _validate_review_output(
    paths: RepositoryPaths,
    review_output: Path,
    *,
    bundle_date: date,
) -> tuple[str, date]:
    _require_directory(review_output, paths.d0_review_dir, label="D0 final review output")
    output_date = _dated_artifact(review_output, label="D0 final review output")
    if review_output.name != f"d0_review_packet.{output_date.isoformat()}.json":
        raise ValueError("D0 final review output must be named d0_review_packet.<ISO-date>.json")
    if output_date < bundle_date:
        raise ValueError("D0 final review output cannot predate the reviewed bundle")
    if review_output.exists():
        raise FileExistsError(f"Refusing to overwrite {review_output}")
    return _relative_path(paths, review_output, label="D0 final review output"), output_date


def _expected_approver(bundle: dict[str, Any]) -> dict[str, str]:
    acceptance_templates = bundle.get("acceptance_item", {}).get("reviewer_signature_template")
    final_template = bundle.get("final_decision_template")
    if (
        not isinstance(acceptance_templates, list)
        or len(acceptance_templates) != 1
        or not isinstance(acceptance_templates[0], dict)
        or not isinstance(final_template, dict)
    ):
        raise ValueError("D0 final bundle signature templates are invalid")
    acceptance = acceptance_templates[0]
    role = str(acceptance.get("role") or "").strip()
    person_name = str(acceptance.get("person_name") or "").strip()
    if (
        not role
        or not person_name
        or final_template.get("approver_role") != role
        or final_template.get("approved_by") != person_name
    ):
        raise ValueError("D0 final bundle project approver binding is inconsistent")
    return {"role": role, "person_name": person_name}


def build_d0_final_confirmation_template(
    paths: RepositoryPaths,
    authorization_path: Path,
    review_path: Path,
    bundle_path: Path,
    review_output: Path,
) -> dict[str, Any]:
    bundle = load_and_validate_d0_final_review_bundle(
        paths,
        authorization_path,
        review_path,
        bundle_path,
    )
    bundle_date = _dated_artifact(bundle_path, label="D0 final review bundle")
    review_relative, _ = _validate_review_output(
        paths,
        review_output,
        bundle_date=bundle_date,
    )
    approver = _expected_approver(bundle)
    return {
        "schema_version": 1,
        "stage": "D0",
        "confirmation_type": "final_closure_review",
        "template_only": True,
        "authorized_transcription": False,
        "bundle": {
            "path": _relative_path(paths, bundle_path, label="D0 final review bundle"),
            "sha256": sha256_file(bundle_path),
        },
        "bound_current_head": bundle["current_head"],
        "source_review": bundle["inputs"]["review_packet"],
        "review_output": review_relative,
        "expected_approver": approver,
        "decision": None,
        "comments": None,
        "acceptance_signature": {**approver, "signed_at": None},
        "final_signature": {**approver, "signed_at": None},
        "warning": (
            "Complete only after the named project approver separately reviews the exact "
            "bundle SHA-256 for D0-AC-010 and the final D0 decision. Approval may complete D0 "
            "but does not complete D1-D4 or authorize user-facing development."
        ),
    }


def _validate_signature(
    signature: Any,
    *,
    label: str,
    expected: dict[str, str],
    bundle_date: date,
    output_date: date,
) -> dict[str, Any]:
    if not isinstance(signature, dict) or set(signature) != _SIGNATURE_FIELDS:
        raise ValueError(f"D0 final {label} signature fields are invalid")
    if (
        signature.get("role") != expected["role"]
        or signature.get("person_name") != expected["person_name"]
    ):
        raise ValueError(f"D0 final {label} signer is not the signed project approver")
    signed_date = _temporal_date(signature.get("signed_at"))
    if signed_date is None:
        raise ValueError(f"D0 final {label} signed_at must be an ISO date or aware datetime")
    if signed_date < bundle_date:
        raise ValueError(f"D0 final {label} signature cannot predate the reviewed bundle")
    if signed_date != output_date:
        raise ValueError(f"D0 final {label} signature date must match the review output date")
    return signature


def validate_d0_final_confirmation(
    paths: RepositoryPaths,
    confirmation: dict[str, Any],
    authorization_path: Path,
    review_path: Path,
    bundle_path: Path,
    review_output: Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    template = build_d0_final_confirmation_template(
        paths,
        authorization_path,
        review_path,
        bundle_path,
        review_output,
    )
    if set(confirmation) != _CONFIRMATION_FIELDS:
        raise ValueError("D0 final confirmation has missing or unexpected fields")
    if (
        confirmation.get("schema_version") != 1
        or confirmation.get("stage") != "D0"
        or confirmation.get("confirmation_type") != "final_closure_review"
    ):
        raise ValueError("D0 final confirmation header is invalid")
    if confirmation.get("template_only") is not False:
        raise ValueError("D0 final confirmation must be a completed copy")
    if confirmation.get("authorized_transcription") is not True:
        raise ValueError("D0 final confirmation requires explicit transcription authorization")
    for field in (
        "bundle",
        "bound_current_head",
        "source_review",
        "review_output",
        "expected_approver",
        "warning",
    ):
        if confirmation.get(field) != template[field]:
            raise ValueError(f"D0 final confirmation changed the bound {field}")
    decision = confirmation.get("decision")
    if decision not in {"approved", "rejected"}:
        raise ValueError("D0 final confirmation decision must be approved or rejected")
    if decision == "rejected" and not str(confirmation.get("comments") or "").strip():
        raise ValueError("Rejected D0 final confirmation requires comments")
    bundle_date = _dated_artifact(bundle_path, label="D0 final review bundle")
    output_date = _dated_artifact(review_output, label="D0 final review output")
    expected = template["expected_approver"]
    acceptance_signature = _validate_signature(
        confirmation.get("acceptance_signature"),
        label="acceptance",
        expected=expected,
        bundle_date=bundle_date,
        output_date=output_date,
    )
    final_signature = _validate_signature(
        confirmation.get("final_signature"),
        label="decision",
        expected=expected,
        bundle_date=bundle_date,
        output_date=output_date,
    )
    bundle = load_and_validate_d0_final_review_bundle(
        paths,
        authorization_path,
        review_path,
        bundle_path,
    )
    return bundle, acceptance_signature, final_signature


def _write_temporary(output: Path, content: bytes) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=output.parent,
        prefix=f".{output.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        temporary.write(content)
        temporary_path = Path(temporary.name)
    temporary_path.chmod(0o644)
    return temporary_path


def write_d0_final_confirmation_template(
    paths: RepositoryPaths,
    authorization_path: Path,
    review_path: Path,
    bundle_path: Path,
    review_output: Path,
    confirmation_output: Path,
) -> Path:
    _require_directory(
        confirmation_output,
        paths.d0_review_dir,
        label="D0 final confirmation template",
    )
    if confirmation_output.suffix.lower() != ".json":
        raise ValueError("D0 final confirmation template must be a JSON file")
    if confirmation_output.exists():
        raise FileExistsError(f"Refusing to overwrite {confirmation_output}")
    template = build_d0_final_confirmation_template(
        paths,
        authorization_path,
        review_path,
        bundle_path,
        review_output,
    )
    temporary = _write_temporary(confirmation_output, _payload_bytes(template))
    try:
        if confirmation_output.exists():
            raise FileExistsError(f"Refusing to overwrite {confirmation_output}")
        os.link(temporary, confirmation_output)
    finally:
        temporary.unlink(missing_ok=True)
    return confirmation_output


def _build_applied_review(
    review_path: Path,
    bundle: dict[str, Any],
    acceptance_signature: dict[str, Any],
    final_signature: dict[str, Any],
    comments: Any,
) -> dict[str, Any]:
    packet, _ = _load_object_and_sha256(review_path, label="D0 source review packet")
    items = packet.get("acceptance_items")
    if not isinstance(items, list):
        raise ValueError("D0 source review acceptance items are invalid")
    acceptance = {
        str(item.get("acceptance_id") or ""): item for item in items if isinstance(item, dict)
    }
    target = acceptance.get("D0-AC-010")
    if not isinstance(target, dict) or target.get("review_status") != "pending":
        raise ValueError("D0-AC-010 is not pending in the source review packet")
    signature_templates = deepcopy(bundle["acceptance_item"]["reviewer_signature_template"])
    signature_templates[0]["signed_at"] = acceptance_signature["signed_at"]
    target.update(
        {
            "comments": comments,
            "review_status": "approved",
            "reviewer_signatures": signature_templates,
        }
    )
    final_decision = deepcopy(bundle["final_decision_template"])
    final_decision["approved_at"] = final_signature["signed_at"]
    final_decision["comments"] = comments
    packet["final_decision"] = final_decision
    return packet


def _build_applied_manifest(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    acceptance_signature: dict[str, Any],
    final_signature: dict[str, Any],
    confirmation_path: Path,
    confirmation_hash: str,
) -> dict[str, Any]:
    manifest, _ = _load_object_and_sha256(
        paths.evidence_manifest,
        label="D0 evidence manifest",
    )
    entries = manifest.get("evidence")
    if not isinstance(entries, list):
        raise ValueError("D0 evidence manifest evidence must be a list")
    existing_ids = {
        str(entry.get("evidence_id") or "").strip() for entry in entries if isinstance(entry, dict)
    }
    confirmation_relative = _relative_path(
        paths,
        confirmation_path,
        label="D0 final confirmation evidence",
    )
    signed_at_by_purpose = {
        "D0-AC-010 acceptance": acceptance_signature["signed_at"],
        "final D0 decision": final_signature["signed_at"],
    }
    for template in bundle["evidence_manifest_templates"]:
        evidence_id = str(template["evidence_id"])
        purpose = str(template["review_purpose"])
        if evidence_id in existing_ids:
            raise ValueError(f"D0 final evidence ID already exists: {evidence_id}")
        if purpose not in signed_at_by_purpose:
            raise ValueError(f"D0 final evidence purpose is invalid: {purpose}")
        entry = deepcopy(template)
        entry.update(
            {
                "path": confirmation_relative,
                "sha256": confirmation_hash,
                "recorded_at": signed_at_by_purpose[purpose],
                "status": "已批准",
                "subject_sha256": sha256_file(paths.root / str(template["subject_path"])),
            }
        )
        entries.append(entry)
        existing_ids.add(evidence_id)
    return manifest


def _validate_applied_state(
    paths: RepositoryPaths,
    manifest_temporary: Path,
    packet: dict[str, Any],
) -> None:
    validation_paths = replace(paths, evidence_manifest=manifest_temporary)
    evidence_checks = validate_evidence(validation_paths)
    if evidence_checks:
        raise ValueError(
            "Applied D0 final evidence manifest failed validation: "
            + "; ".join(f"{check.code}: {check.message}" for check in evidence_checks)
        )
    review_checks = validate_review_packet(validation_paths, packet)
    if review_checks:
        raise ValueError(
            "Applied D0 final review failed validation: "
            + "; ".join(f"{check.code}: {check.message}" for check in review_checks)
        )


def apply_d0_final_confirmation(
    paths: RepositoryPaths,
    confirmation_path: Path,
    authorization_path: Path,
    review_path: Path,
    bundle_path: Path,
    review_output: Path,
    manifest_output: Path,
) -> tuple[Path, Path]:
    _require_directory(
        confirmation_path,
        paths.evidence_manifest.parent,
        label="D0 final confirmation evidence",
    )
    if manifest_output.resolve() != paths.evidence_manifest.resolve():
        raise ValueError("D0 final application must update the current evidence manifest")
    if review_output.exists():
        raise FileExistsError(f"Refusing to overwrite {review_output}")
    confirmation, confirmation_hash = _load_object_and_sha256(
        confirmation_path,
        label="D0 final confirmation",
    )
    bundle, acceptance_signature, final_signature = validate_d0_final_confirmation(
        paths,
        confirmation,
        authorization_path,
        review_path,
        bundle_path,
        review_output,
    )
    if confirmation["decision"] != "approved":
        raise ValueError("D0 final closure review was rejected")
    packet = _build_applied_review(
        review_path,
        bundle,
        acceptance_signature,
        final_signature,
        confirmation.get("comments"),
    )
    manifest = _build_applied_manifest(
        paths,
        bundle,
        acceptance_signature,
        final_signature,
        confirmation_path,
        confirmation_hash,
    )
    original_manifest_hash = sha256_file(paths.evidence_manifest)
    original_review_hash = sha256_file(review_path)
    original_bundle_hash = sha256_file(bundle_path)
    review_temporary = _write_temporary(review_output, _payload_bytes(packet))
    manifest_temporary = _write_temporary(manifest_output, _payload_bytes(manifest))
    review_published = False
    try:
        _validate_applied_state(paths, manifest_temporary, packet)
        if sha256_file(paths.evidence_manifest) != original_manifest_hash:
            raise ValueError("D0 evidence manifest changed during final application")
        if sha256_file(review_path) != original_review_hash:
            raise ValueError("D0 source review changed during final application")
        if sha256_file(confirmation_path) != confirmation_hash:
            raise ValueError("D0 final confirmation changed during application")
        if sha256_file(bundle_path) != original_bundle_hash:
            raise ValueError("D0 final review bundle changed during application")
        load_and_validate_d0_final_review_bundle(
            paths,
            authorization_path,
            review_path,
            bundle_path,
        )
        if review_output.exists():
            raise FileExistsError(f"Refusing to overwrite {review_output}")
        os.link(review_temporary, review_output)
        review_published = True
        readiness_paths = replace(paths, evidence_manifest=manifest_temporary)
        readiness = build_readiness_report(readiness_paths)
        if not readiness.ready or readiness.blockers:
            raise ValueError(
                "Applied D0 final state did not reach a zero-blocker D0 gate: "
                + "; ".join(f"{check.code}: {check.message}" for check in readiness.blockers)
            )
        d0_summaries = [item for item in readiness.stage_summaries if item.stage == "D0"]
        if len(d0_summaries) != 1 or d0_summaries[0].completed != 4 or d0_summaries[0].total != 4:
            raise ValueError("Applied D0 final state has an invalid D0 task summary")
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
