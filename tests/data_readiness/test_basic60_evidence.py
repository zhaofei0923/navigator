from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from navigator_data_readiness.basic60_evidence import (
    D3_STAGES,
    REQUIRED_ROUTE_PROBES,
    EvidenceCollectionError,
    build_d3_stage_payloads,
    canonical_sha256,
    collect_machine_evidence,
    validate_machine_evidence,
    write_d3_stage_payloads,
)

NOW = "2026-08-25T12:00:00+08:00"
RAW_ROOT_HASH = "a" * 64
RESPONSE_HASH = "b" * 64
IMMUTABLE_HASH = "c" * 64


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding="utf-8")


def _file_ref(root: Path, path: Path) -> dict[str, Any]:
    payload = path.read_bytes()
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "byte_size": len(payload),
    }


def _repository_layout(root: Path) -> None:
    compose = """name: navigator-basic60-private

services:
  db:
    networks:
      - basic60_internal
  api:
    environment:
      BASIC60_AUTO_CREATE_SCHEMA: "false"
      BASIC60_AUTO_IMPORT_SEED: "false"
      BASIC60_RUNTIME_ATTESTATION_PATH: /runtime/basic60_runtime_attestation.json
      BASIC60_RUNTIME_ATTESTATION_SHA256: ${{BASIC60_RUNTIME_ATTESTATION_SHA256}}
      BASIC60_RUNTIME_ATTESTATION_KEY: ${{BASIC60_RUNTIME_ATTESTATION_KEY}}
    networks:
      - basic60_internal
  web:
    environment:
      NAVIGATOR_RUNTIME_PROFILE: basic60_private
    ports:
      - "127.0.0.1:${NAVIGATOR_BASIC60_WEB_PORT:-3200}:3000"
    networks:
      - basic60_edge
      - basic60_internal

networks:
  basic60_edge:
    internal: true
  basic60_internal:
    internal: true
"""
    _write_text(root / "deploy/basic60/compose.private-trial.yaml", compose)
    _write_text(
        root / "apps/web/proxy.ts",
        'const profile = "basic60_private"; export function proxy() { return profile; }\n',
    )
    _write_text(root / "apps/web/app/api/health/route.ts", "export async function GET() {}\n")
    _write_text(
        root / "apps/web/app/(basic60)/basic60/page.tsx",
        "export default function Page() { return null; }\n",
    )
    _write_text(root / "apps/web/public/.gitkeep", "")

    _write_text(
        root / "services/api/src/navigator_api/basic60_config.py",
        "RUNTIME_ATTESTATION_REQUIRED = True\n",
    )
    _write_text(
        root / "services/api/src/navigator_api/basic60_governance.py",
        "def validate_runtime_attestation():\n    return True\n",
    )

    _write_text(
        root / "services/api/src/navigator_api/basic60_main.py",
        """from fastapi import FastAPI
app = FastAPI()
@app.get("/health")
def health():
    return {}
""",
    )
    _write_text(
        root / "services/api/src/navigator_api/routers/basic60.py",
        'from fastapi import APIRouter\nbasic60_api_router = APIRouter(prefix="/api/v1")\n',
    )
    _write_text(
        root / "services/api/src/navigator_api/routers/basic60_countries.py",
        """from fastapi import APIRouter
router = APIRouter()
@router.get("/countries")
def countries():
    return {}
@router.get("/countries/{country_code}")
def country(country_code: str):
    return country_code
""",
    )
    _write_text(
        root / "services/api/src/navigator_api/basic60_importer.py",
        """def import_basic60_seed_file():
    return None
def activate_basic60_release():
    return None
def revoke_basic60_source():
    return None
""",
    )
    _write_text(
        root / "services/api/src/navigator_api/basic60_models.py",
        "SOURCE_STATES = ('active', 'revoked')\n",
    )
    _write_text(
        root / "services/api/src/navigator_api/basic60_service.py",
        "def visible_values():\n    return []\n",
    )


def _seed(*, metrics: list[dict[str, Any]] | None = None, iso3: str = "IDN") -> dict[str, Any]:
    metric_rows = metrics or [
        {
            "metric_code": "gdp_current_usd",
            "period": "2025",
            "original_value": "100",
            "normalized_value": "100",
            "unit": "USD",
            "value_status": "available",
            "null_reason": None,
            "quality_status": "machine_collected_pending_human_review",
            "source_ref": "SRC-A",
        }
    ]
    return {
        "schema_version": 1,
        "profile_id": "basic60_private",
        "release_id": "BASIC60-PRIVATE-R1",
        "release_profile": "basic60_private",
        "source_root_sha256": RAW_ROOT_HASH,
        "countries": [
            {
                "iso3": iso3,
                "iso2": "ID",
                "coverage_status": "covered",
                "coverage_level": "Basic",
                "opportunity_level": "pending",
                "policy_friendliness_level": "pending",
                "risk_assessment_status": "unknown",
                "metrics": metric_rows,
            }
        ],
    }


def _snapshot(
    seq: int,
    database_id: str,
    phase: str,
    *,
    table_counts: dict[str, int],
    metric_states: dict[str, int],
    releases: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    versions: list[dict[str, Any]],
    immutable_hash: str = IMMUTABLE_HASH,
) -> dict[str, Any]:
    return {
        "seq": seq,
        "event_type": "snapshot",
        "occurred_at": NOW,
        "database_id": database_id,
        "phase": phase,
        "table_counts": table_counts,
        "metric_value_states": metric_states,
        "releases": releases,
        "sources": sources,
        "version_rows": versions,
        "immutable_data_sha256": immutable_hash,
    }


def _operation_log(
    operation: str, inputs: dict[str, Any], events: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "operation": operation,
        "run_id": f"RUN-{operation}",
        "started_at": NOW,
        "completed_at": NOW,
        "inputs": inputs,
        "events": events,
        "events_sha256": canonical_sha256(events),
    }


def _operation_logs(root: Path, seed_ref: dict[str, Any]) -> dict[str, dict[str, Any]]:
    zero_tables = {
        "basic60_release_snapshots": 0,
        "basic60_countries": 0,
        "basic60_metric_values": 0,
    }
    one_tables = {
        "basic60_release_snapshots": 1,
        "basic60_countries": 1,
        "basic60_metric_values": 1,
    }
    zero_metrics = {"available": 0, "pending": 0, "unavailable": 0}
    one_metric = {"available": 1, "pending": 0, "unavailable": 0}
    release = {
        "release_id": "BASIC60-PRIVATE-R1",
        "lifecycle_state": "private_trial_ready",
        "is_active": True,
        "artifact_sha256": seed_ref["sha256"],
    }
    source = {
        "source_ref": "SRC-A",
        "lifecycle_state": "active",
        "stored_value_count": 1,
        "visible_value_count": 1,
    }
    version = {"release_id": "BASIC60-PRIVATE-R1", "record_state": "published", "rows": 1}
    returned = {
        "countries": 1,
        "available_metric_values": 1,
        "pending_metric_values": 0,
        "unavailable_metric_values": 0,
    }

    empty_events = [
        _snapshot(
            1,
            "DB-IMPORT",
            "before_import",
            table_counts=zero_tables,
            metric_states=zero_metrics,
            releases=[],
            sources=[],
            versions=[],
        ),
        {
            "seq": 2,
            "event_type": "seed_import",
            "occurred_at": NOW,
            "database_id": "DB-IMPORT",
            "release_id": "BASIC60-PRIVATE-R1",
            "seed_sha256": seed_ref["sha256"],
            "returned_counts": returned,
        },
        _snapshot(
            3,
            "DB-IMPORT",
            "after_import",
            table_counts=one_tables,
            metric_states=one_metric,
            releases=[release],
            sources=[source],
            versions=[version],
        ),
    ]
    empty_log = _operation_log(
        "empty_database_import", {"seed_sha256": seed_ref["sha256"]}, empty_events
    )

    rebuild_events = copy.deepcopy(empty_events)
    rebuild_events[0]["database_id"] = "DB-REBUILD"
    rebuild_events[0]["phase"] = "before_rebuild"
    rebuild_events[1]["database_id"] = "DB-REBUILD"
    rebuild_events[2]["database_id"] = "DB-REBUILD"
    rebuild_events[2]["phase"] = "after_rebuild"
    rebuild_log = _operation_log(
        "release_rebuild",
        {
            "seed_sha256": seed_ref["sha256"],
            "reference_import_events_sha256": empty_log["events_sha256"],
        },
        rebuild_events,
    )

    previous_seed_path = root / "data/basic60/evidence/previous-seed.json"
    previous_auth_path = root / "data/basic60/evidence/previous-authorization.json"
    _write_json(previous_seed_path, {"release_id": "BASIC60-PRIVATE-R0"})
    _write_json(previous_auth_path, {"release_id": "BASIC60-PRIVATE-R0", "approved": True})
    previous_seed_ref = _file_ref(root, previous_seed_path)
    previous_auth_ref = _file_ref(root, previous_auth_path)
    previous_release = {
        "release_id": "BASIC60-PRIVATE-R0",
        "lifecycle_state": "private_trial_ready",
        "is_active": False,
        "artifact_sha256": previous_seed_ref["sha256"],
    }
    current_release = copy.deepcopy(release)
    two_tables = {
        "basic60_release_snapshots": 2,
        "basic60_countries": 2,
        "basic60_metric_values": 2,
    }
    two_metrics = {"available": 2, "pending": 0, "unavailable": 0}
    versions = [
        version,
        {"release_id": "BASIC60-PRIVATE-R0", "record_state": "published", "rows": 1},
    ]
    rollback_before = _snapshot(
        1,
        "DB-ROLLBACK",
        "before_rollback",
        table_counts=two_tables,
        metric_states=two_metrics,
        releases=[current_release, previous_release],
        sources=[source],
        versions=versions,
    )
    rolled_back_releases = copy.deepcopy(rollback_before["releases"])
    rolled_back_releases[0]["is_active"] = False
    rolled_back_releases[1]["is_active"] = True
    rollback_after = _snapshot(
        3,
        "DB-ROLLBACK",
        "after_rollback",
        table_counts=two_tables,
        metric_states=two_metrics,
        releases=rolled_back_releases,
        sources=[source],
        versions=versions,
    )
    rollback_restored = copy.deepcopy(rollback_before)
    rollback_restored["seq"] = 5
    rollback_restored["phase"] = "after_restore"
    rollback_events = [
        rollback_before,
        {
            "seq": 2,
            "event_type": "release_activation",
            "occurred_at": NOW,
            "database_id": "DB-ROLLBACK",
            "target_release_id": "BASIC60-PRIVATE-R0",
        },
        rollback_after,
        {
            "seq": 4,
            "event_type": "release_activation",
            "occurred_at": NOW,
            "database_id": "DB-ROLLBACK",
            "target_release_id": "BASIC60-PRIVATE-R1",
        },
        rollback_restored,
    ]
    rollback_log = _operation_log(
        "previous_release_rollback",
        {
            "seed_sha256": seed_ref["sha256"],
            "previous_release_id": "BASIC60-PRIVATE-R0",
            "previous_seed_artifact": previous_seed_ref,
            "previous_authorization_artifact": previous_auth_ref,
        },
        rollback_events,
    )

    revocation_before = _snapshot(
        1,
        "DB-REVOCATION",
        "before_revocation",
        table_counts=one_tables,
        metric_states=one_metric,
        releases=[release],
        sources=[source],
        versions=[version],
    )
    revoked_source = {**source, "lifecycle_state": "revoked", "visible_value_count": 0}
    revocation_after = _snapshot(
        3,
        "DB-REVOCATION",
        "after_revocation",
        table_counts=one_tables,
        metric_states=one_metric,
        releases=[release],
        sources=[revoked_source],
        versions=[version],
    )
    revocation_events = [
        revocation_before,
        {
            "seq": 2,
            "event_type": "source_revocation",
            "occurred_at": NOW,
            "database_id": "DB-REVOCATION",
            "release_id": "BASIC60-PRIVATE-R1",
            "source_ref": "SRC-A",
        },
        revocation_after,
        {
            "seq": 4,
            "event_type": "visibility_probe",
            "occurred_at": NOW,
            "method": "GET",
            "path": "/api/v1/countries/IDN?expand=provenance",
            "http_status": 200,
            "response_release_id": "BASIC60-PRIVATE-R1",
            "source_ref": "SRC-A",
            "source_ref_occurrences": 0,
        },
    ]
    revocation_log = _operation_log(
        "source_revocation",
        {"seed_sha256": seed_ref["sha256"], "source_ref": "SRC-A"},
        revocation_events,
    )
    return {
        "empty_database_import": empty_log,
        "release_rebuild": rebuild_log,
        "previous_release_rollback": rollback_log,
        "source_revocation": revocation_log,
    }


def _api_observations() -> dict[str, Any]:
    requests = [
        {
            "route_id": "API-COUNTRY-001",
            "method": "GET",
            "path": "/api/v1/countries?limit=50",
            "body": None,
        },
        {
            "route_id": "API-COUNTRY-002",
            "method": "GET",
            "path": "/api/v1/countries/IDN?expand=identity,macro,energy",
            "body": None,
        },
    ]
    samples: list[dict[str, Any]] = []
    for route_id in ("API-COUNTRY-001", "API-COUNTRY-002"):
        for _ in range(20):
            samples.append(
                {
                    "seq": len(samples) + 1,
                    "route_id": route_id,
                    "started_at": NOW,
                    "elapsed_ns": 100_000_000,
                    "http_status": 200,
                    "response_sha256": RESPONSE_HASH,
                    "response_release_id": "BASIC60-PRIVATE-R1",
                    "response_profile": "basic60_private",
                    "response_gate_state": "pending",
                }
            )
    return {
        "run_id": "RUN-API",
        "started_at": NOW,
        "completed_at": NOW,
        "warmup_count": 3,
        "requests": requests,
        "samples": samples,
        "samples_sha256": canonical_sha256(samples),
    }


def _route_probes() -> list[dict[str, Any]]:
    probes = []
    release_paths = {
        "/health",
        "/api/v1/countries",
        "/api/v1/countries/IDN",
    }
    for (surface, method, path), http_status in REQUIRED_ROUTE_PROBES.items():
        probes.append(
            {
                "surface": surface,
                "method": method,
                "path": path,
                "observed_at": NOW,
                "http_status": http_status,
                "response_release_id": (
                    "BASIC60-PRIVATE-R1" if surface == "api" and path in release_paths else None
                ),
            }
        )
    return probes


@pytest.fixture
def collected_evidence(tmp_path: Path) -> tuple[Path, dict[str, Any]]:
    root = tmp_path / "repository"
    root.mkdir()
    _repository_layout(root)
    seed = _seed()
    raw_manifest = {"root_sha256": RAW_ROOT_HASH, "scoped_files": []}
    seed_path = root / "runtime/basic60/seed.json"
    raw_path = root / "data/basic60/candidates/raw-manifest.json"
    bundle_path = root / "data/basic60/review/bundle.json"
    _write_json(seed_path, seed)
    _write_json(raw_path, raw_manifest)
    _write_json(bundle_path, {"release_id": "BASIC60-PRIVATE-R1"})
    d3 = write_d3_stage_payloads(
        seed,
        raw_manifest,
        repository_root=root,
        output_directory=Path("data/basic60/evidence/d3"),
    )
    seed_ref = _file_ref(root, seed_path)
    evidence = collect_machine_evidence(
        repository_root=root,
        seed_path=seed_path,
        raw_manifest_path=raw_path,
        bundle_path=bundle_path,
        d3_artifacts=d3,
        operation_logs=_operation_logs(root, seed_ref),
        api_observations=_api_observations(),
        route_probes=_route_probes(),
    )
    assert validate_machine_evidence(evidence, repository_root=root) == []
    return root, evidence


def test_d3_payloads_replay_preserve_source_and_recalculate_anomalies(tmp_path: Path) -> None:
    duplicate = {
        "metric_code": "gdp_current_usd",
        "period": "2025",
        "original_value": "100",
        "normalized_value": "100",
        "unit": "usd",
        "value_status": "available",
        "quality_status": "pending",
        "source_ref": "SRC-A",
    }
    conflict = {**duplicate, "original_value": "101", "normalized_value": "999"}
    conflict["value_status"] = "invented"
    seed = _seed(metrics=[duplicate, copy.deepcopy(duplicate), conflict], iso3="idn")
    manifest = {"root_sha256": RAW_ROOT_HASH, "scoped_files": []}

    first = build_d3_stage_payloads(seed, manifest)
    second = build_d3_stage_payloads(seed, manifest)
    assert first == second
    assert {first[stage]["stage_id"] for stage in D3_STAGES} == set(D3_STAGES)
    assert len(first["entity"]["quality_observations"]["duplicate_record_ids"]) == 1
    assert first["entity"]["quality_observations"]["fuzzy_match_record_ids"]
    assert first["entity"]["quality_observations"]["unknown_enum_record_ids"]
    assert first["entity"]["quality_observations"]["conflict_record_ids"]
    assert len({first[stage]["original_values_sha256"] for stage in D3_STAGES}) == 1
    assert len({first[stage]["source_fields_sha256"] for stage in D3_STAGES}) == 1

    root = tmp_path / "repository"
    root.mkdir()
    artifacts = write_d3_stage_payloads(
        seed,
        manifest,
        repository_root=root,
        output_directory=Path("data/basic60/evidence/d3"),
    )
    assert artifacts["replay"]["first_output_sha256"] == artifacts["replay"]["second_output_sha256"]
    reused = write_d3_stage_payloads(
        seed,
        manifest,
        repository_root=root,
        output_directory=Path("data/basic60/evidence/d3"),
    )
    assert reused == artifacts
    parse_path = root / artifacts["stages"]["parse"]["path"]
    parse_path.write_text(parse_path.read_text(encoding="utf-8") + " ", encoding="utf-8")
    with pytest.raises(EvidenceCollectionError, match="differs"):
        write_d3_stage_payloads(
            seed,
            manifest,
            repository_root=root,
            output_directory=Path("data/basic60/evidence/d3"),
        )


def test_v1_and_submitted_verdict_fields_are_rejected(
    collected_evidence: tuple[Path, dict[str, Any]],
) -> None:
    root, evidence = collected_evidence
    tampered = copy.deepcopy(evidence)
    tampered["schema_version"] = "basic60.machine-evidence.v1"
    tampered["status"] = "passed"
    codes = {item.code for item in validate_machine_evidence(tampered, repository_root=root)}
    assert "B60_MACHINE_EVIDENCE_VERSION_INVALID" in codes
    assert "B60_EVIDENCE_SELF_ATTESTATION" in codes


def test_current_runtime_evidence_requires_only_country_gets_and_retired_route_404s(
    collected_evidence: tuple[Path, dict[str, Any]],
) -> None:
    root, evidence = collected_evidence
    original = copy.deepcopy(evidence)
    assert {request["route_id"] for request in evidence["api"]["requests"]} == {
        "API-COUNTRY-001",
        "API-COUNTRY-002",
    }
    assert len(evidence["api"]["samples"]) == 40
    retired_probes = [
        probe
        for probe in evidence["isolation"]["route_probes"]
        if "country-comparisons" in probe["path"]
    ]
    assert {probe["path"] for probe in retired_probes} == {
        "/api/v1/country-comparisons",
        "/api/v1/demo/country-comparisons",
    }
    assert all(probe["http_status"] == 404 for probe in retired_probes)
    assert validate_machine_evidence(evidence, repository_root=root) == []
    assert evidence == original


def test_historical_comparison_performance_is_not_accepted_as_current_scope(
    collected_evidence: tuple[Path, dict[str, Any]],
) -> None:
    root, evidence = collected_evidence
    tampered = copy.deepcopy(evidence)
    tampered["api"]["requests"].append(
        {
            "route_id": "API-COMPARE-001",
            "method": "POST",
            "path": "/api/v1/country-comparisons",
            "body": {"country_codes": ["IDN", "VNM"], "metric_codes": ["gdp_current_usd"]},
        }
    )
    codes = {item.code for item in validate_machine_evidence(tampered, repository_root=root)}
    assert "B60_API_ROUTE_SET_INCOMPLETE" in codes


@pytest.mark.parametrize(
    "path", ("/api/v1/country-comparisons", "/api/v1/demo/country-comparisons")
)
def test_retired_comparison_probe_cannot_report_success(
    collected_evidence: tuple[Path, dict[str, Any]], path: str
) -> None:
    root, evidence = collected_evidence
    tampered = copy.deepcopy(evidence)
    probes = tampered["isolation"]["route_probes"]
    probe = next(probe for probe in probes if probe["path"] == path)
    probe["http_status"] = 200
    tampered["isolation"]["route_probes_sha256"] = canonical_sha256(probes)
    codes = {item.code for item in validate_machine_evidence(tampered, repository_root=root)}
    assert "B60_ISOLATION_ROUTE_PROBE_INVALID" in codes


def test_comparison_route_registration_fails_current_source_inventory(
    collected_evidence: tuple[Path, dict[str, Any]],
) -> None:
    root, evidence = collected_evidence
    tampered = copy.deepcopy(evidence)
    route_path = root / "services/api/src/navigator_api/routers/basic60_countries.py"
    _write_text(
        route_path,
        route_path.read_text(encoding="utf-8")
        + '\n@router.post("/country-comparisons")\ndef compare():\n    return {}\n',
    )
    rows = tampered["isolation"]["source_files"]
    row = next(row for row in rows if row["path"] == route_path.relative_to(root).as_posix())
    row.update(_file_ref(root, route_path))
    tampered["isolation"]["source_files_sha256"] = canonical_sha256(rows)
    codes = {item.code for item in validate_machine_evidence(tampered, repository_root=root)}
    assert "B60_ISOLATION_API_ROUTE_INVALID" in codes


def test_latency_p95_is_recalculated_from_raw_nearest_rank_samples(
    collected_evidence: tuple[Path, dict[str, Any]],
) -> None:
    root, evidence = collected_evidence
    tampered = copy.deepcopy(evidence)
    first_route = [
        sample for sample in tampered["api"]["samples"] if sample["route_id"] == "API-COUNTRY-001"
    ]
    first_route[-1]["elapsed_ns"] = 900_000_000
    first_route[-2]["elapsed_ns"] = 900_000_000
    tampered["api"]["samples_sha256"] = canonical_sha256(tampered["api"]["samples"])
    codes = {item.code for item in validate_machine_evidence(tampered, repository_root=root)}
    assert "B60_API_P95_EXCEEDED" in codes


def test_hash_updated_event_reordering_still_fails(
    collected_evidence: tuple[Path, dict[str, Any]],
) -> None:
    root, evidence = collected_evidence
    tampered = copy.deepcopy(evidence)
    log = tampered["operations"]["empty_database_import"]
    log["events"][1]["seq"] = 1
    log["events_sha256"] = canonical_sha256(log["events"])
    codes = {item.code for item in validate_machine_evidence(tampered, repository_root=root)}
    assert "B60_OPERATION_EVENT_ORDER_INVALID" in codes


def test_source_file_drift_is_independently_rediscovered(
    collected_evidence: tuple[Path, dict[str, Any]],
) -> None:
    root, evidence = collected_evidence
    proxy_path = root / "apps/web/proxy.ts"
    proxy_path.write_text(proxy_path.read_text(encoding="utf-8") + "// drift\n", encoding="utf-8")
    codes = {item.code for item in validate_machine_evidence(evidence, repository_root=root)}
    assert "B60_ISOLATION_SOURCE_DRIFT" in codes


def test_hash_updated_d3_stage_tampering_fails_independent_replay(
    collected_evidence: tuple[Path, dict[str, Any]],
) -> None:
    root, evidence = collected_evidence
    tampered = copy.deepcopy(evidence)
    entity_ref = tampered["d3"]["stages"]["entity"]
    entity_path = root / entity_ref["path"]
    payload = json.loads(entity_path.read_text(encoding="utf-8"))
    payload["records"][0]["normalized_value"] = "999"
    _write_json(entity_path, payload)
    entity_ref.update(_file_ref(root, entity_path))
    codes = {item.code for item in validate_machine_evidence(tampered, repository_root=root)}
    assert "B60_D3_STAGE_CONTENT_INVALID" in codes


def test_collection_refuses_missing_live_observations(tmp_path: Path) -> None:
    root = tmp_path / "repository"
    root.mkdir()
    _repository_layout(root)
    seed_path = root / "seed.json"
    raw_path = root / "raw.json"
    bundle_path = root / "bundle.json"
    _write_json(seed_path, _seed())
    _write_json(raw_path, {"root_sha256": RAW_ROOT_HASH})
    _write_json(bundle_path, {})
    with pytest.raises(EvidenceCollectionError, match="Missing live operation logs"):
        collect_machine_evidence(
            repository_root=root,
            seed_path=seed_path,
            raw_manifest_path=raw_path,
            bundle_path=bundle_path,
            d3_artifacts={},
            operation_logs={},
            api_observations={},
            route_probes=[],
        )
