from __future__ import annotations

import copy
import json
from collections import Counter
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from navigator_data_readiness.d4_acceptance import (
    APPROVAL_ROLES,
    COUNTRIES,
    DIMENSIONS,
    DOMAIN_TARGETS,
    HANDOVER_ITEMS,
    REHEARSALS,
    SEED_ARTIFACT_TYPES,
    build_d4_assessment,
    build_d4_bundle_template,
    build_d4_scorecard,
    build_sampling_plan,
    d4_candidate_payloads,
    load_and_validate_d4_bundle,
    validate_d4_bundle,
    write_d4_candidates,
)
from navigator_data_readiness.paths import RepositoryPaths, discover_repository


def _completed_d4_payloads(
    paths: RepositoryPaths,
) -> tuple[dict[str, Any], dict[str, Any]]:
    bundle = build_d4_bundle_template(paths)
    bundle["template_only"] = False
    bundle["dependencies"] = {
        "d3_gate_status": "approved",
        "d3_gate_evidence_id": "EVD-D3-FINAL",
    }
    d3_bundle: dict[str, Any] = {
        "schema_version": 1,
        "stage": "D3",
        "template_only": False,
        "dependencies": {
            "d2_gate_status": "approved",
            "d2_gate_evidence_id": "EVD-D2-FINAL",
        },
        "records": [],
    }

    source_ids: dict[str, list[str]] = {}
    for country in COUNTRIES:
        target = DOMAIN_TARGETS["ACTIVE_SOURCE"][0 if country == "IDN" else 1]
        source_ids[country] = []
        for source_index in range(1, target + 1):
            source_id = f"SRC-{country}-{source_index:03d}"
            source_ids[country].append(source_id)
            bundle["production_sources"].append(
                {
                    "source_id": source_id,
                    "country": country,
                    "status": "active",
                    "license_status": "approved",
                    "terms_snapshot_sha256": f"{source_index:064x}",
                    "license_snapshot_sha256": f"{source_index + 100:064x}",
                    "storage_allowed": True,
                    "display_allowed": True,
                    "export_allowed": True,
                    "ai_use_allowed": True,
                    "permission_metadata_complete": True,
                    "owner": "来源管理员",
                    "reviewer": "合规复核员",
                    "reviewed_at": "2026-08-10T09:00:00+08:00",
                    "evidence_ids": [f"EVD-SOURCE-{source_id}"],
                }
            )

    publication_counter = 0
    rag_publications: list[dict[str, Any]] = []
    for country in COUNTRIES:
        for domain, targets in DOMAIN_TARGETS.items():
            if domain == "ACTIVE_SOURCE":
                continue
            target = targets[0 if country == "IDN" else 1]
            for domain_index in range(1, target + 1):
                publication_counter += 1
                record_id = f"REC-{publication_counter:05d}"
                publication_id = f"PUB-{publication_counter:05d}"
                source_id = source_ids[country][(domain_index - 1) % len(source_ids[country])]
                raw_id = f"RAW-{publication_counter:05d}"
                locator = f"page={domain_index};paragraph=1"
                source_hash = f"{publication_counter + 1000:064x}"
                d3_bundle["records"].append(
                    {
                        "record_id": record_id,
                        "status": "candidate",
                        "country": country,
                        "source_id": source_id,
                        "raw_id": raw_id,
                        "source_locator": locator,
                        "source_snapshot_sha256": source_hash,
                    }
                )
                publication = {
                    "publication_id": publication_id,
                    "record_id": record_id,
                    "country": country,
                    "domain": domain,
                    "source_id": source_id,
                    "raw_id": raw_id,
                    "source_snapshot_sha256": source_hash,
                    "source_locator": locator,
                    "data_version": "seed-1.0.0",
                    "review_version": "review-1.0.0",
                    "editor": "数据编辑",
                    "reviewer": "独立审核员",
                    "second_reviewer": None,
                    "reviewed_at": "2026-08-11T09:00:00+08:00",
                    "published_at": "2026-08-11T10:00:00+08:00",
                    "status": "published",
                    "quality_gate_passed": True,
                    "freshness_status": "current",
                    "traceability_complete": True,
                    "high_risk": False,
                    "p0_issue_open": False,
                    "transformation_run_ids": [
                        "D3-RUN-PARSE",
                        "D3-RUN-STANDARDIZE",
                        "D3-RUN-ENTITY",
                    ],
                    "evidence_ids": [f"EVD-{publication_id}"],
                }
                bundle["publication_records"].append(publication)
                if domain == "RAG_DOCUMENT":
                    rag_publications.append(publication)

    bundle["publication_records"][0]["high_risk"] = True
    bundle["publication_records"][0]["second_reviewer"] = "高风险复核员"

    source_counts = Counter(item["country"] for item in bundle["production_sources"])
    publication_counts = Counter(
        (item["country"], item["domain"]) for item in bundle["publication_records"]
    )
    for item in bundle["domain_coverage"]:
        item["actual_count"] = (
            source_counts[item["country"]]
            if item["domain"] == "ACTIVE_SOURCE"
            else publication_counts[(item["country"], item["domain"])]
        )
        item["evidence_ids"] = [f"EVD-{item['coverage_id']}"]
    for item in bundle["country_coverage"]:
        item["applicable_core_fields"] = 100
        item["available_valid_fields"] = 90 if item["country"] == "IDN" else 70
        item["actual_pct"] = float(item["available_valid_fields"])
        item["evidence_ids"] = [f"EVD-CORE-{item['country']}"]

    sampled_total = 0
    correct_total = 0
    high_risk_total = 0
    high_risk_correct = 0
    for index, sample in enumerate(bundle["sampling_reviews"], start=1):
        country = sample["country"]
        scope = sample["scope"]
        if scope == "COUNTRY_CORE":
            population = 100
        elif scope == "POLICY":
            population = publication_counts[(country, "POLICY")]
        elif scope == "PROJECT_TENDER":
            population = (
                publication_counts[(country, "PROJECT")] + publication_counts[(country, "TENDER")]
            )
        elif scope == "PARTNER":
            population = publication_counts[(country, "PARTNER")]
        elif scope == "RAG_DOCUMENT":
            population = publication_counts[(country, "RAG_DOCUMENT")]
        else:
            population = 1
        minimum = sample["minimum_sample"]
        sampled = population if sample["full_population_review"] else int(minimum)
        sample.update(
            {
                "population_count": population,
                "sampled_count": sampled,
                "correct_count": sampled,
                "status": "completed",
                "reviewer_one": "抽样复核员A",
                "reviewer_two": "抽样复核员B",
                "sample_manifest_sha256": f"{index + 2000:064x}",
                "evidence_ids": [f"EVD-{sample['sample_id']}"],
            }
        )
        sampled_total += sampled
        correct_total += sampled
        if scope == "HIGH_RISK_CONFLICT_MERGE":
            high_risk_total = sampled
            high_risk_correct = sampled

    for item in bundle["dimension_scores"]:
        item.update(
            {
                "score": item["weight"],
                "metric_version": "D4-METRIC@1.0.0",
                "calculation_note": "按冻结分子分母和证据计算",
                "reviewer": "数据质量负责人",
                "reviewed_at": "2026-08-12T09:00:00+08:00",
                "evidence_ids": [f"EVD-{item['dimension_code']}"],
            }
        )

    publication_count = len(bundle["publication_records"])
    source_count = len(bundle["production_sources"])
    bundle["hard_gate_metrics"] = {
        "published_key_facts": publication_count,
        "traceable_key_facts": publication_count,
        "production_sources": source_count,
        "licensed_production_sources": source_count,
        "sampled_fields": sampled_total,
        "correct_sampled_fields": correct_total,
        "high_risk_sampled": high_risk_total,
        "high_risk_correct": high_risk_correct,
        "effective_records": publication_count,
        "duplicate_effective_records": 0,
        "required_enum_checks": publication_count,
        "passed_required_enum_checks": publication_count,
        "open_p0_issues": 0,
        "revoked_source_index_residuals": 0,
        "permission_leaks": 0,
    }
    bundle["seed_package"] = {
        "data_version": "seed-1.0.0",
        "schema_version": "V1.0-BASELINE",
        "record_count": publication_count,
        "manifest_sha256": "a" * 64,
        "artifacts": [
            {
                "artifact_type": artifact_type,
                "path": f"secure-handover/{artifact_type}",
                "version": "1.0.0",
                "sha256": f"{index + 3000:064x}",
                "contains_plaintext_secrets": False,
            }
            for index, artifact_type in enumerate(sorted(SEED_ARTIFACT_TYPES), start=1)
        ],
    }
    bundle["rag_candidates"] = [
        {
            "knowledge_id": f"KNOW-{index:04d}",
            "publication_id": publication["publication_id"],
            "source_id": publication["source_id"],
            "country": publication["country"],
            "version": "1.0.0",
            "status": "eligible",
            "permission_metadata_complete": True,
            "citation_locator_complete": True,
            "revocation_supported": True,
            "index_eligible": True,
            "revocation_test_id": "D4-DRILL-SOURCE-REVOKE",
        }
        for index, publication in enumerate(rag_publications, start=1)
    ]
    for index, rehearsal in enumerate(bundle["rehearsals"], start=1):
        rehearsal.update(
            {
                "status": "passed",
                "run_id": f"D4-RUN-{index:03d}",
                "code_version": "navigator-data@0.1.0",
                "input_sha256": f"{index + 4000:064x}",
                "output_sha256": f"{index + 5000:064x}",
                "isolated_environment": True,
                "operator": "演练执行人",
                "reviewer": "演练复核人",
                "executed_at": "2026-08-13T09:00:00+08:00",
                "history_preserved": True,
                "residual_count": 0,
                "evidence_ids": [f"EVD-{rehearsal['rehearsal_id']}"],
            }
        )
    for index, item in enumerate(bundle["handover_items"], start=1):
        item.update(
            {
                "status": "accepted",
                "artifact_sha256": f"{index + 6000:064x}",
                "owner": "交付负责人",
                "reviewer": "独立签收人",
                "reviewed_at": "2026-08-14T09:00:00+08:00",
                "evidence_ids": [f"EVD-{item['handover_id']}"],
            }
        )
    bundle["acceptance"] = {
        "tasks": [
            {
                "task_id": task_id,
                "status": "completed",
                "evidence_ids": [f"EVD-{task_id}"],
            }
            for task_id in ("D4-01", "D4-02", "D4-03", "D4-04")
        ],
        "reported_total_score": 100,
        "decision": "approved",
        "committee_approvals": [
            {
                "role": role,
                "person_name": f"{role}姓名",
                "decision": "approved",
                "signed_at": "2026-08-15T09:00:00+08:00",
                "evidence_id": f"EVD-APPROVAL-{index:02d}",
            }
            for index, role in enumerate(sorted(APPROVAL_ROLES), start=1)
        ],
        "signed_at": "2026-08-15T10:00:00+08:00",
        "d4_gate_evidence_id": "EVD-D4-FINAL",
    }
    return bundle, d3_bundle


def _codes(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    d3_bundle: dict[str, Any],
) -> set[str]:
    return {item.code for item in validate_d4_bundle(paths, bundle, d3_bundle)}


def test_d4_templates_freeze_score_sampling_domains_and_handover() -> None:
    paths = discover_repository()

    bundle = build_d4_bundle_template(paths)
    scorecard = build_d4_scorecard()
    assessment = build_d4_assessment(paths)
    payloads = d4_candidate_payloads(paths)

    assert len(bundle["dimension_scores"]) == len(DIMENSIONS) == 7
    assert len(bundle["sampling_reviews"]) == len(build_sampling_plan()) == 26
    assert len(bundle["domain_coverage"]) == len(COUNTRIES) * len(DOMAIN_TARGETS)
    assert len(bundle["rehearsals"]) == len(REHEARSALS)
    assert len(bundle["handover_items"]) == len(HANDOVER_ITEMS)
    assert scorecard["overall_minimum"] == 85
    assert assessment["overall_status"] == "not_ready"
    assert set(payloads) == {
        "d4_acceptance_assessment.json",
        "d4_acceptance_bundle.template.json",
        "d4_sampling_plan.json",
        "d4_scorecard.json",
    }


def test_unfilled_d4_template_is_blocked() -> None:
    paths = discover_repository()
    bundle = build_d4_bundle_template(paths)

    codes = _codes(paths, bundle, {"records": []})

    assert {
        "D4_TEMPLATE_UNCOPIED",
        "D4_D3_DEPENDENCY_PENDING",
        "D4_D3_HEADER_INVALID",
        "D4_D3_TEMPLATE_UNCOMPLETED",
        "D4_TOTAL_SCORE_BELOW_MINIMUM",
        "D4_COUNTRY_COVERAGE_INVALID",
        "D4_DOMAIN_COVERAGE_BELOW_TARGET",
        "D4_SAMPLING_RESULT_INVALID",
        "D4_SEED_PACKAGE_INCOMPLETE",
        "D4_FINAL_DECISION_NOT_APPROVED",
    } <= codes


def test_completed_d4_acceptance_bundle_passes() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)

    assert validate_d4_bundle(paths, bundle, d3_bundle) == []


def test_header_dependency_and_d3_lineage_cannot_be_bypassed() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    bundle.update(
        {
            "schema_version": 2,
            "append_only": False,
            "baseline": {},
            "dependencies": {},
        }
    )
    d3_bundle.update(
        {
            "schema_version": 2,
            "template_only": True,
            "dependencies": {},
        }
    )

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_HEADER_INVALID",
        "D4_APPEND_ONLY_MISSING",
        "D4_BASELINE_STALE",
        "D4_D3_DEPENDENCY_PENDING",
        "D4_D3_HEADER_INVALID",
        "D4_D3_TEMPLATE_UNCOMPLETED",
        "D4_D3_D2_LINEAGE_INCOMPLETE",
    } <= codes


def test_source_admission_and_usage_boundaries_are_rechecked() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    source = bundle["production_sources"][0]
    source.update(
        {
            "status": "under_review",
            "license_status": "pending",
            "ai_use_allowed": False,
            "terms_snapshot_sha256": "INVALID",
            "reviewer": source["owner"],
            "evidence_ids": [],
        }
    )

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_SOURCE_NOT_ACTIVE",
        "D4_SOURCE_USAGE_BOUNDARY_INCOMPLETE",
        "D4_SOURCE_SNAPSHOT_HASH_INVALID",
        "D4_SOURCE_REVIEW_NOT_SEPARATED",
        "D4_SOURCE_EVIDENCE_MISSING",
        "D4_LICENSE_HARD_GATE_FAILED",
    } <= codes


def test_publication_requires_unchanged_candidate_source_quality_and_review() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    publication = bundle["publication_records"][0]
    publication.update(
        {
            "source_locator": "tampered",
            "status": "draft",
            "quality_gate_passed": False,
            "freshness_status": "overdue",
            "traceability_complete": False,
            "reviewer": publication["editor"],
            "second_reviewer": publication["editor"],
            "p0_issue_open": True,
            "evidence_ids": [],
        }
    )

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_PUBLICATION_D3_LINEAGE_MISMATCH",
        "D4_PUBLICATION_GATE_NOT_PASSED",
        "D4_PUBLICATION_FRESHNESS_INVALID",
        "D4_PUBLICATION_TRACEABILITY_INCOMPLETE",
        "D4_PUBLICATION_REVIEW_NOT_SEPARATED",
        "D4_PUBLICATION_SECOND_REVIEW_MISSING",
        "D4_PUBLICATION_P0_OPEN",
        "D4_PUBLICATION_EVIDENCE_INCOMPLETE",
        "D4_TRACEABILITY_HARD_GATE_FAILED",
    } <= codes


def test_quality_issue_states_p0_resolution_and_waivers_are_auditable() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    bundle["quality_issues"] = [
        {
            "issue_id": "ISSUE-P0",
            "severity": "P0",
            "status": "open",
        },
        {
            "issue_id": "ISSUE-P2",
            "severity": "P2",
            "status": "waived",
        },
    ]
    bundle["hard_gate_metrics"]["open_p0_issues"] = 1

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_ISSUE_METADATA_INCOMPLETE",
        "D4_P0_ISSUE_OPEN",
        "D4_P0_RESOLUTION_INCOMPLETE",
        "D4_P0_EVIDENCE_MISSING",
        "D4_WAIVER_INCOMPLETE",
        "D4_P0_HARD_GATE_FAILED",
    } <= codes


def test_score_dimensions_are_exact_evidenced_and_above_thresholds() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    dimension = bundle["dimension_scores"][0]
    dimension.update(
        {
            "name": "tampered",
            "weight": 99,
            "score": 5,
            "metric_version": None,
            "evidence_ids": [],
        }
    )
    bundle["dimension_scores"][1]["score"] = 0

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_DIMENSION_INPUT_CHANGED",
        "D4_DIMENSION_BELOW_MINIMUM",
        "D4_DIMENSION_EVIDENCE_INCOMPLETE",
        "D4_TOTAL_SCORE_BELOW_MINIMUM",
        "D4_ACCEPTANCE_SCORE_MISMATCH",
    } <= codes


def test_country_coverage_counts_targets_and_evidence_are_verified() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    coverage = bundle["country_coverage"][0]
    coverage.update(
        {
            "minimum_pct": 50,
            "available_valid_fields": 60,
            "actual_pct": 99,
            "evidence_ids": [],
        }
    )

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_COUNTRY_TARGET_CHANGED",
        "D4_COUNTRY_COVERAGE_MISMATCH",
        "D4_COUNTRY_COVERAGE_BELOW_TARGET",
        "D4_COUNTRY_COVERAGE_EVIDENCE_MISSING",
    } <= codes


def test_domain_coverage_reconciles_with_source_and_publication_manifests() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    coverage = bundle["domain_coverage"][0]
    coverage.update(
        {
            "country": "BRA",
            "minimum_target": 0,
            "actual_count": 999,
            "evidence_ids": [],
        }
    )
    bundle["production_sources"].pop()

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_DOMAIN_TARGET_CHANGED",
        "D4_DOMAIN_COUNT_MISMATCH",
        "D4_DOMAIN_COVERAGE_BELOW_TARGET",
        "D4_DOMAIN_COVERAGE_EVIDENCE_MISSING",
    } <= codes


def test_sampling_requires_full_review_minimums_accuracy_and_independence() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    core_idn = next(
        item for item in bundle["sampling_reviews"] if item["sample_id"] == "D4-SAMPLE-CORE-IDN"
    )
    core_idn.update(
        {
            "sampled_count": 50,
            "correct_count": 0,
            "reviewer_two": core_idn["reviewer_one"],
            "sample_manifest_sha256": "INVALID",
            "evidence_ids": [],
        }
    )
    high_risk = bundle["sampling_reviews"][-1]
    high_risk["correct_count"] = 0
    bundle["hard_gate_metrics"].update(
        {
            "sampled_fields": bundle["hard_gate_metrics"]["sampled_fields"] - 50,
            "correct_sampled_fields": (bundle["hard_gate_metrics"]["correct_sampled_fields"] - 101),
            "high_risk_correct": 0,
        }
    )

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_SAMPLING_FULL_REVIEW_INCOMPLETE",
        "D4_SAMPLING_REVIEWERS_INVALID",
        "D4_SAMPLING_EVIDENCE_INCOMPLETE",
        "D4_HIGH_RISK_ACCURACY_FAILED",
        "D4_SAMPLE_ACCURACY_BELOW_TARGET",
    } <= codes


def test_hard_gate_metrics_reject_duplicates_validation_residuals_and_leaks() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    metrics = bundle["hard_gate_metrics"]
    metrics.update(
        {
            "published_key_facts": 1,
            "duplicate_effective_records": metrics["effective_records"],
            "passed_required_enum_checks": 0,
            "revoked_source_index_residuals": 1,
            "permission_leaks": 1,
        }
    )

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_HARD_GATE_METRIC_MISMATCH",
        "D4_REQUIRED_ENUM_HARD_GATE_FAILED",
        "D4_DUPLICATE_RATE_HARD_GATE_FAILED",
        "D4_REVOKED_SOURCE_RESIDUAL_HARD_GATE_FAILED",
        "D4_PERMISSION_LEAK_HARD_GATE_FAILED",
    } <= codes


def test_seed_package_requires_complete_safe_hashed_artifacts() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    seed = bundle["seed_package"]
    seed["record_count"] = 1
    seed["manifest_sha256"] = "INVALID"
    seed["artifacts"].pop()
    seed["artifacts"][0].update(
        {
            "path": None,
            "sha256": "INVALID",
            "contains_plaintext_secrets": True,
        }
    )

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_SEED_MANIFEST_INVALID",
        "D4_SEED_ARTIFACT_SET_INVALID",
        "D4_SEED_ARTIFACT_METADATA_INCOMPLETE",
        "D4_SEED_ARTIFACT_UNSAFE",
    } <= codes


def test_rag_candidates_require_published_ai_allowed_revocable_sources() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    candidate = bundle["rag_candidates"][0]
    candidate.update(
        {
            "publication_id": "PUB-UNKNOWN",
            "status": "revoked",
            "permission_metadata_complete": False,
            "revocation_test_id": None,
        }
    )
    source = next(
        item for item in bundle["production_sources"] if item["source_id"] == candidate["source_id"]
    )
    source["ai_use_allowed"] = False

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_RAG_PUBLICATION_INVALID",
        "D4_RAG_SOURCE_NOT_ALLOWED",
        "D4_RAG_ELIGIBILITY_INCOMPLETE",
        "D4_RAG_METADATA_INCOMPLETE",
    } <= codes


def test_rehearsals_require_isolation_separation_hashes_history_and_zero_residual() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    rehearsal = next(
        item for item in bundle["rehearsals"] if item["rehearsal_id"] == "D4-DRILL-SOURCE-REVOKE"
    )
    rehearsal.update(
        {
            "status": "failed",
            "isolated_environment": False,
            "reviewer": rehearsal["operator"],
            "input_sha256": "INVALID",
            "history_preserved": False,
            "residual_count": 1,
            "evidence_ids": [],
        }
    )

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_REHEARSAL_NOT_PASSED",
        "D4_REHEARSAL_REVIEW_NOT_SEPARATED",
        "D4_REHEARSAL_EVIDENCE_INCOMPLETE",
        "D4_REHEARSAL_HISTORY_NOT_PRESERVED",
        "D4_REVOKE_REHEARSAL_RESIDUAL",
    } <= codes


def test_handover_requires_all_independently_accepted_artifacts() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    handover = bundle["handover_items"][0]
    handover.update(
        {
            "name": "tampered",
            "status": "pending",
            "artifact_sha256": "INVALID",
            "reviewer": handover["owner"],
            "evidence_ids": [],
        }
    )

    codes = _codes(paths, bundle, d3_bundle)

    assert {"D4_HANDOVER_INPUT_CHANGED", "D4_HANDOVER_NOT_ACCEPTED"} <= codes


def test_final_acceptance_requires_tasks_score_roles_approvals_and_signature() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    acceptance = bundle["acceptance"]
    acceptance["tasks"][0]["status"] = "pending"
    acceptance["reported_total_score"] = 99
    acceptance["committee_approvals"].pop()
    acceptance["committee_approvals"][0]["decision"] = "rejected"
    acceptance["signed_at"] = None
    acceptance["d4_gate_evidence_id"] = None
    acceptance["decision"] = "pending"

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_ACCEPTANCE_TASKS_INCOMPLETE",
        "D4_ACCEPTANCE_SCORE_MISMATCH",
        "D4_APPROVAL_ROLE_SET_INVALID",
        "D4_APPROVAL_NOT_APPROVED",
        "D4_FINAL_SIGNOFF_INCOMPLETE",
        "D4_FINAL_DECISION_NOT_APPROVED",
    } <= codes


def test_invalid_sections_entries_and_duplicates_are_reported() -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    bundle["quality_issues"] = {}
    bundle["handover_items"] = [
        {},
        copy.deepcopy(bundle["handover_items"][0]),
        copy.deepcopy(bundle["handover_items"][0]),
    ]

    codes = _codes(paths, bundle, d3_bundle)

    assert {
        "D4_SECTION_INVALID",
        "D4_ENTRY_INVALID",
        "D4_ENTRY_DUPLICATE",
        "D4_HANDOVER_SET_INVALID",
    } <= codes


def test_write_d4_candidates_is_deterministic(tmp_path: Path) -> None:
    paths = discover_repository()
    local_paths = replace(paths, d4_candidates_dir=tmp_path / "d4")

    written = write_d4_candidates(local_paths)
    first = {item.name: item.read_bytes() for item in written}
    written_again = write_d4_candidates(local_paths)

    assert len(written) == 4
    assert first == {item.name: item.read_bytes() for item in written_again}


def test_load_and_validate_d4_bundle_handles_valid_and_invalid_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    bundle_path = tmp_path / "d4.json"
    d3_path = tmp_path / "d3.json"
    d2_path = tmp_path / "d2.json"
    registry_path = tmp_path / "d1_registry.json"
    matrix_path = tmp_path / "d1_matrix.json"
    evidence_path = tmp_path / "d1_evidence.json"
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
    d3_path.write_text(json.dumps(d3_bundle), encoding="utf-8")
    d2_path.write_text("{}", encoding="utf-8")
    registry_path.write_text("{}", encoding="utf-8")
    matrix_path.write_text("{}", encoding="utf-8")
    evidence_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        "navigator_data_readiness.d4_acceptance.load_and_validate_d3_bundle",
        lambda *_args: [],
    )

    assert (
        load_and_validate_d4_bundle(
            paths,
            bundle_path,
            d3_path,
            d2_path,
            registry_path,
            matrix_path,
            evidence_path,
        )
        == []
    )

    bundle_path.write_text("{", encoding="utf-8")
    checks = load_and_validate_d4_bundle(
        paths,
        bundle_path,
        d3_path,
        d2_path,
        registry_path,
        matrix_path,
        evidence_path,
    )
    assert checks[0].code == "D4_ARTIFACT_INVALID"

    bundle_path.write_text("[]", encoding="utf-8")
    checks = load_and_validate_d4_bundle(
        paths,
        bundle_path,
        d3_path,
        d2_path,
        registry_path,
        matrix_path,
        evidence_path,
    )
    assert checks[0].code == "D4_ARTIFACT_INVALID"


def test_load_d4_rejects_bundle_when_full_d3_chain_is_invalid(tmp_path: Path) -> None:
    paths = discover_repository()
    bundle, d3_bundle = _completed_d4_payloads(paths)
    bundle_path = tmp_path / "d4.json"
    d3_path = tmp_path / "d3.json"
    d2_path = tmp_path / "d2.json"
    registry_path = tmp_path / "d1_registry.json"
    matrix_path = tmp_path / "d1_matrix.json"
    evidence_path = tmp_path / "d1_evidence.json"
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
    d3_path.write_text(json.dumps(d3_bundle), encoding="utf-8")
    d2_path.write_text("{}", encoding="utf-8")
    registry_path.write_text("{}", encoding="utf-8")
    matrix_path.write_text("{}", encoding="utf-8")
    evidence_path.write_text("{}", encoding="utf-8")

    checks = load_and_validate_d4_bundle(
        paths,
        bundle_path,
        d3_path,
        d2_path,
        registry_path,
        matrix_path,
        evidence_path,
    )

    assert any(item.code == "D4_D3_PROCESSING_INVALID" for item in checks)
