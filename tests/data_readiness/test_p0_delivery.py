from __future__ import annotations

import copy
import json
import subprocess
from dataclasses import replace
from pathlib import Path
from typing import Any

from navigator_data_readiness.baseline import sha256_file
from navigator_data_readiness.models import CheckResult
from navigator_data_readiness.p0_delivery import (
    _validate_delivery_packet_provenance,
    build_p0_delivery_template,
    load_and_validate_p0_delivery_bundle,
    payload_sha256,
    validate_p0_delivery_bundle,
    write_p0_delivery_template,
)
from navigator_data_readiness.paths import discover_repository


def _ready_traceability() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "traceability_ready": True,
        "traceability_blockers": [],
    }


def _head_commit() -> str:
    paths = discover_repository()
    return subprocess.check_output(
        ["git", "-C", str(paths.root), "rev-parse", "HEAD"],
        text=True,
    ).strip()


def _parent_commit() -> str:
    paths = discover_repository()
    return subprocess.check_output(
        ["git", "-C", str(paths.root), "rev-parse", "HEAD^"],
        text=True,
    ).strip()


def _approved_d4_bundle() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "stage": "D4",
        "acceptance": {
            "decision": "approved",
            "d4_gate_evidence_id": "EVD-D4-FINAL",
            "committee_approvals": [
                {
                    "role": "项目委员会",
                    "person_name": "kevin",
                    "signed_at": "2026-07-31",
                    "evidence_id": "EVD-D4-FINAL",
                    "decision": "approved",
                }
            ],
        },
    }


def _completed_bundle() -> tuple[dict[str, Any], dict[str, Any]]:
    paths = discover_repository()
    bundle = copy.deepcopy(build_p0_delivery_template(paths))
    bundle["template_only"] = False
    commit_sha = _head_commit()
    evidence_id = "EVD-P0-DELIVERY-INTEGRATION"
    evidence_path = "data/p0/evidence/README.md"
    bundle["evidence"] = [
        {
            "evidence_id": evidence_id,
            "artifact_type": "integration_test_fixture",
            "path": evidence_path,
            "sha256": sha256_file(paths.root / evidence_path),
            "commit_sha": commit_sha,
            "generated_by": "test",
            "generated_at": "2026-07-31T00:00:00Z",
            "approved_by": "kevin",
            "approval_role": "项目委员会",
            "approved_at": "2026-07-31T00:00:00Z",
            "status": "approved",
            "contains_restricted_data": False,
        }
    ]
    for item in bundle["signer_authorizations"]:
        item.update(
            {
                "person_name": "kevin",
                "authorized_by": "kevin",
                "authorized_at": "2026-07-31",
                "evidence_ids": [evidence_id],
            }
        )
    for section in ("requirements", "routes", "apis"):
        for item in bundle[section]:
            item.update(
                {
                    "status": "implemented",
                    "commit_sha": commit_sha,
                    "implemented_by": "kevin",
                    "implemented_at": "2026-07-31",
                    "evidence_ids": [evidence_id],
                }
            )
    for section in ("product_tests", "engineering_tests"):
        for item in bundle[section]:
            item.update(
                {
                    "status": "passed",
                    "executed_by": "kevin",
                    "executed_at": "2026-07-31",
                    "reviewed_by": "kevin",
                    "reviewer_role": item["required_reviewer_role"],
                    "reviewed_at": "2026-07-31",
                    "evidence_ids": [evidence_id],
                }
            )
    for item in bundle["acceptance_items"]:
        item.update(
            {
                "status": "approved",
                "reviewed_by": "kevin",
                "reviewer_role": item["required_reviewer_role"],
                "reviewed_at": "2026-07-31",
                "evidence_ids": [evidence_id],
            }
        )
    bundle["release_metrics"] = {
        "open_s0_defects": 0,
        "open_s1_defects": 0,
        "critical_task_success_rate_pct": 95,
        "leak_counts": {
            "tenant": 0,
            "search": 0,
            "cache": 0,
            "file": 0,
            "report": 0,
            "ai": 0,
        },
        "ai_citation_coverage_pct": 95,
        "performance_capacity_rpo_rto_status": "passed",
        "evidence_ids": [evidence_id],
    }
    bundle["final_release"] = {
        "status": "approved",
        "commit_sha": commit_sha,
        "build_status": "passed",
        "deployment_status": "passed",
        "rollback_status": "passed",
        "restore_status": "passed",
        "handover_status": "passed",
        "approver_role": "项目委员会",
        "approved_by": "kevin",
        "approved_at": "2026-07-31",
        "evidence_ids": [evidence_id],
    }
    d4_bundle = _approved_d4_bundle()
    bundle["dependencies"] = {
        "d4_gate_status": "approved",
        "d4_gate_evidence_id": "EVD-D4-FINAL",
        "d4_bundle_sha256": payload_sha256(d4_bundle),
    }
    subject_refs = {"release_metrics", "final_release"}
    for item in bundle["signer_authorizations"]:
        subject_refs.add(f"signer_authorizations:{item['role']}:{item['person_name']}")
    for section, identifier_field in (
        ("requirements", "requirement_id"),
        ("routes", "page_id"),
        ("apis", "api_id"),
        ("product_tests", "test_id"),
        ("engineering_tests", "test_id"),
        ("acceptance_items", "acceptance_id"),
    ):
        subject_refs.update(f"{section}:{item[identifier_field]}" for item in bundle[section])
    bundle["evidence"][0]["subject_refs"] = sorted(subject_refs)
    return bundle, d4_bundle


def _codes(checks: list[CheckResult]) -> set[str]:
    return {check.code for check in checks}


def test_delivery_template_freezes_complete_p0_scope() -> None:
    bundle = build_p0_delivery_template(discover_repository())

    assert bundle["template_only"] is True
    assert bundle["append_only"] is True
    assert bundle["schema_version"] == 4
    assert len(bundle["requirements"]) == 90
    assert len(bundle["routes"]) == 125
    assert len(bundle["apis"]) == 56
    assert len(bundle["product_tests"]) == 89
    assert len(bundle["engineering_tests"]) == 17
    assert len(bundle["acceptance_items"]) == 11
    assert {item["role"] for item in bundle["signer_authorizations"]} == {
        "产品/业务",
        "技术负责人",
        "商务代表",
        "业务/产品",
        "业务/法务",
        "业务代表",
        "测试负责人",
        "种子用户",
    }
    assert len(bundle["baseline"]["p0_traceability_assessment_sha256"]) == 64


def test_unfilled_delivery_template_is_blocked() -> None:
    paths = discover_repository()
    bundle = build_p0_delivery_template(paths)
    d4_bundle = _approved_d4_bundle()

    checks = validate_p0_delivery_bundle(
        paths,
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )
    codes = _codes(checks)

    assert "P0_DELIVERY_TEMPLATE_UNCOPIED" in codes
    assert "P0_DELIVERY_TRACEABILITY_GATE_FAILED" in codes
    assert "P0_DELIVERY_D4_DEPENDENCY_INVALID" in codes
    assert "P0_DELIVERY_SIGNER_AUTHORIZATION_INCOMPLETE" in codes
    assert "P0_DELIVERY_SIGNER_ROLE_COVERAGE_INCOMPLETE" in codes
    assert "P0_DELIVERY_IMPLEMENTATION_PENDING" in codes
    assert "P0_DELIVERY_IMPLEMENTATION_METADATA_INCOMPLETE" in codes
    assert "P0_DELIVERY_TEST_NOT_PASSED" in codes
    assert "P0_DELIVERY_TEST_METADATA_INCOMPLETE" in codes
    assert "P0_DELIVERY_ACCEPTANCE_PENDING" in codes
    assert "P0_DELIVERY_ACCEPTANCE_METADATA_INCOMPLETE" in codes
    assert "P0_DELIVERY_FINAL_RELEASE_PENDING" in codes
    assert "P0_DELIVERY_FINAL_RELEASE_METADATA_INCOMPLETE" in codes


def test_completed_delivery_bundle_passes(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert checks == []


def test_evidence_must_declare_every_referenced_subject(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    subject_ref = f"requirements:{bundle['requirements'][0]['requirement_id']}"
    bundle["evidence"][0]["subject_refs"].remove(subject_ref)

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert "P0_DELIVERY_EVIDENCE_SUBJECT_BINDING_MISSING" in _codes(checks)


def test_evidence_cannot_declare_an_unknown_subject(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["evidence"][0]["subject_refs"].append("requirements:FR-NOT-REAL")

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert "P0_DELIVERY_EVIDENCE_SUBJECT_UNKNOWN" in _codes(checks)


def test_declared_subject_must_reference_the_evidence(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["requirements"][0]["evidence_ids"] = []

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert "P0_DELIVERY_EVIDENCE_SUBJECT_REFERENCE_MISSING" in _codes(checks)


def test_unreferenced_evidence_is_rejected(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    unreferenced = copy.deepcopy(bundle["evidence"][0])
    unreferenced["evidence_id"] = "EVD-P0-UNREFERENCED"
    bundle["evidence"].append(unreferenced)

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert "P0_DELIVERY_EVIDENCE_UNREFERENCED" in _codes(checks)


def test_evidence_subject_refs_are_required_and_unique(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["evidence"][0]["subject_refs"] = []

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )
    assert "P0_DELIVERY_EVIDENCE_SUBJECT_REFS_INVALID" in _codes(checks)

    bundle, d4_bundle = _completed_bundle()
    bundle["evidence"][0]["subject_refs"].append(bundle["evidence"][0]["subject_refs"][0])
    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )
    assert "P0_DELIVERY_EVIDENCE_SUBJECT_REF_DUPLICATE" in _codes(checks)


def test_evidence_path_must_be_relative_canonical_and_scoped(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    paths = discover_repository()
    cases = (
        (
            str(paths.root / "data" / "p0" / "evidence" / "README.md"),
            "P0_DELIVERY_EVIDENCE_PATH_NOT_RELATIVE",
        ),
        (
            "data/p0/evidence/./README.md",
            "P0_DELIVERY_EVIDENCE_PATH_NOT_CANONICAL",
        ),
        (
            "data/d0/evidence/kevin_review_decisions_20260731.md",
            "P0_DELIVERY_EVIDENCE_PATH_SCOPE_INVALID",
        ),
    )

    for evidence_path, expected_code in cases:
        bundle, d4_bundle = _completed_bundle()
        bundle["evidence"][0]["path"] = evidence_path
        checks = validate_p0_delivery_bundle(
            paths,
            bundle,
            d4_bundle,
            d4_chain_checks=[],
        )
        assert expected_code in _codes(checks)


def test_delivery_temporal_fields_must_be_iso8601(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["requirements"][0]["implemented_at"] = "eventually"
    bundle["signer_authorizations"][0]["authorized_at"] = "2026-07-31T10:00:00"

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    temporal_checks = [check for check in checks if check.code == "P0_DELIVERY_TEMPORAL_INVALID"]
    assert {check.location for check in temporal_checks} == {
        f"requirements.{bundle['requirements'][0]['requirement_id']}.implemented_at",
        "signer_authorizations[0].authorized_at",
    }


def test_reviews_and_approvals_cannot_predate_their_events(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["product_tests"][0]["executed_at"] = "2026-07-31T10:00:00+08:00"
    bundle["product_tests"][0]["reviewed_at"] = "2026-07-31T09:00:00+08:00"
    bundle["evidence"][0]["generated_at"] = "2026-07-31T10:00:00Z"
    bundle["evidence"][0]["approved_at"] = "2026-07-31T09:00:00Z"

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )
    codes = _codes(checks)

    assert "P0_DELIVERY_TEST_REVIEW_BEFORE_EXECUTION" in codes
    assert "P0_DELIVERY_EVIDENCE_APPROVAL_BEFORE_GENERATION" in codes


def test_noncommittee_signatures_require_prior_authorization(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    test_authorization = next(
        item for item in bundle["signer_authorizations"] if item["role"] == "测试负责人"
    )
    test_authorization["authorized_at"] = "2026-08-02"
    bundle["product_tests"][0]["executed_at"] = "2026-07-31"
    bundle["product_tests"][0]["reviewed_at"] = "2026-08-01"

    acceptance = next(
        item
        for item in bundle["acceptance_items"]
        if item["required_reviewer_role"] != "项目委员会"
    )
    acceptance_authorization = next(
        item
        for item in bundle["signer_authorizations"]
        if item["role"] == acceptance["required_reviewer_role"]
    )
    acceptance_authorization["authorized_at"] = "2026-08-02"
    acceptance["reviewed_at"] = "2026-08-01"

    bundle["evidence"][0]["approval_role"] = "测试负责人"
    bundle["evidence"][0]["approved_at"] = "2026-08-01"

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )
    codes = _codes(checks)

    assert "P0_DELIVERY_TEST_REVIEW_BEFORE_AUTHORIZATION" in codes
    assert "P0_DELIVERY_ACCEPTANCE_REVIEW_BEFORE_AUTHORIZATION" in codes
    assert "P0_DELIVERY_EVIDENCE_APPROVAL_BEFORE_AUTHORIZATION" in codes


def test_committee_authority_cannot_be_applied_retroactively(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    d4_bundle["acceptance"]["committee_approvals"][0]["signed_at"] = "2026-08-02"
    bundle["dependencies"]["d4_bundle_sha256"] = payload_sha256(d4_bundle)

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )
    codes = _codes(checks)

    assert "P0_DELIVERY_SIGNER_AUTHORIZATION_BEFORE_COMMITTEE_APPROVAL" in codes
    assert "P0_DELIVERY_ACCEPTANCE_REVIEW_BEFORE_AUTHORIZATION" in codes
    assert "P0_DELIVERY_EVIDENCE_APPROVAL_BEFORE_AUTHORIZATION" in codes
    assert "P0_DELIVERY_FINAL_RELEASE_BEFORE_AUTHORIZATION" in codes


def test_d4_chain_cannot_be_self_reported(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[CheckResult(code="D4_UPSTREAM_TEST", message="failed")],
    )

    assert "P0_DELIVERY_D4_CHAIN_INVALID" in _codes(checks)


def test_tampered_evidence_and_scope_are_rejected(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["evidence"][0]["sha256"] = "0" * 64
    bundle["requirements"][0]["function"] = "未评审变更"
    bundle["apis"].pop()
    bundle["acceptance_items"][0]["reviewer_role"] = "错误角色"

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )
    codes = _codes(checks)

    assert "P0_DELIVERY_EVIDENCE_HASH_MISMATCH" in codes
    assert "P0_DELIVERY_FROZEN_INPUT_CHANGED" in codes
    assert "P0_DELIVERY_SET_INVALID" in codes
    assert "P0_DELIVERY_ACCEPTANCE_ROLE_INVALID" in codes


def test_unknown_commit_and_failed_metrics_are_rejected(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    unknown_commit = "f" * 40
    bundle["requirements"][0]["commit_sha"] = unknown_commit
    bundle["release_metrics"]["open_s0_defects"] = 1
    bundle["release_metrics"]["leak_counts"]["ai"] = 1
    bundle["release_metrics"]["critical_task_success_rate_pct"] = 94

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )
    codes = _codes(checks)

    assert "P0_DELIVERY_COMMIT_NOT_FOUND" in codes
    assert "P0_DELIVERY_DEFECT_GATE_FAILED" in codes
    assert "P0_DELIVERY_LEAK_GATE_FAILED" in codes
    assert "P0_DELIVERY_TASK_SUCCESS_GATE_FAILED" in codes


def test_delivery_signers_must_follow_committee_authorization(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["signer_authorizations"][0]["authorized_by"] = "mallory"
    bundle["product_tests"][0]["reviewed_by"] = "mallory"
    non_committee_acceptance = next(
        item
        for item in bundle["acceptance_items"]
        if item["required_reviewer_role"] != "项目委员会"
    )
    non_committee_acceptance["reviewed_by"] = "mallory"
    bundle["evidence"][0]["approved_by"] = "mallory"
    bundle["final_release"]["approved_by"] = "mallory"

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )
    codes = _codes(checks)

    assert "P0_DELIVERY_SIGNER_AUTHORIZER_INVALID" in codes
    assert "P0_DELIVERY_TEST_REVIEWER_UNAUTHORIZED" in codes
    assert "P0_DELIVERY_ACCEPTANCE_REVIEWER_UNAUTHORIZED" in codes
    assert "P0_DELIVERY_EVIDENCE_APPROVER_UNAUTHORIZED" in codes
    assert "P0_DELIVERY_FINAL_RELEASE_APPROVER_UNAUTHORIZED" in codes


def test_signer_authorization_evidence_requires_committee_approval(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["evidence"][0]["approval_role"] = "测试负责人"

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert "P0_DELIVERY_EVIDENCE_APPROVER_UNAUTHORIZED" not in _codes(checks)
    assert "P0_DELIVERY_SIGNER_AUTHORIZATION_EVIDENCE_INVALID" in _codes(checks)


def test_all_required_signer_roles_must_be_authorized(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["signer_authorizations"].pop()

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert "P0_DELIVERY_SIGNER_ROLE_COVERAGE_INCOMPLETE" in _codes(checks)


def test_d4_requires_one_committee_authority_root(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    d4_bundle["acceptance"]["committee_approvals"] = []
    bundle["dependencies"]["d4_bundle_sha256"] = payload_sha256(d4_bundle)

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert "P0_DELIVERY_COMMITTEE_APPROVER_INVALID" in _codes(checks)


def test_evidence_must_match_the_blob_in_its_declared_commit(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    real_run = subprocess.run

    def tamper_git_show(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[Any]:
        command = args[0]
        if isinstance(command, list) and "show" in command:
            return subprocess.CompletedProcess(command, 0, stdout=b"tampered", stderr=b"")
        return real_run(*args, **kwargs)

    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.subprocess.run",
        tamper_git_show,
    )

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert "P0_DELIVERY_EVIDENCE_COMMIT_HASH_MISMATCH" in _codes(checks)


def test_implementation_and_evidence_commits_must_be_in_release(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["final_release"]["commit_sha"] = _parent_commit()

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert "P0_DELIVERY_COMMIT_NOT_IN_RELEASE" in _codes(checks)


def test_evidence_requires_a_commit_binding(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery.build_p0_traceability_report",
        lambda _paths: _ready_traceability(),
    )
    bundle, d4_bundle = _completed_bundle()
    bundle["evidence"][0].pop("commit_sha")

    checks = validate_p0_delivery_bundle(
        discover_repository(),
        bundle,
        d4_bundle,
        d4_chain_checks=[],
    )

    assert "P0_DELIVERY_EVIDENCE_METADATA_INCOMPLETE" in _codes(checks)


def test_write_delivery_template_is_deterministic(tmp_path: Path) -> None:
    paths = replace(discover_repository(), p0_candidates_dir=tmp_path / "p0")

    first_path = write_p0_delivery_template(paths)
    first = first_path.read_bytes()
    second_path = write_p0_delivery_template(paths)

    assert first_path == second_path
    assert first == second_path.read_bytes()


def test_load_delivery_rejects_invalid_artifact(tmp_path: Path) -> None:
    paths = discover_repository()
    invalid = tmp_path / "invalid.json"
    invalid.write_text("[]", encoding="utf-8")
    missing = tmp_path / "missing.json"

    checks = load_and_validate_p0_delivery_bundle(
        paths,
        invalid,
        missing,
        missing,
        missing,
        missing,
        missing,
        missing,
    )

    assert [check.code for check in checks] == ["P0_DELIVERY_ARTIFACT_INVALID"]


def test_completed_delivery_packet_must_match_git_head(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    repository_root = tmp_path / "repository"
    delivery_dir = repository_root / "data" / "p0" / "delivery"
    delivery_dir.mkdir(parents=True)
    packet_path = delivery_dir / "p0_delivery_evidence.v1.json"
    packet_path.write_text('{"stage":"P0-DELIVERY"}\n', encoding="utf-8")
    paths = replace(discover_repository(), root=repository_root)

    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery._run_git",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            ["git"],
            0,
            stdout=packet_path.read_bytes(),
            stderr=b"",
        ),
    )
    assert _validate_delivery_packet_provenance(paths, packet_path) == []

    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery._run_git",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            ["git"],
            0,
            stdout=b"tampered",
            stderr=b"",
        ),
    )
    assert "P0_DELIVERY_PACKET_HEAD_MISMATCH" in _codes(
        _validate_delivery_packet_provenance(paths, packet_path)
    )

    monkeypatch.setattr(
        "navigator_data_readiness.p0_delivery._run_git",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            ["git"],
            128,
            stdout=b"",
            stderr=b"missing",
        ),
    )
    assert "P0_DELIVERY_PACKET_NOT_IN_HEAD" in _codes(
        _validate_delivery_packet_provenance(paths, packet_path)
    )

    outside_path = repository_root / "p0_delivery_evidence.v1.json"
    outside_path.write_text("{}", encoding="utf-8")
    assert "P0_DELIVERY_PACKET_PATH_INVALID" in _codes(
        _validate_delivery_packet_provenance(paths, outside_path)
    )


def test_load_delivery_reports_packet_provenance_before_missing_d4(tmp_path: Path) -> None:
    packet_path = tmp_path / "p0_delivery_evidence.v1.json"
    packet_path.write_text("{}", encoding="utf-8")
    missing = tmp_path / "missing.json"

    checks = load_and_validate_p0_delivery_bundle(
        discover_repository(),
        packet_path,
        missing,
        missing,
        missing,
        missing,
        missing,
        missing,
    )

    assert [check.code for check in checks] == [
        "P0_DELIVERY_PACKET_PATH_INVALID",
        "P0_DELIVERY_ARTIFACT_INVALID",
    ]


def test_template_is_json_serializable() -> None:
    payload = json.dumps(build_p0_delivery_template(discover_repository()), ensure_ascii=False)

    assert '"stage": "P0-DELIVERY"' in payload
