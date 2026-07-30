from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from navigator_data_readiness.d3_processing import (
    PIPELINE_DEFINITIONS,
    build_d3_assessment,
    build_d3_bundle_template,
    build_d3_rule_catalog,
    d3_candidate_payloads,
    load_and_validate_d3_bundle,
    validate_d3_bundle,
    write_d3_candidates,
)
from navigator_data_readiness.paths import RepositoryPaths, discover_repository


def _completed_d3_payloads(
    paths: RepositoryPaths,
) -> tuple[dict[str, Any], dict[str, Any]]:
    bundle = build_d3_bundle_template(paths)
    bundle["template_only"] = False
    bundle["dependencies"] = {
        "d2_gate_status": "approved",
        "d2_gate_evidence_id": "EVD-D2-FINAL",
    }
    for pipeline in bundle["pipelines"]:
        pipeline["config"] = {key: f"{key}@1.0.0" for key in pipeline["required_config"]}
        pipeline["idempotency_key_template"] = "input_hash+code_version+rule_version"
        pipeline["status"] = "enabled"

    source_text = "Indonesia"
    text_hash = hashlib.sha256(source_text.encode()).hexdigest()
    raw = {
        "raw_id": "RAW-001",
        "run_id": "D2-RUN-001",
        "job_id": "D2-JOB-001",
        "batch_id": "D2-BATCH-001",
        "source_id": "SRC-IDN-001",
        "country": "IDN",
        "sha256": "a" * 64,
        "immutable": True,
        "original_bytes_preserved": True,
        "cookie_or_token_logged": False,
    }
    d2_bundle = {
        "schema_version": 1,
        "stage": "D2",
        "batches": [{"batch_id": raw["batch_id"], "status": "closed"}],
        "raw_objects": [raw],
    }
    run_specs = (
        ("D3-RUN-PARSE-001", "D3-PARSE", [raw["raw_id"]], ["REC-001"]),
        ("D3-RUN-STANDARDIZE-001", "D3-STANDARDIZE", ["REC-001"], ["REC-001"]),
        ("D3-RUN-ENTITY-001", "D3-ENTITY", ["REC-001"], ["REC-001"]),
    )
    for index, (run_id, pipeline_id, input_ids, output_ids) in enumerate(run_specs, start=1):
        bundle["transformation_runs"].append(
            {
                "run_id": run_id,
                "pipeline_id": pipeline_id,
                "status": "succeeded",
                "started_at": "2026-08-04T01:00:00Z",
                "finished_at": "2026-08-04T01:01:00Z",
                "code_version": "navigator-data@0.1.0",
                "rule_version": "D3-RULES@1.0.0",
                "parameters_sha256": f"{index:064x}",
                "input_manifest_sha256": f"{index + 10:064x}",
                "output_manifest_sha256": f"{index + 20:064x}",
                "input_ids": input_ids,
                "output_ids": output_ids,
                "input_mutated": False,
                "secret_material_logged": False,
            }
        )
    bundle["records"] = [
        {
            "record_id": "REC-001",
            "raw_id": raw["raw_id"],
            "source_id": raw["source_id"],
            "batch_id": raw["batch_id"],
            "country": raw["country"],
            "source_snapshot_sha256": raw["sha256"],
            "source_locator": "page=1;paragraph=1",
            "source_text": source_text,
            "source_text_sha256": text_hash,
            "source_language": "en",
            "extraction_method": "pdf_text",
            "extraction_confidence": 0.99,
            "schema_version": "V1.0-BASELINE",
            "transformation_run_ids": [item[0] for item in run_specs],
            "status": "candidate",
            "publish_eligible": False,
            "ai_index_eligible": False,
        }
    ]
    bundle["field_values"] = [
        {
            "field_value_id": "FV-001",
            "record_id": "REC-001",
            "target_field": "country.iso_code",
            "value_status": "available",
            "original_value": "IDN",
            "normalized_value": "IDN",
            "raw_id": raw["raw_id"],
            "source_locator": "page=1;paragraph=1",
            "transformation_run_id": "D3-RUN-STANDARDIZE-001",
            "rule_version": "iso-3166@2026-01",
        }
    ]
    bundle["translations"] = [
        {
            "translation_id": "TR-001",
            "record_id": "REC-001",
            "source_hash": text_hash,
            "source_language": "en",
            "target_language": "zh",
            "source_text": source_text,
            "translated_text": "印度尼西亚",
            "source_locator": "page=1;paragraph=1",
            "generated_at": "2026-08-04T01:01:00Z",
            "version": "1",
            "transformation_run_id": "D3-RUN-STANDARDIZE-001",
            "status": "machine_translated",
            "high_risk": False,
            "engine_or_model": "approved-engine@1",
            "glossary_version": "glossary@1",
        }
    ]
    bundle["entity_decisions"] = [
        {
            "decision_id": "ER-001",
            "record_id": "REC-001",
            "entity_type": "country",
            "method": "new_entity",
            "decision": "confirmed",
            "resolved_entity_id": "COUNTRY-IDN",
            "transformation_run_id": "D3-RUN-ENTITY-001",
            "rule_version": "entity@1",
            "evidence_ids": ["EVD-ENTITY-001"],
            "decided_at": "2026-08-04T01:02:00Z",
        }
    ]
    return bundle, d2_bundle


def _codes(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    d2_bundle: dict[str, Any],
) -> set[str]:
    return {item.code for item in validate_d3_bundle(paths, bundle, d2_bundle)}


def test_d3_templates_define_three_safe_candidate_pipelines() -> None:
    paths = discover_repository()

    bundle = build_d3_bundle_template(paths)
    rules = build_d3_rule_catalog()
    assessment = build_d3_assessment(paths)
    payloads = d3_candidate_payloads(paths)

    assert bundle["template_only"] is True
    assert bundle["append_only"] is True
    assert [item["pipeline_id"] for item in bundle["pipelines"]] == [
        item["pipeline_id"] for item in PIPELINE_DEFINITIONS
    ]
    assert all(item["preserve_source_text"] for item in bundle["pipelines"])
    assert "publication_boundary" in rules["rules"]
    assert assessment["overall_status"] == "not_ready"
    assert set(payloads) == {
        "d3_acceptance_assessment.json",
        "d3_processing_bundle.template.json",
        "d3_rule_catalog.json",
    }


def test_unfilled_d3_template_is_blocked() -> None:
    paths = discover_repository()
    bundle = build_d3_bundle_template(paths)

    codes = _codes(paths, bundle, {"raw_objects": []})

    assert {
        "D3_TEMPLATE_UNCOPIED",
        "D3_D2_DEPENDENCY_PENDING",
        "D3_PIPELINE_NOT_ENABLED",
        "D3_SUCCESSFUL_PIPELINE_RUNS_INCOMPLETE",
        "D3_D2_HEADER_INVALID",
        "D3_D2_BATCHES_INVALID",
    } <= codes


def test_completed_d3_bundle_passes() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)

    assert validate_d3_bundle(paths, bundle, d2_bundle) == []


def test_d3_header_baseline_and_pipeline_contract_are_frozen() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    bundle["schema_version"] = 2
    bundle["append_only"] = False
    bundle["baseline"] = {}
    bundle["dependencies"] = {}
    bundle["pipelines"][0]["name"] = "tampered"
    bundle["pipelines"][0]["status"] = "invented"
    bundle["pipelines"].pop()

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_HEADER_INVALID",
        "D3_APPEND_ONLY_MISSING",
        "D3_BASELINE_STALE",
        "D3_D2_DEPENDENCY_PENDING",
        "D3_PIPELINE_SET_INVALID",
        "D3_PIPELINE_INPUT_CHANGED",
        "D3_PIPELINE_STATUS_INVALID",
        "D3_PIPELINE_NOT_ENABLED",
    } <= codes


def test_pipeline_configuration_and_review_policies_cannot_be_weakened() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    pipeline = bundle["pipelines"][0]
    pipeline["config"][pipeline["required_config"][0]] = None
    pipeline["idempotency_key_template"] = None
    pipeline["preserve_source_text"] = False
    pipeline["unknown_enum_action"] = "auto_accept"

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_PIPELINE_CONFIG_INCOMPLETE",
        "D3_PIPELINE_PRESERVATION_MISSING",
        "D3_PIPELINE_REVIEW_POLICY_UNSAFE",
    } <= codes


def test_run_replay_metadata_and_safety_are_enforced() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    run = bundle["transformation_runs"][0]
    run.update(
        {
            "pipeline_id": "UNKNOWN",
            "status": "invented",
            "started_at": None,
            "parameters_sha256": "INVALID",
            "input_ids": [],
            "input_mutated": True,
            "secret_material_logged": True,
        }
    )

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_RUN_PIPELINE_UNKNOWN",
        "D3_RUN_STATUS_INVALID",
        "D3_RUN_METADATA_INCOMPLETE",
        "D3_RUN_HASH_INVALID",
        "D3_RUN_INPUT_OUTPUT_INVALID",
        "D3_RUN_MUTATED_INPUT",
        "D3_RUN_SECRET_LOGGING_UNSAFE",
        "D3_SUCCESSFUL_PIPELINE_RUNS_INCOMPLETE",
    } <= codes


def test_d2_input_must_be_closed_immutable_unique_and_hashed() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    d2_bundle["schema_version"] = 2
    d2_bundle["batches"][0]["status"] = "open"
    raw = d2_bundle["raw_objects"][0]
    raw["immutable"] = False
    raw["sha256"] = "INVALID"
    raw["source_id"] = None
    d2_bundle["raw_objects"].append(copy.deepcopy(raw))
    d2_bundle["raw_objects"].append({})

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_D2_HEADER_INVALID",
        "D3_D2_BATCH_NOT_CLOSED",
        "D3_D2_RAW_UNSAFE",
        "D3_D2_RAW_HASH_INVALID",
        "D3_D2_RAW_METADATA_INCOMPLETE",
        "D3_D2_RAW_DUPLICATE",
        "D3_D2_RAW_ENTRY_INVALID",
    } <= codes


def test_record_provenance_hash_status_and_run_lineage_are_enforced() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    record = bundle["records"][0]
    record.update(
        {
            "source_id": "TAMPERED",
            "source_text": "changed",
            "extraction_confidence": True,
            "status": "published",
            "publish_eligible": True,
        }
    )
    bundle["transformation_runs"][1]["output_ids"] = []

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_RECORD_RAW_MISMATCH",
        "D3_RECORD_TEXT_HASH_MISMATCH",
        "D3_RECORD_CONFIDENCE_INVALID",
        "D3_RECORD_STATUS_INVALID",
        "D3_RECORD_PUBLICATION_BOUNDARY_BROKEN",
        "D3_RECORD_RUN_LINEAGE_MISMATCH",
    } <= codes


def test_unknown_record_run_and_raw_coverage_are_reported() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    record = bundle["records"][0]
    record["raw_id"] = "RAW-UNKNOWN"
    record["transformation_run_ids"].append("RUN-UNKNOWN")
    d2_bundle["raw_objects"].append(
        {
            **d2_bundle["raw_objects"][0],
            "raw_id": "RAW-002",
            "sha256": "b" * 64,
        }
    )

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_RECORD_RAW_UNKNOWN",
        "D3_RECORD_RUN_UNKNOWN",
        "D3_RAW_COVERAGE_INCOMPLETE",
    } <= codes


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (
            lambda item: item.update({"target_field": "unknown.field"}),
            "D3_FIELD_TARGET_UNKNOWN",
        ),
        (
            lambda item: item.update({"value_status": "invented"}),
            "D3_VALUE_STATUS_INVALID",
        ),
        (
            lambda item: item.update({"value_status": "available", "normalized_value": None}),
            "D3_VALUE_AVAILABLE_INCOMPLETE",
        ),
        (
            lambda item: item.update({"value_status": "pending", "normalized_value": "IDN"}),
            "D3_VALUE_STATUS_CONTRADICTION",
        ),
        (
            lambda item: item.update({"normalized_unit": "MW", "conversion_factor": -1}),
            "D3_UNIT_CONVERSION_FACTOR_INVALID",
        ),
        (
            lambda item: item.update({"normalized_currency": "USD", "fx_rate": 0}),
            "D3_CURRENCY_RATE_INVALID",
        ),
        (
            lambda item: item.update({"normalized_utc": "2026-01-01T00:00:00Z"}),
            "D3_TIME_CONVERSION_INCOMPLETE",
        ),
        (
            lambda item: item.update({"raw_id": "RAW-TAMPERED"}),
            "D3_FIELD_PROVENANCE_MISMATCH",
        ),
        (
            lambda item: item.update({"transformation_run_id": "D3-RUN-PARSE-001"}),
            "D3_FIELD_RUN_INVALID",
        ),
    ],
)
def test_field_value_contracts(
    mutate: Any,
    expected: str,
) -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    mutate(bundle["field_values"][0])

    assert expected in _codes(paths, bundle, d2_bundle)


def test_enum_candidates_require_review_and_approved_codes_must_be_frozen() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    field_value = bundle["field_values"][0]
    field_value.update(
        {
            "target_field": "country.coverage_level",
            "enum_status": "approved",
            "enum_code": "invented",
        }
    )

    assert "D3_ENUM_CODE_UNKNOWN" in _codes(paths, bundle, d2_bundle)

    field_value["enum_status"] = "candidate"
    assert "D3_ENUM_REVIEW_NOT_ENFORCED" in _codes(paths, bundle, d2_bundle)


def test_field_and_entity_presence_are_required_per_record() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    bundle["field_values"] = []
    bundle["entity_decisions"] = []

    codes = _codes(paths, bundle, d2_bundle)

    assert {"D3_RECORD_FIELDS_MISSING", "D3_ENTITY_DECISION_MISSING"} <= codes


def test_translation_source_risk_engine_review_and_run_are_checked() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    translation = bundle["translations"][0]
    translation.update(
        {
            "source_hash": "b" * 64,
            "source_text": "tampered",
            "high_risk": True,
            "engine_or_model": None,
            "transformation_run_id": "D3-RUN-ENTITY-001",
        }
    )

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_TRANSLATION_STALE_NOT_ENFORCED",
        "D3_TRANSLATION_SOURCE_MISMATCH",
        "D3_TRANSLATION_HIGH_RISK_UNREVIEWED",
        "D3_TRANSLATION_ENGINE_INCOMPLETE",
        "D3_TRANSLATION_RUN_INVALID",
    } <= codes

    translation.update(
        {
            "status": "human_reviewed",
            "source_hash": bundle["records"][0]["source_text_sha256"],
            "source_text": bundle["records"][0]["source_text"],
            "transformation_run_id": "D3-RUN-STANDARDIZE-001",
        }
    )
    assert "D3_TRANSLATION_REVIEW_INCOMPLETE" in _codes(paths, bundle, d2_bundle)


def test_non_chinese_record_requires_translation() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    bundle["translations"] = []

    assert "D3_TRANSLATION_MISSING" in _codes(paths, bundle, d2_bundle)


def test_entity_resolution_requires_replayable_confirmed_evidence() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    decision = bundle["entity_decisions"][0]
    decision.update(
        {
            "entity_type": None,
            "resolved_entity_id": None,
            "evidence_ids": [],
            "transformation_run_id": "D3-RUN-STANDARDIZE-001",
        }
    )

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_ENTITY_RUN_INVALID",
        "D3_ENTITY_METADATA_INCOMPLETE",
        "D3_ENTITY_CONFIRMATION_INCOMPLETE",
        "D3_ENTITY_EVIDENCE_MISSING",
    } <= codes


def test_fuzzy_entity_resolution_requires_preview_review_evidence_and_reversal() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    decision = bundle["entity_decisions"][0]
    decision.update(
        {
            "method": "fuzzy",
            "preview_generated": False,
            "reversible": False,
            "reviewer": None,
            "preview_sha256": "INVALID",
            "reversal_plan": None,
        }
    )

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_FUZZY_PREVIEW_OR_REVERSAL_MISSING",
        "D3_FUZZY_REVIEW_INCOMPLETE",
        "D3_FUZZY_PREVIEW_HASH_INVALID",
    } <= codes


def test_pending_fuzzy_resolution_keeps_record_in_review() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    bundle["entity_decisions"][0].update(
        {
            "method": "fuzzy",
            "decision": "pending",
            "preview_generated": True,
            "reversible": True,
        }
    )

    assert "D3_FUZZY_REVIEW_NOT_ENFORCED" in _codes(paths, bundle, d2_bundle)


def test_deterministic_entity_resolution_requires_key_and_rule() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    bundle["entity_decisions"][0]["method"] = "deterministic"

    assert "D3_DETERMINISTIC_KEY_MISSING" in _codes(paths, bundle, d2_bundle)


def test_conflicts_preserve_both_evidence_sides_and_force_review() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    bundle["conflicts"] = [
        {
            "conflict_id": "CONFLICT-001",
            "record_id": "REC-001",
            "status": "open",
            "evidence": [{"evidence_id": "EVD-1"}],
            "majority_vote_auto_resolution": True,
        }
    ]

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_CONFLICT_EVIDENCE_INCOMPLETE",
        "D3_CONFLICT_AUTO_OVERWRITE_UNSAFE",
        "D3_CONFLICT_REVIEW_NOT_ENFORCED",
    } <= codes


def test_conflict_evidence_metadata_and_resolution_are_complete() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    bundle["conflicts"] = [
        {
            "conflict_id": "CONFLICT-001",
            "record_id": "REC-001",
            "status": "resolved",
            "evidence": [{}, {}],
            "majority_vote_auto_resolution": False,
        }
    ]

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_CONFLICT_EVIDENCE_METADATA_INCOMPLETE",
        "D3_CONFLICT_RESOLUTION_INCOMPLETE",
    } <= codes


def test_merge_preview_history_reversal_and_execution_audit_are_required() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    bundle["merge_actions"] = [
        {
            "merge_id": "MERGE-001",
            "status": "executed",
            "entity_type": "partner",
            "survivor_id": "PARTNER-001",
            "merged_ids": ["PARTNER-002"],
            "history_id_map": {},
            "preview_sha256": "INVALID",
            "reviewer": "数据质量负责人",
            "approved_at": "2026-08-04T02:00:00Z",
            "reversal_plan": "restore aliases and versions",
            "reversible": False,
        }
    ]

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_MERGE_PREVIEW_HASH_INVALID",
        "D3_MERGE_HISTORY_MAP_INCOMPLETE",
        "D3_MERGE_NOT_REVERSIBLE",
        "D3_MERGE_EXECUTION_AUDIT_MISSING",
    } <= codes


def test_invalid_sections_entries_and_duplicates_are_reported() -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    bundle["conflicts"] = {}
    bundle["merge_actions"] = [{}, {"merge_id": "M-1"}, {"merge_id": "M-1"}]

    codes = _codes(paths, bundle, d2_bundle)

    assert {
        "D3_SECTION_INVALID",
        "D3_ENTRY_INVALID",
        "D3_ENTRY_DUPLICATE",
    } <= codes


def test_write_d3_candidates_is_deterministic(tmp_path: Path) -> None:
    paths = discover_repository()
    local_paths = replace(paths, d3_candidates_dir=tmp_path / "d3")

    written = write_d3_candidates(local_paths)
    first = {item.name: item.read_bytes() for item in written}
    written_again = write_d3_candidates(local_paths)

    assert len(written) == 3
    assert first == {item.name: item.read_bytes() for item in written_again}


def test_load_and_validate_d3_bundle_handles_valid_and_invalid_files(
    tmp_path: Path,
) -> None:
    paths = discover_repository()
    bundle, d2_bundle = _completed_d3_payloads(paths)
    bundle_path = tmp_path / "d3.json"
    d2_path = tmp_path / "d2.json"
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
    d2_path.write_text(json.dumps(d2_bundle), encoding="utf-8")

    assert load_and_validate_d3_bundle(paths, bundle_path, d2_path) == []

    bundle_path.write_text("{", encoding="utf-8")
    checks = load_and_validate_d3_bundle(paths, bundle_path, d2_path)
    assert checks[0].code == "D3_ARTIFACT_INVALID"

    bundle_path.write_text("[]", encoding="utf-8")
    checks = load_and_validate_d3_bundle(paths, bundle_path, d2_path)
    assert checks[0].code == "D3_ARTIFACT_INVALID"
