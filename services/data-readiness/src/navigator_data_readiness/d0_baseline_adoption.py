from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .baseline import sha256_file
from .models import CheckResult
from .paths import RepositoryPaths
from .validation import APPROVED_EVIDENCE_STATES, validate_structure


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
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=output_path.parent,
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        temporary.write(_payload_bytes(packet))
        temporary_path = Path(temporary.name)
    temporary_path.chmod(0o644)
    try:
        if output_path.exists():
            raise FileExistsError(f"Refusing to overwrite {output_path}")
        os.link(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)
    return output_path


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
