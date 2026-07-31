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
        },
    }


def _completed_bundle() -> tuple[dict[str, Any], dict[str, Any]]:
    paths = discover_repository()
    bundle = copy.deepcopy(build_p0_delivery_template(paths))
    bundle["template_only"] = False
    commit_sha = _head_commit()
    evidence_id = "EVD-P0-DELIVERY-INTEGRATION"
    evidence_path = "data/d0/evidence/kevin_review_decisions_20260731.md"
    bundle["evidence"] = [
        {
            "evidence_id": evidence_id,
            "artifact_type": "integration_test_fixture",
            "path": evidence_path,
            "sha256": sha256_file(paths.root / evidence_path),
            "commit_sha": commit_sha,
            "generated_by": "test",
            "generated_at": "2026-07-31T00:00:00Z",
            "status": "approved",
            "contains_restricted_data": False,
        }
    ]
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
    return bundle, d4_bundle


def _codes(checks: list[CheckResult]) -> set[str]:
    return {check.code for check in checks}


def test_delivery_template_freezes_complete_p0_scope() -> None:
    bundle = build_p0_delivery_template(discover_repository())

    assert bundle["template_only"] is True
    assert bundle["append_only"] is True
    assert bundle["schema_version"] == 2
    assert len(bundle["requirements"]) == 90
    assert len(bundle["routes"]) == 125
    assert len(bundle["apis"]) == 56
    assert len(bundle["product_tests"]) == 89
    assert len(bundle["engineering_tests"]) == 17
    assert len(bundle["acceptance_items"]) == 11
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
    assert "P0_DELIVERY_IMPLEMENTATION_PENDING" in codes
    assert "P0_DELIVERY_TEST_NOT_PASSED" in codes
    assert "P0_DELIVERY_ACCEPTANCE_PENDING" in codes
    assert "P0_DELIVERY_FINAL_RELEASE_PENDING" in codes


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
