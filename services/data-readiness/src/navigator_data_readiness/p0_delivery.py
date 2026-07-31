from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any, cast

from .baseline import extract_contracts, sha256_file, snapshot_manifest
from .d4_acceptance import load_and_validate_d4_bundle
from .models import CheckResult
from .p0_traceability import build_p0_traceability_report, extract_references
from .paths import RepositoryPaths

_COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_PASS_STATUS = "passed"
_IMPLEMENTED_STATUS = "implemented"
_APPROVED_STATUS = "approved"
_COMMITTEE_ROLE = "项目委员会"
_TEST_REVIEWER_ROLE = "测试负责人"


def payload_sha256(payload: Any) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


def _text(record: dict[str, Any], field: str) -> str:
    value = record.get(field)
    return "" if value is None else str(value).strip()


def _p0_records(contracts: dict[str, Any], name: str) -> list[dict[str, Any]]:
    records = cast(list[dict[str, Any]], contracts[name])
    if name == "api_catalog":
        return [record for record in records if "P1" not in _text(record, "状态")]
    return [record for record in records if _text(record, "优先级") == "P0"]


def _implementation_item(
    identifier_field: str,
    identifier: str,
    **immutable: Any,
) -> dict[str, Any]:
    return {
        identifier_field: identifier,
        **immutable,
        "status": "pending",
        "commit_sha": None,
        "implemented_by": None,
        "implemented_at": None,
        "evidence_ids": [],
    }


def _test_item(
    identifier: str,
    **immutable: Any,
) -> dict[str, Any]:
    return {
        "test_id": identifier,
        **immutable,
        "required_reviewer_role": _TEST_REVIEWER_ROLE,
        "status": "pending",
        "executed_by": None,
        "executed_at": None,
        "reviewed_by": None,
        "reviewer_role": None,
        "reviewed_at": None,
        "evidence_ids": [],
    }


def build_p0_delivery_template(paths: RepositoryPaths) -> dict[str, Any]:
    contracts = extract_contracts(paths)
    traceability = build_p0_traceability_report(paths)
    source_manifest = snapshot_manifest(paths)
    requirements = _p0_records(contracts, "feature_requirements")
    routes = _p0_records(contracts, "page_routes")
    apis = _p0_records(contracts, "api_catalog")
    tests = _p0_records(contracts, "test_cases")
    engineering_tests = _p0_records(contracts, "engineering_acceptance_tests")
    acceptance = cast(list[dict[str, Any]], contracts["mvp_acceptance"])
    signer_roles = sorted(
        {
            _text(record, "验收角色")
            for record in acceptance
            if _text(record, "验收角色") != _COMMITTEE_ROLE
        }
        | {_TEST_REVIEWER_ROLE}
    )
    return {
        "schema_version": 4,
        "stage": "P0-DELIVERY",
        "template_only": True,
        "append_only": True,
        "baseline": {
            "version": "V1.0-BASELINE",
            "sources": source_manifest["sources"],
            "p0_traceability_assessment_sha256": payload_sha256(traceability),
        },
        "dependencies": {
            "d4_gate_status": "pending",
            "d4_gate_evidence_id": None,
            "d4_bundle_sha256": None,
        },
        "evidence": [],
        "signer_authorizations": [
            {
                "role": role,
                "person_name": None,
                "authorizer_role": _COMMITTEE_ROLE,
                "authorized_by": None,
                "authorized_at": None,
                "evidence_ids": [],
            }
            for role in signer_roles
        ],
        "requirements": [
            _implementation_item(
                "requirement_id",
                _text(record, "需求编号"),
                module=_text(record, "模块"),
                function=_text(record, "功能"),
            )
            for record in requirements
        ],
        "routes": [
            _implementation_item(
                "page_id",
                _text(record, "页面编号"),
                page_name=_text(record, "页面名称"),
                route=_text(record, "建议路由"),
            )
            for record in routes
        ],
        "apis": [
            _implementation_item(
                "api_id",
                _text(record, "接口编号"),
                module=_text(record, "模块"),
                method=_text(record, "方法"),
                path=_text(record, "路径"),
            )
            for record in apis
        ],
        "product_tests": [
            _test_item(
                _text(record, "用例编号"),
                module=_text(record, "模块"),
                requirement_ids=extract_references(record.get("需求编号"), ("FR-",)),
            )
            for record in tests
        ],
        "engineering_tests": [
            _test_item(
                _text(record, "用例编号"),
                domain=_text(record, "测试域"),
                requirement_ids=extract_references(record.get("需求编号"), ("FR-",)),
            )
            for record in engineering_tests
        ],
        "acceptance_items": [
            {
                "acceptance_id": _text(record, "验收编号"),
                "domain": _text(record, "验收域"),
                "threshold": _text(record, "门槛"),
                "required_reviewer_role": _text(record, "验收角色"),
                "accountable_role": _text(record, "责任A"),
                "status": "pending",
                "reviewed_by": None,
                "reviewer_role": None,
                "reviewed_at": None,
                "evidence_ids": [],
            }
            for record in acceptance
        ],
        "release_metrics": {
            "open_s0_defects": None,
            "open_s1_defects": None,
            "critical_task_success_rate_pct": None,
            "leak_counts": {
                "tenant": None,
                "search": None,
                "cache": None,
                "file": None,
                "report": None,
                "ai": None,
            },
            "ai_citation_coverage_pct": None,
            "performance_capacity_rpo_rto_status": "pending",
            "evidence_ids": [],
        },
        "final_release": {
            "status": "pending",
            "commit_sha": None,
            "build_status": "pending",
            "deployment_status": "pending",
            "rollback_status": "pending",
            "restore_status": "pending",
            "handover_status": "pending",
            "approver_role": _COMMITTEE_ROLE,
            "approved_by": None,
            "approved_at": None,
            "evidence_ids": [],
        },
        "warning": (
            "This template cannot replace D4 approval, implementation, test execution, UAT, "
            "or release authorization. It records evidence only after those events occur."
        ),
    }


def write_p0_delivery_template(paths: RepositoryPaths) -> Path:
    paths.p0_candidates_dir.mkdir(parents=True, exist_ok=True)
    destination = paths.p0_candidates_dir / "p0_delivery_evidence.template.json"
    destination.write_text(
        json.dumps(
            build_p0_delivery_template(paths),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return destination


def _indexed_section(
    checks: list[CheckResult],
    payload: dict[str, Any],
    section: str,
    identifier_field: str,
) -> dict[str, dict[str, Any]]:
    raw_items = payload.get(section)
    if not isinstance(raw_items, list):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_SECTION_INVALID",
                message=f"{section} must be a list",
                location=section,
            )
        )
        return {}
    result: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_ITEM_INVALID",
                    message=f"{section}[{index}] must be an object",
                    location=section,
                )
            )
            continue
        identifier = _text(item, identifier_field)
        if not identifier:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_IDENTIFIER_MISSING",
                    message=f"{section}[{index}] requires {identifier_field}",
                    location=section,
                )
            )
            continue
        if identifier in result:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_IDENTIFIER_DUPLICATE",
                    message=f"{section} contains duplicate {identifier}",
                    location=section,
                )
            )
            continue
        result[identifier] = item
    return result


def _validate_exact_section(
    checks: list[CheckResult],
    actual: dict[str, dict[str, Any]],
    expected: dict[str, dict[str, Any]],
    *,
    section: str,
    immutable_fields: tuple[str, ...],
) -> None:
    actual_ids = set(actual)
    expected_ids = set(expected)
    if actual_ids != expected_ids:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_SET_INVALID",
                message=(
                    f"{section} IDs differ; missing={sorted(expected_ids - actual_ids)}, "
                    f"unexpected={sorted(actual_ids - expected_ids)}"
                ),
                location=section,
            )
        )
    for identifier in sorted(actual_ids & expected_ids):
        changed = [
            field
            for field in immutable_fields
            if actual[identifier].get(field) != expected[identifier].get(field)
        ]
        if changed:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_FROZEN_INPUT_CHANGED",
                    message=f"{identifier} changed frozen fields: {', '.join(changed)}",
                    location=f"{section}.{identifier}",
                )
            )


def _string_ids(
    checks: list[CheckResult],
    item: dict[str, Any],
    *,
    location: str,
) -> list[str]:
    value = item.get("evidence_ids")
    if not isinstance(value, list):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_EVIDENCE_IDS_INVALID",
                message="evidence_ids must be a list",
                location=location,
            )
        )
        return []
    identifiers = [str(entry).strip() for entry in value if str(entry).strip()]
    if len(identifiers) != len(set(identifiers)):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_EVIDENCE_ID_DUPLICATE",
                message="evidence_ids contains duplicates",
                location=location,
            )
        )
    return identifiers


def _subject_refs(
    checks: list[CheckResult],
    item: dict[str, Any],
    *,
    location: str,
) -> set[str]:
    value = item.get("subject_refs")
    if (
        not isinstance(value, list)
        or not value
        or any(not isinstance(entry, str) or not entry.strip() for entry in value)
    ):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_EVIDENCE_SUBJECT_REFS_INVALID",
                message="subject_refs must be a list of non-empty strings",
                location=location,
            )
        )
        return set()
    normalized = [entry.strip() for entry in value]
    if len(normalized) != len(set(normalized)):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_EVIDENCE_SUBJECT_REF_DUPLICATE",
                message="subject_refs contains duplicates",
                location=location,
            )
        )
    return set(normalized)


def _bind_evidence_subjects(
    bindings: dict[str, set[str]],
    evidence_ids: set[str],
    subject_ref: str,
) -> None:
    for evidence_id in evidence_ids:
        bindings.setdefault(evidence_id, set()).add(subject_ref)


def _required_fields(
    checks: list[CheckResult],
    item: dict[str, Any],
    fields: tuple[str, ...],
    *,
    code: str,
    location: str,
) -> None:
    missing = [field for field in fields if not _text(item, field)]
    if missing:
        checks.append(
            CheckResult(
                code=code,
                message=f"Missing required fields: {', '.join(missing)}",
                location=location,
            )
        )


def _d4_committee_approver(
    checks: list[CheckResult],
    d4_bundle: dict[str, Any],
) -> str:
    acceptance = d4_bundle.get("acceptance")
    approvals = acceptance.get("committee_approvals") if isinstance(acceptance, dict) else None
    committee_approvals = (
        [
            item
            for item in approvals
            if isinstance(item, dict)
            and _text(item, "role") == _COMMITTEE_ROLE
            and item.get("decision") == _APPROVED_STATUS
            and _text(item, "person_name")
        ]
        if isinstance(approvals, list)
        else []
    )
    if len(committee_approvals) != 1:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_COMMITTEE_APPROVER_INVALID",
                message="D4 must contain exactly one approved project committee signer",
                location="d4_bundle.acceptance.committee_approvals",
            )
        )
        return ""
    return _text(committee_approvals[0], "person_name")


def _is_authorized_signer(
    role: str,
    person_name: str,
    authorized_signers: dict[str, set[str]],
    committee_approver: str,
) -> bool:
    if role == _COMMITTEE_ROLE:
        return bool(committee_approver) and person_name == committee_approver
    return person_name in authorized_signers.get(role, set())


def _validate_signer_authorizations(
    checks: list[CheckResult],
    payload: dict[str, Any],
    required_roles: set[str],
    committee_approver: str,
) -> tuple[
    dict[str, set[str]],
    set[str],
    dict[str, set[str]],
    set[str],
]:
    entries = payload.get("signer_authorizations")
    if not isinstance(entries, list):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_SIGNER_AUTHORIZATIONS_INVALID",
                message="signer_authorizations must be a list",
                location="signer_authorizations",
            )
        )
        return {}, set(), {}, set()
    authorized_signers: dict[str, set[str]] = {}
    evidence_ids: set[str] = set()
    evidence_subject_requirements: dict[str, set[str]] = {}
    known_subject_refs: set[str] = set()
    seen_pairs: set[tuple[str, str]] = set()
    for index, entry in enumerate(entries):
        location = f"signer_authorizations[{index}]"
        if not isinstance(entry, dict):
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_SIGNER_AUTHORIZATION_INVALID",
                    message="Signer authorization entry must be an object",
                    location=location,
                )
            )
            continue
        _required_fields(
            checks,
            entry,
            (
                "role",
                "person_name",
                "authorizer_role",
                "authorized_by",
                "authorized_at",
            ),
            code="P0_DELIVERY_SIGNER_AUTHORIZATION_INCOMPLETE",
            location=location,
        )
        role = _text(entry, "role")
        person_name = _text(entry, "person_name")
        if role == _COMMITTEE_ROLE:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_SIGNER_AUTHORIZATION_ROLE_INVALID",
                    message="Project committee authority must come directly from the D4 approval",
                    location=location,
                )
            )
        pair = (role, person_name)
        if all(pair):
            if pair in seen_pairs:
                checks.append(
                    CheckResult(
                        code="P0_DELIVERY_SIGNER_AUTHORIZATION_DUPLICATE",
                        message=f"Duplicate signer authorization: {role}/{person_name}",
                        location=location,
                    )
                )
            else:
                seen_pairs.add(pair)
                authorized_signers.setdefault(role, set()).add(person_name)
        if (
            not committee_approver
            or _text(entry, "authorizer_role") != _COMMITTEE_ROLE
            or _text(entry, "authorized_by") != committee_approver
        ):
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_SIGNER_AUTHORIZER_INVALID",
                    message=(
                        "Every P0 signer must be authorized by the approved D4 committee signer"
                    ),
                    location=location,
                )
            )
        entry_evidence_ids = set(_string_ids(checks, entry, location=location))
        if not entry_evidence_ids:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_SIGNER_AUTHORIZATION_EVIDENCE_MISSING",
                    message="Signer authorization requires evidence IDs",
                    location=location,
                )
            )
        if all(pair):
            subject_ref = f"signer_authorizations:{role}:{person_name}"
            known_subject_refs.add(subject_ref)
            _bind_evidence_subjects(
                evidence_subject_requirements,
                entry_evidence_ids,
                subject_ref,
            )
        evidence_ids.update(entry_evidence_ids)

    missing_roles = sorted(required_roles - set(authorized_signers))
    if missing_roles:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_SIGNER_ROLE_COVERAGE_INCOMPLETE",
                message=f"Missing authorized P0 signer roles: {', '.join(missing_roles)}",
                location="signer_authorizations",
            )
        )
    return (
        authorized_signers,
        evidence_ids,
        evidence_subject_requirements,
        known_subject_refs,
    )


def _validate_implementation(
    checks: list[CheckResult],
    item: dict[str, Any],
    *,
    location: str,
    commit_shas: set[str],
) -> set[str]:
    if item.get("status") != _IMPLEMENTED_STATUS:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_IMPLEMENTATION_PENDING",
                message="Implementation status must be implemented",
                location=location,
            )
        )
    _required_fields(
        checks,
        item,
        ("commit_sha", "implemented_by", "implemented_at"),
        code="P0_DELIVERY_IMPLEMENTATION_METADATA_INCOMPLETE",
        location=location,
    )
    commit_sha = _text(item, "commit_sha").lower()
    if commit_sha:
        if not _COMMIT_PATTERN.fullmatch(commit_sha):
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_COMMIT_SHA_INVALID",
                    message=f"Invalid commit SHA: {commit_sha}",
                    location=location,
                )
            )
        else:
            commit_shas.add(commit_sha)
    evidence_ids = set(_string_ids(checks, item, location=location))
    if not evidence_ids:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_IMPLEMENTATION_EVIDENCE_MISSING",
                message="Implementation requires evidence IDs",
                location=location,
            )
        )
    return evidence_ids


def _validate_test_execution(
    checks: list[CheckResult],
    item: dict[str, Any],
    *,
    location: str,
    authorized_signers: dict[str, set[str]],
    committee_approver: str,
) -> set[str]:
    if item.get("status") != _PASS_STATUS:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_TEST_NOT_PASSED",
                message="Test execution status must be passed",
                location=location,
            )
        )
    _required_fields(
        checks,
        item,
        ("executed_by", "executed_at", "reviewed_by", "reviewer_role", "reviewed_at"),
        code="P0_DELIVERY_TEST_METADATA_INCOMPLETE",
        location=location,
    )
    reviewer_role = _text(item, "reviewer_role")
    reviewed_by = _text(item, "reviewed_by")
    if reviewer_role != _text(item, "required_reviewer_role"):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_TEST_REVIEWER_ROLE_INVALID",
                message="reviewer_role must match the frozen required_reviewer_role",
                location=location,
            )
        )
    if not _is_authorized_signer(
        reviewer_role,
        reviewed_by,
        authorized_signers,
        committee_approver,
    ):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_TEST_REVIEWER_UNAUTHORIZED",
                message=f"Test reviewer is not authorized for {reviewer_role or 'the role'}",
                location=location,
            )
        )
    evidence_ids = set(_string_ids(checks, item, location=location))
    if not evidence_ids:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_TEST_EVIDENCE_MISSING",
                message="Passed tests require evidence IDs",
                location=location,
            )
        )
    return evidence_ids


def _validate_acceptance(
    checks: list[CheckResult],
    item: dict[str, Any],
    *,
    location: str,
    authorized_signers: dict[str, set[str]],
    committee_approver: str,
) -> set[str]:
    if item.get("status") != _APPROVED_STATUS:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_ACCEPTANCE_PENDING",
                message="Acceptance item must be approved",
                location=location,
            )
        )
    _required_fields(
        checks,
        item,
        ("reviewed_by", "reviewer_role", "reviewed_at"),
        code="P0_DELIVERY_ACCEPTANCE_METADATA_INCOMPLETE",
        location=location,
    )
    reviewer_role = _text(item, "reviewer_role")
    reviewed_by = _text(item, "reviewed_by")
    if reviewer_role != _text(item, "required_reviewer_role"):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_ACCEPTANCE_ROLE_INVALID",
                message="reviewer_role must match the frozen required_reviewer_role",
                location=location,
            )
        )
    if not _is_authorized_signer(
        reviewer_role,
        reviewed_by,
        authorized_signers,
        committee_approver,
    ):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_ACCEPTANCE_REVIEWER_UNAUTHORIZED",
                message=f"Acceptance reviewer is not authorized for {reviewer_role or 'the role'}",
                location=location,
            )
        )
    evidence_ids = set(_string_ids(checks, item, location=location))
    if not evidence_ids:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_ACCEPTANCE_EVIDENCE_MISSING",
                message="Approved acceptance items require evidence IDs",
                location=location,
            )
        )
    return evidence_ids


def _validate_evidence(
    checks: list[CheckResult],
    paths: RepositoryPaths,
    payload: dict[str, Any],
    authorized_signers: dict[str, set[str]],
    committee_approver: str,
) -> tuple[
    set[str],
    list[tuple[str, str, str, str]],
    dict[str, tuple[str, str]],
    dict[str, set[str]],
]:
    entries = payload.get("evidence")
    if not isinstance(entries, list):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_EVIDENCE_SECTION_INVALID",
                message="evidence must be a list",
                location="evidence",
            )
        )
        return set(), [], {}, {}
    identifiers: set[str] = set()
    bindings: list[tuple[str, str, str, str]] = []
    approvals: dict[str, tuple[str, str]] = {}
    declared_subject_refs: dict[str, set[str]] = {}
    for index, entry in enumerate(entries):
        location = f"evidence[{index}]"
        if not isinstance(entry, dict):
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_INVALID",
                    message="Evidence entry must be an object",
                    location=location,
                )
            )
            continue
        _required_fields(
            checks,
            entry,
            (
                "evidence_id",
                "artifact_type",
                "path",
                "sha256",
                "commit_sha",
                "generated_by",
                "generated_at",
                "approved_by",
                "approval_role",
                "approved_at",
            ),
            code="P0_DELIVERY_EVIDENCE_METADATA_INCOMPLETE",
            location=location,
        )
        evidence_id = _text(entry, "evidence_id")
        if evidence_id in identifiers:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_DUPLICATE",
                    message=f"Duplicate evidence ID: {evidence_id}",
                    location=location,
                )
            )
        if evidence_id:
            identifiers.add(evidence_id)
            declared_subject_refs.setdefault(evidence_id, set()).update(
                _subject_refs(checks, entry, location=location)
            )
        else:
            _subject_refs(checks, entry, location=location)
        approval_role = _text(entry, "approval_role")
        approved_by = _text(entry, "approved_by")
        if evidence_id and approval_role and approved_by:
            approvals[evidence_id] = (approval_role, approved_by)
        if not _is_authorized_signer(
            approval_role,
            approved_by,
            authorized_signers,
            committee_approver,
        ):
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_APPROVER_UNAUTHORIZED",
                    message=(
                        f"{evidence_id or location} approver is not authorized for "
                        f"{approval_role or 'the role'}"
                    ),
                    location=location,
                )
            )
        if entry.get("status") != _APPROVED_STATUS:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_NOT_APPROVED",
                    message=f"{evidence_id or location} is not approved",
                    location=location,
                )
            )
        if entry.get("contains_restricted_data") is not False:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_RESTRICTED",
                    message=f"{evidence_id or location} must not contain restricted data",
                    location=location,
                )
            )
        relative_path = _text(entry, "path")
        declared_sha256 = _text(entry, "sha256").lower()
        commit_sha = _text(entry, "commit_sha").lower()
        commit_valid = bool(_COMMIT_PATTERN.fullmatch(commit_sha))
        if commit_sha and not commit_valid:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_COMMIT_SHA_INVALID",
                    message=f"Invalid evidence commit SHA: {commit_sha}",
                    location=location,
                )
            )
        if declared_sha256 and not _SHA256_PATTERN.fullmatch(declared_sha256):
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_SHA256_INVALID",
                    message=f"Invalid evidence SHA-256: {declared_sha256}",
                    location=location,
                )
            )
        if not relative_path:
            continue
        evidence_path = (paths.root / relative_path).resolve()
        try:
            evidence_path.relative_to(paths.root)
        except ValueError:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_PATH_OUTSIDE_REPOSITORY",
                    message=f"Evidence path escapes repository: {relative_path}",
                    location=location,
                )
            )
            continue
        if not evidence_path.is_file():
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_FILE_MISSING",
                    message=f"Evidence file does not exist: {relative_path}",
                    location=location,
                )
            )
        elif sha256_file(evidence_path) != declared_sha256:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_HASH_MISMATCH",
                    message=f"Evidence hash does not match: {relative_path}",
                    location=location,
                )
            )
        if commit_valid and _SHA256_PATTERN.fullmatch(declared_sha256):
            normalized_path = evidence_path.relative_to(paths.root).as_posix()
            bindings.append((evidence_id, normalized_path, declared_sha256, commit_sha))
    return identifiers, bindings, approvals, declared_subject_refs


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _validate_metrics(
    checks: list[CheckResult],
    metrics: Any,
) -> set[str]:
    if not isinstance(metrics, dict):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_METRICS_INVALID",
                message="release_metrics must be an object",
                location="release_metrics",
            )
        )
        return set()
    for field in ("open_s0_defects", "open_s1_defects"):
        if _number(metrics.get(field)) != 0:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_DEFECT_GATE_FAILED",
                    message=f"{field} must be 0",
                    location=f"release_metrics.{field}",
                )
            )
    task_rate = _number(metrics.get("critical_task_success_rate_pct"))
    if task_rate is None or task_rate < 95 or task_rate > 100:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_TASK_SUCCESS_GATE_FAILED",
                message="critical_task_success_rate_pct must be between 95 and 100",
                location="release_metrics.critical_task_success_rate_pct",
            )
        )
    citation_rate = _number(metrics.get("ai_citation_coverage_pct"))
    if citation_rate is None or citation_rate < 95 or citation_rate > 100:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_AI_CITATION_GATE_FAILED",
                message="ai_citation_coverage_pct must be between 95 and 100",
                location="release_metrics.ai_citation_coverage_pct",
            )
        )
    leaks = metrics.get("leak_counts")
    if not isinstance(leaks, dict):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_LEAK_METRICS_INVALID",
                message="leak_counts must be an object",
                location="release_metrics.leak_counts",
            )
        )
    else:
        expected_leaks = {"tenant", "search", "cache", "file", "report", "ai"}
        if set(leaks) != expected_leaks or any(
            _number(leaks.get(field)) != 0 for field in expected_leaks
        ):
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_LEAK_GATE_FAILED",
                    message="All declared leak counts must be present and equal 0",
                    location="release_metrics.leak_counts",
                )
            )
    if metrics.get("performance_capacity_rpo_rto_status") != _PASS_STATUS:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_NONFUNCTIONAL_GATE_FAILED",
                message="Performance, capacity, RPO, and RTO status must be passed",
                location="release_metrics.performance_capacity_rpo_rto_status",
            )
        )
    evidence_ids = set(_string_ids(checks, metrics, location="release_metrics"))
    if not evidence_ids:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_METRIC_EVIDENCE_MISSING",
                message="Release metrics require evidence IDs",
                location="release_metrics",
            )
        )
    return evidence_ids


def _validate_final_release(
    checks: list[CheckResult],
    final_release: Any,
    commit_shas: set[str],
    committee_approver: str,
) -> set[str]:
    if not isinstance(final_release, dict):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_FINAL_RELEASE_INVALID",
                message="final_release must be an object",
                location="final_release",
            )
        )
        return set()
    if final_release.get("status") != _APPROVED_STATUS:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_FINAL_RELEASE_PENDING",
                message="Final P0 release must be approved",
                location="final_release",
            )
        )
    for field in (
        "build_status",
        "deployment_status",
        "rollback_status",
        "restore_status",
        "handover_status",
    ):
        if final_release.get(field) != _PASS_STATUS:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_RELEASE_CAPABILITY_FAILED",
                    message=f"{field} must be passed",
                    location=f"final_release.{field}",
                )
            )
    _required_fields(
        checks,
        final_release,
        ("commit_sha", "approver_role", "approved_by", "approved_at"),
        code="P0_DELIVERY_FINAL_RELEASE_METADATA_INCOMPLETE",
        location="final_release",
    )
    if (
        not committee_approver
        or _text(final_release, "approver_role") != _COMMITTEE_ROLE
        or _text(final_release, "approved_by") != committee_approver
    ):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_FINAL_RELEASE_APPROVER_UNAUTHORIZED",
                message="Final release must be approved by the approved D4 committee signer",
                location="final_release",
            )
        )
    commit_sha = _text(final_release, "commit_sha").lower()
    if commit_sha:
        if not _COMMIT_PATTERN.fullmatch(commit_sha):
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_COMMIT_SHA_INVALID",
                    message=f"Invalid final release commit SHA: {commit_sha}",
                    location="final_release",
                )
            )
        else:
            commit_shas.add(commit_sha)
    evidence_ids = set(_string_ids(checks, final_release, location="final_release"))
    if not evidence_ids:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_FINAL_RELEASE_EVIDENCE_MISSING",
                message="Final release requires evidence IDs",
                location="final_release",
            )
        )
    return evidence_ids


def _run_git(
    paths: RepositoryPaths,
    *arguments: str,
    text: bool = True,
) -> subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes] | None:
    try:
        return subprocess.run(
            ["git", "-C", str(paths.root), *arguments],
            check=False,
            capture_output=True,
            text=text,
        )
    except OSError:
        return None


def _validate_delivery_packet_provenance(
    paths: RepositoryPaths,
    bundle_path: Path,
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    repository_root = paths.root.resolve()
    delivery_dir = (repository_root / "data" / "p0" / "delivery").resolve()
    resolved_path = bundle_path.resolve()
    try:
        resolved_path.relative_to(delivery_dir)
    except ValueError:
        return [
            CheckResult(
                code="P0_DELIVERY_PACKET_PATH_INVALID",
                message=("Completed P0 delivery bundles must be stored under data/p0/delivery"),
                location=str(bundle_path),
            )
        ]

    relative_path = resolved_path.relative_to(repository_root).as_posix()
    result = _run_git(paths, "show", f"HEAD:{relative_path}", text=False)
    if result is None:
        return [
            CheckResult(
                code="P0_DELIVERY_GIT_UNAVAILABLE",
                message="Cannot read the completed delivery bundle from Git HEAD",
                location=str(paths.root),
            )
        ]
    if result.returncode != 0:
        return [
            CheckResult(
                code="P0_DELIVERY_PACKET_NOT_IN_HEAD",
                message=(f"Completed delivery bundle is not committed at HEAD: {relative_path}"),
                location=relative_path,
            )
        ]
    try:
        current_bytes = resolved_path.read_bytes()
    except OSError as error:
        return [
            CheckResult(
                code="P0_DELIVERY_ARTIFACT_INVALID",
                message=f"Cannot reread P0 delivery bundle: {error}",
                location=str(bundle_path),
            )
        ]
    if current_bytes != cast(bytes, result.stdout):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_PACKET_HEAD_MISMATCH",
                message=(
                    f"Completed delivery bundle differs from its Git HEAD blob: {relative_path}"
                ),
                location=relative_path,
            )
        )
    return checks


def _validate_git_provenance(
    checks: list[CheckResult],
    paths: RepositoryPaths,
    commit_shas: set[str],
    final_release_commit: str,
    evidence_bindings: list[tuple[str, str, str, str]],
) -> None:
    existing_commits: set[str] = set()
    for commit_sha in sorted(commit_shas):
        result = _run_git(paths, "cat-file", "-e", f"{commit_sha}^{{commit}}")
        if result is None:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_GIT_UNAVAILABLE",
                    message="Cannot execute Git while validating delivery provenance",
                    location=str(paths.root),
                )
            )
            return
        if result.returncode != 0:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_COMMIT_NOT_FOUND",
                    message=f"Commit does not exist in the repository: {commit_sha}",
                    location="commit_sha",
                )
            )
        else:
            existing_commits.add(commit_sha)

    if final_release_commit in existing_commits:
        head_result = _run_git(paths, "rev-parse", "HEAD")
        if head_result is None:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_GIT_UNAVAILABLE",
                    message="Cannot resolve HEAD while validating delivery provenance",
                    location=str(paths.root),
                )
            )
            return
        head_commit = str(head_result.stdout).strip().lower()
        release_reachable = _run_git(
            paths,
            "merge-base",
            "--is-ancestor",
            final_release_commit,
            head_commit,
        )
        if release_reachable is None:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_GIT_UNAVAILABLE",
                    message="Cannot validate final release reachability",
                    location=str(paths.root),
                )
            )
            return
        if release_reachable.returncode != 0:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_RELEASE_COMMIT_UNREACHABLE",
                    message=(
                        f"Final release commit is not reachable from HEAD: {final_release_commit}"
                    ),
                    location="final_release.commit_sha",
                )
            )

        for commit_sha in sorted(existing_commits - {final_release_commit}):
            result = _run_git(
                paths,
                "merge-base",
                "--is-ancestor",
                commit_sha,
                final_release_commit,
            )
            if result is None:
                checks.append(
                    CheckResult(
                        code="P0_DELIVERY_GIT_UNAVAILABLE",
                        message="Cannot validate commit ancestry",
                        location=str(paths.root),
                    )
                )
                return
            if result.returncode != 0:
                checks.append(
                    CheckResult(
                        code="P0_DELIVERY_COMMIT_NOT_IN_RELEASE",
                        message=(
                            f"Implementation or evidence commit is not included in the final "
                            f"release: {commit_sha}"
                        ),
                        location="commit_sha",
                    )
                )

    for evidence_id, relative_path, declared_sha256, commit_sha in evidence_bindings:
        if commit_sha not in existing_commits:
            continue
        result = _run_git(paths, "show", f"{commit_sha}:{relative_path}", text=False)
        if result is None:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_GIT_UNAVAILABLE",
                    message="Cannot read committed evidence blobs",
                    location=str(paths.root),
                )
            )
            return
        if result.returncode != 0:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_NOT_IN_COMMIT",
                    message=(
                        f"Evidence {evidence_id} is not present at {relative_path} "
                        f"in commit {commit_sha}"
                    ),
                    location=f"evidence.{evidence_id}",
                )
            )
            continue
        committed_sha256 = hashlib.sha256(cast(bytes, result.stdout)).hexdigest()
        if committed_sha256 != declared_sha256:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_COMMIT_HASH_MISMATCH",
                    message=(
                        f"Evidence {evidence_id} does not match its Git blob in commit {commit_sha}"
                    ),
                    location=f"evidence.{evidence_id}",
                )
            )


def validate_p0_delivery_bundle(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    d4_bundle: dict[str, Any],
    *,
    d4_chain_checks: list[CheckResult],
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    current = build_p0_delivery_template(paths)
    if bundle.get("schema_version") != 4 or bundle.get("stage") != "P0-DELIVERY":
        checks.append(
            CheckResult(
                code="P0_DELIVERY_HEADER_INVALID",
                message="Bundle requires schema_version 4 and stage P0-DELIVERY",
                location="bundle",
            )
        )
    if bundle.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_TEMPLATE_UNCOPIED",
                message="Copy the template and set template_only to false",
                location="template_only",
            )
        )
    if bundle.get("append_only") is not True:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_APPEND_ONLY_MISSING",
                message="P0 delivery evidence must be append-only",
                location="append_only",
            )
        )
    if bundle.get("baseline") != current["baseline"]:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_BASELINE_STALE",
                message="P0 delivery baseline differs from current frozen inputs",
                location="baseline",
            )
        )

    traceability = build_p0_traceability_report(paths)
    if traceability.get("traceability_ready") is not True:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_TRACEABILITY_GATE_FAILED",
                message="Current P0 traceability assessment has open blockers",
                location="baseline",
            )
        )

    dependencies = bundle.get("dependencies")
    d4_acceptance = d4_bundle.get("acceptance")
    d4_evidence_id = (
        d4_acceptance.get("d4_gate_evidence_id") if isinstance(d4_acceptance, dict) else None
    )
    if not isinstance(dependencies, dict) or (
        dependencies.get("d4_gate_status") != _APPROVED_STATUS
        or not dependencies.get("d4_gate_evidence_id")
        or dependencies.get("d4_gate_evidence_id") != d4_evidence_id
        or dependencies.get("d4_bundle_sha256") != payload_sha256(d4_bundle)
    ):
        checks.append(
            CheckResult(
                code="P0_DELIVERY_D4_DEPENDENCY_INVALID",
                message="Approved D4 evidence and the exact D4 bundle hash are required",
                location="dependencies",
            )
        )
    if not isinstance(d4_acceptance, dict) or d4_acceptance.get("decision") != _APPROVED_STATUS:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_D4_NOT_APPROVED",
                message="D4 acceptance decision is not approved",
                location="d4_bundle.acceptance",
            )
        )
    if d4_chain_checks:
        codes = ", ".join(sorted({check.code for check in d4_chain_checks}))
        checks.append(
            CheckResult(
                code="P0_DELIVERY_D4_CHAIN_INVALID",
                message=f"Full D4 validation failed: {codes}",
                location="d4_bundle",
            )
        )

    committee_approver = _d4_committee_approver(checks, d4_bundle)
    referenced_evidence_ids: set[str] = set()
    evidence_subject_requirements: dict[str, set[str]] = {}
    known_subject_refs = {"release_metrics", "final_release"}
    required_signer_roles = {
        _text(item, "role") for item in cast(list[dict[str, Any]], current["signer_authorizations"])
    }
    (
        authorized_signers,
        authorization_evidence_ids,
        authorization_subject_requirements,
        authorization_subject_refs,
    ) = _validate_signer_authorizations(checks, bundle, required_signer_roles, committee_approver)
    referenced_evidence_ids.update(authorization_evidence_ids)
    for evidence_id, subject_refs in authorization_subject_requirements.items():
        evidence_subject_requirements.setdefault(evidence_id, set()).update(subject_refs)
    known_subject_refs.update(authorization_subject_refs)
    commit_shas: set[str] = set()
    section_specs = (
        (
            "requirements",
            "requirement_id",
            ("requirement_id", "module", "function"),
            _validate_implementation,
        ),
        (
            "routes",
            "page_id",
            ("page_id", "page_name", "route"),
            _validate_implementation,
        ),
        (
            "apis",
            "api_id",
            ("api_id", "module", "method", "path"),
            _validate_implementation,
        ),
        (
            "product_tests",
            "test_id",
            ("test_id", "module", "requirement_ids", "required_reviewer_role"),
            _validate_test_execution,
        ),
        (
            "engineering_tests",
            "test_id",
            ("test_id", "domain", "requirement_ids", "required_reviewer_role"),
            _validate_test_execution,
        ),
        (
            "acceptance_items",
            "acceptance_id",
            (
                "acceptance_id",
                "domain",
                "threshold",
                "required_reviewer_role",
                "accountable_role",
            ),
            _validate_acceptance,
        ),
    )
    for section, identifier_field, immutable_fields, validator in section_specs:
        actual = _indexed_section(checks, bundle, section, identifier_field)
        expected = {
            str(item[identifier_field]): item
            for item in cast(list[dict[str, Any]], current[section])
        }
        known_subject_refs.update(f"{section}:{identifier}" for identifier in expected)
        _validate_exact_section(
            checks,
            actual,
            expected,
            section=section,
            immutable_fields=immutable_fields,
        )
        for identifier, item in actual.items():
            location = f"{section}.{identifier}"
            if validator is _validate_implementation:
                item_evidence_ids = _validate_implementation(
                    checks,
                    item,
                    location=location,
                    commit_shas=commit_shas,
                )
            elif validator is _validate_test_execution:
                item_evidence_ids = _validate_test_execution(
                    checks,
                    item,
                    location=location,
                    authorized_signers=authorized_signers,
                    committee_approver=committee_approver,
                )
            else:
                item_evidence_ids = _validate_acceptance(
                    checks,
                    item,
                    location=location,
                    authorized_signers=authorized_signers,
                    committee_approver=committee_approver,
                )
            referenced_evidence_ids.update(item_evidence_ids)
            _bind_evidence_subjects(
                evidence_subject_requirements,
                item_evidence_ids,
                f"{section}:{identifier}",
            )

    metric_evidence_ids = _validate_metrics(checks, bundle.get("release_metrics"))
    referenced_evidence_ids.update(metric_evidence_ids)
    _bind_evidence_subjects(
        evidence_subject_requirements,
        metric_evidence_ids,
        "release_metrics",
    )
    final_release_evidence_ids = _validate_final_release(
        checks,
        bundle.get("final_release"),
        commit_shas,
        committee_approver,
    )
    referenced_evidence_ids.update(final_release_evidence_ids)
    _bind_evidence_subjects(
        evidence_subject_requirements,
        final_release_evidence_ids,
        "final_release",
    )
    (
        evidence_ids,
        evidence_bindings,
        evidence_approvals,
        declared_subject_refs,
    ) = _validate_evidence(
        checks,
        paths,
        bundle,
        authorized_signers,
        committee_approver,
    )
    commit_shas.update(binding[3] for binding in evidence_bindings)
    unknown_evidence = sorted(referenced_evidence_ids - evidence_ids)
    if unknown_evidence:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_EVIDENCE_REFERENCE_UNKNOWN",
                message=f"Unknown evidence IDs: {', '.join(unknown_evidence)}",
                location="evidence",
            )
        )
    unreferenced_evidence = sorted(evidence_ids - referenced_evidence_ids)
    if unreferenced_evidence:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_EVIDENCE_UNREFERENCED",
                message=f"Unreferenced evidence IDs: {', '.join(unreferenced_evidence)}",
                location="evidence",
            )
        )
    for evidence_id in sorted(evidence_ids):
        unknown_subject_refs = sorted(
            declared_subject_refs.get(evidence_id, set()) - known_subject_refs
        )
        if unknown_subject_refs:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_SUBJECT_UNKNOWN",
                    message=(
                        f"{evidence_id} declares unknown subjects: "
                        f"{', '.join(unknown_subject_refs)}"
                    ),
                    location=f"evidence.{evidence_id}",
                )
            )
        missing_subject_refs = sorted(
            evidence_subject_requirements.get(evidence_id, set())
            - declared_subject_refs.get(evidence_id, set())
        )
        if missing_subject_refs:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_SUBJECT_BINDING_MISSING",
                    message=(
                        f"{evidence_id} does not declare referenced subjects: "
                        f"{', '.join(missing_subject_refs)}"
                    ),
                    location=f"evidence.{evidence_id}",
                )
            )
        unlinked_subject_refs = sorted(
            (declared_subject_refs.get(evidence_id, set()) & known_subject_refs)
            - evidence_subject_requirements.get(evidence_id, set())
        )
        if unlinked_subject_refs:
            checks.append(
                CheckResult(
                    code="P0_DELIVERY_EVIDENCE_SUBJECT_REFERENCE_MISSING",
                    message=(
                        f"{evidence_id} declares subjects that do not reference it: "
                        f"{', '.join(unlinked_subject_refs)}"
                    ),
                    location=f"evidence.{evidence_id}",
                )
            )
    invalid_authorization_evidence = sorted(
        evidence_id
        for evidence_id in authorization_evidence_ids & evidence_ids
        if evidence_approvals.get(evidence_id) != (_COMMITTEE_ROLE, committee_approver)
    )
    if invalid_authorization_evidence:
        checks.append(
            CheckResult(
                code="P0_DELIVERY_SIGNER_AUTHORIZATION_EVIDENCE_INVALID",
                message=(
                    "Signer authorization evidence must be approved by the D4 committee signer: "
                    f"{', '.join(invalid_authorization_evidence)}"
                ),
                location="signer_authorizations",
            )
        )
    final_release = bundle.get("final_release")
    final_release_commit = (
        _text(final_release, "commit_sha").lower() if isinstance(final_release, dict) else ""
    )
    _validate_git_provenance(
        checks,
        paths,
        commit_shas,
        final_release_commit,
        evidence_bindings,
    )
    return checks


def _load_object(path: Path, label: str) -> tuple[dict[str, Any] | None, CheckResult | None]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        return None, CheckResult(
            code="P0_DELIVERY_ARTIFACT_INVALID",
            message=f"Cannot read {label}: {error}",
            location=str(path),
        )
    if not isinstance(payload, dict):
        return None, CheckResult(
            code="P0_DELIVERY_ARTIFACT_INVALID",
            message=f"{label} root must be an object",
            location=str(path),
        )
    return payload, None


def load_and_validate_p0_delivery_bundle(
    paths: RepositoryPaths,
    bundle_path: Path,
    d4_bundle_path: Path,
    d3_bundle_path: Path,
    d2_bundle_path: Path,
    d1_registry_path: Path,
    d1_matrix_path: Path,
    d1_evidence_path: Path,
) -> list[CheckResult]:
    bundle, bundle_error = _load_object(bundle_path, "P0 delivery bundle")
    if bundle_error:
        return [bundle_error]
    packet_checks = _validate_delivery_packet_provenance(paths, bundle_path)
    d4_bundle, d4_error = _load_object(d4_bundle_path, "D4 bundle")
    if d4_error:
        return [*packet_checks, d4_error]
    assert bundle is not None
    assert d4_bundle is not None
    d4_checks = load_and_validate_d4_bundle(
        paths,
        d4_bundle_path,
        d3_bundle_path,
        d2_bundle_path,
        d1_registry_path,
        d1_matrix_path,
        d1_evidence_path,
    )
    return [
        *packet_checks,
        *validate_p0_delivery_bundle(
            paths,
            bundle,
            d4_bundle,
            d4_chain_checks=d4_checks,
        ),
    ]
