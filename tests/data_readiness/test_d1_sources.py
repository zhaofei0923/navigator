from __future__ import annotations

import copy
import json
from collections import Counter
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from navigator_data_readiness.baseline import sha256_file
from navigator_data_readiness.d1_sources import (
    ASSIGNMENT_EVIDENCE_KIND,
    COUNTRY_SOURCE_TARGETS,
    RESEARCH_CATALOG_NAME,
    SOURCE_EVIDENCE_KINDS,
    USE_BOUNDARIES,
    build_d1_assessment,
    build_d1_evidence_manifest_template,
    build_domain_source_matrix_template,
    build_source_coverage_gap_report,
    build_source_registry_template,
    load_and_validate_d1_admission,
    load_official_source_candidates,
    validate_d1_admission,
    write_d1_candidates,
)
from navigator_data_readiness.paths import RepositoryPaths, discover_repository


def _source_evidence_id(source_id: str, evidence_kind: str) -> str:
    if evidence_kind == "terms_snapshot":
        return f"TERMS-{source_id}"
    if evidence_kind == "license_snapshot":
        return f"LICENSE-{source_id}"
    if evidence_kind == "robots_snapshot":
        return f"ROBOTS-{source_id}"
    return f"EVD-{evidence_kind.upper().replace('_', '-')}-{source_id}"


def _activate_source(item: dict[str, Any], country: str) -> None:
    evidence_ids = [
        _source_evidence_id(str(item["source_id"]), kind) for kind in sorted(SOURCE_EVIDENCE_KINDS)
    ]
    item.update(
        {
            "scope_codes": [country],
            "source_type": "official_publication",
            "languages": ["en"],
            "technical_owner": "数据工程负责人姓名",
            "data_owner_reviewer": "数据负责人姓名",
            "compliance_reviewer": "合规负责人姓名",
            "reviewed_at": "2026-08-02T09:00:00+08:00",
            "next_review_at": "2027-08-02T09:00:00+08:00",
            "terms_snapshot_id": _source_evidence_id(str(item["source_id"]), "terms_snapshot"),
            "license_snapshot_id": _source_evidence_id(str(item["source_id"]), "license_snapshot"),
            "robots_snapshot_id": _source_evidence_id(str(item["source_id"]), "robots_snapshot"),
            "attribution_requirement": "明确标注机构和来源链接",
            "retention_rule": "按许可保留；撤权触发影响评估",
            "usage_boundaries": {
                name: "prohibited" if name == "model_training" else "allowed"
                for name in USE_BOUNDARIES
            },
            "boundary_conditions": {},
            "access_policy": {
                "automation": "allowed",
                "login_required": False,
                "paid_access": False,
                "captcha_observed": False,
                "geo_restricted": False,
                "rate_limit": "遵守来源规则并使用条件请求",
                "identifiable_user_agent_required": True,
                "access_control_bypass_prohibited": True,
            },
            "approval_evidence_ids": evidence_ids,
            "status": "active",
        }
    )


def _completed_d1_payloads(paths: RepositoryPaths) -> tuple[dict[str, Any], dict[str, Any]]:
    registry = build_source_registry_template(paths)
    registry["template_only"] = False
    sources: list[dict[str, Any]] = registry["sources"]

    country_sources: dict[str, list[dict[str, Any]]] = {
        country: [item for item in sources if country in item.get("scope_codes", [])]
        for country in COUNTRY_SOURCE_TARGETS
    }
    seed = sources[0]
    for country, target in COUNTRY_SOURCE_TARGETS.items():
        for item in country_sources[country]:
            _activate_source(item, country)
        for index in range(len(country_sources[country]), target):
            item = copy.deepcopy(seed)
            item.update(
                {
                    "source_id": f"SRC-{country}-ADDED-{index + 1:02d}",
                    "organization": f"{country} Official Source {index + 1}",
                    "canonical_domain": f"source-{index + 1}.{country.lower()}.example",
                    "entry_url": f"https://source-{index + 1}.{country.lower()}.example/",
                }
            )
            _activate_source(item, country)
            sources.append(item)
            country_sources[country].append(item)

    matrix = build_domain_source_matrix_template(paths)
    matrix["template_only"] = False
    source_ids_by_country = {
        country: [str(item["source_id"]) for item in items]
        for country, items in country_sources.items()
    }
    for item in matrix["assignments"]:
        primary, alternative = source_ids_by_country[item["country"]][:2]
        item.update(
            {
                "primary_source_id": primary,
                "alternative_source_id": alternative,
                "approved_by": "数据负责人姓名",
                "approved_at": "2026-08-02T10:00:00+08:00",
                "evidence_ids": [f"EVD-MATRIX-{item['country']}-{item['domain_id']}"],
                "status": "approved",
            }
        )
    return registry, matrix


def _completed_evidence_manifest(
    paths: RepositoryPaths,
    registry: dict[str, Any],
    matrix: dict[str, Any],
) -> dict[str, Any]:
    manifest = build_d1_evidence_manifest_template(paths)
    manifest["template_only"] = False
    evidence_path = paths.d1_evidence_dir / "research_catalog_baseline.json"
    evidence_hash = sha256_file(evidence_path)
    entries: list[dict[str, Any]] = []
    for source in registry["sources"]:
        source_id = str(source["source_id"])
        for evidence_kind in sorted(SOURCE_EVIDENCE_KINDS):
            entries.append(
                {
                    "evidence_id": _source_evidence_id(source_id, evidence_kind),
                    "evidence_kind": evidence_kind,
                    "path": "data/d1/evidence/research_catalog_baseline.json",
                    "sha256": evidence_hash,
                    "reviewer": "实际复核人",
                    "reviewed_at": "2026-08-02T11:00:00+08:00",
                    "status": "approved",
                    "source_ids": [source_id],
                    "assignment_keys": [],
                }
            )
    for assignment in matrix["assignments"]:
        assignment_key = f"{assignment['country']}/{assignment['domain_id']}"
        entries.append(
            {
                "evidence_id": str(assignment["evidence_ids"][0]),
                "evidence_kind": ASSIGNMENT_EVIDENCE_KIND,
                "path": "data/d1/evidence/research_catalog_baseline.json",
                "sha256": evidence_hash,
                "reviewer": "实际复核人",
                "reviewed_at": "2026-08-02T11:00:00+08:00",
                "status": "approved",
                "source_ids": [],
                "assignment_keys": [assignment_key],
            }
        )
    manifest["evidence"] = entries
    return manifest


def test_d1_templates_expose_frozen_counts_and_country_gaps() -> None:
    paths = discover_repository()

    registry = build_source_registry_template(paths)
    matrix = build_domain_source_matrix_template(paths)
    evidence = build_d1_evidence_manifest_template(paths)
    gap = build_source_coverage_gap_report(paths)
    assessment = build_d1_assessment(paths)
    gaps = {item["country"]: item for item in gap["countries"]}

    assert registry["template_only"] is True
    assert len(registry["sources"]) == 59
    assert all(item["status"] == "under_review" for item in registry["sources"])
    assert len(matrix["assignments"]) == 40
    assert evidence["template_only"] is True
    assert len(evidence["source_checklists"]) == 59
    assert len(evidence["assignment_checklists"]) == 40
    assert evidence["evidence"] == []
    assert gap["frozen_seed_source_count"] == 18
    assert gap["researched_candidate_count"] == 41
    assert gaps["IDN"]["frozen_seed_candidates"] == 2
    assert gaps["IDN"]["researched_candidates"] == 18
    assert gaps["IDN"]["candidate_sources"] == 20
    assert all(item["candidate_gap"] == 0 for item in gaps.values())
    assert all(item["active_gap"] == item["target"] for item in gaps.values())
    assert gap["regional_or_global_seed_count"] == 7
    assert assessment["overall_status"] == "not_ready"
    assert assessment["d0_dependency_ready"] is True
    threshold_check = next(
        item for item in assessment["checks"] if item["check_id"] == "D1-COUNTRY-THRESHOLDS"
    )
    assert threshold_check["status"] == "candidate_generated"


def test_official_source_research_catalog_is_bounded_and_never_activates_sources() -> None:
    paths = discover_repository()

    catalog = load_official_source_candidates(paths)
    candidates = catalog["candidates"]
    counts = Counter(str(item["country"]) for item in candidates)
    registry = build_source_registry_template(paths)
    researched_sources = [item for item in registry["sources"] if item.get("research_provenance")]

    assert len(candidates) == 41
    assert counts == Counter({"IDN": 18, "VNM": 6, "SAU": 6, "ZAF": 6, "BRA": 5})
    assert all(str(item["entry_url"]).startswith("https://") for item in candidates)
    assert len({str(item["source_id"]) for item in candidates}) == 41
    assert len(researched_sources) == 41
    assert all(item["status"] == "under_review" for item in researched_sources)
    assert all(set(item["usage_boundaries"].values()) == {"pending"} for item in researched_sources)
    assert all(item["access_policy"]["automation"] == "pending" for item in researched_sources)


def _write_research_catalog(
    tmp_path: Path,
    payload: Any,
) -> Path:
    research_dir = tmp_path / "research"
    research_dir.mkdir(parents=True)
    (research_dir / RESEARCH_CATALOG_NAME).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )
    return research_dir


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda payload: [], "root must be an object"),
        (
            lambda payload: {**payload, "schema_version": 2},
            "requires schema_version 1",
        ),
        (
            lambda payload: {**payload, "warning": ""},
            "requires warning",
        ),
        (
            lambda payload: {**payload, "candidates": "invalid"},
            "candidates must be a list",
        ),
        (
            lambda payload: {**payload, "candidates": [None]},
            "candidate 0 must be an object",
        ),
        (
            lambda payload: {
                **payload,
                "candidates": [{**payload["candidates"][0], "organization": ""}],
            },
            "missing required fields",
        ),
        (
            lambda payload: {
                **payload,
                "candidates": [payload["candidates"][0], payload["candidates"][0]],
            },
            "Duplicate D1 research source_id",
        ),
        (
            lambda payload: {
                **payload,
                "candidates": [{**payload["candidates"][0], "country": "USA"}],
            },
            "unsupported country",
        ),
        (
            lambda payload: {
                **payload,
                "candidates": [{**payload["candidates"][0], "entry_url": "http://example.com/"}],
            },
            "requires an HTTPS",
        ),
        (
            lambda payload: {
                **payload,
                "candidates": [{**payload["candidates"][0], "authority_level": "C"}],
            },
            "authority_level must be A or B",
        ),
        (
            lambda payload: {
                **payload,
                "candidates": [{**payload["candidates"][0], "languages": []}],
            },
            "requires one or more research languages",
        ),
        (
            lambda payload: {
                **payload,
                "candidates": [{**payload["candidates"][0], "research_status": "verified"}],
            },
            "research_status must remain",
        ),
        (
            lambda payload: {
                **payload,
                "candidates": [{**payload["candidates"][0], "status": "active"}],
            },
            "cannot mark a source active",
        ),
    ],
)
def test_invalid_research_catalogs_are_rejected(
    tmp_path: Path,
    mutation: Any,
    message: str,
) -> None:
    source_paths = discover_repository()
    payload = load_official_source_candidates(source_paths)
    research_dir = _write_research_catalog(tmp_path, mutation(copy.deepcopy(payload)))
    paths = replace(source_paths, d1_research_dir=research_dir)

    with pytest.raises(ValueError, match=message):
        load_official_source_candidates(paths)


def test_missing_malformed_overlapping_and_incomplete_research_catalogs_are_rejected(
    tmp_path: Path,
) -> None:
    source_paths = discover_repository()
    missing_paths = replace(source_paths, d1_research_dir=tmp_path / "missing")
    with pytest.raises(ValueError, match="Cannot read"):
        load_official_source_candidates(missing_paths)

    malformed_dir = tmp_path / "malformed"
    malformed_dir.mkdir()
    (malformed_dir / RESEARCH_CATALOG_NAME).write_text("{", encoding="utf-8")
    with pytest.raises(ValueError, match="Cannot read"):
        load_official_source_candidates(replace(source_paths, d1_research_dir=malformed_dir))

    payload = load_official_source_candidates(source_paths)
    overlap = copy.deepcopy(payload)
    overlap["candidates"][0]["source_id"] = "SRC-IDN-ESDM"
    overlap_dir = _write_research_catalog(tmp_path / "overlap", overlap)
    with pytest.raises(ValueError, match="overlap frozen seeds"):
        build_source_registry_template(replace(source_paths, d1_research_dir=overlap_dir))

    incomplete = copy.deepcopy(payload)
    incomplete["candidates"].pop()
    incomplete_dir = _write_research_catalog(tmp_path / "incomplete", incomplete)
    with pytest.raises(ValueError, match="research coverage mismatch"):
        build_source_registry_template(replace(source_paths, d1_research_dir=incomplete_dir))


def test_research_catalog_evidence_baseline_must_match_current_catalog(
    tmp_path: Path,
) -> None:
    source_paths = discover_repository()
    missing_paths = replace(source_paths, d1_evidence_dir=tmp_path / "missing")
    with pytest.raises(ValueError, match="Cannot read"):
        build_d1_evidence_manifest_template(missing_paths)

    malformed_dir = tmp_path / "malformed-evidence"
    malformed_dir.mkdir()
    (malformed_dir / "research_catalog_baseline.json").write_text(
        "{",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="Cannot read"):
        build_d1_evidence_manifest_template(replace(source_paths, d1_evidence_dir=malformed_dir))

    baseline = json.loads(
        (source_paths.d1_evidence_dir / "research_catalog_baseline.json").read_text(
            encoding="utf-8"
        )
    )
    baseline["source_catalog"]["sha256"] = "0" * 64
    mismatch_dir = tmp_path / "mismatched-evidence"
    mismatch_dir.mkdir()
    (mismatch_dir / "research_catalog_baseline.json").write_text(
        json.dumps(baseline),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="does not match"):
        build_d1_evidence_manifest_template(replace(source_paths, d1_evidence_dir=mismatch_dir))


def test_unfilled_d1_templates_fail_all_hard_categories() -> None:
    paths = discover_repository()
    registry = build_source_registry_template(paths)
    matrix = build_domain_source_matrix_template(paths)

    codes = {item.code for item in validate_d1_admission(paths, registry, matrix)}

    assert {
        "D1_REGISTRY_TEMPLATE_UNCOPIED",
        "D1_MATRIX_TEMPLATE_UNCOPIED",
        "D1_COUNTRY_SOURCE_TARGET_UNMET",
        "D1_MATRIX_SOURCES_INCOMPLETE",
        "D1_MATRIX_APPROVAL_PENDING",
    } <= codes
    assert "D1_D0_DEPENDENCY_PENDING" not in codes


def test_completed_d1_registry_and_matrix_pass_when_d0_is_ready() -> None:
    paths = discover_repository()
    registry, matrix = _completed_d1_payloads(paths)

    checks = validate_d1_admission(paths, registry, matrix, d0_ready=True)

    assert checks == []


def test_completed_d1_registry_matrix_and_hashed_evidence_pass_when_d0_is_ready() -> None:
    paths = discover_repository()
    registry, matrix = _completed_d1_payloads(paths)
    evidence = _completed_evidence_manifest(paths, registry, matrix)

    checks = validate_d1_admission(
        paths,
        registry,
        matrix,
        evidence,
        d0_ready=True,
    )

    assert checks == []


def test_d1_evidence_manifest_header_template_baseline_and_list_are_enforced() -> None:
    paths = discover_repository()
    registry = build_source_registry_template(paths)
    matrix = build_domain_source_matrix_template(paths)
    evidence = build_d1_evidence_manifest_template(paths)
    evidence["schema_version"] = 2
    evidence["baseline"] = {}
    evidence["evidence"] = "invalid"

    codes = {
        item.code
        for item in validate_d1_admission(
            paths,
            registry,
            matrix,
            evidence,
            d0_ready=True,
        )
    }

    assert {
        "D1_EVIDENCE_HEADER_INVALID",
        "D1_EVIDENCE_TEMPLATE_UNCOPIED",
        "D1_EVIDENCE_BASELINE_STALE",
        "D1_EVIDENCE_LIST_INVALID",
    } <= codes


def _evidence_entry(
    paths: RepositoryPaths,
    evidence_id: str,
    evidence_kind: str,
) -> dict[str, Any]:
    return {
        "evidence_id": evidence_id,
        "evidence_kind": evidence_kind,
        "path": "data/d1/evidence/research_catalog_baseline.json",
        "sha256": sha256_file(paths.d1_evidence_dir / "research_catalog_baseline.json"),
        "reviewer": "实际复核人",
        "reviewed_at": "2026-08-02T11:00:00+08:00",
        "status": "approved",
        "source_ids": ["SRC-IDN-ESDM"],
        "assignment_keys": [],
    }


def test_d1_evidence_entries_reject_invalid_metadata_scope_paths_and_hashes() -> None:
    paths = discover_repository()
    registry = build_source_registry_template(paths)
    matrix = build_domain_source_matrix_template(paths)
    evidence = build_d1_evidence_manifest_template(paths)
    evidence["template_only"] = False
    valid = _evidence_entry(paths, "EVD-VALID", "source_identity")
    duplicate = copy.deepcopy(valid)
    invalid_kind = _evidence_entry(paths, "EVD-KIND", "invented")
    pending = _evidence_entry(paths, "EVD-PENDING", "access_review")
    pending["status"] = "pending"
    invalid_source_scope = _evidence_entry(paths, "EVD-SCOPE", "access_review")
    invalid_source_scope["source_ids"] = []
    invalid_source_scope["assignment_keys"] = ["IDN/DOM-COUNTRY"]
    unknown_source = _evidence_entry(paths, "EVD-SOURCE", "access_review")
    unknown_source["source_ids"] = ["SRC-UNKNOWN"]
    unknown_assignment = _evidence_entry(
        paths,
        "EVD-ASSIGNMENT",
        ASSIGNMENT_EVIDENCE_KIND,
    )
    unknown_assignment["source_ids"] = []
    unknown_assignment["assignment_keys"] = ["IDN/DOM-UNKNOWN"]
    absolute_path = _evidence_entry(paths, "EVD-ABSOLUTE", "access_review")
    absolute_path["path"] = str(paths.d1_evidence_dir / "research_catalog_baseline.json")
    escaped_path = _evidence_entry(paths, "EVD-ESCAPE", "access_review")
    escaped_path["path"] = "../outside.txt"
    outside_evidence_dir = _evidence_entry(paths, "EVD-OUTSIDE-DIR", "access_review")
    outside_evidence_dir["path"] = "README.md"
    placeholder_file = _evidence_entry(paths, "EVD-PLACEHOLDER", "access_review")
    placeholder_file["path"] = "data/d1/evidence/README.md"
    invalid_hash = _evidence_entry(paths, "EVD-HASH", "access_review")
    invalid_hash["sha256"] = "invalid"
    missing_file = _evidence_entry(paths, "EVD-MISSING", "access_review")
    missing_file["path"] = "data/d1/evidence/missing.txt"
    mismatched_hash = _evidence_entry(paths, "EVD-MISMATCH", "access_review")
    mismatched_hash["sha256"] = "0" * 64
    evidence["evidence"] = [
        None,
        {"evidence_id": "EVD-INCOMPLETE"},
        valid,
        duplicate,
        invalid_kind,
        pending,
        invalid_source_scope,
        unknown_source,
        unknown_assignment,
        absolute_path,
        escaped_path,
        outside_evidence_dir,
        placeholder_file,
        invalid_hash,
        missing_file,
        mismatched_hash,
    ]

    codes = {
        item.code
        for item in validate_d1_admission(
            paths,
            registry,
            matrix,
            evidence,
            d0_ready=True,
        )
    }

    assert {
        "D1_EVIDENCE_ENTRY_INVALID",
        "D1_EVIDENCE_METADATA_INCOMPLETE",
        "D1_EVIDENCE_ID_DUPLICATE",
        "D1_EVIDENCE_KIND_INVALID",
        "D1_EVIDENCE_STATUS_INVALID",
        "D1_EVIDENCE_SCOPE_INVALID",
        "D1_EVIDENCE_SOURCE_UNKNOWN",
        "D1_EVIDENCE_ASSIGNMENT_UNKNOWN",
        "D1_EVIDENCE_PATH_INVALID",
        "D1_EVIDENCE_PLACEHOLDER_FILE",
        "D1_EVIDENCE_HASH_INVALID",
        "D1_EVIDENCE_FILE_MISSING",
        "D1_EVIDENCE_HASH_MISMATCH",
    } <= codes


def test_active_sources_and_approved_assignments_require_scoped_evidence() -> None:
    paths = discover_repository()
    registry, matrix = _completed_d1_payloads(paths)
    evidence = _completed_evidence_manifest(paths, registry, matrix)
    active_sources = [item for item in registry["sources"] if item["status"] == "active"]

    active_sources[0]["approval_evidence_ids"] = "invalid"
    active_sources[1]["approval_evidence_ids"] = [
        "EVD-UNKNOWN",
        active_sources[1]["terms_snapshot_id"],
    ]
    active_sources[2]["approval_evidence_ids"][0] = active_sources[1]["approval_evidence_ids"][1]
    active_sources[3]["terms_snapshot_id"] = active_sources[3]["license_snapshot_id"]

    matrix["assignments"][0]["evidence_ids"] = "invalid"
    matrix["assignments"][1]["evidence_ids"] = ["EVD-MATRIX-UNKNOWN"]
    matrix["assignments"][2]["evidence_ids"] = [str(matrix["assignments"][3]["evidence_ids"][0])]

    codes = {
        item.code
        for item in validate_d1_admission(
            paths,
            registry,
            matrix,
            evidence,
            d0_ready=True,
        )
    }

    assert {
        "D1_ACTIVE_EVIDENCE_REFERENCE_INVALID",
        "D1_ACTIVE_EVIDENCE_REFERENCE_UNKNOWN",
        "D1_ACTIVE_EVIDENCE_SCOPE_MISMATCH",
        "D1_ACTIVE_EVIDENCE_KIND_MISSING",
        "D1_SNAPSHOT_EVIDENCE_INVALID",
        "D1_MATRIX_EVIDENCE_REFERENCE_INVALID",
        "D1_MATRIX_EVIDENCE_REFERENCE_UNKNOWN",
        "D1_MATRIX_EVIDENCE_SCOPE_MISMATCH",
        "D1_MATRIX_EVIDENCE_KIND_MISSING",
    } <= codes


def test_active_source_compliance_and_access_conflicts_are_blocked() -> None:
    paths = discover_repository()
    registry, matrix = _completed_d1_payloads(paths)
    source = registry["sources"][0]
    _activate_source(source, "IDN")
    source["technical_owner"] = None
    source["approval_evidence_ids"] = []
    source["usage_boundaries"] = {"collect_content": "conditional"}
    source["boundary_conditions"] = {}
    source["access_policy"]["automation"] = "allowed"
    source["access_policy"]["captcha_observed"] = True
    source["access_policy"]["paid_access"] = True

    codes = {item.code for item in validate_d1_admission(paths, registry, matrix, d0_ready=True)}

    assert {
        "D1_ACTIVE_APPROVAL_INCOMPLETE",
        "D1_ACTIVE_EVIDENCE_MISSING",
        "D1_USAGE_BOUNDARIES_INCOMPLETE",
        "D1_BOUNDARY_CONDITIONS_MISSING",
        "D1_AUTOMATION_CONFLICT",
        "D1_PAID_ACCESS_AUTOMATION_UNSCOPED",
    } <= codes


def test_invalid_source_metadata_status_boundaries_and_access_policy_are_blocked() -> None:
    paths = discover_repository()
    registry, matrix = _completed_d1_payloads(paths)
    source = registry["sources"][0]
    source["organization"] = None
    source["scope_codes"] = []
    source["authority_level"] = "Z"
    source["canonical_domain"] = "mismatch.example"
    source["status"] = "invented"
    source["access_policy"]["access_control_bypass_prohibited"] = False
    active_source = next(item for item in registry["sources"] if item["status"] == "active")
    active_source["usage_boundaries"] = []
    active_source["access_policy"] = []

    codes = {item.code for item in validate_d1_admission(paths, registry, matrix, d0_ready=True)}

    assert {
        "D1_SOURCE_METADATA_INCOMPLETE",
        "D1_SOURCE_SCOPE_MISSING",
        "D1_SOURCE_AUTHORITY_INVALID",
        "D1_SOURCE_URL_INVALID",
        "D1_SOURCE_STATUS_INVALID",
        "D1_BYPASS_PROHIBITION_MISSING",
        "D1_USAGE_BOUNDARIES_INVALID",
        "D1_ACCESS_POLICY_INVALID",
    } <= codes


def test_pending_automation_and_conditional_boundary_require_decisions() -> None:
    paths = discover_repository()
    registry, matrix = _completed_d1_payloads(paths)
    source = next(item for item in registry["sources"] if item["status"] == "active")
    source["usage_boundaries"]["ai_index"] = "conditional"
    source["boundary_conditions"] = {}
    source["access_policy"]["automation"] = "pending"
    source["access_policy"]["login_required"] = None
    source["access_policy"]["rate_limit"] = None

    codes = {item.code for item in validate_d1_admission(paths, registry, matrix, d0_ready=True)}

    assert "D1_BOUNDARY_CONDITIONS_MISSING" in codes
    assert "D1_AUTOMATION_DECISION_PENDING" in codes
    assert "D1_ACCESS_POLICY_INCOMPLETE" in codes


def test_active_source_requires_classification_languages_rate_limit_and_scoped_login() -> None:
    paths = discover_repository()
    registry, matrix = _completed_d1_payloads(paths)
    source = next(item for item in registry["sources"] if item["status"] == "active")
    source["source_type"] = "pending_classification"
    source["languages"] = []
    source["access_policy"]["login_required"] = True
    source["access_policy"]["rate_limit"] = None

    codes = {item.code for item in validate_d1_admission(paths, registry, matrix, d0_ready=True)}

    assert {
        "D1_ACTIVE_CLASSIFICATION_PENDING",
        "D1_ACTIVE_LANGUAGES_MISSING",
        "D1_RATE_LIMIT_MISSING",
        "D1_LOGIN_AUTOMATION_UNSCOPED",
    } <= codes


def test_registry_structure_and_baseline_tampering_are_blocked() -> None:
    paths = discover_repository()
    registry = build_source_registry_template(paths)
    matrix = build_domain_source_matrix_template(paths)
    registry["schema_version"] = 2
    matrix["stage"] = "D2"
    registry["baseline"] = {}
    matrix["baseline"] = {}
    first = registry["sources"][0]
    registry["sources"] = [first, copy.deepcopy(first), {}]
    matrix["assignments"] = [{}, "invalid"]

    codes = {item.code for item in validate_d1_admission(paths, registry, matrix, d0_ready=True)}

    assert {
        "D1_REGISTRY_HEADER_INVALID",
        "D1_MATRIX_HEADER_INVALID",
        "D1_BASELINE_STALE",
        "D1_SOURCE_ID_DUPLICATE",
        "D1_SOURCE_ENTRY_INVALID",
        "D1_SEED_SOURCE_MISSING",
        "D1_MATRIX_ENTRY_INVALID",
        "D1_MATRIX_SET_INVALID",
    } <= codes


def test_invalid_source_and_matrix_lists_are_blocked() -> None:
    paths = discover_repository()
    registry = build_source_registry_template(paths)
    matrix = build_domain_source_matrix_template(paths)
    registry["sources"] = "invalid"
    matrix["assignments"] = "invalid"

    codes = {item.code for item in validate_d1_admission(paths, registry, matrix, d0_ready=True)}

    assert "D1_SOURCE_LIST_INVALID" in codes
    assert "D1_MATRIX_LIST_INVALID" in codes


def test_matrix_requires_active_in_scope_distinct_sources_and_approval() -> None:
    paths = discover_repository()
    registry, matrix = _completed_d1_payloads(paths)
    assignment = matrix["assignments"][0]
    assignment["alternative_source_id"] = assignment["primary_source_id"]
    assignment["status"] = "pending"
    second = matrix["assignments"][1]
    second["primary_source_id"] = "SRC-UNKNOWN"
    third = matrix["assignments"][2]
    out_of_scope = next(
        item
        for item in registry["sources"]
        if item["status"] == "active" and third["country"] not in item["scope_codes"]
    )
    third["primary_source_id"] = out_of_scope["source_id"]
    fourth = matrix["assignments"][3]
    source = next(
        item for item in registry["sources"] if item["source_id"] == fourth["primary_source_id"]
    )
    source["status"] = "blocked"

    codes = {item.code for item in validate_d1_admission(paths, registry, matrix, d0_ready=True)}

    assert {
        "D1_MATRIX_SOURCES_INCOMPLETE",
        "D1_MATRIX_APPROVAL_PENDING",
        "D1_MATRIX_SOURCE_NOT_ACTIVE",
        "D1_MATRIX_SOURCE_SCOPE_MISMATCH",
        "D1_COUNTRY_SOURCE_TARGET_UNMET",
    } <= codes


def test_approved_matrix_requires_reviewer_time_and_evidence() -> None:
    paths = discover_repository()
    registry, matrix = _completed_d1_payloads(paths)
    assignment = matrix["assignments"][0]
    assignment["approved_by"] = None
    assignment["evidence_ids"] = []

    codes = {item.code for item in validate_d1_admission(paths, registry, matrix, d0_ready=True)}

    assert "D1_MATRIX_APPROVAL_INCOMPLETE" in codes
    assert "D1_MATRIX_EVIDENCE_MISSING" in codes


def test_write_and_load_d1_artifacts(tmp_path: Path) -> None:
    source_paths = discover_repository()
    paths = replace(source_paths, d1_candidates_dir=tmp_path / "candidates")

    written = write_d1_candidates(paths)
    registry_path = paths.d1_candidates_dir / "source_admission_registry.template.json"
    matrix_path = paths.d1_candidates_dir / "domain_source_matrix.template.json"
    evidence_path = paths.d1_candidates_dir / "d1_evidence_manifest.template.json"
    checks = load_and_validate_d1_admission(
        paths,
        registry_path,
        matrix_path,
        evidence_path,
    )

    assert len(written) == 5
    assert all(path.is_file() for path in written)
    assert all(item.code != "D1_D0_DEPENDENCY_PENDING" for item in checks)
    assert any(item.code == "D1_REGISTRY_TEMPLATE_UNCOPIED" for item in checks)


def test_load_d1_artifacts_handles_missing_invalid_and_non_object_files(tmp_path: Path) -> None:
    paths = discover_repository()
    valid = tmp_path / "valid.json"
    valid.write_text("{}", encoding="utf-8")
    invalid = tmp_path / "invalid.json"
    invalid.write_text("{", encoding="utf-8")
    array = tmp_path / "array.json"
    array.write_text("[]", encoding="utf-8")

    missing = load_and_validate_d1_admission(
        paths,
        tmp_path / "missing.json",
        valid,
        valid,
    )
    malformed = load_and_validate_d1_admission(paths, invalid, valid, valid)
    non_object = load_and_validate_d1_admission(paths, array, valid, valid)

    assert missing[0].code == "D1_ARTIFACT_INVALID"
    assert malformed[0].code == "D1_ARTIFACT_INVALID"
    assert non_object[0].code == "D1_ARTIFACT_INVALID"
