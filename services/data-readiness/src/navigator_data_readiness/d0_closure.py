from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .d0_baseline_adoption import (
    assess_d0_baseline_adoption,
    load_and_validate_d0_baseline_publication_authorization,
)
from .d0_review import validate_review_packet
from .paths import RepositoryPaths
from .readiness import build_readiness_report
from .review_packets import latest_review_packet

_CARRIED_ACCEPTANCE_IDS = {f"D0-AC-{number:03d}" for number in range(1, 9)}
_PENDING_ACCEPTANCE_IDS = {"D0-AC-009", "D0-AC-010"}
_EXPECTED_REVIEW_CHECKS = {
    ("D0_REVIEW_ACCEPTANCE_PENDING", "acceptance_items.D0-AC-009"),
    ("D0_REVIEW_ACCEPTANCE_PENDING", "acceptance_items.D0-AC-010"),
    ("D0_REVIEW_FINAL_PENDING", "final_decision"),
}
_FINAL_CARRIED_ACCEPTANCE_IDS = {f"D0-AC-{number:03d}" for number in range(1, 10)}
_EXPECTED_FINAL_REVIEW_CHECKS = {
    ("D0_REVIEW_ACCEPTANCE_PENDING", "acceptance_items.D0-AC-010"),
    ("D0_REVIEW_FINAL_PENDING", "final_decision"),
}
_CONTRACT_NAME = re.compile(r"[a-z0-9_]+")
_ISO_DATE_IN_NAME = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")


def _payload_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _load_object_bytes(content: bytes, *, label: str) -> dict[str, Any]:
    payload = json.loads(content.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload


def _load_object(path: Path, *, label: str) -> dict[str, Any]:
    return _load_object_bytes(path.read_bytes(), label=label)


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


def _git(paths: RepositoryPaths, *arguments: str) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(
        ["git", "-C", str(paths.root), *arguments],
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"Git command failed ({' '.join(arguments)}): {message}")
    return result


def _current_head(paths: RepositoryPaths) -> str:
    return _git(paths, "rev-parse", "--verify", "HEAD^{commit}").stdout.decode("ascii").strip()


def _current_git_binding(
    paths: RepositoryPaths,
    path: Path,
    *,
    label: str,
) -> tuple[dict[str, str], bytes]:
    relative = _relative_path(paths, path, label=label)
    output = _git(paths, "ls-tree", "-z", "HEAD", "--", relative).stdout
    records = [record for record in output.split(b"\0") if record]
    if len(records) != 1 or b"\t" not in records[0]:
        raise ValueError(f"{label} must resolve to exactly one Git object at HEAD")
    metadata, raw_name = records[0].split(b"\t", 1)
    parts = metadata.decode("ascii").split()
    if len(parts) != 3:
        raise ValueError(f"{label} Git tree metadata is invalid")
    mode, object_type, object_id = parts
    if raw_name.decode("utf-8") != relative or mode != "100644" or object_type != "blob":
        raise ValueError(f"{label} must be a canonical regular Git file")
    content = _git(paths, "cat-file", "blob", object_id).stdout
    if not path.is_file() or path.read_bytes() != content:
        raise ValueError(f"{label} must exactly match its committed Git blob at HEAD")
    return (
        {
            "path": relative,
            "sha256": hashlib.sha256(content).hexdigest(),
            "git_blob": object_id,
        },
        content,
    )


def _dated_output(path: Path) -> str:
    match = _ISO_DATE_IN_NAME.search(path.name)
    if match is None:
        raise ValueError("D0 AC-009 review bundle filename must contain an ISO date")
    return "".join(match.groups())


def _latest_review_packet(paths: RepositoryPaths) -> Path:
    packet = latest_review_packet(paths.d0_review_dir)
    if packet is None:
        raise ValueError("A completed D0 review packet is required")
    return packet


def _indexed_items(
    items: Any,
    *,
    identity_field: str,
    label: str,
) -> dict[str, dict[str, Any]]:
    if not isinstance(items, list):
        raise ValueError(f"{label} must be a list")
    indexed: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            raise ValueError(f"{label} entries must be objects")
        identity = str(item.get(identity_field) or "").strip()
        if not identity or identity in indexed:
            raise ValueError(f"{label} contains a missing or duplicate {identity_field}")
        indexed[identity] = item
    return indexed


def _validate_review_state(
    paths: RepositoryPaths,
    review: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, str], list[dict[str, Any]]]:
    checks = validate_review_packet(paths, review)
    check_scope = {(check.code, str(check.location or "")) for check in checks}
    if len(checks) != len(_EXPECTED_REVIEW_CHECKS) or check_scope != _EXPECTED_REVIEW_CHECKS:
        raise ValueError(
            "D0 AC-009 closure review requires only AC-009, AC-010, and the final "
            "decision to remain pending: "
            + "; ".join(f"{check.code}: {check.message}" for check in checks)
        )

    acceptance = _indexed_items(
        review.get("acceptance_items"),
        identity_field="acceptance_id",
        label="D0 acceptance items",
    )
    if set(acceptance) != _CARRIED_ACCEPTANCE_IDS | _PENDING_ACCEPTANCE_IDS:
        raise ValueError("D0 acceptance item inventory is invalid")
    approved = {
        acceptance_id
        for acceptance_id, item in acceptance.items()
        if item.get("review_status") == "approved"
    }
    pending = {
        acceptance_id
        for acceptance_id, item in acceptance.items()
        if item.get("review_status") == "pending"
    }
    if approved != _CARRIED_ACCEPTANCE_IDS or pending != _PENDING_ACCEPTANCE_IDS:
        raise ValueError("D0 AC-009 closure review requires AC-001 through AC-008 only")
    final_decision = review.get("final_decision")
    if not isinstance(final_decision, dict) or final_decision.get("status") != "pending":
        raise ValueError("The final D0 decision must remain pending")

    roles = _indexed_items(
        review.get("role_assignments"),
        identity_field="role",
        label="D0 role assignments",
    )
    role_holders = {
        role: str(item.get("role_holder") or "").strip() for role, item in roles.items()
    }
    ac009_roles = acceptance["D0-AC-009"].get("required_roles")
    if (
        not isinstance(ac009_roles, list)
        or not ac009_roles
        or any(not role_holders.get(str(role)) for role in ac009_roles)
    ):
        raise ValueError("D0-AC-009 requires signed named role holders")
    return acceptance, role_holders, [check.to_dict() for check in checks]


def _validate_contract_snapshot(
    paths: RepositoryPaths,
    d0_binding: dict[str, str],
    technical_binding: dict[str, str],
) -> dict[str, Any]:
    manifest_path = paths.contracts_dir / "manifest.json"
    manifest_binding, manifest_content = _current_git_binding(
        paths,
        manifest_path,
        label="D0 contract snapshot manifest",
    )
    manifest = _load_object_bytes(manifest_content, label="D0 contract snapshot manifest")
    if manifest.get("schema_version") != 1 or manifest.get("baseline_version") != "V1.0-BASELINE":
        raise ValueError("D0 contract snapshot manifest header is invalid")
    expected_sources = {
        "d0_workbook": {
            "path": d0_binding["path"],
            "sha256": d0_binding["sha256"],
        },
        "technical_workbook": {
            "path": technical_binding["path"],
            "sha256": technical_binding["sha256"],
        },
    }
    if manifest.get("sources") != expected_sources:
        raise ValueError("D0 contract snapshot does not bind the current authoritative workbooks")
    contract_hashes = manifest.get("contract_sha256")
    record_counts = manifest.get("record_counts")
    if (
        not isinstance(contract_hashes, dict)
        or not contract_hashes
        or not isinstance(record_counts, dict)
        or set(contract_hashes) != set(record_counts)
    ):
        raise ValueError("D0 contract snapshot inventory is invalid")

    files: list[dict[str, Any]] = []
    for name in sorted(contract_hashes):
        if not isinstance(name, str) or _CONTRACT_NAME.fullmatch(name) is None:
            raise ValueError(f"D0 contract snapshot name is invalid: {name}")
        contract_path = paths.contracts_dir / f"{name}.json"
        binding, content = _current_git_binding(
            paths,
            contract_path,
            label=f"D0 contract snapshot {name}",
        )
        if binding["sha256"] != contract_hashes[name]:
            raise ValueError(f"D0 contract snapshot hash mismatch: {name}")
        records = json.loads(content.decode("utf-8"))
        if not isinstance(records, list) or len(records) != record_counts[name]:
            raise ValueError(f"D0 contract snapshot record count mismatch: {name}")
        files.append({**binding, "contract": name, "record_count": len(records)})
    return {"manifest": manifest_binding, "contracts": files}


def _normalized_location(paths: RepositoryPaths, location: str | None) -> str | None:
    if location is None:
        return None
    candidate = Path(location)
    if candidate.is_absolute():
        try:
            return candidate.resolve().relative_to(paths.root.resolve()).as_posix()
        except ValueError:
            return location
    return location


def _normalized_check(paths: RepositoryPaths, check: Any) -> dict[str, Any]:
    return {
        "code": str(check.code),
        "message": str(check.message),
        "severity": str(check.severity),
        "location": _normalized_location(paths, check.location),
    }


def _validate_readiness_replay(paths: RepositoryPaths) -> dict[str, Any]:
    report = build_readiness_report(paths)
    blockers = [_normalized_check(paths, check) for check in report.blockers]
    expected = {
        ("D0_ACCEPTANCE_PENDING", "D0-AC-009"),
        ("D0_ACCEPTANCE_PENDING", "D0-AC-010"),
        ("EVIDENCE_ACCEPTANCE_MISSING", "D0-AC-009"),
        ("EVIDENCE_ACCEPTANCE_MISSING", "D0-AC-010"),
    }
    actual: set[tuple[str, str]] = set()
    for item in blockers:
        code = item["code"]
        message = item["message"]
        if code == "D0_ACCEPTANCE_PENDING" and message.endswith(" is pending"):
            acceptance_id = message.partition(":")[0]
        elif code == "EVIDENCE_ACCEPTANCE_MISSING" and message.startswith(
            "No evidence is registered for "
        ):
            acceptance_id = message.removeprefix("No evidence is registered for ")
        else:
            acceptance_id = ""
        actual.add((code, acceptance_id))
    if len(blockers) != len(expected) or actual != expected:
        raise ValueError(
            "D0 AC-009 closure has unexpected readiness blockers: "
            + "; ".join(f"{item['code']}: {item['message']}" for item in blockers)
        )
    d0_summaries = [summary for summary in report.stage_summaries if summary.stage == "D0"]
    if (
        len(d0_summaries) != 1
        or d0_summaries[0].completed != 4
        or d0_summaries[0].total != 4
        or d0_summaries[0].status != "已完成"
    ):
        raise ValueError("D0 AC-009 closure requires all four D0 tasks to be complete")
    return {
        "baseline_version": report.baseline_version,
        "current_stage": report.current_stage,
        "workbook_hashes": report.workbook_hashes,
        "stage_summaries": [summary.to_dict() for summary in report.stage_summaries],
        "warnings": [_normalized_check(paths, warning) for warning in report.warnings],
        "preclosure_blockers": [],
        "excluded_self_gates": blockers,
    }


def build_d0_ac009_review_bundle(
    paths: RepositoryPaths,
    authorization_path: Path,
    review_path: Path,
    bundle_output: Path,
) -> dict[str, Any]:
    _require_directory(
        authorization_path,
        paths.d0_candidates_dir,
        label="D0 publication authorization",
    )
    _require_directory(review_path, paths.d0_review_dir, label="D0 review packet")
    _require_directory(bundle_output, paths.d0_candidates_dir, label="D0 AC-009 review bundle")
    if bundle_output.suffix.lower() != ".json":
        raise ValueError("D0 AC-009 review bundle must be a JSON file")
    evidence_date = _dated_output(bundle_output)
    latest_review = _latest_review_packet(paths)
    if review_path.resolve() != latest_review.resolve():
        raise ValueError("D0 AC-009 closure requires the latest completed review packet")

    head = _current_head(paths)
    authorization_binding, _ = _current_git_binding(
        paths,
        authorization_path,
        label="D0 publication authorization",
    )
    load_and_validate_d0_baseline_publication_authorization(paths, authorization_path)
    adoption = assess_d0_baseline_adoption(paths, authorization_path)
    if adoption.get("ready_for_post_publication_d0_rebuild") is not True:
        codes = [str(check.get("code")) for check in adoption.get("checks", [])]
        raise ValueError(
            "D0 AC-009 closure requires a committed approved baseline publication: "
            + ", ".join(codes or ["unknown adoption failure"])
        )
    if adoption.get("current_head") != head:
        raise ValueError("D0 adoption replay does not bind the current Git HEAD")

    review_binding, review_content = _current_git_binding(
        paths,
        review_path,
        label="D0 review packet",
    )
    review = _load_object_bytes(review_content, label="D0 review packet")
    acceptance, role_holders, review_checks = _validate_review_state(paths, review)

    d0_binding, _ = _current_git_binding(
        paths,
        paths.d0_workbook,
        label="authoritative D0 workbook",
    )
    technical_binding, _ = _current_git_binding(
        paths,
        paths.technical_workbook,
        label="authoritative technical workbook",
    )
    evidence_binding, _ = _current_git_binding(
        paths,
        paths.evidence_manifest,
        label="D0 evidence manifest",
    )
    contracts = _validate_contract_snapshot(paths, d0_binding, technical_binding)
    readiness = _validate_readiness_replay(paths)
    if readiness["workbook_hashes"] != {
        "d0_workbook": d0_binding["sha256"],
        "technical_workbook": technical_binding["sha256"],
    }:
        raise ValueError("D0 readiness replay workbook hashes are inconsistent")

    ac009 = acceptance["D0-AC-009"]
    required_roles = [str(role) for role in ac009["required_roles"]]
    bundle_relative = _relative_path(
        paths,
        bundle_output,
        label="D0 AC-009 review bundle",
    )
    signature_templates: list[dict[str, Any]] = []
    evidence_templates: list[dict[str, Any]] = []
    for index, role in enumerate(required_roles, start=1):
        evidence_id = f"EVD-D0-AC-009-CLOSURE-R{index:02d}-{evidence_date}"
        signature_templates.append(
            {
                "role": role,
                "person_name": role_holders[role],
                "signed_at": None,
                "evidence_ids": [evidence_id],
            }
        )
        evidence_templates.append(
            {
                "evidence_id": evidence_id,
                "acceptance_id": "D0-AC-009",
                "path": None,
                "sha256": None,
                "recorded_by": "codex (authorized transcription)",
                "recorded_at": None,
                "reviewer": role_holders[role],
                "reviewer_role": role,
                "status": "待复核",
                "subject_path": bundle_relative,
                "subject_sha256": None,
            }
        )
    return {
        "schema_version": 1,
        "stage": "D0",
        "bundle_type": "ac009_closure_review_candidate",
        "automated_assessment_only": True,
        "does_not_approve_acceptance": True,
        "does_not_complete_d0": True,
        "does_not_complete_d4": True,
        "does_not_authorize_user_facing_development": True,
        "current_head": head,
        "inputs": {
            "publication_authorization": authorization_binding,
            "review_packet": review_binding,
            "authoritative_d0_workbook": d0_binding,
            "authoritative_technical_workbook": technical_binding,
            "contract_snapshot": contracts,
            "evidence_manifest": evidence_binding,
        },
        "publication_replay": {
            "ready_for_post_publication_d0_rebuild": True,
            "expected_publication": adoption["expected_publication"],
            "current_authoritative_workbook": adoption["current_authoritative_workbook"],
            "checks": [],
        },
        "review_replay": {
            "carried_acceptance_ids": sorted(_CARRIED_ACCEPTANCE_IDS),
            "remaining_acceptance_ids": sorted(_PENDING_ACCEPTANCE_IDS),
            "validation_checks": review_checks,
        },
        "readiness_replay": readiness,
        "acceptance_item": {
            "acceptance_id": "D0-AC-009",
            "title": ac009["title"],
            "hard_gate": ac009["hard_gate"],
            "current_review_status": ac009["review_status"],
            "required_roles": required_roles,
            "evidence_candidate_ids": [
                template["evidence_ids"][0] for template in signature_templates
            ],
            "reviewer_signature_template": signature_templates,
        },
        "evidence_manifest_templates": evidence_templates,
        "ready_for_named_human_review": True,
        "next_required_action": (
            "The signed D0-AC-009 role holders must review the exact bundle SHA-256. "
            "D0-AC-010 and the final D0 decision remain pending."
        ),
        "warning": (
            "This machine-generated candidate excludes only the four self-referential AC-009/010 "
            "pending/evidence gates. It is not an approval, does not complete D0 or D4, and does "
            "not authorize user-facing development."
        ),
    }


def load_and_validate_d0_ac009_review_bundle(
    paths: RepositoryPaths,
    authorization_path: Path,
    review_path: Path,
    bundle_path: Path,
) -> dict[str, Any]:
    bundle = _load_object(bundle_path, label="D0 AC-009 review bundle")
    expected = build_d0_ac009_review_bundle(
        paths,
        authorization_path,
        review_path,
        bundle_path,
    )
    if bundle != expected:
        raise ValueError("D0 AC-009 review bundle does not match a deterministic Git replay")
    return bundle


def write_d0_ac009_review_bundle(
    paths: RepositoryPaths,
    authorization_path: Path,
    review_path: Path,
    bundle_output: Path,
) -> Path:
    if bundle_output.exists():
        raise FileExistsError(f"Refusing to overwrite {bundle_output}")
    bundle = build_d0_ac009_review_bundle(
        paths,
        authorization_path,
        review_path,
        bundle_output,
    )
    bundle_output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=bundle_output.parent,
        prefix=f".{bundle_output.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        temporary.write(_payload_bytes(bundle))
        temporary_path = Path(temporary.name)
    temporary_path.chmod(0o644)
    try:
        if bundle_output.exists():
            raise FileExistsError(f"Refusing to overwrite {bundle_output}")
        os.link(temporary_path, bundle_output)
    finally:
        temporary_path.unlink(missing_ok=True)
    return bundle_output


def _validate_final_review_state(
    paths: RepositoryPaths,
    review: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, str], list[dict[str, Any]]]:
    checks = validate_review_packet(paths, review)
    check_scope = {(check.code, str(check.location or "")) for check in checks}
    if (
        len(checks) != len(_EXPECTED_FINAL_REVIEW_CHECKS)
        or check_scope != _EXPECTED_FINAL_REVIEW_CHECKS
    ):
        raise ValueError(
            "D0 final closure review requires only AC-010 and the final decision to remain "
            "pending: " + "; ".join(f"{check.code}: {check.message}" for check in checks)
        )
    acceptance = _indexed_items(
        review.get("acceptance_items"),
        identity_field="acceptance_id",
        label="D0 acceptance items",
    )
    expected_ids = _FINAL_CARRIED_ACCEPTANCE_IDS | {"D0-AC-010"}
    if set(acceptance) != expected_ids:
        raise ValueError("D0 acceptance item inventory is invalid")
    approved = {
        acceptance_id
        for acceptance_id, item in acceptance.items()
        if item.get("review_status") == "approved"
    }
    if (
        approved != _FINAL_CARRIED_ACCEPTANCE_IDS
        or acceptance["D0-AC-010"].get("review_status") != "pending"
    ):
        raise ValueError("D0 final closure requires AC-001 through AC-009 only")
    final_decision = review.get("final_decision")
    if not isinstance(final_decision, dict) or final_decision.get("status") != "pending":
        raise ValueError("The final D0 decision must remain pending")
    roles = _indexed_items(
        review.get("role_assignments"),
        identity_field="role",
        label="D0 role assignments",
    )
    role_holders = {
        role: str(item.get("role_holder") or "").strip() for role, item in roles.items()
    }
    required_roles = acceptance["D0-AC-010"].get("required_roles")
    approver_role = str(final_decision.get("approver_role") or "").strip()
    if (
        not isinstance(required_roles, list)
        or required_roles != [approver_role]
        or not role_holders.get(approver_role)
    ):
        raise ValueError("D0-AC-010 requires the signed named project approver")
    return acceptance, role_holders, [check.to_dict() for check in checks]


def _validate_final_readiness_replay(paths: RepositoryPaths) -> dict[str, Any]:
    report = build_readiness_report(paths)
    blockers = [_normalized_check(paths, check) for check in report.blockers]
    expected = {
        ("D0_ACCEPTANCE_PENDING", "D0-AC-010"),
        ("EVIDENCE_ACCEPTANCE_MISSING", "D0-AC-010"),
    }
    actual: set[tuple[str, str]] = set()
    for item in blockers:
        code = item["code"]
        message = item["message"]
        if code == "D0_ACCEPTANCE_PENDING" and message.endswith(" is pending"):
            acceptance_id = message.partition(":")[0]
        elif code == "EVIDENCE_ACCEPTANCE_MISSING" and message.startswith(
            "No evidence is registered for "
        ):
            acceptance_id = message.removeprefix("No evidence is registered for ")
        else:
            acceptance_id = ""
        actual.add((code, acceptance_id))
    if len(blockers) != len(expected) or actual != expected:
        raise ValueError(
            "D0 final closure has unexpected readiness blockers: "
            + "; ".join(f"{item['code']}: {item['message']}" for item in blockers)
        )
    d0_summaries = [summary for summary in report.stage_summaries if summary.stage == "D0"]
    if (
        len(d0_summaries) != 1
        or d0_summaries[0].completed != 4
        or d0_summaries[0].total != 4
        or d0_summaries[0].status != "已完成"
    ):
        raise ValueError("D0 final closure requires all four D0 tasks to be complete")
    return {
        "baseline_version": report.baseline_version,
        "current_stage": report.current_stage,
        "workbook_hashes": report.workbook_hashes,
        "stage_summaries": [summary.to_dict() for summary in report.stage_summaries],
        "warnings": [_normalized_check(paths, warning) for warning in report.warnings],
        "preclosure_blockers": [],
        "excluded_self_gates": blockers,
    }


def build_d0_final_review_bundle(
    paths: RepositoryPaths,
    authorization_path: Path,
    review_path: Path,
    bundle_output: Path,
) -> dict[str, Any]:
    _require_directory(
        authorization_path,
        paths.d0_candidates_dir,
        label="D0 publication authorization",
    )
    _require_directory(review_path, paths.d0_review_dir, label="D0 review packet")
    _require_directory(bundle_output, paths.d0_candidates_dir, label="D0 final review bundle")
    if bundle_output.suffix.lower() != ".json":
        raise ValueError("D0 final review bundle must be a JSON file")
    evidence_date = _dated_output(bundle_output)
    if review_path.resolve() != _latest_review_packet(paths).resolve():
        raise ValueError("D0 final closure requires the latest completed review packet")

    head = _current_head(paths)
    authorization_binding, _ = _current_git_binding(
        paths,
        authorization_path,
        label="D0 publication authorization",
    )
    load_and_validate_d0_baseline_publication_authorization(paths, authorization_path)
    adoption = assess_d0_baseline_adoption(paths, authorization_path)
    if adoption.get("ready_for_post_publication_d0_rebuild") is not True:
        codes = [str(check.get("code")) for check in adoption.get("checks", [])]
        raise ValueError(
            "D0 final closure requires a committed approved baseline publication: "
            + ", ".join(codes or ["unknown adoption failure"])
        )
    if adoption.get("current_head") != head:
        raise ValueError("D0 adoption replay does not bind the current Git HEAD")

    review_binding, review_content = _current_git_binding(
        paths,
        review_path,
        label="D0 review packet",
    )
    review = _load_object_bytes(review_content, label="D0 review packet")
    acceptance, role_holders, review_checks = _validate_final_review_state(paths, review)
    d0_binding, _ = _current_git_binding(
        paths,
        paths.d0_workbook,
        label="authoritative D0 workbook",
    )
    technical_binding, _ = _current_git_binding(
        paths,
        paths.technical_workbook,
        label="authoritative technical workbook",
    )
    evidence_binding, _ = _current_git_binding(
        paths,
        paths.evidence_manifest,
        label="D0 evidence manifest",
    )
    contracts = _validate_contract_snapshot(paths, d0_binding, technical_binding)
    readiness = _validate_final_readiness_replay(paths)
    if readiness["workbook_hashes"] != {
        "d0_workbook": d0_binding["sha256"],
        "technical_workbook": technical_binding["sha256"],
    }:
        raise ValueError("D0 final readiness replay workbook hashes are inconsistent")

    ac010 = acceptance["D0-AC-010"]
    required_role = str(ac010["required_roles"][0])
    approver = role_holders[required_role]
    acceptance_evidence_id = f"EVD-D0-AC-010-CLOSURE-ACCEPTANCE-{evidence_date}"
    final_evidence_id = f"EVD-D0-AC-010-CLOSURE-FINAL-{evidence_date}"
    bundle_relative = _relative_path(paths, bundle_output, label="D0 final review bundle")
    evidence_templates = [
        {
            "evidence_id": evidence_id,
            "acceptance_id": "D0-AC-010",
            "path": None,
            "sha256": None,
            "recorded_by": "codex (authorized transcription)",
            "recorded_at": None,
            "reviewer": approver,
            "reviewer_role": required_role,
            "review_purpose": purpose,
            "status": "待复核",
            "subject_path": bundle_relative,
            "subject_sha256": None,
        }
        for evidence_id, purpose in (
            (acceptance_evidence_id, "D0-AC-010 acceptance"),
            (final_evidence_id, "final D0 decision"),
        )
    ]
    return {
        "schema_version": 1,
        "stage": "D0",
        "bundle_type": "final_closure_review_candidate",
        "automated_assessment_only": True,
        "does_not_approve_acceptance": True,
        "does_not_approve_final_decision": True,
        "does_not_complete_d0": True,
        "does_not_complete_d4": True,
        "does_not_authorize_user_facing_development": True,
        "current_head": head,
        "inputs": {
            "publication_authorization": authorization_binding,
            "review_packet": review_binding,
            "authoritative_d0_workbook": d0_binding,
            "authoritative_technical_workbook": technical_binding,
            "contract_snapshot": contracts,
            "evidence_manifest": evidence_binding,
        },
        "publication_replay": {
            "ready_for_post_publication_d0_rebuild": True,
            "expected_publication": adoption["expected_publication"],
            "current_authoritative_workbook": adoption["current_authoritative_workbook"],
            "checks": [],
        },
        "review_replay": {
            "carried_acceptance_ids": sorted(_FINAL_CARRIED_ACCEPTANCE_IDS),
            "remaining_acceptance_ids": ["D0-AC-010"],
            "validation_checks": review_checks,
        },
        "readiness_replay": readiness,
        "acceptance_item": {
            "acceptance_id": "D0-AC-010",
            "title": ac010["title"],
            "hard_gate": ac010["hard_gate"],
            "current_review_status": ac010["review_status"],
            "required_roles": [required_role],
            "reviewer_signature_template": [
                {
                    "role": required_role,
                    "person_name": approver,
                    "signed_at": None,
                    "evidence_ids": [acceptance_evidence_id],
                }
            ],
        },
        "final_decision_template": {
            "status": "approved",
            "approver_role": required_role,
            "approved_by": approver,
            "approved_at": None,
            "evidence_ids": [final_evidence_id],
            "comments": None,
        },
        "evidence_manifest_templates": evidence_templates,
        "ready_for_named_human_review": True,
        "next_required_action": (
            "The signed project approver must review the exact bundle SHA-256 separately for "
            "D0-AC-010 and the final D0 decision."
        ),
        "warning": (
            "This machine-generated candidate excludes only the AC-010 pending and missing "
            "evidence self-gates. It is not an approval, does not complete D0 or D4, and does "
            "not authorize user-facing development."
        ),
    }


def load_and_validate_d0_final_review_bundle(
    paths: RepositoryPaths,
    authorization_path: Path,
    review_path: Path,
    bundle_path: Path,
) -> dict[str, Any]:
    bundle = _load_object(bundle_path, label="D0 final review bundle")
    expected = build_d0_final_review_bundle(
        paths,
        authorization_path,
        review_path,
        bundle_path,
    )
    if bundle != expected:
        raise ValueError("D0 final review bundle does not match a deterministic Git replay")
    return bundle


def write_d0_final_review_bundle(
    paths: RepositoryPaths,
    authorization_path: Path,
    review_path: Path,
    bundle_output: Path,
) -> Path:
    if bundle_output.exists():
        raise FileExistsError(f"Refusing to overwrite {bundle_output}")
    bundle = build_d0_final_review_bundle(
        paths,
        authorization_path,
        review_path,
        bundle_output,
    )
    bundle_output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=bundle_output.parent,
        prefix=f".{bundle_output.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        temporary.write(_payload_bytes(bundle))
        temporary_path = Path(temporary.name)
    temporary_path.chmod(0o644)
    try:
        if bundle_output.exists():
            raise FileExistsError(f"Refusing to overwrite {bundle_output}")
        os.link(temporary_path, bundle_output)
    finally:
        temporary_path.unlink(missing_ok=True)
    return bundle_output
