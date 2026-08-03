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
from .d0_closure import load_and_validate_d0_ac009_review_bundle
from .d0_review import validate_review_packet
from .paths import RepositoryPaths
from .review_packets import validate_new_review_packet_path
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
    "expected_signatures",
    "decision",
    "comments",
    "signatures",
    "warning",
}
_SIGNATURE_FIELDS = {"role", "person_name", "signed_at"}
_ISO_DATE_IN_NAME = re.compile(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)")
_EXPECTED_APPLIED_CHECKS = {
    ("D0_REVIEW_ACCEPTANCE_PENDING", "acceptance_items.D0-AC-010"),
    ("D0_REVIEW_FINAL_PENDING", "final_decision"),
}


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
    _require_directory(review_output, paths.d0_review_dir, label="D0 AC-009 review output")
    output_date = validate_new_review_packet_path(
        review_output,
        paths.d0_review_dir,
        minimum_date=bundle_date,
        label="D0 AC-009 review output",
    )
    return _relative_path(paths, review_output, label="D0 AC-009 review output"), output_date


def _signature_expectations(bundle: dict[str, Any]) -> list[dict[str, str]]:
    templates = bundle.get("acceptance_item", {}).get("reviewer_signature_template")
    if not isinstance(templates, list) or not templates:
        raise ValueError("D0 AC-009 bundle signature templates are invalid")
    expectations: list[dict[str, str]] = []
    for template in templates:
        if not isinstance(template, dict):
            raise ValueError("D0 AC-009 bundle signature template must be an object")
        role = str(template.get("role") or "").strip()
        person_name = str(template.get("person_name") or "").strip()
        evidence_ids = template.get("evidence_ids")
        if (
            not role
            or not person_name
            or not isinstance(evidence_ids, list)
            or len(evidence_ids) != 1
            or not str(evidence_ids[0]).strip()
        ):
            raise ValueError("D0 AC-009 bundle signature template is incomplete")
        expectations.append({"role": role, "person_name": person_name})
    if len({item["role"] for item in expectations}) != len(expectations):
        raise ValueError("D0 AC-009 bundle signature roles are duplicated")
    return expectations


def build_d0_ac009_confirmation_template(
    paths: RepositoryPaths,
    authorization_path: Path,
    review_path: Path,
    bundle_path: Path,
    review_output: Path,
) -> dict[str, Any]:
    bundle = load_and_validate_d0_ac009_review_bundle(
        paths,
        authorization_path,
        review_path,
        bundle_path,
    )
    bundle_date = _dated_artifact(bundle_path, label="D0 AC-009 review bundle")
    review_relative, _ = _validate_review_output(
        paths,
        review_output,
        bundle_date=bundle_date,
    )
    expected_signatures = _signature_expectations(bundle)
    return {
        "schema_version": 1,
        "stage": "D0",
        "confirmation_type": "ac009_closure_review",
        "template_only": True,
        "authorized_transcription": False,
        "bundle": {
            "path": _relative_path(paths, bundle_path, label="D0 AC-009 review bundle"),
            "sha256": sha256_file(bundle_path),
        },
        "bound_current_head": bundle["current_head"],
        "source_review": bundle["inputs"]["review_packet"],
        "review_output": review_relative,
        "expected_signatures": expected_signatures,
        "decision": None,
        "comments": None,
        "signatures": [{**expectation, "signed_at": None} for expectation in expected_signatures],
        "warning": (
            "Complete only after every named D0-AC-009 role holder reviews the exact bundle "
            "SHA-256. Approval authorizes only AC-009 transcription; AC-010, the final D0 "
            "decision, D4, and user-facing development remain blocked."
        ),
    }


def _indexed_signatures(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("D0 AC-009 confirmation signatures must be a list")
    indexed: dict[str, dict[str, Any]] = {}
    for signature in value:
        if not isinstance(signature, dict) or set(signature) != _SIGNATURE_FIELDS:
            raise ValueError("D0 AC-009 confirmation signature fields are invalid")
        role = str(signature.get("role") or "").strip()
        if not role or role in indexed:
            raise ValueError("D0 AC-009 confirmation has a missing or duplicate role")
        indexed[role] = signature
    return indexed


def validate_d0_ac009_confirmation(
    paths: RepositoryPaths,
    confirmation: dict[str, Any],
    authorization_path: Path,
    review_path: Path,
    bundle_path: Path,
    review_output: Path,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    template = build_d0_ac009_confirmation_template(
        paths,
        authorization_path,
        review_path,
        bundle_path,
        review_output,
    )
    if set(confirmation) != _CONFIRMATION_FIELDS:
        raise ValueError("D0 AC-009 confirmation has missing or unexpected fields")
    if (
        confirmation.get("schema_version") != 1
        or confirmation.get("stage") != "D0"
        or confirmation.get("confirmation_type") != "ac009_closure_review"
    ):
        raise ValueError("D0 AC-009 confirmation header is invalid")
    if confirmation.get("template_only") is not False:
        raise ValueError("D0 AC-009 confirmation must be a completed copy")
    if confirmation.get("authorized_transcription") is not True:
        raise ValueError("D0 AC-009 confirmation requires explicit transcription authorization")
    for field in (
        "bundle",
        "bound_current_head",
        "source_review",
        "review_output",
        "expected_signatures",
        "warning",
    ):
        if confirmation.get(field) != template[field]:
            raise ValueError(f"D0 AC-009 confirmation changed the bound {field}")
    decision = confirmation.get("decision")
    if decision not in {"approved", "rejected"}:
        raise ValueError("D0 AC-009 confirmation decision must be approved or rejected")
    if decision == "rejected" and not str(confirmation.get("comments") or "").strip():
        raise ValueError("Rejected D0 AC-009 confirmation requires comments")

    expected = {
        str(item["role"]): str(item["person_name"]) for item in template["expected_signatures"]
    }
    signatures = _indexed_signatures(confirmation.get("signatures"))
    if set(signatures) != set(expected):
        raise ValueError("D0 AC-009 confirmation signature roles are incomplete or unexpected")
    bundle_date = _dated_artifact(bundle_path, label="D0 AC-009 review bundle")
    output_date = _dated_artifact(review_output, label="D0 AC-009 review output")
    for role, person_name in expected.items():
        signature = signatures[role]
        if signature.get("person_name") != person_name:
            raise ValueError(f"D0 AC-009 signer is not the signed holder of {role}")
        signed_date = _temporal_date(signature.get("signed_at"))
        if signed_date is None:
            raise ValueError(f"D0 AC-009 {role} signed_at must be an ISO date or aware datetime")
        if signed_date < bundle_date:
            raise ValueError(f"D0 AC-009 {role} signature cannot predate the reviewed bundle")
        if signed_date != output_date:
            raise ValueError(f"D0 AC-009 {role} signature date must match the review output date")
    bundle = load_and_validate_d0_ac009_review_bundle(
        paths,
        authorization_path,
        review_path,
        bundle_path,
    )
    return bundle, signatures


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


def write_d0_ac009_confirmation_template(
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
        label="D0 AC-009 confirmation template",
    )
    if confirmation_output.suffix.lower() != ".json":
        raise ValueError("D0 AC-009 confirmation template must be a JSON file")
    if confirmation_output.exists():
        raise FileExistsError(f"Refusing to overwrite {confirmation_output}")
    template = build_d0_ac009_confirmation_template(
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
    signatures: dict[str, dict[str, Any]],
    comments: Any,
) -> dict[str, Any]:
    packet, _ = _load_object_and_sha256(review_path, label="D0 source review packet")
    items = packet.get("acceptance_items")
    if not isinstance(items, list):
        raise ValueError("D0 source review acceptance items are invalid")
    acceptance = {
        str(item.get("acceptance_id") or ""): item for item in items if isinstance(item, dict)
    }
    target = acceptance.get("D0-AC-009")
    if not isinstance(target, dict) or target.get("review_status") != "pending":
        raise ValueError("D0-AC-009 is not pending in the source review packet")
    signature_templates = deepcopy(bundle["acceptance_item"]["reviewer_signature_template"])
    for signature in signature_templates:
        role = str(signature["role"])
        signature["signed_at"] = signatures[role]["signed_at"]
    target.update(
        {
            "comments": comments,
            "review_status": "approved",
            "reviewer_signatures": signature_templates,
        }
    )
    return packet


def _build_applied_manifest(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    signatures: dict[str, dict[str, Any]],
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
        label="D0 AC-009 confirmation evidence",
    )
    for template in bundle["evidence_manifest_templates"]:
        evidence_id = str(template["evidence_id"])
        role = str(template["reviewer_role"])
        if evidence_id in existing_ids:
            raise ValueError(f"D0 AC-009 evidence ID already exists: {evidence_id}")
        entry = deepcopy(template)
        entry.update(
            {
                "path": confirmation_relative,
                "sha256": confirmation_hash,
                "recorded_at": signatures[role]["signed_at"],
                "status": "已批准",
                "subject_sha256": sha256_file(paths.root / str(template["subject_path"])),
            }
        )
        entries.append(entry)
        existing_ids.add(evidence_id)
    return manifest


def _validate_applied_review(
    paths: RepositoryPaths,
    manifest_temporary: Path,
    packet: dict[str, Any],
) -> None:
    validation_paths = replace(paths, evidence_manifest=manifest_temporary)
    evidence_checks = validate_evidence(validation_paths)
    if evidence_checks:
        raise ValueError(
            "Applied D0 AC-009 evidence manifest failed validation: "
            + "; ".join(f"{check.code}: {check.message}" for check in evidence_checks)
        )
    review_checks = validate_review_packet(validation_paths, packet)
    actual = {(check.code, str(check.location or "")) for check in review_checks}
    if len(review_checks) != len(_EXPECTED_APPLIED_CHECKS) or actual != _EXPECTED_APPLIED_CHECKS:
        raise ValueError(
            "Applied D0 AC-009 review has unexpected validation errors: "
            + "; ".join(f"{check.code}: {check.message}" for check in review_checks)
        )


def apply_d0_ac009_confirmation(
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
        label="D0 AC-009 confirmation evidence",
    )
    if manifest_output.resolve() != paths.evidence_manifest.resolve():
        raise ValueError("D0 AC-009 application must update the current evidence manifest")
    if review_output.exists():
        raise FileExistsError(f"Refusing to overwrite {review_output}")
    confirmation, confirmation_hash = _load_object_and_sha256(
        confirmation_path,
        label="D0 AC-009 confirmation",
    )
    bundle, signatures = validate_d0_ac009_confirmation(
        paths,
        confirmation,
        authorization_path,
        review_path,
        bundle_path,
        review_output,
    )
    if confirmation["decision"] != "approved":
        raise ValueError("D0-AC-009 closure review was rejected")
    packet = _build_applied_review(
        review_path,
        bundle,
        signatures,
        confirmation.get("comments"),
    )
    manifest = _build_applied_manifest(
        paths,
        bundle,
        signatures,
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
        _validate_applied_review(paths, manifest_temporary, packet)
        if sha256_file(paths.evidence_manifest) != original_manifest_hash:
            raise ValueError("D0 evidence manifest changed during AC-009 application")
        if sha256_file(review_path) != original_review_hash:
            raise ValueError("D0 source review changed during AC-009 application")
        if sha256_file(confirmation_path) != confirmation_hash:
            raise ValueError("D0 AC-009 confirmation changed during application")
        if sha256_file(bundle_path) != original_bundle_hash:
            raise ValueError("D0 AC-009 review bundle changed during application")
        load_and_validate_d0_ac009_review_bundle(
            paths,
            authorization_path,
            review_path,
            bundle_path,
        )
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
