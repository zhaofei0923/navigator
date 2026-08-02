from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
from copy import deepcopy
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .baseline import sha256_file
from .d0_review import build_review_packet, validate_review_packet
from .models import CheckResult
from .paths import RepositoryPaths
from .validation import APPROVED_EVIDENCE_STATES, validate_structure

_POST_ADOPTION_PENDING_CODES = {
    "D0_REVIEW_ACCEPTANCE_PENDING",
    "D0_REVIEW_FINAL_PENDING",
}
_EXPECTED_CARRIED_ACCEPTANCE_IDS = {f"D0-AC-{number:03d}" for number in range(1, 9)}
_EXPECTED_REMAINING_ACCEPTANCE_IDS = {"D0-AC-009", "D0-AC-010"}
_MACHINE_PASS_REQUIRED_CARRIED_IDS = {"D0-AC-001", "D0-AC-002", "D0-AC-003"}
_POST_ADOPTION_CONFIRMATION_FIELDS = {
    "schema_version",
    "stage",
    "confirmation_type",
    "template_only",
    "authorized_transcription",
    "bundle",
    "proposed_review_packet_sha256",
    "expected_reviewer",
    "review_output",
    "reviewer",
    "reviewed_at",
    "decision",
    "comments",
    "warning",
}


def _payload_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _write_new_payload(output_path: Path, payload: dict[str, Any]) -> Path:
    if output_path.exists():
        raise FileExistsError(f"Refusing to overwrite {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=output_path.parent,
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        temporary.write(_payload_bytes(payload))
        temporary_path = Path(temporary.name)
    temporary_path.chmod(0o644)
    try:
        if output_path.exists():
            raise FileExistsError(f"Refusing to overwrite {output_path}")
        os.link(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)
    return output_path


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


def _canonical_relative(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} requires a repository-relative path")
    candidate = Path(value)
    if candidate.is_absolute() or ".." in candidate.parts or candidate.as_posix() != value:
        raise ValueError(f"{label} path must be canonical and repository-relative")
    return value


def _git(
    paths: RepositoryPaths,
    *arguments: str,
    allowed_codes: set[int] | None = None,
) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(
        ["git", "-C", str(paths.root), *arguments],
        check=False,
        capture_output=True,
    )
    if result.returncode not in (allowed_codes or {0}):
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"Git command failed ({' '.join(arguments)}): {message}")
    return result


def _canonical_commit(paths: RepositoryPaths, revision: str) -> str:
    if not revision.strip():
        raise ValueError("D0 publication approval commit is required")
    return (
        _git(paths, "rev-parse", "--verify", f"{revision}^{{commit}}")
        .stdout.decode("ascii")
        .strip()
    )


def _current_head(paths: RepositoryPaths) -> str:
    return _canonical_commit(paths, "HEAD")


def _require_ancestor(paths: RepositoryPaths, ancestor: str, descendant: str) -> None:
    result = _git(
        paths,
        "merge-base",
        "--is-ancestor",
        ancestor,
        descendant,
        allowed_codes={0, 1},
    )
    if result.returncode != 0:
        raise ValueError(f"Approval commit {ancestor} is not an ancestor of {descendant}")


def _git_binding(
    paths: RepositoryPaths,
    commit: str,
    relative_path: str,
    *,
    label: str,
) -> tuple[dict[str, str], bytes]:
    relative = _canonical_relative(relative_path, label=label)
    output = _git(paths, "ls-tree", "-z", commit, "--", relative).stdout
    records = [item for item in output.split(b"\0") if item]
    if len(records) != 1 or b"\t" not in records[0]:
        raise ValueError(f"{label} must resolve to exactly one Git object at {commit}")
    metadata, raw_name = records[0].split(b"\t", 1)
    parts = metadata.decode("ascii").split()
    if len(parts) != 3:
        raise ValueError(f"{label} Git tree metadata is invalid")
    mode, object_type, object_id = parts
    name = raw_name.decode("utf-8")
    if name != relative or mode != "100644" or object_type != "blob":
        raise ValueError(f"{label} must be a canonical regular Git file")
    content = _git(paths, "cat-file", "blob", object_id).stdout
    return (
        {
            "path": relative,
            "sha256": hashlib.sha256(content).hexdigest(),
            "git_blob": object_id,
        },
        content,
    )


def _declared_git_binding(
    paths: RepositoryPaths,
    commit: str,
    declaration: Any,
    *,
    label: str,
) -> tuple[dict[str, str], bytes]:
    if not isinstance(declaration, dict):
        raise ValueError(f"{label} declaration must be an object")
    binding, content = _git_binding(
        paths,
        commit,
        _canonical_relative(declaration.get("path"), label=label),
        label=label,
    )
    if binding["sha256"] != declaration.get("sha256"):
        raise ValueError(f"{label} SHA-256 does not match its Git blob")
    return binding, content


def _validate_authorization_evidence(
    decision: dict[str, Any],
    confirmation: dict[str, Any],
    manifest: dict[str, Any],
) -> None:
    signature = decision.get("reviewer_signature")
    if not isinstance(signature, dict):
        raise ValueError("D0 publication decision reviewer signature is invalid")
    evidence_ids = signature.get("evidence_ids")
    if not isinstance(evidence_ids, list) or len(evidence_ids) != 2:
        raise ValueError("D0 publication decision requires two acceptance evidence IDs")
    entries = manifest.get("evidence")
    if not isinstance(entries, list):
        raise ValueError("D0 publication evidence manifest is invalid")
    acceptance_ids: set[str] = set()
    for evidence_id in evidence_ids:
        matches = [
            entry
            for entry in entries
            if isinstance(entry, dict) and entry.get("evidence_id") == evidence_id
        ]
        if len(matches) != 1:
            raise ValueError(f"D0 publication evidence must contain exactly one {evidence_id}")
        entry = matches[0]
        acceptance_ids.add(str(entry.get("acceptance_id") or ""))
        expected_fields = {
            "path": decision["confirmation"]["path"],
            "sha256": decision["confirmation"]["sha256"],
            "reviewer": signature["person_name"],
            "subject_path": decision["bundle"]["path"],
            "subject_sha256": decision["bundle"]["sha256"],
            "decision": "approved_for_manual_adoption",
        }
        if any(entry.get(key) != value for key, value in expected_fields.items()):
            raise ValueError(f"D0 publication evidence binding is invalid: {evidence_id}")
        if entry.get("status") not in APPROVED_EVIDENCE_STATES:
            raise ValueError(f"D0 publication evidence is not approved: {evidence_id}")
    if acceptance_ids != {"D0-AC-001", "D0-AC-002"}:
        raise ValueError("D0 publication evidence must bind AC-001 and AC-002")
    if (
        confirmation.get("reviewer") != signature.get("person_name")
        or confirmation.get("reviewed_at") != signature.get("signed_at")
        or confirmation.get("decision") != "approved_for_manual_adoption"
        or confirmation.get("template_only") is not False
        or confirmation.get("authorized_transcription") is not True
    ):
        raise ValueError("D0 publication confirmation does not match the signed decision")


def build_d0_baseline_publication_authorization(
    paths: RepositoryPaths,
    approval_commit: str,
    decision_path: Path,
    readiness_path: Path,
    staged_workbook: Path,
) -> dict[str, Any]:
    commit = _canonical_commit(paths, approval_commit)
    _require_ancestor(paths, commit, _current_head(paths))
    decision_relative = _relative_path(paths, decision_path, label="D0 baseline decision")
    readiness_relative = _relative_path(paths, readiness_path, label="D0 readiness report")
    staged_relative = _relative_path(paths, staged_workbook, label="D0 staged workbook")

    decision_binding, decision_content = _git_binding(
        paths,
        commit,
        decision_relative,
        label="D0 baseline decision",
    )
    readiness_binding, readiness_content = _git_binding(
        paths,
        commit,
        readiness_relative,
        label="D0 readiness report",
    )
    staged_binding, _ = _git_binding(
        paths,
        commit,
        staged_relative,
        label="D0 staged workbook",
    )
    decision = _load_object_bytes(decision_content, label="D0 baseline decision")
    readiness = _load_object_bytes(readiness_content, label="D0 readiness report")
    if (
        decision.get("schema_version") != 1
        or decision.get("stage") != "D0"
        or decision.get("record_type") != "baseline_adoption_decision"
        or decision.get("decision") != "approved_for_manual_adoption"
        or decision.get("manual_baseline_adoption_authorized") is not True
        or decision.get("does_not_activate_baseline") is not True
        or decision.get("does_not_complete_d0") is not True
    ):
        raise ValueError("D0 publication decision is not an approved safe adoption decision")
    inputs = decision.get("inputs")
    if not isinstance(inputs, dict):
        raise ValueError("D0 publication decision inputs are invalid")

    previous_binding, _ = _declared_git_binding(
        paths,
        commit,
        inputs.get("authoritative_workbook"),
        label="D0 previous authoritative workbook",
    )
    candidate_binding, _ = _declared_git_binding(
        paths,
        commit,
        inputs.get("candidate_workbook"),
        label="D0 approved candidate workbook",
    )
    resolution_binding, _ = _declared_git_binding(
        paths,
        commit,
        inputs.get("resolution"),
        label="D0 contract resolution",
    )
    review_binding, _ = _declared_git_binding(
        paths,
        commit,
        inputs.get("review_packet"),
        label="D0 formal review packet",
    )
    bundle_binding, bundle_content = _declared_git_binding(
        paths,
        commit,
        decision.get("bundle"),
        label="D0 baseline review bundle",
    )
    confirmation_binding, confirmation_content = _declared_git_binding(
        paths,
        commit,
        decision.get("confirmation"),
        label="D0 baseline confirmation",
    )
    manifest_binding, manifest_content = _git_binding(
        paths,
        commit,
        "data/d0/evidence/manifest.json",
        label="D0 evidence manifest",
    )
    bundle = _load_object_bytes(bundle_content, label="D0 baseline review bundle")
    confirmation = _load_object_bytes(
        confirmation_content,
        label="D0 baseline confirmation",
    )
    manifest = _load_object_bytes(manifest_content, label="D0 evidence manifest")
    if bundle.get("inputs") != inputs or bundle.get("change_summary") != decision.get(
        "change_summary"
    ):
        raise ValueError("D0 baseline decision does not match its reviewed bundle")
    if confirmation.get("bundle") != {
        "path": bundle_binding["path"],
        "sha256": bundle_binding["sha256"],
    }:
        raise ValueError("D0 baseline confirmation does not bind the reviewed bundle")
    _validate_authorization_evidence(decision, confirmation, manifest)

    expected_source = {
        "path": previous_binding["path"],
        "sha256": previous_binding["sha256"],
    }
    expected_decision = {
        "path": decision_binding["path"],
        "sha256": decision_binding["sha256"],
    }
    expected_candidate = {
        "path": candidate_binding["path"],
        "sha256": candidate_binding["sha256"],
    }
    expected_staged = {
        "path": staged_binding["path"],
        "sha256": staged_binding["sha256"],
    }
    if (
        readiness.get("schema_version") != 1
        or readiness.get("stage") != "D0"
        or readiness.get("ready_for_manual_baseline_publication") is not True
        or readiness.get("checks") != []
        or readiness.get("does_not_publish_baseline") is not True
        or readiness.get("does_not_activate_baseline") is not True
        or readiness.get("source_workbook") != expected_source
        or readiness.get("decision_record")
        != {**expected_decision, "decision": "approved_for_manual_adoption"}
        or readiness.get("expected_candidate_workbook") != expected_candidate
        or readiness.get("staged_workbook") != expected_staged
    ):
        raise ValueError("D0 readiness report does not prove the approved publication handoff")
    baseline_assessment = readiness.get("baseline_change_assessment")
    if not isinstance(baseline_assessment, dict) or (
        baseline_assessment.get("candidate_ready_for_formal_baseline_review") is not True
        or baseline_assessment.get("checks") != []
    ):
        raise ValueError("D0 readiness report baseline replay did not pass")
    if staged_binding["sha256"] != candidate_binding["sha256"]:
        raise ValueError("D0 staged workbook does not match the approved candidate")
    if Path(staged_binding["path"]).name != Path(previous_binding["path"]).name:
        raise ValueError("D0 staged workbook filename does not match the authoritative workbook")
    if previous_binding["sha256"] == candidate_binding["sha256"]:
        raise ValueError("D0 publication authorization requires a changed authoritative workbook")

    signature = decision["reviewer_signature"]
    return {
        "schema_version": 1,
        "stage": "D0",
        "packet_type": "baseline_publication_authorization",
        "automated_assessment_only": True,
        "does_not_publish_baseline": True,
        "does_not_complete_d0": True,
        "approval_commit": commit,
        "authorized_decision": "approved_for_manual_adoption",
        "reviewer_signature": signature,
        "bindings": {
            "previous_authoritative_workbook": previous_binding,
            "approved_candidate_workbook": candidate_binding,
            "staged_workbook": staged_binding,
            "contract_resolution": resolution_binding,
            "formal_review_packet": review_binding,
            "review_bundle": bundle_binding,
            "confirmation": confirmation_binding,
            "decision_record": decision_binding,
            "evidence_manifest": manifest_binding,
            "readiness_report": readiness_binding,
        },
        "expected_publication": {
            "path": previous_binding["path"],
            "previous_sha256": previous_binding["sha256"],
            "adopted_sha256": candidate_binding["sha256"],
            "required_git_mode": "100644",
            "requires_descendant_commit": True,
        },
        "publication_state_at_authorization": "authorized_not_published",
        "next_required_action": (
            "A baseline steward must publish the staged workbook as the authoritative path in "
            "a descendant Git commit, then run the read-only post-publication verifier."
        ),
        "warning": (
            "This Git-bound packet preserves the pre-publication audit chain but does not copy, "
            "replace, or activate the authoritative workbook; it does not approve AC-009/010, "
            "complete D0/D4, or authorize user-facing development."
        ),
    }


def write_d0_baseline_publication_authorization(
    paths: RepositoryPaths,
    approval_commit: str,
    decision_path: Path,
    readiness_path: Path,
    staged_workbook: Path,
    output_path: Path,
) -> Path:
    _require_directory(
        output_path,
        paths.d0_candidates_dir,
        label="D0 publication authorization output",
    )
    if output_path.exists():
        raise FileExistsError(f"Refusing to overwrite {output_path}")
    packet = build_d0_baseline_publication_authorization(
        paths,
        approval_commit,
        decision_path,
        readiness_path,
        staged_workbook,
    )
    return _write_new_payload(output_path, packet)


def load_and_validate_d0_baseline_publication_authorization(
    paths: RepositoryPaths,
    authorization_path: Path,
) -> dict[str, Any]:
    _require_directory(
        authorization_path,
        paths.d0_candidates_dir,
        label="D0 publication authorization",
    )
    packet = _load_object(authorization_path, label="D0 publication authorization")
    if (
        packet.get("schema_version") != 1
        or packet.get("stage") != "D0"
        or packet.get("packet_type") != "baseline_publication_authorization"
        or packet.get("automated_assessment_only") is not True
        or packet.get("does_not_publish_baseline") is not True
        or packet.get("does_not_complete_d0") is not True
    ):
        raise ValueError("D0 publication authorization header or safety boundary is invalid")
    bindings = packet.get("bindings")
    if not isinstance(bindings, dict):
        raise ValueError("D0 publication authorization bindings are invalid")
    expected = build_d0_baseline_publication_authorization(
        paths,
        str(packet.get("approval_commit") or ""),
        paths.root
        / _canonical_relative(
            bindings.get("decision_record", {}).get("path")
            if isinstance(bindings.get("decision_record"), dict)
            else None,
            label="D0 decision record",
        ),
        paths.root
        / _canonical_relative(
            bindings.get("readiness_report", {}).get("path")
            if isinstance(bindings.get("readiness_report"), dict)
            else None,
            label="D0 readiness report",
        ),
        paths.root
        / _canonical_relative(
            bindings.get("staged_workbook", {}).get("path")
            if isinstance(bindings.get("staged_workbook"), dict)
            else None,
            label="D0 staged workbook",
        ),
    )
    if packet != expected:
        raise ValueError("D0 publication authorization does not match a deterministic Git replay")
    return packet


def assess_d0_baseline_adoption(
    paths: RepositoryPaths,
    authorization_path: Path,
) -> dict[str, Any]:
    source = paths.d0_workbook.resolve()
    report: dict[str, Any] = {
        "schema_version": 1,
        "stage": "D0",
        "assessment_scope": "Git-bound D0 baseline post-publication verification",
        "automated_assessment_only": True,
        "does_not_publish_baseline": True,
        "does_not_complete_d0": True,
        "authorization": {
            "path": _relative_path(paths, authorization_path, label="D0 authorization"),
            "sha256": sha256_file(authorization_path) if authorization_path.is_file() else None,
            "approval_commit": None,
        },
        "current_head": None,
        "current_authoritative_workbook": {
            "path": _relative_path(paths, source, label="D0 authoritative workbook"),
            "sha256": sha256_file(source) if source.is_file() else None,
            "git_blob": None,
        },
        "expected_publication": None,
        "ready_for_post_publication_d0_rebuild": False,
        "checks": [],
        "warning": (
            "A passing result proves the approved workbook is published and committed, but does "
            "not approve AC-009/010, complete D0/D4, or authorize user-facing development."
        ),
    }
    checks: list[CheckResult] = []
    try:
        packet = load_and_validate_d0_baseline_publication_authorization(
            paths,
            authorization_path,
        )
        head = _current_head(paths)
        _require_ancestor(paths, packet["approval_commit"], head)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        checks.append(
            CheckResult(
                code="D0_ADOPTION_AUTHORIZATION_INVALID",
                message=f"D0 publication authorization is invalid: {error}",
                location=str(authorization_path.resolve()),
            )
        )
        report["checks"] = [check.to_dict() for check in checks]
        return report

    report["authorization"]["approval_commit"] = packet["approval_commit"]
    report["current_head"] = head
    expected = packet["expected_publication"]
    report["expected_publication"] = expected
    current_hash = sha256_file(source) if source.is_file() else None
    if current_hash is None:
        checks.append(
            CheckResult(
                code="D0_ADOPTION_AUTHORITATIVE_MISSING",
                message="The authoritative D0 workbook is missing",
                location=str(source),
            )
        )
    elif current_hash == expected["previous_sha256"]:
        checks.append(
            CheckResult(
                code="D0_ADOPTION_NOT_PUBLISHED",
                message="The authoritative D0 workbook still has the pre-publication SHA-256",
                location=str(source),
            )
        )
    elif current_hash != expected["adopted_sha256"]:
        checks.append(
            CheckResult(
                code="D0_ADOPTION_UNEXPECTED_HASH",
                message="The authoritative D0 workbook matches neither approved publication hash",
                location=str(source),
            )
        )
    else:
        try:
            head_binding, _ = _git_binding(
                paths,
                head,
                expected["path"],
                label="D0 adopted authoritative workbook",
            )
        except ValueError as error:
            checks.append(
                CheckResult(
                    code="D0_ADOPTION_GIT_BINDING_INVALID",
                    message=f"The adopted workbook Git binding is invalid: {error}",
                    location=str(source),
                )
            )
        else:
            report["current_authoritative_workbook"]["git_blob"] = head_binding["git_blob"]
            if head_binding["sha256"] != expected["adopted_sha256"]:
                checks.append(
                    CheckResult(
                        code="D0_ADOPTION_NOT_COMMITTED",
                        message="The approved authoritative workbook is not committed at HEAD",
                        location=str(source),
                    )
                )
            else:
                checks.extend(validate_structure(paths))

    report["ready_for_post_publication_d0_rebuild"] = not checks
    report["checks"] = [check.to_dict() for check in checks]
    return report


def _indexed_review_items(
    value: Any,
    *,
    identity_field: str,
    label: str,
) -> dict[str, dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be a list")
    indexed: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(f"{label} item {index} must be an object")
        identity = str(item.get(identity_field) or "").strip()
        if not identity or identity in indexed:
            raise ValueError(f"{label} requires unique non-empty {identity_field} values")
        indexed[identity] = item
    return indexed


def _carry_reviewed_fields(
    current_items: Any,
    previous_items: Any,
    *,
    identity_field: str,
    reviewed_fields: set[str],
    volatile_fields: set[str] | None = None,
    label: str,
) -> list[dict[str, Any]]:
    current = _indexed_review_items(
        current_items,
        identity_field=identity_field,
        label=f"current {label}",
    )
    previous = _indexed_review_items(
        previous_items,
        identity_field=identity_field,
        label=f"previous {label}",
    )
    if set(current) != set(previous):
        raise ValueError(f"{label} identities changed during D0 baseline adoption")
    ignored = reviewed_fields | (volatile_fields or set())
    migrated: list[dict[str, Any]] = []
    for identity, current_item in current.items():
        previous_item = previous[identity]
        current_static = {key: value for key, value in current_item.items() if key not in ignored}
        previous_static = {key: value for key, value in previous_item.items() if key not in ignored}
        if current_static != previous_static:
            raise ValueError(f"{label} input changed during D0 baseline adoption: {identity}")
        migrated_item = deepcopy(current_item)
        for field in reviewed_fields:
            if field in previous_item:
                migrated_item[field] = deepcopy(previous_item[field])
            else:
                migrated_item.pop(field, None)
        migrated.append(migrated_item)
    return migrated


def _post_adoption_review_packet(
    paths: RepositoryPaths,
    previous: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    current = build_review_packet(paths)
    if (
        previous.get("schema_version") != 3
        or previous.get("stage") != "D0"
        or previous.get("template_only") is not False
    ):
        raise ValueError("The pre-adoption D0 review packet is not a completed schema v3 copy")
    previous_baseline = previous.get("baseline")
    current_baseline = current.get("baseline")
    if not isinstance(previous_baseline, dict) or not isinstance(current_baseline, dict):
        raise ValueError("D0 review packet baseline bindings are invalid")
    previous_sources = previous_baseline.get("sources")
    current_sources = current_baseline.get("sources")
    if not isinstance(previous_sources, dict) or not isinstance(current_sources, dict):
        raise ValueError("D0 review packet source bindings are invalid")
    if previous_sources.get("technical_workbook") != current_sources.get("technical_workbook"):
        raise ValueError("The technical workbook changed during D0 baseline adoption")

    proposed = deepcopy(current)
    proposed["template_only"] = False
    proposed["role_assignments"] = _carry_reviewed_fields(
        current["role_assignments"],
        previous.get("role_assignments"),
        identity_field="role",
        reviewed_fields={
            "role_holder",
            "alternate",
            "escalation_person",
            "signature_evidence_id",
            "signed_at",
            "status",
        },
        label="D0 role assignments",
    )
    proposed["mapping_decisions"] = _carry_reviewed_fields(
        current["mapping_decisions"],
        previous.get("mapping_decisions"),
        identity_field="mapping_id",
        reviewed_fields={
            "decision",
            "final_target",
            "rationale",
            "change_request_id",
            "decided_by",
            "decided_at",
            "evidence_ids",
            "review_status",
        },
        label="D0 mapping decisions",
    )
    proposed["raw_sample_reviews"] = _carry_reviewed_fields(
        current["raw_sample_reviews"],
        previous.get("raw_sample_reviews"),
        identity_field="raw_id",
        reviewed_fields={
            "license_decision",
            "redistribution_allowed",
            "ai_index_allowed",
            "compliance_reviewer",
            "compliance_reviewed_at",
            "professional_review_status",
            "professional_reviewer",
            "professional_reviewed_at",
            "compliance_evidence_ids",
            "professional_evidence_ids",
        },
        label="D0 raw sample reviews",
    )
    proposed["artifact_reviews"] = _carry_reviewed_fields(
        current["artifact_reviews"],
        previous.get("artifact_reviews"),
        identity_field="artifact_id",
        reviewed_fields={"reviewer_signatures", "review_status", "comments"},
        label="D0 artifact reviews",
    )
    proposed["acceptance_items"] = _carry_reviewed_fields(
        current["acceptance_items"],
        previous.get("acceptance_items"),
        identity_field="acceptance_id",
        reviewed_fields={"reviewer_signatures", "review_status", "comments"},
        volatile_fields={"machine_status"},
        label="D0 acceptance items",
    )
    proposed["final_decision"] = deepcopy(current["final_decision"])
    proposed["warning"] = (
        "This is a proposed post-adoption migration of existing named D0 decisions. "
        "It requires the project approver to review the exact migration bundle hash; "
        "AC-009/010 and the final D0 decision remain pending."
    )

    roles = _indexed_review_items(
        proposed["role_assignments"],
        identity_field="role",
        label="migrated D0 role assignments",
    )
    approver = roles.get("项目批准人")
    if (
        not isinstance(approver, dict)
        or approver.get("status") != "signed"
        or not str(approver.get("role_holder") or "").strip()
    ):
        raise ValueError("The signed D0 project approver is missing")
    previous_final = previous.get("final_decision")
    if not isinstance(previous_final, dict) or previous_final.get("status") != "pending":
        raise ValueError("The pre-adoption final D0 decision must remain pending")

    acceptance = _indexed_review_items(
        proposed["acceptance_items"],
        identity_field="acceptance_id",
        label="migrated D0 acceptance items",
    )
    carried_ids = {
        acceptance_id
        for acceptance_id, item in acceptance.items()
        if item.get("review_status") == "approved"
    }
    pending_ids = {
        acceptance_id
        for acceptance_id, item in acceptance.items()
        if item.get("review_status") == "pending"
    }
    if carried_ids != _EXPECTED_CARRIED_ACCEPTANCE_IDS:
        raise ValueError("Only the previously approved D0-AC-001 through D0-AC-008 may migrate")
    if pending_ids != _EXPECTED_REMAINING_ACCEPTANCE_IDS:
        raise ValueError("D0-AC-009 and D0-AC-010 must remain pending after migration")
    failed_machine_ids = sorted(
        acceptance_id
        for acceptance_id in _MACHINE_PASS_REQUIRED_CARRIED_IDS
        if acceptance[acceptance_id].get("machine_status") != "pass"
    )
    if failed_machine_ids:
        raise ValueError(
            "Migrated D0 approvals require passing current machine evidence: "
            + ", ".join(failed_machine_ids)
        )

    checks = validate_review_packet(paths, proposed)
    unexpected = [check for check in checks if check.code not in _POST_ADOPTION_PENDING_CODES]
    if unexpected:
        raise ValueError(
            "Proposed post-adoption review packet has unexpected validation errors: "
            + "; ".join(f"{check.code}: {check.message}" for check in unexpected)
        )
    pending_locations = {
        check.location for check in checks if check.code == "D0_REVIEW_ACCEPTANCE_PENDING"
    }
    if pending_locations != {
        "acceptance_items.D0-AC-009",
        "acceptance_items.D0-AC-010",
    }:
        raise ValueError("Proposed post-adoption review packet has an unexpected pending scope")
    final_checks = [check for check in checks if check.code == "D0_REVIEW_FINAL_PENDING"]
    if len(final_checks) != 1:
        raise ValueError(
            "Proposed post-adoption review packet must keep one final decision pending"
        )

    previous_hashes = previous_baseline.get("candidate_hashes")
    current_hashes = current_baseline.get("candidate_hashes")
    if not isinstance(previous_hashes, dict) or not isinstance(current_hashes, dict):
        raise ValueError("D0 review candidate hash bindings are invalid")
    if set(previous_hashes) != set(current_hashes):
        raise ValueError("D0 review candidate inventory changed during baseline adoption")
    hash_changes = [
        {
            "candidate": name,
            "previous_sha256": previous_hashes[name],
            "current_sha256": current_hashes[name],
            "changed": previous_hashes[name] != current_hashes[name],
        }
        for name in sorted(current_hashes)
    ]
    summary = {
        "expected_reviewer": str(approver["role_holder"]),
        "carried_acceptance_ids": sorted(carried_ids),
        "remaining_acceptance_ids": sorted(pending_ids),
        "candidate_hash_changes": hash_changes,
        "validation_checks": [check.to_dict() for check in checks],
    }
    return proposed, summary


def build_d0_post_adoption_review_bundle(
    paths: RepositoryPaths,
    authorization_path: Path,
) -> dict[str, Any]:
    adoption = assess_d0_baseline_adoption(paths, authorization_path)
    if adoption.get("ready_for_post_publication_d0_rebuild") is not True:
        codes = [str(check.get("code")) for check in adoption.get("checks", [])]
        raise ValueError(
            "D0 post-adoption review migration requires a committed approved publication: "
            + ", ".join(codes or ["unknown adoption failure"])
        )
    authorization = load_and_validate_d0_baseline_publication_authorization(
        paths,
        authorization_path,
    )
    previous_binding, previous_content = _declared_git_binding(
        paths,
        authorization["approval_commit"],
        authorization["bindings"]["formal_review_packet"],
        label="D0 pre-adoption formal review packet",
    )
    previous = _load_object_bytes(
        previous_content,
        label="D0 pre-adoption formal review packet",
    )
    expected_publication = authorization["expected_publication"]
    previous_source = previous.get("baseline", {}).get("sources", {}).get("d0_workbook")
    if previous_source != {
        "path": expected_publication["path"],
        "sha256": expected_publication["previous_sha256"],
    }:
        raise ValueError("The pre-adoption review packet does not bind the authorized old baseline")

    proposed, migration = _post_adoption_review_packet(paths, previous)
    proposed_bytes = _payload_bytes(proposed)
    authorization_relative = _relative_path(
        paths,
        authorization_path,
        label="D0 publication authorization",
    )
    current_workbook = adoption["current_authoritative_workbook"]
    return {
        "schema_version": 1,
        "stage": "D0",
        "bundle_type": "post_adoption_review_migration_candidate",
        "automated_assessment_only": True,
        "does_not_approve_decisions": True,
        "does_not_write_review_packet": True,
        "does_not_complete_d0": True,
        "authorization": {
            "path": authorization_relative,
            "sha256": sha256_file(authorization_path),
            "approval_commit": authorization["approval_commit"],
        },
        "publication": {
            "current_head": adoption["current_head"],
            "authoritative_workbook": current_workbook,
        },
        "pre_adoption_review_packet": previous_binding,
        "expected_reviewer": migration["expected_reviewer"],
        "migration_scope": {
            "carried_sections": [
                "role_assignments",
                "mapping_decisions",
                "raw_sample_reviews",
                "artifact_reviews",
            ],
            "carried_acceptance_ids": migration["carried_acceptance_ids"],
            "remaining_acceptance_ids": migration["remaining_acceptance_ids"],
            "candidate_hash_changes": migration["candidate_hash_changes"],
        },
        "machine_replay": {
            "status": "pass",
            "expected_pending_only": True,
            "checks": migration["validation_checks"],
        },
        "proposed_review_packet_sha256": hashlib.sha256(proposed_bytes).hexdigest(),
        "proposed_review_packet": proposed,
        "ready_for_named_human_review": True,
        "required_human_decision": (
            "The signed project approver must review the exact migration bundle SHA-256 and "
            "explicitly approve or reject transcription of the proposed review packet."
        ),
        "warning": (
            "This candidate bundle does not write or approve a review packet. It carries no "
            "new acceptance decision, leaves D0-AC-009/010 and the final D0 decision pending, "
            "does not complete D0/D4, and does not authorize user-facing development."
        ),
    }


def write_d0_post_adoption_review_bundle(
    paths: RepositoryPaths,
    authorization_path: Path,
    output_path: Path,
) -> Path:
    _require_directory(
        output_path,
        paths.d0_candidates_dir,
        label="D0 post-adoption review bundle output",
    )
    if output_path.exists():
        raise FileExistsError(f"Refusing to overwrite {output_path}")
    bundle = build_d0_post_adoption_review_bundle(paths, authorization_path)
    return _write_new_payload(output_path, bundle)


def _resolve_current_binding(
    paths: RepositoryPaths,
    binding: Any,
    *,
    label: str,
) -> Path:
    if not isinstance(binding, dict):
        raise ValueError(f"{label} binding must be an object")
    relative = _canonical_relative(binding.get("path"), label=label)
    path = (paths.root / relative).resolve()
    if not path.is_file() or _relative_path(paths, path, label=label) != relative:
        raise ValueError(f"{label} binding path is missing or non-canonical")
    expected_hash = binding.get("sha256")
    if not isinstance(expected_hash, str) or sha256_file(path) != expected_hash:
        raise ValueError(f"{label} binding SHA-256 does not match the current file")
    return path


def load_and_validate_d0_post_adoption_review_bundle(
    paths: RepositoryPaths,
    bundle_path: Path,
) -> dict[str, Any]:
    _require_directory(
        bundle_path,
        paths.d0_candidates_dir,
        label="D0 post-adoption review bundle",
    )
    bundle = _load_object(bundle_path, label="D0 post-adoption review bundle")
    if (
        bundle.get("schema_version") != 1
        or bundle.get("stage") != "D0"
        or bundle.get("bundle_type") != "post_adoption_review_migration_candidate"
        or bundle.get("automated_assessment_only") is not True
        or bundle.get("does_not_approve_decisions") is not True
        or bundle.get("does_not_write_review_packet") is not True
        or bundle.get("does_not_complete_d0") is not True
        or bundle.get("ready_for_named_human_review") is not True
    ):
        raise ValueError("D0 post-adoption review bundle header or safety boundary is invalid")
    authorization_path = _resolve_current_binding(
        paths,
        bundle.get("authorization"),
        label="D0 publication authorization",
    )
    expected = build_d0_post_adoption_review_bundle(paths, authorization_path)
    if bundle != expected:
        raise ValueError(
            "D0 post-adoption review bundle does not match a deterministic current replay"
        )
    return bundle


def _dated_artifact(path: Path, *, label: str) -> tuple[str, date]:
    match = re.search(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)", path.name)
    if match is None:
        raise ValueError(f"{label} filename must contain an ISO date")
    token = match.group(1)
    return token, date.fromisoformat(token)


def _reviewed_date(value: Any) -> date | None:
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


def _validate_post_adoption_review_output(
    paths: RepositoryPaths,
    review_output: Path,
    *,
    date_token: str,
) -> str:
    _require_directory(
        review_output,
        paths.d0_review_dir,
        label="D0 migrated review output",
    )
    expected_name = f"d0_review_packet.{date_token}.json"
    if review_output.name != expected_name:
        raise ValueError(f"D0 migrated review output must be named {expected_name}")
    return _relative_path(paths, review_output, label="D0 migrated review output")


def build_d0_post_adoption_confirmation_template(
    paths: RepositoryPaths,
    bundle_path: Path,
    review_output: Path,
) -> dict[str, Any]:
    bundle = load_and_validate_d0_post_adoption_review_bundle(paths, bundle_path)
    date_token, _ = _dated_artifact(bundle_path, label="D0 post-adoption review bundle")
    review_relative = _validate_post_adoption_review_output(
        paths,
        review_output,
        date_token=date_token,
    )
    if review_output.exists():
        raise FileExistsError(f"Refusing to overwrite {review_output}")
    return {
        "schema_version": 1,
        "stage": "D0",
        "confirmation_type": "post_adoption_review_migration",
        "template_only": True,
        "authorized_transcription": False,
        "bundle": {
            "path": _relative_path(
                paths,
                bundle_path,
                label="D0 post-adoption review bundle",
            ),
            "sha256": sha256_file(bundle_path),
        },
        "proposed_review_packet_sha256": bundle["proposed_review_packet_sha256"],
        "expected_reviewer": bundle["expected_reviewer"],
        "review_output": review_relative,
        "reviewer": None,
        "reviewed_at": None,
        "decision": None,
        "comments": None,
        "warning": (
            "Complete only after the signed project approver reviews the exact bundle SHA-256. "
            "Approval authorizes transcription of only the proposed review packet and does not "
            "approve D0-AC-009/010, the final D0 decision, D4, or user-facing development."
        ),
    }


def write_d0_post_adoption_confirmation_template(
    paths: RepositoryPaths,
    bundle_path: Path,
    review_output: Path,
    confirmation_output: Path,
) -> Path:
    _require_directory(
        confirmation_output,
        paths.d0_review_dir,
        label="D0 post-adoption confirmation template output",
    )
    if confirmation_output.suffix.lower() != ".json":
        raise ValueError("D0 post-adoption confirmation template must be a JSON file")
    template = build_d0_post_adoption_confirmation_template(
        paths,
        bundle_path,
        review_output,
    )
    return _write_new_payload(confirmation_output, template)


def validate_d0_post_adoption_confirmation(
    paths: RepositoryPaths,
    confirmation: dict[str, Any],
    bundle_path: Path,
    review_output: Path,
) -> dict[str, Any]:
    template = build_d0_post_adoption_confirmation_template(
        paths,
        bundle_path,
        review_output,
    )
    if set(confirmation) != _POST_ADOPTION_CONFIRMATION_FIELDS:
        raise ValueError("D0 post-adoption confirmation has missing or unexpected fields")
    if (
        confirmation.get("schema_version") != 1
        or confirmation.get("stage") != "D0"
        or confirmation.get("confirmation_type") != "post_adoption_review_migration"
    ):
        raise ValueError("D0 post-adoption confirmation header is invalid")
    if confirmation.get("template_only") is not False:
        raise ValueError("D0 post-adoption confirmation must be a completed copy")
    if confirmation.get("authorized_transcription") is not True:
        raise ValueError("D0 post-adoption confirmation requires transcription authorization")
    for field in (
        "bundle",
        "proposed_review_packet_sha256",
        "expected_reviewer",
        "review_output",
        "warning",
    ):
        if confirmation.get(field) != template[field]:
            raise ValueError(f"D0 post-adoption confirmation changed the bound {field}")
    reviewer = str(template["expected_reviewer"])
    if confirmation.get("reviewer") != reviewer:
        raise ValueError("D0 post-adoption confirmation reviewer is not the project approver")
    reviewed_at = _reviewed_date(confirmation.get("reviewed_at"))
    if reviewed_at is None:
        raise ValueError(
            "D0 post-adoption confirmation reviewed_at must be an ISO date or aware datetime"
        )
    _, bundle_date = _dated_artifact(bundle_path, label="D0 post-adoption review bundle")
    if reviewed_at < bundle_date:
        raise ValueError("D0 post-adoption confirmation cannot predate the reviewed bundle")
    decision = confirmation.get("decision")
    if decision not in {"approved", "rejected"}:
        raise ValueError("D0 post-adoption confirmation decision must be approved or rejected")
    if decision == "rejected" and not str(confirmation.get("comments") or "").strip():
        raise ValueError("Rejected D0 post-adoption confirmation requires comments")
    return load_and_validate_d0_post_adoption_review_bundle(paths, bundle_path)


def apply_d0_post_adoption_confirmation(
    paths: RepositoryPaths,
    confirmation_path: Path,
    bundle_path: Path,
    review_output: Path,
) -> Path:
    _require_directory(
        confirmation_path,
        paths.evidence_manifest.parent,
        label="D0 post-adoption completed confirmation",
    )
    if not confirmation_path.is_file():
        raise ValueError("D0 post-adoption completed confirmation is missing")
    confirmation = _load_object(
        confirmation_path,
        label="D0 post-adoption completed confirmation",
    )
    bundle = validate_d0_post_adoption_confirmation(
        paths,
        confirmation,
        bundle_path,
        review_output,
    )
    if confirmation["decision"] != "approved":
        raise ValueError("D0 post-adoption review migration was rejected")
    proposed = bundle.get("proposed_review_packet")
    if not isinstance(proposed, dict):
        raise ValueError("D0 post-adoption bundle proposed review packet is invalid")
    proposed_hash = hashlib.sha256(_payload_bytes(proposed)).hexdigest()
    if proposed_hash != bundle.get("proposed_review_packet_sha256"):
        raise ValueError("D0 post-adoption proposed review packet SHA-256 is invalid")
    checks = validate_review_packet(paths, proposed)
    unexpected = [check for check in checks if check.code not in _POST_ADOPTION_PENDING_CODES]
    if unexpected:
        raise ValueError("D0 post-adoption proposed review packet no longer validates")
    return _write_new_payload(review_output, proposed)
