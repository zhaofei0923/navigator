from __future__ import annotations

import copy
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from navigator_data_readiness.d2_collection import (
    STOP_SIGNALS,
    build_d2_assessment,
    build_d2_bundle_template,
    build_stop_signal_catalog,
    load_and_validate_d2_bundle,
    validate_d2_bundle,
    write_d2_candidates,
)
from navigator_data_readiness.paths import RepositoryPaths, discover_repository
from pytest import MonkeyPatch


def _configure_job(item: dict[str, Any]) -> None:
    item.update(
        {
            "connector_type": "web",
            "connector_version": "connector@1.0.0",
            "schedule": "0 2 * * *",
            "schedule_timezone": "UTC",
            "scope": {"path": "/approved"},
            "watermark_strategy": "source_updated_at",
            "idempotency_key_template": "source+external_id+version",
            "deduplication_key_template": "canonical_url+content_hash",
            "rate_limit": "1 request/second",
            "timeout_seconds": 30,
            "max_retries": 3,
            "retry_policy": "仅网络、429和5xx有限重试；遵守Retry-After",
            "schema_fingerprint": "a" * 64,
            "user_agent_policy": "可识别Navigator采集代理",
            "status": "enabled",
        }
    )


def _completed_d2_payloads(
    paths: RepositoryPaths,
) -> tuple[dict[str, Any], dict[str, Any]]:
    bundle = build_d2_bundle_template(paths)
    bundle["template_only"] = False
    bundle["dependencies"] = {
        "d1_gate_status": "approved",
        "d1_gate_evidence_id": "EVD-D1-FINAL",
    }
    d1_sources: list[dict[str, Any]] = []

    for index, job in enumerate(bundle["jobs"], start=1):
        _configure_job(job)
        d1_sources.append({"source_id": job["source_id"], "status": "active"})
        run_id = f"RUN-{index:03d}"
        raw_id = f"RAW-{index:03d}"
        run = {
            "run_id": run_id,
            "job_id": job["job_id"],
            "batch_id": job["batch_id"],
            "source_id": job["source_id"],
            "country": job["country"],
            "status": "succeeded",
            "started_at": "2026-08-03T02:00:00Z",
            "finished_at": "2026-08-03T02:01:00Z",
            "connector_version": job["connector_version"],
            "parameters_sha256": f"{index:064x}",
            "watermark_before": "0",
            "observed_watermark": "1",
            "committed_watermark": "1",
            "http_status": 200,
            "access_signal": "none",
            "retry_count": 0,
            "automation_stopped": False,
            "incident_id": None,
            "secret_material_logged": False,
        }
        raw = {
            "raw_id": raw_id,
            "run_id": run_id,
            "job_id": job["job_id"],
            "batch_id": job["batch_id"],
            "source_id": job["source_id"],
            "country": job["country"],
            "original_url": f"https://source-{index}.example/document",
            "final_url": f"https://source-{index}.example/document.pdf",
            "organization": f"Official Source {index}",
            "title": f"Source document {index}",
            "published_at": "2026-08-01",
            "captured_at": "2026-08-03T02:00:30Z",
            "access_method": "public_download",
            "language": "en",
            "encoding": "binary",
            "mime_type": "application/pdf",
            "byte_size": 1024 + index,
            "sha256": f"{index + 10:064x}",
            "storage_object_id": f"l0/{job['country']}/{run_id}/{raw_id}",
            "encryption_status": "encrypted_at_rest",
            "malware_scan_status": "clean",
            "parse_status": "pending",
            "license_snapshot_id": f"LICENSE-{job['source_id']}",
            "access_level": "internal_restricted",
            "retention_until": "2031-08-03",
            "response_metadata_sha256": f"{index + 20:064x}",
            "immutable": True,
            "original_bytes_preserved": True,
            "cookie_or_token_logged": False,
        }
        bundle["runs"].append(run)
        bundle["raw_objects"].append(raw)
        batch = next(item for item in bundle["batches"] if item["batch_id"] == job["batch_id"])
        batch.update(
            {
                "run_ids": [run_id],
                "raw_object_ids": [raw_id],
                "incident_ids": [],
                "manifest_sha256": f"{index + 30:064x}",
                "reviewed_by": "数据质量负责人姓名",
                "reviewed_at": "2026-08-03T10:00:00+08:00",
                "evidence_ids": [f"EVD-D2-BATCH-{index:03d}"],
                "status": "closed",
            }
        )
    return bundle, {"schema_version": 1, "stage": "D1", "sources": d1_sources}


def test_d2_templates_cover_frozen_jobs_batches_and_stop_signals() -> None:
    paths = discover_repository()

    bundle = build_d2_bundle_template(paths)
    catalog = build_stop_signal_catalog()
    assessment = build_d2_assessment(paths)

    assert bundle["template_only"] is True
    assert bundle["append_only"] is True
    assert len(bundle["jobs"]) == 6
    assert len(bundle["batches"]) == 6
    assert bundle["runs"] == []
    assert bundle["raw_objects"] == []
    assert {item["signal"] for item in catalog["signals"]} == set(STOP_SIGNALS)
    assert assessment["overall_status"] == "not_ready"


def test_unfilled_d2_template_fails_dependency_jobs_batches_and_sources() -> None:
    paths = discover_repository()
    bundle = build_d2_bundle_template(paths)
    d1_registry = {"sources": []}

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert {
        "D2_TEMPLATE_UNCOPIED",
        "D2_D1_DEPENDENCY_PENDING",
        "D2_JOB_NOT_ENABLED",
        "D2_SOURCE_NOT_ACTIVE",
        "D2_BATCH_NOT_CLOSED",
    } <= codes


def test_completed_d2_collection_bundle_passes() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)

    checks = validate_d2_bundle(paths, bundle, d1_registry)

    assert checks == []


def test_job_configuration_and_frozen_inputs_cannot_be_bypassed() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    job = bundle["jobs"][0]
    job["country"] = "TAMPERED"
    job["status"] = "invented"
    job["access_control_bypass_prohibited"] = False
    second = bundle["jobs"][1]
    second["connector_version"] = None
    second["timeout_seconds"] = 0
    second["max_retries"] = 4
    second["stop_signals"] = []
    second["schema_fingerprint"] = "INVALID"

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert {
        "D2_JOB_INPUT_CHANGED",
        "D2_JOB_STATUS_INVALID",
        "D2_JOB_BYPASS_PROHIBITION_MISSING",
        "D2_JOB_CONFIG_INCOMPLETE",
        "D2_JOB_TIMEOUT_INVALID",
        "D2_JOB_RETRY_INVALID",
        "D2_JOB_STOP_SIGNALS_INCOMPLETE",
        "D2_JOB_SCHEMA_HASH_INVALID",
    } <= codes


def test_access_stop_signal_requires_stop_incident_and_unchanged_watermark() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    run = bundle["runs"][0]
    run.update(
        {
            "status": "succeeded",
            "http_status": 403,
            "access_signal": "captcha",
            "retry_count": 4,
            "automation_stopped": False,
            "incident_id": "INC-MISSING",
            "committed_watermark": "2",
        }
    )

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert {
        "D2_RUN_HTTP_SIGNAL_MISMATCH",
        "D2_RUN_STOP_NOT_ENFORCED",
        "D2_RUN_FORBIDDEN_RETRY",
        "D2_RUN_INCIDENT_MISSING",
        "D2_RUN_RETRY_LIMIT_EXCEEDED",
    } <= codes


def test_unsuccessful_run_cannot_advance_watermark_or_hide_terminal_metadata() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    run = bundle["runs"][0]
    run["status"] = "failed"
    run["finished_at"] = None
    run["parameters_sha256"] = "INVALID"
    run["committed_watermark"] = "advanced"
    run["secret_material_logged"] = True
    run["access_signal"] = "invalid"

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert {
        "D2_RUN_TERMINAL_METADATA_INCOMPLETE",
        "D2_RUN_PARAMETERS_HASH_INVALID",
        "D2_RUN_SECRET_LOGGING_UNSAFE",
        "D2_RUN_SIGNAL_INVALID",
        "D2_RUN_FAILURE_ADVANCED_WATERMARK",
    } <= codes


def test_run_job_lineage_and_status_are_checked() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    bundle["runs"][0]["job_id"] = "JOB-UNKNOWN"
    bundle["runs"][1]["country"] = "TAMPERED"
    bundle["runs"][2]["status"] = "invented"

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert {
        "D2_RUN_JOB_UNKNOWN",
        "D2_RUN_JOB_MISMATCH",
        "D2_RUN_STATUS_INVALID",
    } <= codes


def test_raw_objects_require_lineage_metadata_immutability_hash_size_and_safe_urls() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    raw = bundle["raw_objects"][0]
    raw["run_id"] = "RUN-UNKNOWN"
    raw["title"] = None
    raw["immutable"] = False
    raw["original_bytes_preserved"] = False
    raw["cookie_or_token_logged"] = True
    raw["byte_size"] = 0
    raw["sha256"] = "INVALID"
    raw["response_metadata_sha256"] = "INVALID"
    raw["original_url"] = "file:///unsafe"
    second = bundle["raw_objects"][1]
    second["country"] = "TAMPERED"

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert {
        "D2_RAW_RUN_UNKNOWN",
        "D2_RAW_RUN_MISMATCH",
        "D2_RAW_METADATA_INCOMPLETE",
        "D2_RAW_IMMUTABILITY_MISSING",
        "D2_RAW_SECRET_LOGGING_UNSAFE",
        "D2_RAW_SIZE_INVALID",
        "D2_RAW_HASH_INVALID",
        "D2_RAW_RESPONSE_HASH_INVALID",
        "D2_RAW_URL_INVALID",
    } <= codes


def test_incident_contract_enforces_lineage_type_metadata_and_drift_controls() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    bundle["incidents"] = [
        {
            "incident_id": "INC-001",
            "run_id": "RUN-UNKNOWN",
            "incident_type": "schema_drift",
            "severity": None,
            "detected_at": "2026-08-03T02:00:10Z",
            "owner": "数据工程负责人姓名",
            "status": "open",
            "action": "暂停",
            "bypass_attempted": True,
            "mapping_paused": False,
            "raw_evidence_preserved": False,
        },
        {
            "incident_id": "INC-002",
            "run_id": "RUN-001",
            "incident_type": "invented",
            "severity": "P1",
            "detected_at": "2026-08-03T02:00:10Z",
            "owner": "数据工程负责人姓名",
            "status": "open",
            "action": "调查",
            "bypass_attempted": False,
        },
    ]

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert {
        "D2_INCIDENT_RUN_UNKNOWN",
        "D2_INCIDENT_TYPE_INVALID",
        "D2_INCIDENT_METADATA_INCOMPLETE",
        "D2_INCIDENT_BYPASS_UNSAFE",
        "D2_DRIFT_CONTROLS_MISSING",
    } <= codes


def test_stop_signal_incident_must_match_run_and_signal() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    run = bundle["runs"][0]
    run.update(
        {
            "status": "stopped",
            "access_signal": "captcha",
            "automation_stopped": True,
            "retry_count": 0,
            "incident_id": "INC-001",
            "committed_watermark": run["watermark_before"],
        }
    )
    bundle["incidents"] = [
        {
            "incident_id": "INC-001",
            "run_id": "RUN-002",
            "batch_id": bundle["runs"][1]["batch_id"],
            "incident_type": "forbidden",
            "severity": "P0",
            "detected_at": "2026-08-03T02:00:10Z",
            "owner": "数据工程负责人姓名",
            "status": "open",
            "action": "停止并复核",
            "bypass_attempted": False,
        }
    ]

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert "D2_RUN_INCIDENT_MISMATCH" in codes


def test_batch_closure_requires_known_outputs_hash_review_and_evidence() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    batch = bundle["batches"][0]
    batch["job_id"] = "JOB-UNKNOWN"
    batch["run_ids"] = ["RUN-UNKNOWN"]
    batch["raw_object_ids"] = ["RAW-UNKNOWN"]
    batch["incident_ids"] = ["INC-UNKNOWN"]
    batch["manifest_sha256"] = "INVALID"
    batch["reviewed_by"] = None
    batch["evidence_ids"] = []

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert {
        "D2_BATCH_JOB_MISMATCH",
        "D2_BATCH_RUN_UNKNOWN",
        "D2_BATCH_RAW_UNKNOWN",
        "D2_BATCH_INCIDENT_UNKNOWN",
        "D2_BATCH_OUTPUT_INCOMPLETE",
        "D2_BATCH_CLOSURE_INCOMPLETE",
        "D2_BATCH_MANIFEST_HASH_INVALID",
        "D2_BATCH_EVIDENCE_MISSING",
    } <= codes


def test_batch_references_cannot_cross_batch_lineage() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    bundle["batches"][0]["run_ids"].append(bundle["runs"][1]["run_id"])
    bundle["batches"][0]["raw_object_ids"].append(bundle["raw_objects"][1]["raw_id"])

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert "D2_BATCH_LINEAGE_MISMATCH" in codes


def test_invalid_bundle_sections_sets_dependencies_and_d1_registry_are_blocked() -> None:
    paths = discover_repository()
    bundle = build_d2_bundle_template(paths)
    bundle["schema_version"] = 2
    bundle["append_only"] = False
    bundle["baseline"] = {}
    bundle["dependencies"] = []
    bundle["jobs"] = "invalid"
    bundle["batches"] = "invalid"
    bundle["runs"] = "invalid"
    bundle["raw_objects"] = "invalid"
    bundle["incidents"] = "invalid"

    codes = {item.code for item in validate_d2_bundle(paths, bundle, {"sources": "invalid"})}

    assert {
        "D2_HEADER_INVALID",
        "D2_APPEND_ONLY_MISSING",
        "D2_BASELINE_STALE",
        "D2_D1_DEPENDENCY_PENDING",
        "D2_SECTION_INVALID",
        "D2_JOB_SET_INVALID",
        "D2_BATCH_SET_INVALID",
        "D2_D1_REGISTRY_INVALID",
    } <= codes


def test_duplicate_entries_and_storage_objects_are_blocked() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    bundle["runs"].append(copy.deepcopy(bundle["runs"][0]))
    bundle["raw_objects"][1]["storage_object_id"] = bundle["raw_objects"][0]["storage_object_id"]

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert "D2_ENTRY_DUPLICATE" in codes
    assert "D2_STORAGE_OBJECT_DUPLICATE" in codes


def test_invalid_batch_references_and_status_are_blocked() -> None:
    paths = discover_repository()
    bundle, d1_registry = _completed_d2_payloads(paths)
    bundle["batches"][0]["run_ids"] = "invalid"
    bundle["batches"][1]["status"] = "invented"

    codes = {item.code for item in validate_d2_bundle(paths, bundle, d1_registry)}

    assert "D2_BATCH_REFERENCES_INVALID" in codes
    assert "D2_BATCH_STATUS_INVALID" in codes


def test_write_and_load_d2_artifacts(tmp_path: Path) -> None:
    source_paths = discover_repository()
    paths = replace(source_paths, d2_candidates_dir=tmp_path / "candidates")

    written = write_d2_candidates(paths)
    bundle_path = paths.d2_candidates_dir / "d2_collection_bundle.template.json"
    d1_registry = tmp_path / "d1.json"
    d1_registry.write_text(json.dumps({"sources": []}), encoding="utf-8")
    d1_matrix = source_paths.d1_candidates_dir / "domain_source_matrix.template.json"
    d1_evidence = source_paths.d1_candidates_dir / "d1_evidence_manifest.template.json"
    checks = load_and_validate_d2_bundle(
        paths,
        bundle_path,
        d1_registry,
        d1_matrix,
        d1_evidence,
    )

    assert len(written) == 3
    assert all(path.is_file() for path in written)
    assert any(item.code == "D2_D1_DEPENDENCY_PENDING" for item in checks)
    assert any(item.code == "D2_D1_ADMISSION_INVALID" for item in checks)


def test_load_d2_accepts_only_after_full_d1_admission_passes(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    paths = discover_repository()
    bundle, registry = _completed_d2_payloads(paths)
    bundle_path = tmp_path / "bundle.json"
    registry_path = tmp_path / "registry.json"
    matrix_path = tmp_path / "matrix.json"
    evidence_path = tmp_path / "evidence.json"
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    matrix_path.write_text("{}", encoding="utf-8")
    evidence_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        "navigator_data_readiness.d2_collection.load_and_validate_d1_admission",
        lambda *_args: [],
    )

    checks = load_and_validate_d2_bundle(
        paths,
        bundle_path,
        registry_path,
        matrix_path,
        evidence_path,
    )

    assert checks == []


def test_load_d2_rejects_fabricated_active_registry_without_valid_d1_artifacts(
    tmp_path: Path,
) -> None:
    paths = discover_repository()
    bundle, registry = _completed_d2_payloads(paths)
    bundle_path = tmp_path / "bundle.json"
    registry_path = tmp_path / "registry.json"
    matrix_path = tmp_path / "matrix.json"
    evidence_path = tmp_path / "evidence.json"
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    matrix_path.write_text("{}", encoding="utf-8")
    evidence_path.write_text("{}", encoding="utf-8")

    checks = load_and_validate_d2_bundle(
        paths,
        bundle_path,
        registry_path,
        matrix_path,
        evidence_path,
    )

    assert any(item.code == "D2_D1_ADMISSION_INVALID" for item in checks)


def test_load_d2_handles_missing_invalid_and_non_object_files(tmp_path: Path) -> None:
    paths = discover_repository()
    valid = tmp_path / "valid.json"
    valid.write_text("{}", encoding="utf-8")
    invalid = tmp_path / "invalid.json"
    invalid.write_text("{", encoding="utf-8")
    array = tmp_path / "array.json"
    array.write_text("[]", encoding="utf-8")

    missing = load_and_validate_d2_bundle(paths, tmp_path / "missing.json", valid, valid, valid)
    malformed = load_and_validate_d2_bundle(paths, invalid, valid, valid, valid)
    non_object = load_and_validate_d2_bundle(paths, array, valid, valid, valid)

    assert missing[0].code == "D2_ARTIFACT_INVALID"
    assert malformed[0].code == "D2_ARTIFACT_INVALID"
    assert non_object[0].code == "D2_ARTIFACT_INVALID"
