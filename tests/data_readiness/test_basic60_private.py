from __future__ import annotations

import copy
import csv
import hashlib
import hmac
import itertools
import json
import os
import secrets
import shutil
import stat
from dataclasses import replace
from pathlib import Path, PurePosixPath
from typing import Any

import navigator_data_readiness.basic60_private as basic60_private_module
import pytest
from navigator_api.basic60_seed_contract import Basic60SeedArtifact
from navigator_data_readiness.baseline import sha256_file
from navigator_data_readiness.basic60_evidence import (
    _seed_counts,
    canonical_sha256,
    collect_machine_evidence,
    validate_machine_evidence,
    write_d3_stage_payloads,
)
from navigator_data_readiness.basic60_private import (
    ACCEPTANCE_TEMPLATE_NAME,
    AI_USAGE_POLICY_NAME,
    ASSESSMENT_NAME,
    COUNTRY_SOURCE_URI_MANIFEST_NAME,
    D1_MACHINE_BASELINE_ROOT,
    D1_REAPPROVAL_TRIGGERS,
    D1_SCOPE_AUTHORIZATION_TEMPLATE_NAME,
    DECISION_ID,
    DOMAIN_IDS,
    EXPECTED_AVAILABLE_VALUES,
    EXPECTED_PENDING_VALUES,
    FINAL_APPROVAL_ROLES,
    FUTURE_DEEP_DIVE_PRIORITY_COUNTRY_CODES,
    HUMAN_APPROVAL_TEMPLATE_NAME,
    L0_BATCH_MANIFEST_SCHEMA,
    METRIC_CSV,
    PBD_CANDIDATE_PATH,
    PBD_CLARIFICATION_PATH,
    PBD_CONFIRMATION_TEMPLATE_PATH,
    PBD_DECISION_PATH,
    PROFILE_CSV,
    PROFILE_NAME,
    RAW_MANIFEST_NAME,
    RELEASE_ID,
    REQUESTED_DECISION,
    REQUIRED_D1_SCOPE_AUTHORIZATION_ID,
    SAMPLE_CANDIDATE_NAME,
    SEED_NAME,
    SOURCE_EVIDENCE_SCHEMA,
    SOURCE_MATRIX_NAME,
    SOURCE_REGISTRY_TEMPLATE_NAME,
    SOURCE_TERMS_URI_REQUIREMENTS,
    USAGE_AMENDMENT_ID,
    USAGE_AMENDMENT_PATH,
    USAGE_AMENDMENT_TEMPLATE_NAME,
    _item_review_rows,
    _seed_duplicate_count,
    _source_admission_fingerprint,
    _terms_fingerprint_sha256,
    _terms_snapshot_objects,
    _validate_source_evidence,
    approval_subjects,
    build_basic60_country_source_uri_manifest,
    build_basic60_item_review_manifest,
    build_basic60_ready_seed,
    build_basic60_sample_review_manifest,
    build_d1_authorized_scope,
    build_usage_amendment_template,
    inspect_basic60_raw,
    load_and_assess_basic60_private,
    materialize_basic60_l0,
    prepare_basic60_private,
    write_basic60_runtime_attestation,
    write_d1_machine_baseline_evidence,
)
from navigator_data_readiness.paths import RepositoryPaths, discover_repository
from test_basic60_evidence import (
    _api_observations,
    _file_ref,
    _operation_logs,
    _repository_layout,
    _route_probes,
    _write_json,
)

PROFILE_FIELDS = (
    "order",
    "iso2",
    "iso3",
    "country_name_zh",
    "country_name_en",
    "official_name_en",
    "local_names",
    "capital",
    "admin_level_1_count",
    "admin_level_1_type",
    "population",
    "population_year",
    "official_languages",
    "currency_code",
    "currency_name",
    "time_zones",
    "area_sq_km",
    "area_year",
    "region",
    "collected_at",
    "review_status",
)
METRIC_FIELDS = (
    "iso3",
    "country_name_zh",
    "record_type",
    "year",
    "gdp_current_usd",
    "gdp_growth_pct",
    "gdp_per_capita_current_usd",
    "inflation_cpi_pct",
    "official_exchange_rate_lcu_per_usd",
    "fdi_net_inflows_usd",
    "electricity_installed_capacity_mw",
    "electricity_installed_capacity_year",
    "electricity_generation_gwh",
    "electricity_generation_year",
    "renewable_capacity_mw",
    "renewable_capacity_year",
    "renewable_generation_gwh",
    "renewable_generation_year",
    "renewable_share_capacity_pct",
    "renewable_share_capacity_year",
    "renewable_share_generation_pct",
    "renewable_share_generation_year",
    "electricity_demand_gwh",
    "electricity_demand_year",
    "macro_source_url",
    "energy_source_url",
    "notes",
    "collected_at",
    "review_status",
)


def test_runtime_attestation_authenticates_all_final_artifacts(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, _raw_dir, runtime_dir, _candidate_dir = basic60_fixture
    bundle_path = paths.root / "data/basic60/review/ready.json"
    ready_seed_path = runtime_dir / "basic60_seed.private_trial_ready.json"
    authorization_path = runtime_dir / "basic60_release_authorization.json"
    output_path = runtime_dir / "basic60_runtime_attestation.json"
    validation_report_sha256 = "a" * 64
    trust_key = secrets.token_hex(32)

    _write_json(bundle_path, {"release_id": RELEASE_ID})
    bundle_sha256 = sha256_file(bundle_path)
    _write_json(
        ready_seed_path,
        {
            "release": {
                "release_id": RELEASE_ID,
                "release_profile": "basic60_private",
                "status": "private_trial_ready",
                "release_bundle_sha256": bundle_sha256,
                "validation_report_sha256": validation_report_sha256,
            }
        },
    )
    seed_sha256 = sha256_file(ready_seed_path)
    _write_json(
        authorization_path,
        {
            "release_id": RELEASE_ID,
            "release_profile": "basic60_private",
            "status": "private_trial_ready",
            "release_bundle_sha256": bundle_sha256,
            "validation_report_sha256": validation_report_sha256,
            "seed_artifact_sha256": seed_sha256,
        },
    )

    written = write_basic60_runtime_attestation(
        paths,
        bundle_path,
        ready_seed_path,
        authorization_path,
        output_path,
        validation_report_sha256=validation_report_sha256,
        trust_key=trust_key,
    )

    assert written == output_path
    attestation = json.loads(output_path.read_text(encoding="utf-8"))
    claims = attestation["claims"]
    assert claims == {
        "release_id": RELEASE_ID,
        "release_profile": "basic60_private",
        "validation_report_sha256": validation_report_sha256,
        "release_bundle_sha256": bundle_sha256,
        "seed_artifact_sha256": seed_sha256,
        "release_authorization_sha256": sha256_file(authorization_path),
    }
    message = json.dumps(claims, sort_keys=True, separators=(",", ":")).encode()
    assert (
        attestation["mac_sha256"]
        == hmac.new(trust_key.encode(), message, hashlib.sha256).hexdigest()
    )


@pytest.mark.parametrize(
    "trust_key",
    (
        "replace-me",
        "replace-with-at-least-32-random-bytes",
        "test-runtime-attestation-key-with-32-bytes",
        "basic60-test-runtime-attestation-key-32-bytes",
        "placeholder-runtime-attestation-key-32-bytes",
    ),
)
def test_runtime_attestation_rejects_known_placeholder_and_example_keys(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
    trust_key: str,
) -> None:
    paths, _raw_dir, runtime_dir, _candidate_dir = basic60_fixture
    bundle_path = paths.root / "data/basic60/review/ready.json"
    ready_seed_path = runtime_dir / "basic60_seed.private_trial_ready.json"
    authorization_path = runtime_dir / "basic60_release_authorization.json"
    validation_report_sha256 = "a" * 64
    _write_json(bundle_path, {"release_id": RELEASE_ID})
    bundle_sha256 = sha256_file(bundle_path)
    _write_json(
        ready_seed_path,
        {
            "release": {
                "release_id": RELEASE_ID,
                "release_profile": "basic60_private",
                "status": "private_trial_ready",
                "release_bundle_sha256": bundle_sha256,
                "validation_report_sha256": validation_report_sha256,
            }
        },
    )
    _write_json(
        authorization_path,
        {
            "release_id": RELEASE_ID,
            "release_profile": "basic60_private",
            "status": "private_trial_ready",
            "release_bundle_sha256": bundle_sha256,
            "validation_report_sha256": validation_report_sha256,
            "seed_artifact_sha256": sha256_file(ready_seed_path),
        },
    )

    with pytest.raises(ValueError, match="known placeholder or example value"):
        write_basic60_runtime_attestation(
            paths,
            bundle_path,
            ready_seed_path,
            authorization_path,
            runtime_dir / "rejected-attestation.json",
            validation_report_sha256=validation_report_sha256,
            trust_key=trust_key,
        )


def _write_csv(path: Path, fields: tuple[str, ...], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _country_codes() -> list[tuple[str, str]]:
    iso3_values = ["LKA", "ZAF", "IDN", "VNM", "SAU", "BRA"]
    reserved = set(iso3_values)
    iso3_values.extend(
        "".join(value)
        for value in itertools.product("ABCDEFGH", repeat=3)
        if "".join(value) not in reserved
    )
    iso2_values = ["".join(value) for value in itertools.product("ABCDEFGH", repeat=2)]
    return list(zip(iso2_values[:60], iso3_values[:60], strict=True))


def _write_governance_templates(paths: RepositoryPaths) -> None:
    candidate_path = paths.root / PBD_CANDIDATE_PATH
    candidate_path.parent.mkdir(parents=True, exist_ok=True)
    candidate = {
        "schema_version": 1,
        "candidate_type": "project_baseline_change_candidate",
        "decision_id": DECISION_ID,
        "status": "pending_named_project_approver_review",
        "requested_decision": REQUESTED_DECISION,
        "does_not_complete_formal_d1_d4": True,
        "does_not_complete_p0": True,
        "does_not_authorize_production": True,
        "does_not_authorize_public_release": True,
        "template_only": True,
    }
    candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
    confirmation_path = paths.root / PBD_CONFIRMATION_TEMPLATE_PATH
    confirmation_path.parent.mkdir(parents=True, exist_ok=True)
    confirmation_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "confirmation_type": "project_baseline_change_review",
                "decision_id": DECISION_ID,
                "candidate": {
                    "path": PBD_CANDIDATE_PATH.as_posix(),
                    "sha256": sha256_file(candidate_path),
                },
                "template_only": True,
            }
        ),
        encoding="utf-8",
    )
    clarification_path = paths.root / PBD_CLARIFICATION_PATH
    clarification_path.parent.mkdir(parents=True, exist_ok=True)
    clarification_path.write_text(
        json.dumps(
            _clarification_payload(
                candidate={
                    "path": PBD_CANDIDATE_PATH.as_posix(),
                    "sha256": sha256_file(candidate_path),
                },
                confirmation={
                    "path": "data/governance/evidence/pending-confirmation.json",
                    "sha256": "0" * 64,
                },
                decision={
                    "path": PBD_DECISION_PATH.as_posix(),
                    "sha256": "0" * 64,
                },
            )
        ),
        encoding="utf-8",
    )


def _clarification_payload(
    *,
    candidate: dict[str, str],
    confirmation: dict[str, str],
    decision: dict[str, str],
) -> dict[str, Any]:
    approved_at = "2026-08-26T00:21:49+08:00"
    return {
        "schema_version": 1,
        "record_type": "basic60_private_internal_review_clarification",
        "decision_id": DECISION_ID,
        "status": "approved_and_effective",
        "effective_from": approved_at,
        "basis": {
            "candidate": candidate,
            "confirmation": confirmation,
            "decision": decision,
        },
        "owner_confirmations": {
            "external_information_accuracy_confirmed": True,
            "collected_data_origin": "official_public_sources",
            "manual_data_updates_allowed": True,
            "simplified_internal_review_authorized": True,
        },
        "d1_internal_review": {
            "review_unit": "provider_dataset",
            "required_primary_source_count": 3,
            "alternative_sources_required": False,
            "per_country_manual_review_required": False,
            "approval_mode": "single_consolidated_project_approver",
            "required_approver": {"person_name": "kevin", "role": "项目批准人"},
            "machine_checks_retained": [
                "official_source_reference",
                "terms_and_license_evidence",
                "snapshot_hash",
                "attribution",
                "usage_boundary",
            ],
        },
        "manual_update_policy": {
            "mode": "manual_incremental",
            "routine_value_updates_reuse_d1_admission": True,
            "required_each_update": [
                "new_snapshot_hash",
                "difference_report",
                "source_reference",
                "operator_record",
            ],
            "d1_reapproval_triggers": [
                "source_url_changed",
                "terms_or_license_changed",
                "dataset_structure_changed",
            ],
        },
        "v1_usage_boundaries": {
            "private_structured_storage": "allowed",
            "private_display": "allowed",
            "public_release": "prohibited",
            "private_export": "prohibited",
            "ai_indexing": "prohibited",
            "model_training": "prohibited",
            "cloud_model_processing": "prohibited",
        },
        "does_not_complete": [
            "D2-P",
            "D3-P",
            "D4-P",
            "formal_D1_D4",
            "P0",
            "private_trial_ready",
            "production_release",
        ],
        "approval": {
            "person_name": "kevin",
            "role": "项目批准人",
            "approved_at": approved_at,
            "authorization_basis": "explicit_user_confirmation_in_project_task",
        },
    }


def _write_raw_fixture(raw_dir: Path) -> None:
    profile_rows: list[dict[str, Any]] = []
    metric_rows: list[dict[str, Any]] = []
    for order, (iso2, iso3) in enumerate(_country_codes(), start=1):
        is_south_africa = iso3 == "ZAF"
        profile_rows.append(
            {
                "order": order,
                "iso2": iso2,
                "iso3": iso3,
                "country_name_zh": f"国家{order}",
                "country_name_en": f"Country {order}",
                "official_name_en": f"Republic of Country {order}",
                "local_names": json.dumps([f"Country {order}"]),
                "capital": (
                    "Pretoria (administrative); Cape Town (legislative); Bloemfontein (judicial)"
                    if is_south_africa
                    else f"Capital {order}"
                ),
                "admin_level_1_count": 10,
                "admin_level_1_type": "regions",
                "population": 1_000_000 + order,
                "population_year": 2025,
                "official_languages": json.dumps(["English"]),
                "currency_code": "USD",
                "currency_name": "Test dollar",
                "time_zones": json.dumps(["Etc/UTC"]),
                "area_sq_km": 1000 + order,
                "area_year": 2023,
                "region": "Test Region",
                "collected_at": "2026-08-22",
                "review_status": "machine_collected_pending_human_review",
            }
        )
        for year in range(2020, 2025):
            metric_rows.append(
                {
                    "iso3": iso3,
                    "country_name_zh": f"国家{order}",
                    "record_type": "macro_annual",
                    "year": year,
                    "gdp_current_usd": "100",
                    "gdp_growth_pct": "-1" if year == 2020 else "2",
                    "gdp_per_capita_current_usd": "10",
                    "inflation_cpi_pct": "3",
                    "official_exchange_rate_lcu_per_usd": (
                        "" if iso3 == "LKA" and year == 2024 else "1"
                    ),
                    "fdi_net_inflows_usd": "5",
                    "macro_source_url": "https://example.test/wdi",
                    "notes": "fixture",
                    "collected_at": "2026-08-22",
                    "review_status": "machine_collected_pending_human_review",
                }
            )
        metric_rows.append(
            {
                "iso3": iso3,
                "country_name_zh": f"国家{order}",
                "record_type": "energy_latest",
                "electricity_installed_capacity_mw": "100",
                "electricity_installed_capacity_year": "2025",
                "electricity_generation_gwh": "200",
                "electricity_generation_year": "2023",
                "renewable_capacity_mw": "50",
                "renewable_capacity_year": "2025",
                "renewable_generation_gwh": "80",
                "renewable_generation_year": "2023",
                "renewable_share_capacity_pct": "50",
                "renewable_share_capacity_year": "2025",
                "renewable_share_generation_pct": "40",
                "renewable_share_generation_year": "2023",
                "electricity_demand_gwh": "",
                "electricity_demand_year": "",
                "energy_source_url": "https://example.test/irena",
                "notes": "fixture",
                "collected_at": "2026-08-22",
                "review_status": "machine_collected_pending_human_review",
            }
        )
    _write_csv(raw_dir / PROFILE_CSV, PROFILE_FIELDS, profile_rows)
    _write_csv(raw_dir / METRIC_CSV, METRIC_FIELDS, metric_rows)
    for profile in profile_rows:
        iso3 = str(profile["iso3"])
        country_source_path = (
            raw_dir / "countries" / iso3 / "00_country_profile" / "country_profile.json"
        )
        country_source_path.parent.mkdir(parents=True, exist_ok=True)
        country_source_path.write_text(
            json.dumps(
                {
                    "iso3": iso3,
                    "sources": [
                        {
                            "source_name": "Fixture official country source",
                            "fields": [
                                "capital",
                                "country_name_en",
                                "official_name_en",
                            ],
                            "url": f"https://example.test/country/{iso3.lower()}",
                            "retrieved_at": "2026-08-22",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
    (raw_dir / "collection_manifest_60.json").write_text(
        json.dumps(
            {
                "country_count": 60,
                "macro_annual_record_count": 300,
                "energy_latest_record_count": 60,
            }
        ),
        encoding="utf-8",
    )
    (raw_dir / "README.txt").write_text("test fixture", encoding="utf-8")
    (raw_dir / "ignored.pdf:Zone.Identifier").write_text("ads", encoding="utf-8")


@pytest.fixture
def basic60_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[RepositoryPaths, Path, Path, Path]:
    paths = replace(discover_repository(), root=tmp_path)
    trusted_registry_path = (
        tmp_path.parent / f"{tmp_path.name}-trusted-config/basic60-volume-registry.json"
    )
    monkeypatch.setattr(
        basic60_private_module,
        "D1_TRUSTED_VOLUME_REGISTRY_PATH",
        trusted_registry_path,
    )
    monkeypatch.setattr(
        basic60_private_module,
        "D1_TRUSTED_VOLUME_REGISTRY_ALLOWED_OWNER_UIDS",
        frozenset({os.geteuid()}),
    )
    production_trusted_path_chain = basic60_private_module._trusted_path_chain
    virtual_filesystem_root = tmp_path.parent.resolve()

    def trusted_test_path_chain(path: Path) -> tuple[Path, ...]:
        chain = production_trusted_path_chain(path)
        if virtual_filesystem_root in chain:
            return chain[chain.index(virtual_filesystem_root) :]
        return chain

    monkeypatch.setattr(
        basic60_private_module,
        "_trusted_path_chain",
        trusted_test_path_chain,
    )
    monkeypatch.setattr(
        basic60_private_module,
        "_runtime_account_can_write",
        lambda _path: False,
    )
    _write_governance_templates(paths)
    raw_dir = tmp_path / "raw material"
    runtime_dir = tmp_path / "runtime/basic60"
    candidate_dir = tmp_path / "data/basic60/candidates"
    _write_raw_fixture(raw_dir)
    return paths, raw_dir, runtime_dir, candidate_dir


def _register_test_trusted_volume(l0_dir: Path, volume_id: str) -> None:
    registry_path = basic60_private_module.D1_TRUSTED_VOLUME_REGISTRY_PATH
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.parent.chmod(0o755)
    if registry_path.exists():
        registry_path.chmod(0o644)
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    else:
        registry = {
            "schema_version": "basic60.trusted-volume-registry.v1",
            "volumes": [],
        }
    existing = {item["volume_id"]: item["canonical_root"] for item in registry["volumes"]}
    canonical_root = str(l0_dir.resolve(strict=False))
    if volume_id in existing:
        assert existing[volume_id] == canonical_root
    else:
        registry["volumes"].append(
            {
                "volume_id": volume_id,
                "canonical_root": canonical_root,
                "status": "active",
            }
        )
    registry_path.write_text(json.dumps(registry, sort_keys=True), encoding="utf-8")
    registry_path.chmod(0o444)
    registry_path.parent.chmod(0o555)


def _write_approval(
    paths: RepositoryPaths,
    *,
    filename: str,
    role: str,
    person: str,
    subject_sha256: str,
    signed_at: str = "2026-08-25T10:00:00+08:00",
) -> dict[str, Any]:
    evidence_id = f"EVD-{filename.upper()}"
    path = paths.root / "data/basic60/evidence" / f"{filename}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "record_type": "basic60_human_approval",
                "evidence_id": evidence_id,
                "decision": "approved",
                "person_name": person,
                "role": role,
                "signed_at": signed_at,
                "subject_sha256": subject_sha256,
                "template_only": False,
            }
        ),
        encoding="utf-8",
    )
    return {
        "role": role,
        "person_name": person,
        "decision": "approved",
        "signed_at": signed_at,
        "subject_sha256": subject_sha256,
        "evidence": {
            "evidence_id": evidence_id,
            "path": path.relative_to(paths.root).as_posix(),
            "sha256": sha256_file(path),
        },
    }


def _write_d1_scope_authorization(
    paths: RepositoryPaths,
    *,
    filename: str,
    person: str,
    scope_authorization_id: str,
    scope_subject_sha256: str,
    signed_at: str = "2026-08-25T10:00:00+08:00",
    transcribed_at: str = "2026-08-26T02:00:00+08:00",
) -> dict[str, Any]:
    evidence_id = f"EVD-{filename.upper()}"
    path = paths.root / "data/basic60/evidence" / f"{filename}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "record_type": "basic60_d1_scope_authorization",
                "evidence_id": evidence_id,
                "authorization_type": "human_scope_authorization",
                "decision": "approved",
                "person_name": person,
                "role": "项目批准人",
                "signed_at": signed_at,
                "transcribed_at": transcribed_at,
                "authorization_basis": "explicit_user_confirmation_in_project_task",
                "scope_authorization_id": scope_authorization_id,
                "scope_subject_sha256": scope_subject_sha256,
                "exact_content_hash_signed": False,
                "template_only": False,
            }
        ),
        encoding="utf-8",
    )
    return {
        "approval_type": "human_scope_authorization",
        "role": "项目批准人",
        "person_name": person,
        "decision": "approved",
        "signed_at": signed_at,
        "scope_authorization_id": scope_authorization_id,
        "scope_subject_sha256": scope_subject_sha256,
        "exact_content_hash_signed": False,
        "evidence": {
            "evidence_id": evidence_id,
            "path": path.relative_to(paths.root).as_posix(),
            "sha256": sha256_file(path),
        },
    }


def _write_artifact(
    paths: RepositoryPaths,
    filename: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, str]:
    path = paths.root / "data/basic60/evidence" / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload or {"artifact": filename}), encoding="utf-8")
    return {
        "path": path.relative_to(paths.root).as_posix(),
        "sha256": sha256_file(path),
    }


def _write_runtime_review(
    paths: RepositoryPaths,
    filename: str,
    payload: dict[str, Any],
) -> dict[str, str]:
    path = paths.root / "runtime/basic60/review" / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return {
        "path": path.relative_to(paths.root).as_posix(),
        "sha256": sha256_file(path),
    }


def _complete_sample_review(
    template: dict[str, Any],
    *,
    reviewer_name: str,
    inaccurate_ids: set[str] | None = None,
) -> dict[str, Any]:
    completed = json.loads(json.dumps(template))
    inaccurate = inaccurate_ids or set()
    completed.update(
        {
            "template_only": False,
            "reviewer_name": reviewer_name,
            "reviewed_at": "2026-08-25T12:00:00+08:00",
            "status": "completed",
        }
    )
    for item in completed["items"]:
        item["outcome"] = "inaccurate" if item["sample_id"] in inaccurate else "accurate"
    completed["items_sha256"] = _canonical_payload_hash(completed["items"])
    return completed


def _complete_item_review(
    template: dict[str, Any],
    seed: dict[str, Any],
    *,
    reviewer_name: str,
) -> dict[str, Any]:
    completed = json.loads(json.dumps(template))
    expected = _item_review_rows(seed, blank=False)
    completed.update(
        {
            "template_only": False,
            "reviewer_name": reviewer_name,
            "reviewed_at": "2026-08-25T12:00:00+08:00",
            "status": "completed",
        }
    )
    completed["groups"] = [
        {
            "review_type": review_type,
            "item_count": len(expected[review_type]),
            "items": expected[review_type],
        }
        for review_type in ("chinese_names", "pending_values", "derived_values")
    ]
    completed["groups_sha256"] = _canonical_payload_hash(completed["groups"])
    return completed


def _source_snapshot_bytes(source_ref: str) -> bytes:
    return f"approved provider snapshot for {source_ref}\n".encode()


def _approved_terms_l0_dir(paths: RepositoryPaths) -> Path:
    return paths.root.parent / f"{paths.root.name}-trusted-volumes" / "basic60-approved-terms-l0"


def _materialize_test_terms_snapshot(l0_dir: Path, uri: str) -> dict[str, Any]:
    payload = f"official test source bytes for {uri}\n".encode()
    digest = hashlib.sha256(payload).hexdigest()
    object_path = l0_dir / "sha256" / digest
    object_path.parent.mkdir(parents=True, exist_ok=True)
    if object_path.exists():
        assert object_path.read_bytes() == payload
    else:
        object_path.write_bytes(payload)
    object_path.chmod(0o444)
    return {
        "storage_mode": "external_l0",
        "sha256": digest,
        "byte_size": len(payload),
        "captured_at": "2026-08-26T01:22:03+08:00",
        "retrieval_uri": uri,
        "canonical_url": uri,
        "media_type": "text/plain",
        "capture_method": "official_https_download",
        "volume_id": "basic60-test-terms-l0",
        "object_key": f"sha256/{digest}",
    }


def _approved_sources(
    paths: RepositoryPaths,
    *,
    l0_dir: Path | None = None,
) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    raw_dir = paths.root / "raw material"
    terms_l0_dir = l0_dir or _approved_terms_l0_dir(paths)
    country_source_manifest = build_basic60_country_source_uri_manifest(raw_dir)
    for domain_index, api_domain in enumerate(("country_identity", "macro", "energy"), start=1):
        for role in ("primary",):
            source_ref = f"SRC-{api_domain.upper()}-{role.upper()}"
            terms_snapshots = [
                _materialize_test_terms_snapshot(terms_l0_dir, uri)
                for uri in SOURCE_TERMS_URI_REQUIREMENTS[api_domain]
            ]
            terms_uris = [str(item["canonical_url"]) for item in terms_snapshots]
            snapshot_digest = hashlib.sha256(_source_snapshot_bytes(source_ref)).hexdigest()
            source: dict[str, Any] = {
                "source_ref": source_ref,
                "provider": f"Provider {domain_index}",
                "dataset": f"Dataset {domain_index} {role}",
                "data_domain": api_domain,
                "source_role": role,
                "status": "active",
                "terms_uri": terms_uris[0],
                "evidence_sha256": "a" * 64,
                "access_method": "approved_snapshot",
                "rate_limit": "not_applicable",
                "snapshots": [
                    {
                        "snapshot_ref": f"SNAP-{api_domain.upper()}-{role.upper()}",
                        "captured_at": "2026-08-22T00:00:00+08:00",
                        "content_sha256": snapshot_digest,
                        "retrieval_uri": f"https://example.test/data/{source_ref}",
                        "media_type": "text/csv",
                    }
                ],
            }
            evidence: dict[str, Any] = {
                "schema_version": SOURCE_EVIDENCE_SCHEMA,
                "source_ref": source["source_ref"],
                "terms_snapshots": terms_snapshots,
                "captured_at": source["snapshots"][0]["captured_at"],
            }
            evidence_reference = _write_artifact(
                paths,
                f"source-evidence-{api_domain}-{role}.json",
                evidence,
            )
            source["evidence"] = evidence_reference
            source["evidence_sha256"] = evidence_reference["sha256"]
            source["admission_fingerprint"] = _source_admission_fingerprint(
                raw_dir,
                source,
                country_source_manifest=country_source_manifest,
                terms_evidence=evidence,
            )
            sources.append(source)
    return sources


def _authorize_pbd_and_d1(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    *,
    l0_dir: Path | None = None,
    machine_binding_generated_at: str = "2026-08-26T02:01:00+08:00",
) -> None:
    bundle["template_only"] = False
    candidate_reference = {
        "path": PBD_CANDIDATE_PATH.as_posix(),
        "sha256": sha256_file(paths.root / PBD_CANDIDATE_PATH),
    }
    signed_at = "2026-08-25T09:00:00+08:00"
    confirmation_path = (
        paths.root / "data/governance/evidence/kevin_basic60_private_confirmation.json"
    )
    confirmation_path.parent.mkdir(parents=True, exist_ok=True)
    confirmation_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "confirmation_type": "project_baseline_change_review",
                "decision_id": DECISION_ID,
                "candidate": candidate_reference,
                "decision": REQUESTED_DECISION,
                "comments": "approved for bounded private trial",
                "reviewed_at": signed_at,
                "reviewer_signature": {
                    "person_name": "kevin",
                    "role": "项目批准人",
                    "signed_at": signed_at,
                },
                "authorized_transcription": True,
                "authorized_actions": {
                    "write_decision_record": True,
                    "activate_basic60_private_profile": True,
                    "start_real_data_private_trial": True,
                },
                "template_only": False,
            }
        ),
        encoding="utf-8",
    )
    decision_path = paths.root / PBD_DECISION_PATH
    decision_path.parent.mkdir(parents=True, exist_ok=True)
    decision_path.write_text(
        json.dumps(
            {
                "decision_id": DECISION_ID,
                "status": "approved_and_effective",
                "effective_from": signed_at,
                "scope": {
                    "release_profile": "basic60_private",
                    "private_trial_only": True,
                    "real_data_enabled": True,
                    "policies_enabled": False,
                    "ai_enabled": False,
                    "external_model_calls_enabled": False,
                },
                "approval": {
                    "person_id": "kevin",
                    "role": "project_approver",
                    "signed_at": signed_at,
                    "signature_sha256": sha256_file(confirmation_path),
                },
            }
        ),
        encoding="utf-8",
    )
    bundle["baseline_confirmation"] = {
        "path": confirmation_path.relative_to(paths.root).as_posix(),
        "sha256": sha256_file(confirmation_path),
    }
    bundle["baseline_decision"] = {
        "path": decision_path.relative_to(paths.root).as_posix(),
        "sha256": sha256_file(decision_path),
    }
    clarification_path = paths.root / PBD_CLARIFICATION_PATH
    clarification_path.write_text(
        json.dumps(
            _clarification_payload(
                candidate=bundle["baseline_candidate"],
                confirmation=bundle["baseline_confirmation"],
                decision=bundle["baseline_decision"],
            )
        ),
        encoding="utf-8",
    )
    bundle["baseline_clarification"] = {
        "path": PBD_CLARIFICATION_PATH.as_posix(),
        "sha256": sha256_file(clarification_path),
    }

    usage_signed_at = "2026-08-26T08:00:00+08:00"
    usage_evidence_path = (
        paths.root / "data/governance/evidence/kevin_basic60_usage_amendment_test.json"
    )
    usage_evidence_path.parent.mkdir(parents=True, exist_ok=True)
    usage_evidence_path.write_text(
        json.dumps(
            {
                "amendment_id": USAGE_AMENDMENT_ID,
                "person_name": "kevin",
                "decision": "approved",
                "confirmed_at": usage_signed_at,
            }
        ),
        encoding="utf-8",
    )
    usage_amendment = build_usage_amendment_template()
    usage_amendment.update(
        {
            "status": "approved_and_effective",
            "effective_from": usage_signed_at,
            "template_only": False,
            "approval": {
                "person_name": "kevin",
                "role": "项目批准人",
                "decision": "approved",
                "signed_at": usage_signed_at,
                "authorization_basis": "explicit_user_confirmation_in_project_task",
                "evidence": {
                    "path": usage_evidence_path.relative_to(paths.root).as_posix(),
                    "sha256": sha256_file(usage_evidence_path),
                },
            },
        }
    )
    usage_amendment_path = paths.root / USAGE_AMENDMENT_PATH
    usage_amendment_path.parent.mkdir(parents=True, exist_ok=True)
    usage_amendment_path.write_text(json.dumps(usage_amendment), encoding="utf-8")
    bundle["usage_amendment"] = {
        "path": USAGE_AMENDMENT_PATH.as_posix(),
        "sha256": sha256_file(usage_amendment_path),
    }

    seed_reference = bundle["runtime_seed"]
    candidate_seed = json.loads((paths.root / seed_reference["path"]).read_text(encoding="utf-8"))
    ai_usage_policy_path = paths.root / "data/basic60/candidates" / AI_USAGE_POLICY_NAME
    ai_usage_policy_path.write_text(
        json.dumps(
            basic60_private_module.build_ai_usage_policy(
                candidate_seed,
                seed_reference=seed_reference,
                usage_amendment_reference=bundle["usage_amendment"],
            )
        ),
        encoding="utf-8",
    )
    ai_usage_policy_reference = {
        "path": ai_usage_policy_path.relative_to(paths.root).as_posix(),
        "sha256": sha256_file(ai_usage_policy_path),
    }
    bundle["ai_usage_policy"] = ai_usage_policy_reference
    bundle["source_admission"]["ai_usage_policy"] = ai_usage_policy_reference

    source_registry_template = json.loads(
        (paths.root / "data/basic60/candidates" / SOURCE_REGISTRY_TEMPLATE_NAME).read_text(
            encoding="utf-8"
        )
    )
    effective_l0_dir = l0_dir or _approved_terms_l0_dir(paths)
    bundle["source_admission"]["source_registry"] = _write_artifact(
        paths,
        "approved_source_registry.json",
        {
            "schema_version": 1,
            "profile_id": "basic60_private",
            "release_id": RELEASE_ID,
            "template_only": False,
            "source_declaration": "official_public_data",
            "update_policy": {
                "mode": "manual_incremental",
                "reapproval_triggers": list(D1_REAPPROVAL_TRIGGERS),
            },
            "country_source_uri_manifest": source_registry_template["country_source_uri_manifest"],
            "sources": _approved_sources(paths, l0_dir=effective_l0_dir),
        },
    )
    for domain, api_domain in zip(
        bundle["source_admission"]["domains"],
        ("country_identity", "macro", "energy"),
        strict=True,
    ):
        domain.update(
            {
                "primary_source_id": f"SRC-{api_domain.upper()}-PRIMARY",
                "alternative_source_id": None,
                "status": "active",
            }
        )
    bundle["source_admission"]["usage_boundaries"] = basic60_private_module._usage_boundaries()
    bundle["source_admission"]["scope_authorization_id"] = REQUIRED_D1_SCOPE_AUTHORIZATION_ID
    matrix_reference = bundle["source_admission"]["country_domain_matrix"]
    matrix = json.loads((paths.root / matrix_reference["path"]).read_text(encoding="utf-8"))
    domain_index = {item["domain_id"]: item for item in bundle["source_admission"]["domains"]}
    derived_rows = [
        {
            "iso3": row["iso3"],
            "domain_id": row["domain_id"],
            "primary_source_id": domain_index[row["domain_id"]]["primary_source_id"],
            "alternative_source_id": domain_index[row["domain_id"]]["alternative_source_id"],
        }
        for row in matrix["rows"]
    ]
    bundle["source_admission"]["derived_matrix_sha256"] = _canonical_payload_hash(derived_rows)
    registry_reference = bundle["source_admission"]["source_registry"]
    registry = json.loads((paths.root / registry_reference["path"]).read_text(encoding="utf-8"))
    bundle["source_admission"]["authorized_scope"] = build_d1_authorized_scope(
        bundle,
        registry,
    )
    scope_subject = approval_subjects(bundle)["source_scope"]
    bundle["source_admission"]["approvals"] = [
        _write_d1_scope_authorization(
            paths,
            filename="source-project-approver",
            person="kevin",
            scope_authorization_id=bundle["source_admission"]["scope_authorization_id"],
            scope_subject_sha256=scope_subject,
        )
    ]
    _register_test_trusted_volume(effective_l0_dir, "basic60-test-ledger")
    bundle["source_admission"]["machine_content_binding"] = write_d1_machine_baseline_evidence(
        paths,
        bundle,
        registry,
        l0_dir=effective_l0_dir,
        volume_id="basic60-test-ledger",
        generated_at=machine_binding_generated_at,
    )


def _write_d1_review_copy(
    paths: RepositoryPaths,
    candidate_dir: Path,
    *,
    filename: str = "d1-approved.json",
    l0_dir: Path | None = None,
    machine_binding_generated_at: str = "2026-08-26T02:01:00+08:00",
) -> tuple[dict[str, Any], Path]:
    bundle = json.loads((candidate_dir / ACCEPTANCE_TEMPLATE_NAME).read_text(encoding="utf-8"))
    _authorize_pbd_and_d1(
        paths,
        bundle,
        l0_dir=l0_dir,
        machine_binding_generated_at=machine_binding_generated_at,
    )
    review_path = paths.root / "data/basic60/review" / filename
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(json.dumps(bundle), encoding="utf-8")
    return bundle, review_path


def _canonical_payload_hash(payload: Any) -> str:
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()


def _complete_l0_batch_manifests(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    materialized_paths: list[Path],
    *,
    l0_dir: Path,
    output_prefix: str,
) -> dict[str, dict[str, str]]:
    registry_reference = bundle["source_admission"]["source_registry"]
    registry = json.loads((paths.root / registry_reference["path"]).read_text(encoding="utf-8"))
    sources = {item["source_ref"]: item for item in registry["sources"]}
    checked_at = "2026-08-25T11:00:00+08:00"
    references: dict[str, dict[str, str]] = {}
    for materialized_path in materialized_paths:
        manifest = json.loads(materialized_path.read_text(encoding="utf-8"))
        comparisons = []
        for pending in manifest["source_snapshot_comparisons"]:
            source = sources[pending["source_ref"]]
            snapshot = source["snapshots"][0]
            snapshot_bytes = _source_snapshot_bytes(pending["source_ref"])
            snapshot_digest = hashlib.sha256(snapshot_bytes).hexdigest()
            assert snapshot_digest == snapshot["content_sha256"]
            snapshot_path = l0_dir / "sha256" / snapshot_digest
            snapshot_path.parent.mkdir(parents=True, exist_ok=True)
            if not snapshot_path.exists():
                snapshot_path.write_bytes(snapshot_bytes)
            snapshot_path.chmod(0o444)
            current_snapshot = {
                "storage_mode": "external_l0",
                "volume_id": manifest["volume_id"],
                "object_key": f"sha256/{snapshot_digest}",
                "sha256": snapshot_digest,
                "byte_size": len(snapshot_bytes),
                "captured_at": checked_at,
                "retrieval_uri": f"https://example.test/snapshots/{pending['source_ref']}",
                "media_type": "text/csv",
            }
            retrieval_log = _write_artifact(
                paths,
                (
                    f"{output_prefix}/{manifest['batch_id'].lower()}-"
                    f"{pending['source_role']}.retrieval-log.json"
                ),
                {
                    "schema_version": "basic60.source-retrieval-log.v1",
                    "source_ref": pending["source_ref"],
                    "source_role": pending["source_role"],
                    "request": {
                        "method": "GET",
                        "uri": current_snapshot["retrieval_uri"],
                        "requested_at": "2026-08-25T10:59:00+08:00",
                        "access_method": source["access_method"],
                        "rate_limit": source["rate_limit"],
                    },
                    "response": {
                        "status_code": 200,
                        "retrieved_at": checked_at,
                        "media_type": current_snapshot["media_type"],
                        "content_sha256": snapshot_digest,
                        "byte_size": len(snapshot_bytes),
                        "object_key": current_snapshot["object_key"],
                        "access_signal": "none",
                    },
                },
            )
            source_evidence = json.loads(
                (paths.root / source["evidence"]["path"]).read_text(encoding="utf-8")
            )
            current_terms_snapshots = copy.deepcopy(_terms_snapshot_objects(source_evidence))
            current_terms_retrieval_logs = []
            for terms_index, terms_snapshot in enumerate(current_terms_snapshots):
                terms_snapshot["captured_at"] = checked_at
                current_terms_retrieval_logs.append(
                    _write_artifact(
                        paths,
                        (
                            f"{output_prefix}/{manifest['batch_id'].lower()}-"
                            f"{pending['source_role']}-terms-{terms_index}.retrieval-log.json"
                        ),
                        {
                            "schema_version": "basic60.source-retrieval-log.v1",
                            "source_ref": pending["source_ref"],
                            "source_role": pending["source_role"],
                            "request": {
                                "method": "GET",
                                "uri": terms_snapshot["retrieval_uri"],
                                "requested_at": "2026-08-25T10:59:00+08:00",
                                "access_method": source["access_method"],
                                "rate_limit": source["rate_limit"],
                            },
                            "response": {
                                "status_code": 200,
                                "retrieved_at": checked_at,
                                "media_type": terms_snapshot["media_type"],
                                "content_sha256": terms_snapshot["sha256"],
                                "byte_size": terms_snapshot["byte_size"],
                                "object_key": terms_snapshot.get("object_key"),
                                "access_signal": "none",
                            },
                        },
                    )
                )
            current_terms_fingerprint = _terms_fingerprint_sha256(
                source["terms_uri"],
                current_terms_snapshots,
            )
            comparisons.append(
                {
                    "source_ref": pending["source_ref"],
                    "source_role": pending["source_role"],
                    "approved_snapshot_ref": snapshot["snapshot_ref"],
                    "approved_snapshot_sha256": snapshot["content_sha256"],
                    "approved_terms_fingerprint_sha256": source["admission_fingerprint"][
                        "terms_fingerprint_sha256"
                    ],
                    "current_snapshot": current_snapshot,
                    "current_terms_snapshots": current_terms_snapshots,
                    "current_terms_retrieval_logs": current_terms_retrieval_logs,
                    "current_terms_fingerprint_sha256": current_terms_fingerprint,
                    "retrieval_log": retrieval_log,
                    "diff_artifact": None,
                    "comparison_status": "no_change",
                    "checked_at": checked_at,
                }
            )
        diff_report = _write_artifact(
            paths,
            f"{output_prefix}/{manifest['batch_id'].lower()}.diff-report.json",
            {
                "schema_version": "basic60.l0-diff-report.v1",
                "batch_id": manifest["batch_id"],
                "run_id": manifest["run_id"],
                "raw_root_sha256": manifest["raw_root_sha256"],
                "source_sha256": manifest["source_sha256"],
                "checked_at": checked_at,
                "diff_status": "no_change",
                "difference_count": 0,
                "resolved_difference_count": 0,
                "unresolved_difference_count": 0,
                "comparison_count": len(comparisons),
                "source_snapshot_comparisons_sha256": _canonical_payload_hash(comparisons),
            },
        )
        manifest.update(
            {
                "batch_status": "closed",
                "diff_status": "no_change",
                "diff_report": diff_report,
                "checked_at": checked_at,
                "source_snapshot_comparisons": comparisons,
                "watermark_advanced": True,
                "watermark": {
                    "committed_sha256": _canonical_payload_hash(
                        {
                            "source_sha256": manifest["source_sha256"],
                            "current_snapshot_sha256s": sorted(
                                item["current_snapshot"]["sha256"] for item in comparisons
                            ),
                            "diff_status": "no_change",
                            "difference_count": 0,
                        }
                    ),
                    "committed_at": checked_at,
                },
            }
        )
        references[manifest["batch_id"]] = _write_artifact(
            paths,
            f"{output_prefix}/{manifest['batch_id'].lower()}.completed.json",
            manifest,
        )
    for batch in bundle["collection"]["batches"]:
        batch.update(
            {
                "run_status": "succeeded",
                "access_signal": "none",
                "input_immutable": True,
                "diff_status": "no_change",
                "output_manifest": references[batch["batch_id"]],
                "status": "closed",
            }
        )
    return references


def _complete_v2_operation_logs(
    root: Path,
    seed_reference: dict[str, Any],
    seed: dict[str, Any],
    active_source_ref: str,
) -> dict[str, dict[str, Any]]:
    operations = _operation_logs(root, seed_reference)
    counts = _seed_counts(seed)
    returned_counts = {
        "countries": counts["countries"],
        "available_metric_values": counts["available_metric_values"],
        "pending_metric_values": counts["pending_metric_values"],
        "unavailable_metric_values": counts["unavailable_metric_values"],
    }
    post_import_tables = {
        "basic60_release_snapshots": 1,
        "basic60_countries": counts["countries"],
        "basic60_metric_values": counts["metric_values"],
    }
    post_import_states = {
        "available": counts["available_metric_values"],
        "pending": counts["pending_metric_values"],
        "unavailable": counts["unavailable_metric_values"],
    }

    for operation_name in ("empty_database_import", "release_rebuild"):
        operation = operations[operation_name]
        operation["events"][1]["returned_counts"] = copy.deepcopy(returned_counts)
        operation["events"][2]["table_counts"] = copy.deepcopy(post_import_tables)
        operation["events"][2]["metric_value_states"] = copy.deepcopy(post_import_states)

    for operation in operations.values():
        for event in operation["events"]:
            for source in event.get("sources", []):
                source["source_ref"] = active_source_ref
            if event.get("event_type") in {"source_revocation", "visibility_probe"}:
                event["source_ref"] = active_source_ref
        if operation["operation"] == "source_revocation":
            operation["inputs"]["source_ref"] = active_source_ref
        operation["events_sha256"] = canonical_sha256(operation["events"])

    operations["release_rebuild"]["inputs"]["reference_import_events_sha256"] = operations[
        "empty_database_import"
    ]["events_sha256"]
    return operations


def test_raw_fixture_recalculates_frozen_basic60_counts(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    _paths, raw_dir, _runtime_dir, _candidate_dir = basic60_fixture

    summary, checks = inspect_basic60_raw(raw_dir)

    assert checks == []
    assert summary == {
        "country_count": 60,
        "macro_annual_record_count": 300,
        "energy_latest_record_count": 60,
        "available_observation_count": EXPECTED_AVAILABLE_VALUES,
        "pending_observation_count": EXPECTED_PENDING_VALUES,
    }


def test_prepare_writes_real_values_only_to_ignored_runtime_and_stays_not_ready(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture

    written, assessment = prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)

    assert assessment["status"] == "not_ready"
    assert {path.name for path in written} == {
        SEED_NAME,
        SAMPLE_CANDIDATE_NAME,
        "basic60_sample_review_1.template.json",
        "basic60_sample_review_2.template.json",
        "basic60_item_review.template.json",
        PROFILE_NAME,
        SOURCE_MATRIX_NAME,
        "basic60-d3-parse.replay-manifest.json",
        "basic60-d3-standardize.replay-manifest.json",
        "basic60-d3-entity.replay-manifest.json",
        "basic60-d3-parse.stage.json",
        "basic60-d3-standardize.stage.json",
        "basic60-d3-entity.stage.json",
        COUNTRY_SOURCE_URI_MANIFEST_NAME,
        AI_USAGE_POLICY_NAME,
        SOURCE_REGISTRY_TEMPLATE_NAME,
        USAGE_AMENDMENT_TEMPLATE_NAME,
        HUMAN_APPROVAL_TEMPLATE_NAME,
        D1_SCOPE_AUTHORIZATION_TEMPLATE_NAME,
        RAW_MANIFEST_NAME,
        ACCEPTANCE_TEMPLATE_NAME,
        ASSESSMENT_NAME,
    }
    seed = json.loads((runtime_dir / SEED_NAME).read_text(encoding="utf-8"))
    assert len(seed["countries"]) == 60
    assert seed["publication_status"] == "candidate_not_approved"
    sample = json.loads((runtime_dir / SAMPLE_CANDIDATE_NAME).read_text(encoding="utf-8"))
    assert sample["sample_size"] == 180
    assert {item["iso3"] for item in sample["records"]} == {
        item["iso3"] for item in seed["countries"]
    }
    assert all(
        sum(record["iso3"] == iso3 for record in sample["records"]) == 3
        for iso3 in {item["iso3"] for item in seed["countries"]}
    )
    available_metrics = [
        metric
        for country in seed["countries"]
        for metric in country["metrics"]
        if metric["value_status"] == "available"
    ]
    assert sample["coverage"] == {
        "metric_codes": sorted({item["metric_code"] for item in available_metrics}),
        "periods": sorted(
            {str(item.get("period") or "not_applicable") for item in available_metrics}
        ),
        "source_refs": sorted({item["source_ref"] for item in available_metrics}),
    }
    tracked_payload = "\n".join(
        path.read_text(encoding="utf-8") for path in written if path.is_relative_to(candidate_dir)
    )
    assert "国家1" not in tracked_payload
    manifest = json.loads((candidate_dir / RAW_MANIFEST_NAME).read_text(encoding="utf-8"))
    assert manifest["excluded_zone_identifier_count"] == 1
    profile = json.loads((candidate_dir / PROFILE_NAME).read_text(encoding="utf-8"))
    assert profile["scope"]["coverage_level"] == "Basic"
    assert profile["scope"]["future_deep_dive_priority_country_codes"] == list(
        FUTURE_DEEP_DIVE_PRIORITY_COUNTRY_CODES
    )
    matrix = json.loads((candidate_dir / SOURCE_MATRIX_NAME).read_text(encoding="utf-8"))
    assert matrix["row_count"] == 180
    country_source_manifest = json.loads(
        (candidate_dir / COUNTRY_SOURCE_URI_MANIFEST_NAME).read_text(encoding="utf-8")
    )
    assert country_source_manifest["country_file_count"] == 60
    assert country_source_manifest["entry_count"] == 60
    assert country_source_manifest["entries_sha256"] == _canonical_payload_hash(
        country_source_manifest["entries"]
    )
    registry = json.loads(
        (candidate_dir / SOURCE_REGISTRY_TEMPLATE_NAME).read_text(encoding="utf-8")
    )
    assert registry["source_declaration"] == "official_public_data"
    assert registry["update_policy"] == {
        "mode": "manual_incremental",
        "reapproval_triggers": list(D1_REAPPROVAL_TRIGGERS),
    }
    policy = json.loads((candidate_dir / AI_USAGE_POLICY_NAME).read_text(encoding="utf-8"))
    assert policy["record_type"] == "basic60_ai_usage_scope_projection"
    assert policy["projection_type"] == "machine_generated_all_field_scope_projection"
    assert policy["permission_basis"] == USAGE_AMENDMENT_ID
    assert policy["usage_amendment"] is None
    assert policy["field_scope"]["field_count"] == len(policy["field_scope"]["fields"])
    assert policy["field_scope"]["fields_sha256"] == _canonical_payload_hash(
        policy["field_scope"]["fields"]
    )
    assert all(isinstance(item, str) for item in policy["field_scope"]["fields"])
    assert not any(
        field_name in item
        for item in policy["field_scope"]["fields"]
        for field_name in ("source_ref", "source_snapshot_ref", "raw_record_ref")
    )
    assert not any(policy["v1_runtime_capabilities"].values())
    assert len(registry["sources"]) == 3
    assert registry["country_source_uri_manifest"] == {
        "path": f"data/basic60/candidates/{COUNTRY_SOURCE_URI_MANIFEST_NAME}",
        "sha256": sha256_file(candidate_dir / COUNTRY_SOURCE_URI_MANIFEST_NAME),
    }
    assert all(
        item["admission_fingerprint"]["schema_fingerprint_sha256"]
        and item["admission_fingerprint"]["source_uri_fingerprint_sha256"]
        for item in registry["sources"]
    )
    assert all(
        item["admission_fingerprint"]["terms_fingerprint_sha256"] is None
        for item in registry["sources"]
    )
    assert {(item["data_domain"], item["source_role"]) for item in registry["sources"]} == {
        ("country_identity", "primary"),
        ("macro", "primary"),
        ("energy", "primary"),
    }
    assert "permission_basis" not in registry
    assert "ai_usage_policy" not in registry
    assert all(
        not {
            "license_scope",
            "ai_processing",
            "local_model_processing",
            "controlled_external_model_processing",
            "cloud_processing",
            "model_training",
        }.intersection(item)
        for item in registry["sources"]
    )
    acceptance_template = json.loads(
        (candidate_dir / ACCEPTANCE_TEMPLATE_NAME).read_text(encoding="utf-8")
    )
    assert acceptance_template["baseline_clarification"] == {
        "path": PBD_CLARIFICATION_PATH.as_posix(),
        "sha256": sha256_file(paths.root / PBD_CLARIFICATION_PATH),
    }
    assert acceptance_template["source_admission"]["approvals"] == [
        {
            "approval_type": "human_scope_authorization",
            "role": "项目批准人",
            "person_name": None,
            "decision": "pending",
            "signed_at": None,
            "scope_authorization_id": None,
            "scope_subject_sha256": None,
            "exact_content_hash_signed": False,
            "evidence": None,
        }
    ]
    assert acceptance_template["source_admission"]["authorized_scope"] is None
    assert acceptance_template["source_admission"]["scope_authorization_id"] is None
    assert acceptance_template["source_admission"]["machine_content_binding"] is None
    assert all(
        item["alternative_source_id"] is None
        for item in acceptance_template["source_admission"]["domains"]
    )
    for name in (
        "basic60_sample_review_1.template.json",
        "basic60_sample_review_2.template.json",
    ):
        review_template = json.loads((runtime_dir / name).read_text(encoding="utf-8"))
        assert review_template["template_only"] is True
        assert {item["outcome"] for item in review_template["items"]} == {None}
    item_template = json.loads(
        (runtime_dir / "basic60_item_review.template.json").read_text(encoding="utf-8")
    )
    assert item_template["template_only"] is True
    assert all(
        item["outcome"] is None for group in item_template["groups"] for item in group["items"]
    )

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        candidate_dir / ACCEPTANCE_TEMPLATE_NAME,
    )
    codes = {item["code"] for item in validation["checks"]}
    assert validation["status"] == "not_ready"
    assert {"B60_BASELINE_DECISION_MISSING", "B60_TEMPLATE_UNCOPIED"} <= codes


def test_d1_subject_ignores_value_only_raw_updates_but_d2_subject_does_not() -> None:
    bundle: dict[str, Any] = {
        "release_id": RELEASE_ID,
        "raw_root_sha256": "a" * 64,
        "baseline_clarification": {
            "path": PBD_CLARIFICATION_PATH.as_posix(),
            "sha256": "f" * 64,
        },
        "source_admission": {
            "source_registry": {"path": "data/basic60/evidence/registry.json", "sha256": "b" * 64},
            "country_domain_matrix": {
                "path": "data/basic60/candidates/matrix.json",
                "sha256": "c" * 64,
            },
            "derived_matrix_sha256": "d" * 64,
            "domains": [
                {
                    "domain_id": domain_id,
                    "primary_source_id": f"SRC-{domain_id.upper()}",
                    "alternative_source_id": None,
                    "status": "active",
                }
                for domain_id in DOMAIN_IDS
            ],
            "usage_boundaries": {
                "store_structured": "allowed",
                "private_display": "allowed",
                "private_export": "prohibited",
                "ai_index": "prohibited",
                "model_training": "prohibited",
                "cloud_processing": "prohibited",
            },
        },
        "collection": {
            "input_immutable": True,
            "batches": [],
            "incidents": [],
        },
    }
    before = approval_subjects(bundle)
    bundle["raw_root_sha256"] = "e" * 64
    after = approval_subjects(bundle)

    assert before["source"] == after["source"]
    assert before["collection"] != after["collection"]
    bundle["baseline_clarification"]["sha256"] = "1" * 64
    assert approval_subjects(bundle)["source"] != after["source"]


def test_value_only_raw_update_does_not_invalidate_d1_source_fingerprints(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    source_subject = approval_subjects(bundle)["source"]
    metric_rows = list(csv.DictReader((raw_dir / METRIC_CSV).open(encoding="utf-8")))
    metric_rows[0]["gdp_current_usd"] = "101"
    _write_csv(raw_dir / METRIC_CSV, METRIC_FIELDS, metric_rows)

    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
        _approved_terms_l0_dir(paths),
    )
    codes = {item["code"] for item in assessment["checks"]}

    assert approval_subjects(bundle)["source"] == source_subject
    assert assessment["status"] == "not_ready"
    assert "B60_SOURCE_SCHEMA_FINGERPRINT_MISMATCH" not in codes
    assert "B60_SOURCE_URI_FINGERPRINT_MISMATCH" not in codes
    assert "B60_SOURCE_TERMS_FINGERPRINT_MISMATCH" not in codes
    assert "B60_RAW_MANIFEST_DRIFT" in codes


def test_value_only_update_reuses_d1_and_recloses_d2_with_new_raw_binding(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    l0_dir = paths.root.parent / f"{paths.root.name}-value-update-l0"
    approved_bundle, _old_review_path = _write_d1_review_copy(
        paths,
        candidate_dir,
        l0_dir=l0_dir,
    )
    approved_source = copy.deepcopy(approved_bundle["source_admission"])
    approved_source_subject = approval_subjects(approved_bundle)["source"]
    old_raw_root = approved_bundle["raw_root_sha256"]
    metric_rows = list(csv.DictReader((raw_dir / METRIC_CSV).open(encoding="utf-8")))
    metric_rows[0]["gdp_current_usd"] = "101"
    _write_csv(raw_dir / METRIC_CSV, METRIC_FIELDS, metric_rows)

    refreshed_runtime_dir = runtime_dir / "value-update"
    refreshed_candidate_dir = candidate_dir / "value-update"
    prepare_basic60_private(paths, raw_dir, refreshed_runtime_dir, refreshed_candidate_dir)
    refreshed_bundle = json.loads(
        (refreshed_candidate_dir / ACCEPTANCE_TEMPLATE_NAME).read_text(encoding="utf-8")
    )
    refreshed_bundle["template_only"] = False
    for field in (
        "baseline_confirmation",
        "baseline_decision",
        "baseline_clarification",
        "usage_amendment",
    ):
        refreshed_bundle[field] = copy.deepcopy(approved_bundle[field])
    refreshed_bundle["source_admission"] = approved_source
    refreshed_bundle["source_admission"]["ai_usage_policy"] = refreshed_bundle["ai_usage_policy"]

    assert refreshed_bundle["raw_root_sha256"] != old_raw_root
    assert approval_subjects(refreshed_bundle)["source"] == approved_source_subject
    refreshed_review_path = paths.root / "data/basic60/review/value-update-d1-reused.json"
    refreshed_review_path.parent.mkdir(parents=True, exist_ok=True)
    refreshed_review_path.write_text(json.dumps(refreshed_bundle), encoding="utf-8")
    materialized = materialize_basic60_l0(
        paths,
        raw_dir,
        refreshed_candidate_dir / RAW_MANIFEST_NAME,
        refreshed_review_path,
        l0_dir,
        paths.root / "data/basic60/evidence/value-update",
        "basic60-value-update",
    )
    _complete_l0_batch_manifests(
        paths,
        refreshed_bundle,
        materialized,
        l0_dir=l0_dir,
        output_prefix="value-update-completed",
    )
    refreshed_bundle["collection"]["approval"] = _write_approval(
        paths,
        filename="value-update-batch-close",
        role="授权数据审核人",
        person="alice",
        subject_sha256=approval_subjects(refreshed_bundle)["collection"],
        signed_at="2026-08-25T11:30:00+08:00",
    )
    refreshed_review_path.write_text(json.dumps(refreshed_bundle), encoding="utf-8")

    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        refreshed_candidate_dir / RAW_MANIFEST_NAME,
        refreshed_runtime_dir / SEED_NAME,
        refreshed_review_path,
        l0_dir,
    )
    codes = {item["code"] for item in assessment["checks"]}

    assert assessment["status"] == "not_ready"
    assert not any(code.startswith("B60_SOURCE_") for code in codes)
    assert not any(code.startswith("B60_BATCH_") for code in codes)


def test_macro_source_url_change_is_a_d1_blocker(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    _bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    metric_rows = list(csv.DictReader((raw_dir / METRIC_CSV).open(encoding="utf-8")))
    metric_rows[0]["macro_source_url"] = "https://example.test/changed-official-source"
    _write_csv(raw_dir / METRIC_CSV, METRIC_FIELDS, metric_rows)

    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
    )

    assert assessment["status"] == "not_ready"
    codes = {item["code"] for item in assessment["checks"]}
    assert "B60_SOURCE_URI_FINGERPRINT_MISMATCH" in codes
    assert "B60_D1_REAPPROVAL_REQUIRED" in codes


def test_source_url_change_cannot_rebind_existing_scope_authorization_id(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    approved_bundle, _approved_review_path = _write_d1_review_copy(paths, candidate_dir)
    old_scope_subject = approval_subjects(approved_bundle)["source_scope"]
    old_content_subject = approval_subjects(approved_bundle)["source"]

    metric_rows = list(csv.DictReader((raw_dir / METRIC_CSV).open(encoding="utf-8")))
    metric_rows[0]["macro_source_url"] = "https://example.test/new-official-endpoint"
    _write_csv(raw_dir / METRIC_CSV, METRIC_FIELDS, metric_rows)
    refreshed_runtime = runtime_dir / "url-refresh"
    refreshed_candidates = candidate_dir / "url-refresh"
    prepare_basic60_private(paths, raw_dir, refreshed_runtime, refreshed_candidates)
    refreshed = json.loads(
        (refreshed_candidates / ACCEPTANCE_TEMPLATE_NAME).read_text(encoding="utf-8")
    )
    refreshed["template_only"] = False
    for field in (
        "baseline_confirmation",
        "baseline_decision",
        "baseline_clarification",
        "usage_amendment",
    ):
        refreshed[field] = copy.deepcopy(approved_bundle[field])
    refreshed_source = refreshed["source_admission"]
    registry_template = json.loads(
        (refreshed_candidates / SOURCE_REGISTRY_TEMPLATE_NAME).read_text(encoding="utf-8")
    )
    refreshed_registry = {
        "schema_version": 1,
        "profile_id": "basic60_private",
        "release_id": RELEASE_ID,
        "template_only": False,
        "source_declaration": "official_public_data",
        "update_policy": {
            "mode": "manual_incremental",
            "reapproval_triggers": ["source_url", "terms", "structure"],
        },
        "country_source_uri_manifest": registry_template["country_source_uri_manifest"],
        "sources": _approved_sources(paths),
    }
    refreshed_source["source_registry"] = _write_artifact(
        paths,
        "approved_source_registry-url-refresh.json",
        refreshed_registry,
    )
    refreshed_source["domains"] = copy.deepcopy(approved_bundle["source_admission"]["domains"])
    refreshed_source["usage_boundaries"] = copy.deepcopy(
        approved_bundle["source_admission"]["usage_boundaries"]
    )
    matrix_reference = refreshed_source["country_domain_matrix"]
    matrix = json.loads((paths.root / matrix_reference["path"]).read_text(encoding="utf-8"))
    domain_index = {item["domain_id"]: item for item in refreshed_source["domains"]}
    refreshed_source["derived_matrix_sha256"] = _canonical_payload_hash(
        [
            {
                "iso3": row["iso3"],
                "domain_id": row["domain_id"],
                "primary_source_id": domain_index[row["domain_id"]]["primary_source_id"],
                "alternative_source_id": domain_index[row["domain_id"]]["alternative_source_id"],
            }
            for row in matrix["rows"]
        ]
    )
    refreshed_source["scope_authorization_id"] = approved_bundle["source_admission"][
        "scope_authorization_id"
    ]
    refreshed_source["authorized_scope"] = build_d1_authorized_scope(
        refreshed,
        refreshed_registry,
    )
    refreshed_source["approvals"] = copy.deepcopy(approved_bundle["source_admission"]["approvals"])

    assert approval_subjects(refreshed)["source_scope"] == old_scope_subject
    assert approval_subjects(refreshed)["source"] != old_content_subject
    ledger_l0_dir = _approved_terms_l0_dir(paths)
    with pytest.raises(ValueError, match="B60_D1_MACHINE_BASELINE_ALREADY_BOUND"):
        write_d1_machine_baseline_evidence(
            paths,
            refreshed,
            refreshed_registry,
            l0_dir=ledger_l0_dir,
            volume_id="basic60-test-ledger",
            generated_at="2026-08-26T03:00:00+08:00",
        )
    refreshed_source["machine_content_binding"] = copy.deepcopy(
        approved_bundle["source_admission"]["machine_content_binding"]
    )
    review_path = paths.root / "data/basic60/review/url-refresh-old-scope.json"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(json.dumps(refreshed), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        refreshed_candidates / RAW_MANIFEST_NAME,
        refreshed_runtime / SEED_NAME,
        review_path,
        ledger_l0_dir,
    )
    codes = {item["code"] for item in validation["checks"]}
    assert validation["status"] == "not_ready"
    assert "B60_D1_REAPPROVAL_REQUIRED" in codes


def test_sealed_external_d1_ledger_blocks_unlink_and_rebind_for_update_account(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle, _review_path = _write_d1_review_copy(paths, candidate_dir)
    l0_dir = _approved_terms_l0_dir(paths)
    binding_reference = bundle["source_admission"]["machine_content_binding"]
    anchor_path = l0_dir.joinpath(*PurePosixPath(binding_reference["object_key"]).parts)
    ledger_root = l0_dir.joinpath(*D1_MACHINE_BASELINE_ROOT.parts)
    registry_reference = bundle["source_admission"]["source_registry"]
    registry = json.loads((paths.root / registry_reference["path"]).read_text(encoding="utf-8"))

    assert stat.S_IMODE(ledger_root.stat().st_mode) == 0o555
    assert stat.S_IMODE(anchor_path.parent.stat().st_mode) == 0o555
    assert not os.access(ledger_root, os.W_OK)
    assert not os.access(anchor_path.parent, os.W_OK)
    with pytest.raises(PermissionError):
        anchor_path.unlink()
    with pytest.raises(ValueError, match="B60_D1_MACHINE_BASELINE_ALREADY_BOUND"):
        write_d1_machine_baseline_evidence(
            paths,
            bundle,
            registry,
            l0_dir=l0_dir,
            volume_id="basic60-test-ledger",
            generated_at="2026-08-26T03:00:00+08:00",
        )

    # Test cleanup only: production unsealing is a D1-admin operation after new approval.
    for directory in (ledger_root, ledger_root / "authorizations", ledger_root / "sha256"):
        directory.chmod(0o755)


def test_d1_admin_writer_does_not_require_its_own_trusted_paths_to_be_read_only(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths, raw_dir, _runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, paths.root / "runtime/admin", candidate_dir)
    monkeypatch.setattr(
        basic60_private_module,
        "_runtime_account_can_write",
        lambda _path: True,
    )

    bundle, _review_path = _write_d1_review_copy(paths, candidate_dir)

    assert bundle["source_admission"]["machine_content_binding"]["storage_mode"] == "external_l0"


def test_alternate_l0_root_cannot_reuse_trusted_volume_and_scope_authorization(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    trusted_l0 = _approved_terms_l0_dir(paths)
    trusted_validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
        trusted_l0,
    )
    trusted_codes = {item["code"] for item in trusted_validation["checks"]}
    assert "B60_D1_TRUSTED_VOLUME_MISMATCH" not in trusted_codes
    assert "B60_D1_TRUSTED_VOLUME_REGISTRY_INVALID" not in trusted_codes
    assert "B60_D1_TRUSTED_VOLUME_ROOT_UNSAFE" not in trusted_codes
    alternate_l0 = paths.root.parent / f"{paths.root.name}-alternate-l0"
    shutil.copytree(trusted_l0, alternate_l0)

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
        alternate_l0,
    )
    codes = {item["code"] for item in validation["checks"]}
    assert validation["status"] == "not_ready"
    assert "B60_D1_TRUSTED_VOLUME_MISMATCH" in codes
    assert "B60_D1_REAPPROVAL_REQUIRED" in codes

    registry_reference = bundle["source_admission"]["source_registry"]
    registry = json.loads((paths.root / registry_reference["path"]).read_text(encoding="utf-8"))
    with pytest.raises(ValueError, match="B60_D1_TRUSTED_VOLUME_MISMATCH"):
        write_d1_machine_baseline_evidence(
            paths,
            bundle,
            registry,
            l0_dir=alternate_l0,
            volume_id=bundle["source_admission"]["machine_content_binding"]["volume_id"],
            generated_at="2026-08-26T03:00:00+08:00",
        )


def test_same_canonical_l0_root_replacement_through_writable_parent_is_rejected(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    _bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    trusted_l0 = _approved_terms_l0_dir(paths)
    writable_parent = trusted_l0.parent.resolve()
    displaced_l0 = writable_parent / "displaced-basic60-l0"

    trusted_l0.rename(displaced_l0)
    shutil.copytree(displaced_l0, trusted_l0)
    monkeypatch.setattr(
        basic60_private_module,
        "_runtime_account_can_write",
        lambda path: path.resolve(strict=False) == writable_parent,
    )

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
        trusted_l0,
    )
    codes = {item["code"] for item in validation["checks"]}

    assert validation["status"] == "not_ready"
    assert "B60_D1_TRUSTED_VOLUME_ROOT_UNSAFE" in codes
    assert "B60_D1_TRUSTED_VOLUME_MISMATCH" not in codes

    # Test cleanup only; both copies remain sealed during validation.
    for root in (trusted_l0, displaced_l0):
        ledger_root = root.joinpath(*D1_MACHINE_BASELINE_ROOT.parts)
        for directory in (ledger_root, ledger_root / "authorizations", ledger_root / "sha256"):
            directory.chmod(0o755)


def test_macro_source_urls_cannot_be_swapped_between_years(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    metric_rows = list(csv.DictReader((raw_dir / METRIC_CSV).open(encoding="utf-8")))
    metric_rows[0]["macro_source_url"] = "https://example.test/macro/2020"
    metric_rows[1]["macro_source_url"] = "https://example.test/macro/2021"
    _write_csv(raw_dir / METRIC_CSV, METRIC_FIELDS, metric_rows)
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    _bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    metric_rows[0]["macro_source_url"], metric_rows[1]["macro_source_url"] = (
        metric_rows[1]["macro_source_url"],
        metric_rows[0]["macro_source_url"],
    )
    _write_csv(raw_dir / METRIC_CSV, METRIC_FIELDS, metric_rows)

    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
    )

    assert assessment["status"] == "not_ready"
    assert "B60_SOURCE_URI_FINGERPRINT_MISMATCH" in {item["code"] for item in assessment["checks"]}


def test_country_profile_source_manifest_change_is_a_d1_blocker(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    _bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    country_path = next(raw_dir.glob("countries/*/00_country_profile/country_profile.json"))
    country = json.loads(country_path.read_text(encoding="utf-8"))
    country["sources"][0]["url"] = "https://example.test/changed-country-source"
    country_path.write_text(json.dumps(country), encoding="utf-8")

    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
    )
    codes = {item["code"] for item in assessment["checks"]}

    assert assessment["status"] == "not_ready"
    assert "B60_SOURCE_URI_MANIFEST_CHANGED" in codes
    assert "B60_SOURCE_URI_FINGERPRINT_MISMATCH" in codes


def test_country_profile_source_iso3_must_match_path_and_profile_csv(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    _bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    country_path = next(raw_dir.glob("countries/*/00_country_profile/country_profile.json"))
    country = json.loads(country_path.read_text(encoding="utf-8"))
    country["iso3"] = "ZZZ"
    country_path.write_text(json.dumps(country), encoding="utf-8")

    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
    )
    codes = {item["code"] for item in assessment["checks"]}

    assert assessment["status"] == "not_ready"
    assert "B60_SOURCE_URI_MANIFEST_INVALID" in codes
    assert "B60_SOURCE_ADMISSION_FINGERPRINT_INVALID" in codes


def test_raw_csv_header_change_is_a_d1_blocker(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    _bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    metric_rows = list(csv.DictReader((raw_dir / METRIC_CSV).open(encoding="utf-8")))
    expanded_fields = (*METRIC_FIELDS, "unexpected_structure_field")
    for row in metric_rows:
        row["unexpected_structure_field"] = ""
    _write_csv(raw_dir / METRIC_CSV, expanded_fields, metric_rows)

    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
    )

    assert assessment["status"] == "not_ready"
    assert "B60_SOURCE_SCHEMA_FINGERPRINT_MISMATCH" in {
        item["code"] for item in assessment["checks"]
    }


def test_d1_simplification_requires_the_hash_bound_governance_clarification(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle = json.loads((candidate_dir / ACCEPTANCE_TEMPLATE_NAME).read_text(encoding="utf-8"))
    _authorize_pbd_and_d1(paths, bundle)
    clarification_path = paths.root / PBD_CLARIFICATION_PATH
    clarification = json.loads(clarification_path.read_text(encoding="utf-8"))
    clarification["d1_internal_review"]["alternative_sources_required"] = True
    clarification_path.write_text(json.dumps(clarification), encoding="utf-8")
    bundle["baseline_clarification"]["sha256"] = sha256_file(clarification_path)
    subject = approval_subjects(bundle)["source"]
    bundle["source_admission"]["approvals"] = [
        _write_approval(
            paths,
            filename="source-invalid-clarification",
            role="项目批准人",
            person="kevin",
            subject_sha256=subject,
        )
    ]
    review_path = paths.root / "data/basic60/review/invalid-clarification.json"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
    )

    assert "B60_BASELINE_CLARIFICATION_INVALID" in {item["code"] for item in validation["checks"]}


def test_self_reported_approval_without_hash_bound_evidence_cannot_pass(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle_path = candidate_dir / ACCEPTANCE_TEMPLATE_NAME
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    bundle["template_only"] = False
    for index, domain in enumerate(bundle["source_admission"]["domains"]):
        domain.update(
            {
                "primary_source_id": f"PRIMARY-{index}",
                "alternative_source_id": None,
                "status": "active",
            }
        )
    bundle["source_admission"]["usage_boundaries"] = {
        "store_structured": "allowed",
        "private_display": "allowed",
        "private_export": "prohibited",
        "ai_index": "prohibited",
        "model_training": "prohibited",
        "cloud_processing": "prohibited",
    }
    subject = approval_subjects(bundle)["source"]
    bundle["source_admission"]["approvals"] = [
        {
            "role": "项目批准人",
            "person_name": "kevin",
            "decision": "approved",
            "signed_at": "2026-08-25T10:00:00+08:00",
            "subject_sha256": subject,
            "evidence": None,
        }
    ]
    completed = candidate_dir / "self_reported.json"
    completed.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        completed,
    )

    assert validation["status"] == "not_ready"
    codes = {item["code"] for item in validation["checks"]}
    assert "B60_D1_LEGACY_PRECISE_SIGNATURE_REJECTED" in codes
    assert "B60_D1_SCOPE_AUTHORIZATION_INVALID" in codes


def test_d1_rejects_early_human_signature_over_later_exact_content_hashes(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    exact_content_subject = approval_subjects(bundle)["source"]
    bundle["source_admission"]["approvals"] = [
        _write_approval(
            paths,
            filename="legacy-early-exact-content-signature",
            role="项目批准人",
            person="kevin",
            subject_sha256=exact_content_subject,
            signed_at="2026-08-26T00:21:49+08:00",
        )
    ]
    review_path.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
    )

    codes = {item["code"] for item in validation["checks"]}
    assert validation["status"] == "not_ready"
    assert "B60_D1_LEGACY_PRECISE_SIGNATURE_REJECTED" in codes
    assert "B60_D1_SCOPE_AUTHORIZATION_INVALID" in codes


def test_d1_machine_content_binding_must_follow_terms_capture(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    _bundle, review_path = _write_d1_review_copy(
        paths,
        candidate_dir,
        machine_binding_generated_at="2026-08-26T01:00:00+08:00",
    )

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
        _approved_terms_l0_dir(paths),
    )

    assert "B60_D1_MACHINE_CONTENT_BINDING_PREMATURE" in {
        item["code"] for item in validation["checks"]
    }


@pytest.mark.parametrize(
    ("people", "expected_code"),
    (
        (("mallory",), "B60_SOURCE_PROJECT_APPROVER_INVALID"),
        (("kevin", "mallory"), "B60_SOURCE_APPROVAL_COUNT_INVALID"),
    ),
)
def test_d1_source_admission_requires_one_kevin_project_approval(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
    people: tuple[str, ...],
    expected_code: str,
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle = json.loads((candidate_dir / ACCEPTANCE_TEMPLATE_NAME).read_text(encoding="utf-8"))
    _authorize_pbd_and_d1(paths, bundle)
    subject = approval_subjects(bundle)["source_scope"]
    bundle["source_admission"]["approvals"] = [
        _write_d1_scope_authorization(
            paths,
            filename=f"source-project-{index}",
            person=person,
            scope_authorization_id=bundle["source_admission"]["scope_authorization_id"],
            scope_subject_sha256=subject,
        )
        for index, person in enumerate(people, start=1)
    ]
    review_path = paths.root / "data/basic60/review/d1-project-approval.json"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
    )

    assert expected_code in {item["code"] for item in validation["checks"]}


def test_raw_drift_invalidates_manifest_and_seed_binding(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    (raw_dir / "late-file.txt").write_text("drift", encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        candidate_dir / ACCEPTANCE_TEMPLATE_NAME,
    )

    assert validation["status"] == "not_ready"
    assert "B60_RAW_MANIFEST_DRIFT" in {item["code"] for item in validation["checks"]}


def test_new_runtime_profile_excludes_comparison_without_changing_data_or_formal_gates() -> None:
    profile = basic60_private_module.build_profile()
    assert profile["scope"]["read_only_routes"] == [
        "GET /api/v1/countries",
        "GET /api/v1/countries/{code}",
    ]
    assert profile["scope"]["countries"] == 60
    assert profile["expected_counts"]["countries"] == 60
    assert profile["release_id"] == "BASIC60-PRIVATE-R1"
    assert profile["formal_gate_status"] == "pending"
    assert profile["does_not_complete_formal_d1_d4"] is True
    assert profile["does_not_authorize_p0_or_production"] is True


def test_profile_source_matrix_and_replay_candidates_reject_tampering(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle_path = candidate_dir / ACCEPTANCE_TEMPLATE_NAME
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))

    profile_path = paths.root / bundle["profile"]["path"]
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    profile["scope"]["future_deep_dive_priority_country_codes"].append("LKA")
    profile_path.write_text(json.dumps(profile), encoding="utf-8")
    bundle["profile"]["sha256"] = sha256_file(profile_path)

    matrix_ref = bundle["source_admission"]["country_domain_matrix"]
    matrix_path = paths.root / matrix_ref["path"]
    matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
    matrix["rows"].pop()
    matrix_path.write_text(json.dumps(matrix), encoding="utf-8")
    matrix_ref["sha256"] = sha256_file(matrix_path)

    replay_ref = bundle["processing"]["pipelines"][0]["replay_manifest"]
    replay_path = paths.root / replay_ref["path"]
    replay_path.write_text(json.dumps({"artifact": "placeholder"}), encoding="utf-8")
    replay_ref["sha256"] = sha256_file(replay_path)
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        bundle_path,
    )
    codes = {item["code"] for item in validation["checks"]}
    assert "B60_PROFILE_CONTENT_INVALID" in codes
    assert "B60_SOURCE_MATRIX_CONTENT_INVALID" in codes
    assert "B60_PIPELINE_REPLAY_CONTENT_INVALID" in codes


def test_d3_runtime_stage_hash_updates_cannot_replace_independent_replay(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle_path = candidate_dir / ACCEPTANCE_TEMPLATE_NAME
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    replay_reference = bundle["processing"]["pipelines"][0]["replay_manifest"]
    replay_path = paths.root / replay_reference["path"]
    replay = json.loads(replay_path.read_text(encoding="utf-8"))
    stage_path = paths.root / replay["runtime_stage"]["path"]
    stage = json.loads(stage_path.read_text(encoding="utf-8"))
    stage["records"][0]["original_value"] = "999999"
    stage_path.write_text(json.dumps(stage), encoding="utf-8")
    forged_hash = sha256_file(stage_path)
    replay["runtime_stage"].update({"sha256": forged_hash, "byte_size": stage_path.stat().st_size})
    replay["stage_payload_sha256"] = forged_hash
    replay["independent_replay_sha256"] = {"first": forged_hash, "second": forged_hash}
    replay_path.write_text(json.dumps(replay), encoding="utf-8")
    replay_reference["sha256"] = sha256_file(replay_path)
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        bundle_path,
    )

    assert "B60_PIPELINE_REPLAY_CONTENT_INVALID" in {item["code"] for item in validation["checks"]}


def test_source_evidence_content_is_not_replaceable_by_a_hash_updated_placeholder(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle = json.loads((candidate_dir / ACCEPTANCE_TEMPLATE_NAME).read_text(encoding="utf-8"))
    _authorize_pbd_and_d1(paths, bundle)
    registry_ref = bundle["source_admission"]["source_registry"]
    registry_path = paths.root / registry_ref["path"]
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    source = registry["sources"][0]
    evidence_path = paths.root / source["evidence"]["path"]
    evidence_path.write_text(json.dumps({"artifact": "placeholder"}), encoding="utf-8")
    source["evidence"]["sha256"] = sha256_file(evidence_path)
    source["evidence_sha256"] = sha256_file(evidence_path)
    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    registry_ref["sha256"] = sha256_file(registry_path)
    review_path = paths.root / "data/basic60/review/source-evidence-tampered.json"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
    )
    assert "B60_SOURCE_EVIDENCE_CONTENT_INVALID" in {item["code"] for item in validation["checks"]}


@pytest.mark.parametrize("data_domain", ("country_identity", "macro", "energy"))
def test_source_evidence_reopens_exact_official_terms_originals_from_external_l0(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
    data_domain: str,
) -> None:
    paths, _raw_dir, _runtime_dir, _candidate_dir = basic60_fixture
    l0_dir = paths.root.parent / f"{paths.root.name}-{data_domain}-terms-l0"
    object_dir = l0_dir / "sha256"
    object_dir.mkdir(parents=True)
    captured_at = "2026-08-26T01:22:03+08:00"
    terms_snapshots = []
    for uri in SOURCE_TERMS_URI_REQUIREMENTS[data_domain]:
        payload = f"official test source bytes for {uri}\n".encode()
        digest = hashlib.sha256(payload).hexdigest()
        object_path = object_dir / digest
        object_path.write_bytes(payload)
        object_path.chmod(0o444)
        terms_snapshots.append(
            {
                "storage_mode": "external_l0",
                "sha256": digest,
                "byte_size": len(payload),
                "captured_at": captured_at,
                "retrieval_uri": uri,
                "canonical_url": uri,
                "media_type": "text/plain",
                "capture_method": "official_https_download",
                "volume_id": "basic60-test-terms-l0",
                "object_key": f"sha256/{digest}",
            }
        )
    source_ref = f"SRC-{data_domain.upper()}-PRIMARY"
    item: dict[str, Any] = {
        "data_domain": data_domain,
        "terms_uri": SOURCE_TERMS_URI_REQUIREMENTS[data_domain][0],
        "access_method": "approved_snapshot",
        "rate_limit": "manual_refresh_only",
        "snapshots": [{"captured_at": "2026-08-22T00:00:00+08:00"}],
    }
    evidence = {
        "schema_version": SOURCE_EVIDENCE_SCHEMA,
        "source_ref": source_ref,
        "terms_snapshots": terms_snapshots,
        "captured_at": "2026-08-22T00:00:00+08:00",
    }
    evidence_path = paths.root / f"data/basic60/evidence/{data_domain}-official-terms.json"
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    item["evidence"] = {
        "path": evidence_path.relative_to(paths.root).as_posix(),
        "sha256": sha256_file(evidence_path),
    }
    item["evidence_sha256"] = item["evidence"]["sha256"]

    checks = []
    _validate_source_evidence(checks, paths, source_ref, item, l0_dir=l0_dir)

    assert checks == []


def test_repository_json_summary_cannot_masquerade_as_official_terms_original(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, _raw_dir, _runtime_dir, _candidate_dir = basic60_fixture
    terms_uri = SOURCE_TERMS_URI_REQUIREMENTS["macro"][0]
    summary_path = paths.root / "data/basic60/evidence/self-authored-terms-summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps({"conclusion": "allowed"}), encoding="utf-8")
    digest = sha256_file(summary_path)
    snapshot = {
        "storage_mode": "repository_public",
        "sha256": digest,
        "byte_size": summary_path.stat().st_size,
        "captured_at": "2026-08-26T01:22:03+08:00",
        "retrieval_uri": terms_uri,
        "canonical_url": terms_uri,
        "media_type": "application/json",
        "capture_method": "official_https_download",
        "path": summary_path.relative_to(paths.root).as_posix(),
        "public_and_redacted": True,
    }
    source_ref = "SRC-MACRO-PRIMARY"
    evidence = {
        "schema_version": SOURCE_EVIDENCE_SCHEMA,
        "source_ref": source_ref,
        "terms_snapshots": [snapshot],
        "captured_at": "2026-08-22T00:00:00+08:00",
    }
    evidence_path = paths.root / "data/basic60/evidence/self-authored-source-evidence.json"
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    item = {
        "data_domain": "macro",
        "terms_uri": terms_uri,
        "access_method": "approved_snapshot",
        "rate_limit": "manual_refresh_only",
        "snapshots": [{"captured_at": "2026-08-22T00:00:00+08:00"}],
        "evidence": {
            "path": evidence_path.relative_to(paths.root).as_posix(),
            "sha256": sha256_file(evidence_path),
        },
        "evidence_sha256": sha256_file(evidence_path),
    }

    checks = []
    _validate_source_evidence(checks, paths, source_ref, item, l0_dir=None)

    assert "B60_EVIDENCE_OBJECT_INVALID" in {check.code for check in checks}
    assert "B60_SOURCE_TERMS_ORIGINALS_INVALID" in {check.code for check in checks}


def test_d4_generic_artifact_placeholders_and_self_reported_duplicates_are_rejected(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle_path = candidate_dir / ACCEPTANCE_TEMPLATE_NAME
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    acceptance = bundle["acceptance"]
    acceptance.update(
        {
            "chinese_names_reviewed": 60,
            "sample_accurate_count": 180,
            "duplicate_count": 1,
            "pending_values_reviewed": 61,
            "derived_values_reviewed": 120,
            "unresolved_p0_data_issue_count": 0,
        }
    )
    acceptance["artifacts"] = {
        name: _write_artifact(paths, f"placeholder-{name}.json")
        for name in (
            "sample_manifest",
            "chinese_names_review",
            "pending_values_review",
            "derived_values_review",
            "empty_database_import",
            "release_rebuild",
            "previous_release_rollback",
            "source_revocation",
            "api_performance",
            "isolation_check",
        )
    }
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        bundle_path,
    )
    codes = {item["code"] for item in validation["checks"]}
    assert "B60_DUPLICATE_COUNT_INVALID" in codes
    assert "B60_SAMPLE_REVIEW_MANIFEST_INVALID" in codes
    assert "B60_ITEM_REVIEW_MANIFEST_INVALID" in codes
    assert "B60_ACCEPTANCE_ARTIFACT_SET_INVALID" in codes
    assert "B60_MACHINE_EVIDENCE_INVALID" in codes


def test_d4_hash_updated_review_manifests_still_reject_missing_item_ids(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle_path = candidate_dir / ACCEPTANCE_TEMPLATE_NAME
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    acceptance = bundle["acceptance"]
    seed_reference = bundle["runtime_seed"]
    seed = json.loads((paths.root / seed_reference["path"]).read_text(encoding="utf-8"))
    sample_reference = acceptance["sample_candidate"]
    sample = json.loads((paths.root / sample_reference["path"]).read_text(encoding="utf-8"))

    sample_template = build_basic60_sample_review_manifest(sample_reference, sample, review_slot=1)
    sample_manifest = _complete_sample_review(sample_template, reviewer_name="carol")
    sample_manifest["items"].pop()
    sample_manifest["items_sha256"] = _canonical_payload_hash(sample_manifest["items"])

    item_template = build_basic60_item_review_manifest(seed_reference, seed)
    item_manifest = _complete_item_review(
        item_template,
        seed,
        reviewer_name="alice",
    )
    pending_group = next(
        group for group in item_manifest["groups"] if group["review_type"] == "pending_values"
    )
    pending_group["items"].pop()
    pending_group["item_count"] = len(pending_group["items"])
    item_manifest["groups_sha256"] = _canonical_payload_hash(item_manifest["groups"])

    acceptance.update(
        {
            "chinese_names_reviewed": 60,
            "sample_accurate_count": 179,
            "duplicate_count": 0,
            "pending_values_reviewed": 61,
            "derived_values_reviewed": 120,
            "unresolved_p0_data_issue_count": 0,
        }
    )
    acceptance["artifacts"]["sample_reviews"] = [
        _write_runtime_review(paths, "sample-missing-id.json", sample_manifest),
        None,
    ]
    acceptance["artifacts"]["item_review"] = _write_runtime_review(
        paths, "item-missing-id.json", item_manifest
    )
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        bundle_path,
    )
    codes = {item["code"] for item in validation["checks"]}
    assert "B60_SAMPLE_REVIEW_CONTENT_INVALID" in codes
    assert "B60_ITEM_REVIEW_CONTENT_INVALID" in codes


def test_l0_materialization_rejects_unapproved_bundle_before_any_write(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    review_path = paths.root / "data/basic60/review/unapproved.json"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_bytes((candidate_dir / ACCEPTANCE_TEMPLATE_NAME).read_bytes())
    l0_dir = paths.root.parent / f"{paths.root.name}-unapproved-l0"
    evidence_dir = paths.root / "data/basic60/evidence/unapproved-l0"

    with pytest.raises(ValueError, match="B60_L0_AUTHORIZATION_FAILED"):
        materialize_basic60_l0(
            paths,
            raw_dir,
            candidate_dir / RAW_MANIFEST_NAME,
            review_path,
            l0_dir,
            evidence_dir,
            "basic60-unapproved",
        )

    assert not l0_dir.exists()
    assert not evidence_dir.exists()


def test_l0_materialization_rejects_tampered_terms_snapshot_before_any_write(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    l0_dir = paths.root.parent / f"{paths.root.name}-terms-tamper-l0"
    bundle, review_path = _write_d1_review_copy(paths, candidate_dir, l0_dir=l0_dir)
    registry_reference = bundle["source_admission"]["source_registry"]
    registry = json.loads((paths.root / registry_reference["path"]).read_text(encoding="utf-8"))
    evidence_reference = registry["sources"][0]["evidence"]
    evidence = json.loads((paths.root / evidence_reference["path"]).read_text(encoding="utf-8"))
    terms_path = l0_dir / evidence["terms_snapshots"][0]["object_key"]
    terms_path.chmod(0o644)
    terms_path.write_text("tampered public terms\n", encoding="utf-8")
    initial_object_names = {path.name for path in (l0_dir / "sha256").iterdir()}
    evidence_dir = paths.root / "data/basic60/evidence/terms-tamper-l0"

    with pytest.raises(ValueError, match="B60_EVIDENCE_OBJECT_CONTENT_INVALID"):
        materialize_basic60_l0(
            paths,
            raw_dir,
            candidate_dir / RAW_MANIFEST_NAME,
            review_path,
            l0_dir,
            evidence_dir,
            "basic60-terms-tamper",
        )

    assert {path.name for path in (l0_dir / "sha256").iterdir()} == initial_object_names
    assert not evidence_dir.exists()


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("access_method", ""),
        ("rate_limit", None),
        ("license_scope", {"store": True}),
        ("ai_processing", "allowed_by_manual_decision"),
        ("local_model_processing", "allowed_by_manual_decision"),
        ("controlled_external_model_processing", "allowed_by_manual_decision"),
        ("cloud_processing", "allowed_by_manual_decision"),
        ("model_training", "prohibited"),
    ),
)
def test_l0_materialization_requires_audit_only_source_contracts(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
    field: str,
    value: Any,
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    registry_reference = bundle["source_admission"]["source_registry"]
    registry_path = paths.root / registry_reference["path"]
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    source = registry["sources"][0]
    source[field] = value
    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    registry_reference["sha256"] = sha256_file(registry_path)
    review_path.write_text(json.dumps(bundle), encoding="utf-8")

    with pytest.raises(ValueError, match="B60_SOURCE_REGISTRY_ENTRY_INVALID"):
        materialize_basic60_l0(
            paths,
            raw_dir,
            candidate_dir / RAW_MANIFEST_NAME,
            review_path,
            paths.root.parent / f"{paths.root.name}-invalid-source-l0",
            paths.root / "data/basic60/evidence/invalid-source-l0",
            "basic60-invalid-source",
        )


def test_l0_materialization_rejects_broad_overlapping_and_symlink_targets(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    _bundle, review_path = _write_d1_review_copy(paths, candidate_dir)
    evidence_dir = paths.root / "data/basic60/evidence/unsafe-target"

    for unsafe_target, error_code in (
        (Path("/"), "B60_L0_TARGET_BROAD"),
        (paths.root / "l0", "B60_L0_TARGET_OVERLAP"),
        (raw_dir, "B60_L0_TARGET_OVERLAP"),
    ):
        with pytest.raises(ValueError, match=error_code):
            materialize_basic60_l0(
                paths,
                raw_dir,
                candidate_dir / RAW_MANIFEST_NAME,
                review_path,
                unsafe_target,
                evidence_dir,
                "basic60-unsafe-target",
            )
    assert not evidence_dir.exists()

    actual_target = paths.root.parent / f"{paths.root.name}-actual-l0"
    actual_target.mkdir()
    symlink_target = paths.root.parent / f"{paths.root.name}-symlink-l0"
    symlink_target.symlink_to(actual_target, target_is_directory=True)
    with pytest.raises(ValueError, match="B60_L0_TARGET_SYMLINK"):
        materialize_basic60_l0(
            paths,
            raw_dir,
            candidate_dir / RAW_MANIFEST_NAME,
            review_path,
            symlink_target,
            evidence_dir,
            "basic60-symlink-target",
        )


def test_l0_materialization_deduplicates_read_only_objects_and_reuses_them(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    l0_dir = paths.root.parent / f"{paths.root.name}-approved-l0"
    _bundle, review_path = _write_d1_review_copy(paths, candidate_dir, l0_dir=l0_dir)

    first_paths = materialize_basic60_l0(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        review_path,
        l0_dir,
        paths.root / "data/basic60/evidence/l0-run-1",
        "basic60-volume-01",
    )
    first = {
        payload["batch_id"]: payload
        for payload in (json.loads(path.read_text(encoding="utf-8")) for path in first_paths)
    }
    objects = list((l0_dir / "sha256").iterdir())
    assert len(objects) == 7
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o444 for path in objects)
    assert all(payload["schema_version"] == L0_BATCH_MANIFEST_SCHEMA for payload in first.values())
    assert all("signature" not in payload for payload in first.values())
    assert all(payload["copy_status"] == "succeeded" for payload in first.values())
    assert all(payload["batch_status"] == "materialized_not_closed" for payload in first.values())
    assert all(
        payload["diff_status"] == "pending_external_snapshot_comparison"
        for payload in first.values()
    )
    assert all(payload["watermark_advanced"] is False for payload in first.values())
    assert sum(payload["copied"] for payload in first.values()) == 2
    assert sum(payload["reused"] for payload in first.values()) == 1
    assert first["BASIC60-BATCH-MACRO"]["object_key"] == first["BASIC60-BATCH-ENERGY"]["object_key"]
    for payload in first.values():
        object_path = l0_dir / payload["object_key"]
        assert sha256_file(object_path) == payload["source_sha256"]
        assert object_path.stat().st_size == payload["source_byte_size"]

    second_paths = materialize_basic60_l0(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        review_path,
        l0_dir,
        paths.root / "data/basic60/evidence/l0-run-2",
        "basic60-volume-01",
    )
    second = [json.loads(path.read_text(encoding="utf-8")) for path in second_paths]
    assert all(payload["copied"] is False for payload in second)
    assert all(payload["reused"] is True for payload in second)
    assert len(list((l0_dir / "sha256").iterdir())) == 7


def test_validation_rejects_placeholder_and_tampered_l0_output_manifests(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    l0_dir = paths.root.parent / f"{paths.root.name}-tamper-l0"
    bundle, review_path = _write_d1_review_copy(paths, candidate_dir, l0_dir=l0_dir)
    for batch in bundle["collection"]["batches"]:
        batch.update(
            {
                "run_status": "succeeded",
                "access_signal": "none",
                "diff_status": "no_change",
                "status": "closed",
                "output_manifest": _write_artifact(
                    paths,
                    f"placeholder-{batch['batch_id'].lower()}.json",
                ),
            }
        )
    review_path.write_text(json.dumps(bundle), encoding="utf-8")
    placeholder = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
    )
    placeholder_codes = {item["code"] for item in placeholder["checks"]}
    assert "B60_BATCH_OUTPUT_SCHEMA_INVALID" in placeholder_codes
    assert "B60_L0_DIRECTORY_REQUIRED" in placeholder_codes

    manifest_paths = materialize_basic60_l0(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        review_path,
        l0_dir,
        paths.root / "data/basic60/evidence/l0-tamper",
        "basic60-tamper-volume",
    )
    references = _complete_l0_batch_manifests(
        paths,
        bundle,
        manifest_paths,
        l0_dir=l0_dir,
        output_prefix="l0-tamper-completed",
    )
    macro_path = paths.root / references["BASIC60-BATCH-MACRO"]["path"]
    macro_payload = json.loads(macro_path.read_text(encoding="utf-8"))
    macro_payload["object_byte_size"] += 1
    macro_path.chmod(0o644)
    macro_path.write_text(json.dumps(macro_payload), encoding="utf-8")
    references["BASIC60-BATCH-MACRO"]["sha256"] = sha256_file(macro_path)
    review_path.write_text(json.dumps(bundle), encoding="utf-8")

    tampered = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
        l0_dir,
    )
    assert "B60_BATCH_OUTPUT_CONTENT_INVALID" in {item["code"] for item in tampered["checks"]}


def test_validation_reopens_completed_provider_snapshot_objects_from_external_l0(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    l0_dir = paths.root.parent / f"{paths.root.name}-snapshot-tamper-l0"
    bundle, review_path = _write_d1_review_copy(paths, candidate_dir, l0_dir=l0_dir)
    materialized = materialize_basic60_l0(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        review_path,
        l0_dir,
        paths.root / "data/basic60/evidence/snapshot-tamper",
        "basic60-snapshot-tamper",
    )
    completed = _complete_l0_batch_manifests(
        paths,
        bundle,
        materialized,
        l0_dir=l0_dir,
        output_prefix="snapshot-tamper-completed",
    )
    first_manifest = json.loads(
        (paths.root / next(iter(completed.values()))["path"]).read_text(encoding="utf-8")
    )
    snapshot = first_manifest["source_snapshot_comparisons"][0]["current_snapshot"]
    object_path = l0_dir / snapshot["object_key"]
    object_path.chmod(0o644)
    object_path.write_bytes(b"tampered provider snapshot\n")
    review_path.write_text(json.dumps(bundle), encoding="utf-8")

    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
        l0_dir,
    )

    assert "B60_EVIDENCE_OBJECT_CONTENT_INVALID" in {item["code"] for item in assessment["checks"]}


def test_d2_current_terms_change_is_a_d1_blocker(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    l0_dir = paths.root.parent / f"{paths.root.name}-terms-change-l0"
    bundle, review_path = _write_d1_review_copy(paths, candidate_dir, l0_dir=l0_dir)
    materialized = materialize_basic60_l0(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        review_path,
        l0_dir,
        paths.root / "data/basic60/evidence/terms-change",
        "basic60-terms-change",
    )
    completed = _complete_l0_batch_manifests(
        paths,
        bundle,
        materialized,
        l0_dir=l0_dir,
        output_prefix="terms-change-completed",
    )
    macro_reference = completed["BASIC60-BATCH-MACRO"]
    macro_path = paths.root / macro_reference["path"]
    macro_manifest = json.loads(macro_path.read_text(encoding="utf-8"))
    comparison = macro_manifest["source_snapshot_comparisons"][0]
    registry_reference = bundle["source_admission"]["source_registry"]
    registry = json.loads((paths.root / registry_reference["path"]).read_text(encoding="utf-8"))
    source = next(
        item for item in registry["sources"] if item["source_ref"] == comparison["source_ref"]
    )
    current_terms_snapshot = _materialize_test_terms_snapshot(
        l0_dir,
        "https://example.test/changed-official-terms",
    )
    current_terms_snapshot["captured_at"] = macro_manifest["checked_at"]
    comparison["current_terms_snapshots"] = [current_terms_snapshot]
    comparison["current_terms_retrieval_logs"] = [
        _write_artifact(
            paths,
            "terms-change-completed/current-macro-terms.retrieval-log.json",
            {
                "schema_version": "basic60.source-retrieval-log.v1",
                "source_ref": comparison["source_ref"],
                "source_role": comparison["source_role"],
                "request": {
                    "method": "GET",
                    "uri": current_terms_snapshot["retrieval_uri"],
                    "requested_at": "2026-08-25T10:59:00+08:00",
                    "access_method": source["access_method"],
                    "rate_limit": source["rate_limit"],
                },
                "response": {
                    "status_code": 200,
                    "retrieved_at": macro_manifest["checked_at"],
                    "media_type": current_terms_snapshot["media_type"],
                    "content_sha256": current_terms_snapshot["sha256"],
                    "byte_size": current_terms_snapshot["byte_size"],
                    "object_key": current_terms_snapshot["object_key"],
                    "access_signal": "none",
                },
            },
        )
    ]
    comparison["current_terms_fingerprint_sha256"] = _terms_fingerprint_sha256(
        source["terms_uri"],
        [current_terms_snapshot],
    )
    diff_reference = macro_manifest["diff_report"]
    diff_path = paths.root / diff_reference["path"]
    diff_report = json.loads(diff_path.read_text(encoding="utf-8"))
    diff_report["source_snapshot_comparisons_sha256"] = _canonical_payload_hash(
        macro_manifest["source_snapshot_comparisons"]
    )
    diff_path.write_text(json.dumps(diff_report), encoding="utf-8")
    diff_reference["sha256"] = sha256_file(diff_path)
    macro_path.write_text(json.dumps(macro_manifest), encoding="utf-8")
    macro_reference["sha256"] = sha256_file(macro_path)
    review_path.write_text(json.dumps(bundle), encoding="utf-8")

    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
        l0_dir,
    )

    assert assessment["status"] == "not_ready"
    assert "B60_SOURCE_TERMS_CHANGED" in {item["code"] for item in assessment["checks"]}


def test_d2_rejects_a_replayed_terms_snapshot_from_an_earlier_update(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    l0_dir = paths.root.parent / f"{paths.root.name}-stale-terms-l0"
    bundle, review_path = _write_d1_review_copy(paths, candidate_dir, l0_dir=l0_dir)
    materialized = materialize_basic60_l0(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        review_path,
        l0_dir,
        paths.root / "data/basic60/evidence/stale-terms",
        "basic60-stale-terms",
    )
    completed = _complete_l0_batch_manifests(
        paths,
        bundle,
        materialized,
        l0_dir=l0_dir,
        output_prefix="stale-terms-completed",
    )
    macro_reference = completed["BASIC60-BATCH-MACRO"]
    macro_path = paths.root / macro_reference["path"]
    macro_manifest = json.loads(macro_path.read_text(encoding="utf-8"))
    comparison = macro_manifest["source_snapshot_comparisons"][0]
    comparison["current_terms_snapshots"][0]["captured_at"] = "2026-08-24T11:00:00+08:00"
    diff_reference = macro_manifest["diff_report"]
    diff_path = paths.root / diff_reference["path"]
    diff_report = json.loads(diff_path.read_text(encoding="utf-8"))
    diff_report["source_snapshot_comparisons_sha256"] = _canonical_payload_hash(
        macro_manifest["source_snapshot_comparisons"]
    )
    diff_path.write_text(json.dumps(diff_report), encoding="utf-8")
    diff_reference["sha256"] = sha256_file(diff_path)
    macro_path.write_text(json.dumps(macro_manifest), encoding="utf-8")
    macro_reference["sha256"] = sha256_file(macro_path)
    review_path.write_text(json.dumps(bundle), encoding="utf-8")

    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        review_path,
        l0_dir,
    )
    codes = {item["code"] for item in assessment["checks"]}

    assert assessment["status"] == "not_ready"
    assert "B60_SOURCE_TERMS_SNAPSHOT_STALE" in codes
    assert "B60_RETRIEVAL_LOG_CONTENT_INVALID" in codes


def test_hash_bound_project_revocation_is_a_terminal_non_ready_release_state(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle_path = candidate_dir / ACCEPTANCE_TEMPLATE_NAME
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    subject = approval_subjects(bundle)["revocation"]
    bundle["revocation"] = {
        "reason": "许可变化，立即停止私有试用",
        "approval": _write_approval(
            paths,
            filename="revocation",
            role="项目批准人",
            person="kevin",
            subject_sha256=subject,
        ),
    }
    revoked_path = candidate_dir / "revoked.json"
    revoked_path.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        revoked_path,
    )

    assert validation["status"] == "revoked"
    assert validation["checks"] == []


def test_legacy_handwritten_machine_packet_cannot_reach_private_trial_ready(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    bundle_path = candidate_dir / ACCEPTANCE_TEMPLATE_NAME
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    l0_dir = paths.root.parent / f"{paths.root.name}-l0-ready"
    _authorize_pbd_and_d1(paths, bundle, l0_dir=l0_dir)

    candidate_reference = {
        "path": PBD_CANDIDATE_PATH.as_posix(),
        "sha256": sha256_file(paths.root / PBD_CANDIDATE_PATH),
    }
    signed_at = "2026-08-25T09:00:00+08:00"
    confirmation_path = (
        paths.root / "data/governance/evidence/kevin_basic60_private_confirmation.json"
    )
    confirmation_path.parent.mkdir(parents=True, exist_ok=True)
    confirmation_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "confirmation_type": "project_baseline_change_review",
                "decision_id": DECISION_ID,
                "candidate": candidate_reference,
                "decision": REQUESTED_DECISION,
                "comments": "approved for bounded private trial",
                "reviewed_at": signed_at,
                "reviewer_signature": {
                    "person_name": "kevin",
                    "role": "项目批准人",
                    "signed_at": signed_at,
                },
                "authorized_transcription": True,
                "authorized_actions": {
                    "write_decision_record": True,
                    "activate_basic60_private_profile": True,
                    "start_real_data_private_trial": True,
                },
                "template_only": False,
            }
        ),
        encoding="utf-8",
    )
    decision_path = paths.root / PBD_DECISION_PATH
    decision_path.parent.mkdir(parents=True, exist_ok=True)
    decision_path.write_text(
        json.dumps(
            {
                "decision_id": DECISION_ID,
                "status": "approved_and_effective",
                "effective_from": signed_at,
                "scope": {
                    "release_profile": "basic60_private",
                    "private_trial_only": True,
                    "real_data_enabled": True,
                    "policies_enabled": False,
                    "ai_enabled": False,
                    "external_model_calls_enabled": False,
                },
                "approval": {
                    "person_id": "kevin",
                    "role": "project_approver",
                    "signed_at": signed_at,
                    "signature_sha256": sha256_file(confirmation_path),
                },
            }
        ),
        encoding="utf-8",
    )
    bundle["baseline_confirmation"] = {
        "path": confirmation_path.relative_to(paths.root).as_posix(),
        "sha256": sha256_file(confirmation_path),
    }
    bundle["baseline_decision"] = {
        "path": decision_path.relative_to(paths.root).as_posix(),
        "sha256": sha256_file(decision_path),
    }

    source_registry = _write_artifact(
        paths,
        "approved_source_registry.json",
        {
            "template_only": False,
            "source_declaration": "official_public_data",
            "update_policy": {
                "mode": "manual_incremental",
                "reapproval_triggers": ["source_url", "terms", "structure"],
            },
            "country_source_uri_manifest": json.loads(
                (candidate_dir / SOURCE_REGISTRY_TEMPLATE_NAME).read_text(encoding="utf-8")
            )["country_source_uri_manifest"],
            "sources": _approved_sources(paths, l0_dir=l0_dir),
        },
    )
    bundle["source_admission"]["source_registry"] = source_registry
    for domain, api_domain in zip(
        bundle["source_admission"]["domains"],
        ("country_identity", "macro", "energy"),
        strict=True,
    ):
        domain.update(
            {
                "primary_source_id": f"SRC-{api_domain.upper()}-PRIMARY",
                "alternative_source_id": None,
                "status": "active",
            }
        )
    bundle["source_admission"]["usage_boundaries"] = {
        "store_structured": "allowed",
        "private_display": "allowed",
        "private_export": "prohibited",
        "ai_index": "prohibited",
        "model_training": "prohibited",
        "cloud_processing": "prohibited",
    }

    d1_review_path = paths.root / "data/basic60/review/d1-approved.json"
    d1_review_path.parent.mkdir(parents=True, exist_ok=True)
    d1_review_path.write_text(json.dumps(bundle), encoding="utf-8")
    with pytest.raises(ValueError, match=r"B60_SOURCE_(?:BOUNDARY|REGISTRY)_INVALID"):
        materialize_basic60_l0(
            paths,
            raw_dir,
            candidate_dir / RAW_MANIFEST_NAME,
            d1_review_path,
            l0_dir,
            paths.root / "data/basic60/evidence/l0-ready",
            "basic60-test-volume",
        )
    l0_manifest_paths: dict[str, dict[str, str]] = {}
    return
    _complete_l0_batch_manifests(
        paths,
        bundle,
        l0_manifest_paths,
        l0_dir=l0_dir,
        output_prefix="l0-ready-completed",
    )
    bundle["collection"]["incidents"] = []
    bundle["processing"]["open_anomaly_count"] = 0
    bundle["processing"]["open_high_risk_anomaly_count"] = 0
    acceptance = bundle["acceptance"]
    acceptance.update(
        {
            "chinese_names_reviewed": 60,
            "sample_accurate_count": 171,
            "duplicate_count": 0,
            "pending_values_reviewed": 61,
            "derived_values_reviewed": 120,
            "unresolved_p0_data_issue_count": 0,
        }
    )
    sample_reference = acceptance["sample_candidate"]
    sample_candidate = json.loads(
        (paths.root / sample_reference["path"]).read_text(encoding="utf-8")
    )
    seed_reference = bundle["runtime_seed"]
    seed = json.loads((paths.root / seed_reference["path"]).read_text(encoding="utf-8"))
    reviewed_at = "2026-08-25T12:00:00+08:00"
    machine_counts = acceptance["machine_counts"]
    common_operation = {
        "schema_version": "basic60.operational-evidence.v1",
        "profile_id": "basic60_private",
        "release_id": "BASIC60-PRIVATE-R1",
        "seed_artifact": seed_reference,
        "executed_at": reviewed_at,
        "status": "passed",
        "history_preserved": True,
        "counts": machine_counts,
    }
    acceptance["artifacts"] = {
        "sample_manifest": _write_artifact(
            paths,
            "sample_manifest.json",
            build_basic60_sample_review_manifest(
                sample_reference,
                sample_candidate,
                review_slot=1,
            ),
        ),
        "chinese_names_review": _write_artifact(
            paths,
            "chinese_names_review.json",
            build_basic60_item_review_manifest(
                seed_reference,
                seed,
            ),
        ),
        "pending_values_review": _write_artifact(
            paths,
            "pending_values_review.json",
            build_basic60_item_review_manifest(
                seed_reference,
                seed,
            ),
        ),
        "derived_values_review": _write_artifact(
            paths,
            "derived_values_review.json",
            build_basic60_item_review_manifest(
                seed_reference,
                seed,
            ),
        ),
        "empty_database_import": _write_artifact(
            paths,
            "empty_database_import.json",
            {
                **common_operation,
                "artifact_type": "empty_database_import",
                "empty_database_verified": True,
                "imported_seed_sha256": seed_reference["sha256"],
            },
        ),
        "release_rebuild": _write_artifact(
            paths,
            "release_rebuild.json",
            {
                **common_operation,
                "artifact_type": "release_rebuild",
                "release_rebuilt": True,
                "rebuild_output_sha256": seed_reference["sha256"],
            },
        ),
        "previous_release_rollback": _write_artifact(
            paths,
            "previous_release_rollback.json",
            {
                **common_operation,
                "artifact_type": "previous_release_rollback",
                "previous_release_id": "BASIC60-PRIVATE-R0",
                "rollback_succeeded": True,
                "historical_release_count": 1,
            },
        ),
        "source_revocation": _write_artifact(
            paths,
            "source_revocation.json",
            {
                **common_operation,
                "artifact_type": "source_revocation",
                "source_ref": "SRC-COUNTRY_IDENTITY-PRIMARY",
                "revocation_succeeded": True,
                "revoked_value_count": 1,
                "values_hidden": True,
            },
        ),
        "api_performance": _write_artifact(
            paths,
            "api_performance.json",
            {
                "schema_version": "basic60.api-performance-evidence.v1",
                "profile_id": "basic60_private",
                "release_id": "BASIC60-PRIVATE-R1",
                "seed_artifact": seed_reference,
                "measured_at": reviewed_at,
                "commit_sha": "a" * 40,
                "status": "passed",
                "routes": [
                    {"route": route, "sample_count": 20, "p95_ms": 200}
                    for route in (
                        "GET /api/v1/countries",
                        "GET /api/v1/countries/{code}",
                    )
                ],
            },
        ),
        "isolation_check": _write_artifact(
            paths,
            "isolation_check.json",
            {
                "schema_version": "basic60.isolation-check-evidence.v1",
                "profile_id": "basic60_private",
                "release_id": "BASIC60-PRIVATE-R1",
                "seed_artifact": seed_reference,
                "checked_at": reviewed_at,
                "commit_sha": "a" * 40,
                "status": "passed",
                "checks": {
                    "demo_database_contains_real_data": False,
                    "demo_network_shared": False,
                    "demo_volume_shared": False,
                    "public_static_path_contains_real_data": False,
                    "policy_route_registered": False,
                    "search_route_registered": False,
                    "ai_route_registered": False,
                    "prohibited_route_reachable": False,
                },
            },
        ),
    }

    subjects = approval_subjects(bundle)
    bundle["source_admission"]["approvals"] = [
        _write_approval(
            paths,
            filename="source-project-approver",
            role="项目批准人",
            person="kevin",
            subject_sha256=subjects["source"],
        )
    ]
    bundle["collection"]["approval"] = _write_approval(
        paths,
        filename="batch-close",
        role="授权数据审核人",
        person="alice",
        subject_sha256=subjects["collection"],
    )
    acceptance["sample_approvals"] = [
        _write_approval(
            paths,
            filename=f"sample-{index}",
            role="数据质量复核人",
            person=person,
            subject_sha256=subjects["acceptance"],
        )
        for index, person in enumerate(("carol", "diana"), start=1)
    ]
    final_people = ("alice", "carol", "bob", "edgar", "kevin")
    acceptance["final_approvals"] = [
        _write_approval(
            paths,
            filename=f"final-{index}",
            role=role,
            person=person,
            subject_sha256=subjects["acceptance"],
        )
        for index, (role, person) in enumerate(
            zip(
                ("数据负责人", "数据质量负责人", "合规负责人", "数据工程负责人", "项目批准人"),
                final_people,
                strict=True,
            ),
            start=1,
        )
    ]
    completed_path = paths.root / "data/basic60/review/completed.json"
    completed_path.parent.mkdir(parents=True, exist_ok=True)
    completed_path.write_text(json.dumps(bundle), encoding="utf-8")

    validation = load_and_assess_basic60_private(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        runtime_dir / SEED_NAME,
        completed_path,
        l0_dir,
    )

    assert validation["status"] == "not_ready"
    assert validation["release_bundle_sha256"] == sha256_file(completed_path)
    codes = {item["code"] for item in validation["checks"]}
    assert "B60_ACCEPTANCE_ARTIFACT_SET_INVALID" in codes
    assert "B60_MACHINE_EVIDENCE_INVALID" in codes


def test_complete_v2_packet_reaches_private_trial_ready(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    _repository_layout(paths.root)
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)

    bundle = json.loads((candidate_dir / ACCEPTANCE_TEMPLATE_NAME).read_text(encoding="utf-8"))
    l0_dir = paths.root.parent / f"{paths.root.name}-l0-v2-ready"
    _authorize_pbd_and_d1(paths, bundle, l0_dir=l0_dir)
    d1_review_path = paths.root / "data/basic60/review/d1-approved-v2.json"
    d1_review_path.parent.mkdir(parents=True, exist_ok=True)
    d1_review_path.write_text(json.dumps(bundle), encoding="utf-8")

    materialized_manifests = materialize_basic60_l0(
        paths,
        raw_dir,
        candidate_dir / RAW_MANIFEST_NAME,
        d1_review_path,
        l0_dir,
        paths.root / "data/basic60/evidence/l0-v2-ready",
        "basic60-v2-test-volume",
    )
    _complete_l0_batch_manifests(
        paths,
        bundle,
        materialized_manifests,
        l0_dir=l0_dir,
        output_prefix="l0-v2-ready-completed",
    )
    bundle["collection"]["incidents"] = []
    bundle["processing"]["open_anomaly_count"] = 0
    bundle["processing"]["open_high_risk_anomaly_count"] = 0
    bundle["collection"]["approval"] = _write_approval(
        paths,
        filename="v2-batch-close",
        role="授权数据审核人",
        person="alice",
        subject_sha256=approval_subjects(bundle)["collection"],
        signed_at="2026-08-25T11:30:00+08:00",
    )

    preflight_path = paths.root / "data/basic60/review/basic60_private_d1_d3_frozen.json"
    preflight_path.write_text(json.dumps(bundle), encoding="utf-8")
    seed_path = runtime_dir / SEED_NAME
    raw_manifest_path = candidate_dir / RAW_MANIFEST_NAME
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    raw_manifest = json.loads(raw_manifest_path.read_text(encoding="utf-8"))
    d3_artifacts = write_d3_stage_payloads(
        seed,
        raw_manifest,
        repository_root=paths.root,
        output_directory=runtime_dir / "d3",
    )
    seed_reference = _file_ref(paths.root, seed_path)
    registry_reference = bundle["source_admission"]["source_registry"]
    registry = json.loads((paths.root / registry_reference["path"]).read_text(encoding="utf-8"))
    operation_logs = _complete_v2_operation_logs(
        paths.root,
        seed_reference,
        seed,
        registry["sources"][0]["source_ref"],
    )
    machine_evidence = collect_machine_evidence(
        repository_root=paths.root,
        seed_path=seed_path,
        raw_manifest_path=raw_manifest_path,
        bundle_path=preflight_path,
        d3_artifacts=d3_artifacts,
        operation_logs=operation_logs,
        api_observations=_api_observations(),
        route_probes=_route_probes(),
    )
    assert validate_machine_evidence(machine_evidence, repository_root=paths.root) == []
    machine_evidence_path = runtime_dir / "machine/basic60_machine_evidence.json"
    _write_json(machine_evidence_path, machine_evidence)

    acceptance = bundle["acceptance"]
    sample_reviews = []
    for index, reviewer in enumerate(("carol", "diana"), start=1):
        template_reference = acceptance["review_templates"]["sample_reviews"][index - 1]
        template = json.loads((paths.root / template_reference["path"]).read_text(encoding="utf-8"))
        completed_review = _complete_sample_review(template, reviewer_name=reviewer)
        sample_reviews.append(
            _write_runtime_review(
                paths,
                f"basic60_sample_review_{index}.json",
                completed_review,
            )
        )
    item_template_reference = acceptance["review_templates"]["item_review"]
    item_template = json.loads(
        (paths.root / item_template_reference["path"]).read_text(encoding="utf-8")
    )
    acceptance["artifacts"] = {
        "sample_reviews": sample_reviews,
        "item_review": _write_runtime_review(
            paths,
            "basic60_item_review.json",
            _complete_item_review(item_template, seed, reviewer_name="alice"),
        ),
        "machine_evidence": {
            "path": machine_evidence_path.relative_to(paths.root).as_posix(),
            "sha256": sha256_file(machine_evidence_path),
        },
    }
    acceptance.update(
        {
            "chinese_names_reviewed": 60,
            "sample_accurate_count": 180,
            "duplicate_count": _seed_duplicate_count(seed),
            "pending_values_reviewed": 61,
            "derived_values_reviewed": 120,
            "unresolved_p0_data_issue_count": 0,
        }
    )

    subjects = approval_subjects(bundle)
    acceptance["sample_approvals"] = [
        _write_approval(
            paths,
            filename=f"v2-sample-{index}",
            role="数据质量复核人",
            person=reviewer,
            subject_sha256=subjects[f"sample_review_{index}"],
            signed_at="2026-08-25T12:30:00+08:00",
        )
        for index, reviewer in enumerate(("carol", "diana"), start=1)
    ]
    final_people = ("alice", "carol", "bob", "edgar", "kevin")
    acceptance["final_approvals"] = [
        _write_approval(
            paths,
            filename=f"v2-final-{index}",
            role=role,
            person=person,
            subject_sha256=subjects["acceptance"],
            signed_at="2026-08-25T13:00:00+08:00",
        )
        for index, (role, person) in enumerate(
            zip(FINAL_APPROVAL_ROLES, final_people, strict=True),
            start=1,
        )
    ]

    completed_path = paths.root / "data/basic60/review/completed-v2.json"
    completed_path.write_text(json.dumps(bundle), encoding="utf-8")
    assessment = load_and_assess_basic60_private(
        paths,
        raw_dir,
        raw_manifest_path,
        seed_path,
        completed_path,
        l0_dir,
    )

    assert assessment["status"] == "private_trial_ready"
    assert assessment["ready"] is True
    assert assessment["checks"] == []
    assert assessment["formal_gate_status"] == "pending"
    assert assessment["release_bundle_sha256"] == sha256_file(completed_path)
    assert assessment["machine_counts"] == {
        "country_count": 60,
        "macro_annual_record_count": 300,
        "energy_latest_record_count": 60,
        "available_observation_count": 2279,
        "pending_observation_count": 61,
    }


def test_ready_seed_finalizer_matches_the_strict_api_import_contract(
    basic60_fixture: tuple[RepositoryPaths, Path, Path, Path],
) -> None:
    paths, raw_dir, runtime_dir, candidate_dir = basic60_fixture
    prepare_basic60_private(paths, raw_dir, runtime_dir, candidate_dir)
    candidate_seed = json.loads((runtime_dir / SEED_NAME).read_text(encoding="utf-8"))
    raw_manifest = json.loads((candidate_dir / RAW_MANIFEST_NAME).read_text(encoding="utf-8"))
    bundle = json.loads((candidate_dir / ACCEPTANCE_TEMPLATE_NAME).read_text(encoding="utf-8"))
    sources = _approved_sources(paths)
    domain_specs = (
        ("country_profile", "country_identity"),
        ("macroeconomic", "macro"),
        ("energy", "energy"),
    )
    for bundle_domain, api_domain in domain_specs:
        domain = next(
            item
            for item in bundle["source_admission"]["domains"]
            if item["domain_id"] == bundle_domain
        )
        domain["primary_source_id"] = f"SRC-{api_domain.upper()}-PRIMARY"
        domain["alternative_source_id"] = None
        domain["status"] = "active"
    bundle["usage_amendment"] = {
        "path": USAGE_AMENDMENT_PATH.as_posix(),
        "sha256": "d" * 64,
    }

    ready_seed = build_basic60_ready_seed(
        candidate_seed,
        raw_manifest,
        {"sources": sources},
        bundle,
        release_bundle_sha256="b" * 64,
        validation_report_sha256="c" * 64,
        reviewed_at="2026-08-25T12:00:00+08:00",
    )

    parsed = Basic60SeedArtifact.model_validate(ready_seed)
    assert parsed.release.status == "private_trial_ready"
    assert len(parsed.sources) == 3
    assert {(item.data_domain, item.source_role) for item in parsed.sources} == {
        ("country_identity", "primary"),
        ("macro", "primary"),
        ("energy", "primary"),
    }
    assert len(parsed.countries) == 60
    assert len(parsed.metric_definitions) == 15
    assert len(parsed.raw_records) == 3
    assert parsed.manual_usage_authorization.permission_basis == USAGE_AMENDMENT_ID
    assert parsed.manual_usage_authorization.allowed_uses == (
        "internal_learning_and_exchange",
        "private_display",
        "internal_ai_processing",
        "local_model_processing",
        "controlled_external_model_processing",
    )
    assert parsed.manual_usage_authorization.prohibited_uses == (
        "public_release",
        "model_training",
    )
    assert not any(parsed.manual_usage_authorization.v1_runtime_capabilities.model_dump().values())
    assert (
        parsed.ai_usage_policy.fields_sha256
        == parsed.manual_usage_authorization.field_scope.fields_sha256
    )
    assert all(
        not {
            "license_scope",
            "ai_processing",
            "local_model_processing",
            "controlled_external_model_processing",
            "cloud_processing",
            "model_training",
        }.intersection(item.model_dump())
        for item in parsed.sources
    )
