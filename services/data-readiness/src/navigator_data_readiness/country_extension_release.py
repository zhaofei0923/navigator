"""Build an immutable BASIC61 release after the actual single-workbook confirmation.

This module consumes an approval; it never creates one, changes a current pointer,
imports a database, or rewrites the frozen BASIC60 parent or extension candidate.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import hmac
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from navigator_api.basic61_governance import (
    Basic61ReleaseAuthorization,
    Basic61RuntimeAttestation,
    Basic61ValidationReport,
)
from navigator_api.basic61_seed_contract import (
    ADDED_SOURCE_REFS,
    EXPECTED_COUNTS,
    RELEASE_ID,
    Basic61SeedArtifact,
)
from navigator_api.market_storage import (
    canonical_bytes,
    content_sha256,
    ensure_no_symlinks,
    read_json,
)

from .basic60_private import (
    METRIC_LABELS,
    RUNTIME_ATTESTATION_KEY_ENV,
    _normalized_data_field_paths,
    _period_bounds,
    _runtime_attestation_message,
    validate_runtime_attestation_key,
)
from .country_extension import (
    MAX_INPUT_BYTES,
    CountryExtensionError,
    _file_reference,
    _reference_path,
    validate_country_extension,
)
from .market_content import (
    _immutable_bytes,
    _iso_time,
    _publish_directory,
    _read_workbook,
    _time_before,
    _workbook_bytes,
)

PROFILE_ID = "basic60_private"
CONFIRMATION_SCHEMA = "navigator.country-extension-confirmation.v1"
BUNDLE_NAME = "release_bundle.json"
VALIDATION_NAME = "basic61_validation.json"
READY_SEED_NAME = "basic61_seed.private_trial_ready.json"
AUTHORIZATION_NAME = "release_authorization.json"
ATTESTATION_NAME = "runtime_attestation.json"
NORMALIZED_NAME = "normalized_seed.json"
POLICY_NAME = "ai_usage_policy.json"
COUNTRY_EXTENSION_RELEASE_COMMANDS = frozenset(
    {"prepare-country-extension-release", "validate-country-extension-release"}
)
_CONFIRMATION_FIELDS = frozenset(
    {
        "schema_version",
        "extension_id",
        "candidate_sha256",
        "parent_seed_sha256",
        "workbook_sha256",
        "market_overview_candidate_sha256",
        "decision",
        "approved_by",
        "approved_at",
        "approval_statement",
    }
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _output_target(repo: Path, output_dir: Path, *, must_be_new: bool) -> Path:
    ensure_no_symlinks(output_dir)
    target = output_dir.resolve()
    root = repo / "runtime/basic61"
    if not target.is_relative_to(root) or target == root:
        raise CountryExtensionError("release outputs must be a child of runtime/basic61")
    if must_be_new and target.exists():
        raise CountryExtensionError("release output already exists; never overwrite a version")
    return target


def _read_inputs(
    repo: Path,
    candidate_dir: Path,
    workbook_path: Path,
    confirmation_path: Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    candidate_reference = _file_reference(repo, candidate_dir / "candidate.json")
    workbook_reference = _file_reference(repo, workbook_path)
    confirmation_reference = _file_reference(repo, confirmation_path)
    validation = validate_country_extension(
        repo_root=repo, candidate_dir=candidate_dir, workbook_path=workbook_path
    )
    candidate = read_json(candidate_dir / "candidate.json", max_bytes=MAX_INPUT_BYTES)
    if (
        candidate["new_country"]["iso3"] != "ZMB"
        or candidate["projected_counts"] != EXPECTED_COUNTS
        or candidate["overview"] is None
        or candidate_reference["sha256"] != validation["candidate_sha256"]
    ):
        raise CountryExtensionError(
            "BASIC61 requires the exact canonical Zambia candidate, overview and reviewed counts"
        )
    binding = validation["workbook_binding"]
    confirmation = read_json(confirmation_path)
    expected = {
        "schema_version": CONFIRMATION_SCHEMA,
        "extension_id": candidate["extension_id"],
        "candidate_sha256": candidate_reference["sha256"],
        "parent_seed_sha256": candidate["parent"]["seed_sha256"],
        "workbook_sha256": workbook_reference["sha256"],
        "market_overview_candidate_sha256": binding["market_overview"]["candidate_sha256"],
        "decision": "approved",
        "approved_by": "kevin",
        "approval_statement": "审核通过",
    }
    if set(confirmation) != _CONFIRMATION_FIELDS or any(
        confirmation.get(field) != value for field, value in expected.items()
    ):
        raise CountryExtensionError(
            "release requires the actual single confirmation bound to this workbook and candidate"
        )
    approved_at = _iso_time(confirmation["approved_at"], "approved_at")
    metadata, _rows = _read_workbook(_workbook_bytes(workbook_path))
    created_at = _iso_time(metadata.get("created_at"), "workbook_created_at")
    now = _now()
    if any(_time_before(now, stamp) for stamp in (approved_at, created_at)):
        raise CountryExtensionError("confirmation and workbook creation must not be in the future")
    if _time_before(approved_at, created_at) or _time_before(approved_at, candidate["as_of"]):
        raise CountryExtensionError(
            "confirmation must not precede workbook creation or information"
        )
    parent = read_json(
        _reference_path(repo, candidate["inputs"]["parent_seed"]), max_bytes=MAX_INPUT_BYTES
    )
    references = {
        "candidate": candidate_reference,
        "parent_seed": candidate["inputs"]["parent_seed"],
        "reviewed_workbook": workbook_reference,
        "confirmation": confirmation_reference,
    }
    return candidate, parent, confirmation, references


def _domain(metric_code: str) -> str:
    domain = METRIC_LABELS[metric_code][2]
    return "country_identity" if domain == "identity" else domain


def _small_binding(candidate: dict[str, Any], references: dict[str, Any]) -> dict[str, Any]:
    return {
        "extension_id": candidate["extension_id"],
        "added_country_code": "ZMB",
        "parent_seed_sha256": candidate["parent"]["seed_sha256"],
        "candidate_sha256": references["candidate"]["sha256"],
        "workbook_sha256": references["reviewed_workbook"]["sha256"],
        "confirmation_sha256": references["confirmation"]["sha256"],
    }


def _artifact_reference(repo: Path, target: Path, name: str, payload: object) -> dict[str, str]:
    return {"path": (target / name).relative_to(repo).as_posix(), "sha256": content_sha256(payload)}


def _source_collections(
    repo: Path,
    target: Path,
    candidate: dict[str, Any],
    references: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    files: dict[str, Any] = {}
    sources = []
    raw_records = []
    provenance = {}
    country = candidate["new_country"]
    for domain, source_ref in ADDED_SOURCE_REFS.items():
        metrics = [item for item in country["metrics"] if _domain(item["metric_code"]) == domain]
        identity_ids = country["identity_source_ids"] if domain == "country_identity" else []
        source_ids = set(identity_ids)
        for metric in metrics:
            source_ids.update(metric["source_ids"])
        evidence = [item for item in candidate["evidence"]["sources"] if item["id"] in source_ids]
        if not evidence:
            raise CountryExtensionError("each added source collection requires actual evidence")
        collection = {
            "schema_version": "navigator.country-extension-source-collection.v1",
            "extension_id": candidate["extension_id"],
            "data_domain": domain,
            "candidate_sha256": references["candidate"]["sha256"],
            "workbook_sha256": references["reviewed_workbook"]["sha256"],
            "identity": country["identity"] if domain == "country_identity" else None,
            "identity_source_ids": identity_ids,
            "metrics": metrics,
            "sources": evidence,
        }
        name = f"source_collections/{domain}.json"
        files[name] = collection
        collection_reference = _artifact_reference(repo, target, name, collection)
        suffix = domain.upper()
        snapshot_ref = f"SNAP-BASIC61-ZMB-{suffix}"
        raw_ref = f"RAW-BASIC61-ZMB-{suffix}"
        captured_at = max(evidence, key=lambda item: datetime.fromisoformat(item["captured_at"]))[
            "captured_at"
        ]
        sources.append(
            {
                "source_ref": source_ref,
                "provider": "Reviewed Zambia official-source collection",
                "dataset": f"Zambia {domain} evidence and reviewed fields",
                "data_domain": domain,
                "source_role": "primary",
                "status": "active",
                "terms_uri": (
                    "urn:navigator:reviewed-workbook:sha256:"
                    f"{references['reviewed_workbook']['sha256']}"
                ),
                "evidence_sha256": collection_reference["sha256"],
                "access_method": "immutable_reviewed_official_evidence_collection",
                "rate_limit": None,
                "snapshots": [
                    {
                        "snapshot_ref": snapshot_ref,
                        "captured_at": captured_at,
                        "content_sha256": collection_reference["sha256"],
                        "retrieval_uri": (
                            f"urn:navigator:country-extension:{candidate['extension_id']}:{domain}"
                        ),
                        "media_type": "application/json",
                    }
                ],
            }
        )
        raw_records.append(
            {
                "record_ref": raw_ref,
                "source_ref": source_ref,
                "source_snapshot_ref": snapshot_ref,
                "country_code": "ZMB",
                "object_key": collection_reference["path"],
                "payload_sha256": collection_reference["sha256"],
                "media_type": "application/json",
            }
        )
        provenance[domain] = {
            "source_ref": source_ref,
            "source_snapshot_ref": snapshot_ref,
            "raw_record_ref": raw_ref,
        }
    return files, sources, raw_records, provenance


def _ready_country(
    candidate: dict[str, Any], confirmation: dict[str, Any], provenance: dict[str, Any]
) -> dict[str, Any]:
    country = candidate["new_country"]
    identity = country["identity"]
    identity_provenance = provenance["country_identity"]
    # A date-only user decision does not establish a human signing time.
    reviewed_at = confirmation["approved_at"] if len(confirmation["approved_at"]) > 10 else None
    texts = [
        ("short_name", "zh-CN", identity["country_name_zh"], True),
        ("short_name", "en", identity["country_name_en"], True),
        ("official_name", "en", identity["official_name_en"], True),
        *[("local_name", "und", name, False) for name in identity["local_names"]],
    ]
    metrics = []
    for metric in country["metrics"]:
        start, end, label = _period_bounds(metric["period"], candidate["as_of"])
        metrics.append(
            {
                "metric_code": metric["metric_code"],
                "period_start": start,
                "period_end": end,
                "period_label": label,
                "original_value": metric["original_value"],
                "original_unit": metric["unit"],
                "normalized_value": metric["normalized_value"],
                "normalized_unit": metric["unit"],
                "value_status": metric["value_status"],
                "null_reason": metric["null_reason"],
                "quality_status": "reviewed",
                "freshness_status": "current"
                if metric["value_status"] == "available"
                else "pending",
                "reviewed_at": reviewed_at,
                **provenance[_domain(metric["metric_code"])],
            }
        )
    return {
        "iso3": country["iso3"],
        "iso2": country["iso2"],
        "region_code": identity["region_code"],
        "coverage_status": "covered",
        "coverage_level": "Basic",
        **country["assessment"],
        "last_reviewed_at": reviewed_at,
        "localized_texts": [
            {
                "field_code": field,
                "locale": locale,
                "text": value,
                "preferred": preferred,
                "translation_status": "reviewed",
                "source_text_sha256": hashlib.sha256(value.encode("utf-8")).hexdigest(),
                "valid_from": None,
                "valid_to": None,
                **identity_provenance,
            }
            for field, locale, value, preferred in texts
        ],
        "capitals": [
            {
                "name": identity["capital"],
                "role": "official",
                "display_order": 1,
                "valid_from": None,
                "valid_to": None,
                **identity_provenance,
            }
        ],
        "languages": [
            {
                "code": "en" if name == "English" else f"und-{index:02d}",
                "name_en": name,
                "name_local": name,
                "status": "official",
                **identity_provenance,
            }
            for index, name in enumerate(identity["official_languages"], start=1)
        ],
        "currencies": [
            {
                "code": identity["currency_code"],
                "name_en": identity["currency_name"],
                "legal_tender": True,
                "valid_from": None,
                "valid_to": None,
                **identity_provenance,
            }
        ],
        "timezones": [
            {"iana_code": name, "primary": index == 0, **identity_provenance}
            for index, name in enumerate(identity["time_zones"])
        ],
        "admin_structures": [
            {
                "admin_level": 1,
                "unit_type": identity["admin_level_1_type"],
                "unit_count": identity["admin_level_1_count"],
                "as_of_year": int(identity["collected_at"][:4]),
                "status": "reviewed",
                **identity_provenance,
            }
        ],
        "metrics": metrics,
    }


def _release_payloads(
    *,
    repo: Path,
    target: Path,
    candidate_dir: Path,
    workbook_path: Path,
    confirmation_path: Path,
    trust_key: str,
) -> dict[str, Any]:
    trust_key = validate_runtime_attestation_key(trust_key)
    candidate, parent, confirmation, references = _read_inputs(
        repo, candidate_dir, workbook_path, confirmation_path
    )
    binding = _small_binding(candidate, references)
    files, added_sources, added_records, provenance = _source_collections(
        repo, target, candidate, references
    )
    countries = [
        *copy.deepcopy(parent["countries"]),
        _ready_country(candidate, confirmation, provenance),
    ]
    normalized = {
        "schema_version": "basic61.normalized-candidate.v1",
        "release_id": RELEASE_ID,
        "extension": binding,
        "countries": countries,
    }
    files[NORMALIZED_NAME] = normalized
    field_paths = _normalized_data_field_paths(normalized)
    fields_hash = content_sha256(field_paths)
    manual_usage = copy.deepcopy(parent["manual_usage_authorization"])
    manual_usage["field_scope"] = {
        "mode": "all_normalized_basic60_fields",
        "field_count": len(field_paths),
        "fields_sha256": fields_hash,
    }
    normalized_reference = _artifact_reference(repo, target, NORMALIZED_NAME, normalized)
    policy = {
        "schema_version": "basic61.ai-usage-policy.v1",
        "projection_type": "machine_generated_all_field_scope_projection",
        "generator": "navigator-data",
        "release_id": RELEASE_ID,
        "profile_id": PROFILE_ID,
        "permission_basis": manual_usage["permission_basis"],
        "seed": normalized_reference,
        "field_scope": {**manual_usage["field_scope"], "fields": field_paths},
        "parent_manual_authorization_sha256": content_sha256(parent["manual_usage_authorization"]),
        "confirmation_sha256": references["confirmation"]["sha256"],
        "v1_runtime_capabilities": manual_usage["v1_runtime_capabilities"],
    }
    files[POLICY_NAME] = policy
    policy_reference = _artifact_reference(repo, target, POLICY_NAME, policy)
    bundle = {
        "schema_version": "basic61.release-bundle.v1",
        "release_id": RELEASE_ID,
        "release_profile": PROFILE_ID,
        "as_of": candidate["as_of"],
        "extension": binding,
        **references,
        "normalized_seed": normalized_reference,
        "ai_usage_policy": policy_reference,
        "source_collections": {
            domain: _artifact_reference(
                repo,
                target,
                f"source_collections/{domain}.json",
                files[f"source_collections/{domain}.json"],
            )
            for domain in ADDED_SOURCE_REFS
        },
    }
    files[BUNDLE_NAME] = bundle
    bundle_hash = content_sha256(bundle)
    report = {
        "schema_version": "basic61.validation-report.v1",
        "profile_id": PROFILE_ID,
        "release_id": RELEASE_ID,
        "status": "private_trial_ready",
        "ready": True,
        "formal_gate_status": "pending",
        "no_formal_d1_d4_changes": True,
        "no_production_release_claim": True,
        "bundle_sha256": bundle_hash,
        "machine_counts": {
            "country_count": EXPECTED_COUNTS["countries"],
            "macro_annual_record_count": EXPECTED_COUNTS["macro_rows"],
            "energy_latest_record_count": EXPECTED_COUNTS["energy_rows"],
            "available_observation_count": EXPECTED_COUNTS["available_metric_values"],
            "pending_observation_count": EXPECTED_COUNTS["pending_metric_values"],
        },
        "checks": [],
        "extension": binding,
    }
    Basic61ValidationReport.model_validate(report)
    files[VALIDATION_NAME] = report
    report_hash = content_sha256(report)
    seed = {
        "schema_version": "basic61.seed.v1",
        "release": {
            "release_id": RELEASE_ID,
            "release_profile": PROFILE_ID,
            "formal_gate_status": "pending",
            "status": "private_trial_ready",
            "as_of": candidate["as_of"],
            "source_cutoff": candidate["as_of"],
            "release_bundle_sha256": bundle_hash,
            "validation_report_sha256": report_hash,
            "counts": copy.deepcopy(EXPECTED_COUNTS),
        },
        "manual_usage_authorization": manual_usage,
        "ai_usage_policy": {
            "projection_type": "machine_generated_all_field_scope_projection",
            "permission_basis": manual_usage["permission_basis"],
            "policy_reference": policy_reference,
            "seed_sha256": normalized_reference["sha256"],
            "field_count": len(field_paths),
            "fields_sha256": fields_hash,
        },
        "sources": [*copy.deepcopy(parent["sources"]), *added_sources],
        "raw_records": [*copy.deepcopy(parent["raw_records"]), *added_records],
        "metric_definitions": copy.deepcopy(parent["metric_definitions"]),
        "countries": countries,
        "extension": {
            "schema_version": "navigator.country-extension-release-binding.v1",
            **binding,
            "parent_release_id": "BASIC60-PRIVATE-R1",
            "parent_country_sha256": copy.deepcopy(candidate["parent"]["country_sha256"]),
            "added_source_refs": copy.deepcopy(ADDED_SOURCE_REFS),
        },
    }
    # Validate the raw JSON, never dump parsed models over the inherited objects.
    Basic61SeedArtifact.model_validate(seed)
    files[READY_SEED_NAME] = seed
    seed_hash = content_sha256(seed)
    authorization = {
        "schema_version": "basic61.release-authorization.v1",
        "release_id": RELEASE_ID,
        "release_profile": PROFILE_ID,
        "status": "private_trial_ready",
        "formal_gate_status": "pending",
        "release_bundle_sha256": bundle_hash,
        "validation_report_sha256": report_hash,
        "seed_artifact_sha256": seed_hash,
        "approved_at": confirmation["approved_at"],
        "approved_by": confirmation["approved_by"],
        "pbd_decision_id": "PBD-BASIC60-PRIVATE-001",
        "review_scope": "added_country_data_sources_and_overview",
        "reviewed_workbook": references["reviewed_workbook"],
        "confirmation": references["confirmation"],
        "extension": binding,
        "no_formal_d1_d4_changes": True,
        "no_production_release_claim": True,
    }
    Basic61ReleaseAuthorization.model_validate(authorization)
    files[AUTHORIZATION_NAME] = authorization
    claims = {
        "release_id": RELEASE_ID,
        "release_profile": PROFILE_ID,
        "validation_report_sha256": report_hash,
        "release_bundle_sha256": bundle_hash,
        "seed_artifact_sha256": seed_hash,
        "release_authorization_sha256": content_sha256(authorization),
    }
    files[ATTESTATION_NAME] = {
        "schema_version": "basic61.runtime-attestation.v1",
        "artifact_kind": "machine_validation_attestation",
        "algorithm": "HMAC-SHA256",
        "claims": claims,
        "mac_sha256": hmac.new(
            trust_key.encode("utf-8"), _runtime_attestation_message(claims), hashlib.sha256
        ).hexdigest(),
    }
    Basic61RuntimeAttestation.model_validate(files[ATTESTATION_NAME])
    # Detect mutable input changes during construction before writing ready artifacts.
    for reference in references.values():
        _reference_path(repo, reference)
    for reference in candidate["inputs"].values():
        _reference_path(repo, reference)
    for source in candidate["evidence"]["sources"]:
        _reference_path(repo, {"path": source["local_path"], "sha256": source["sha256"]})
    return files


def _verify_directory(
    repo: Path, release_dir: Path, declared_target: Path, trust_key: str
) -> dict[str, Any]:
    ensure_no_symlinks(release_dir)
    bundle_path = release_dir / BUNDLE_NAME
    ensure_no_symlinks(bundle_path)
    bundle = read_json(bundle_path)
    if bundle.get("schema_version") != "basic61.release-bundle.v1":
        raise CountryExtensionError("invalid BASIC61 release bundle")
    candidate_path = _reference_path(repo, bundle.get("candidate"))
    workbook_path = _reference_path(repo, bundle.get("reviewed_workbook"))
    confirmation_path = _reference_path(repo, bundle.get("confirmation"))
    expected = _release_payloads(
        repo=repo,
        target=declared_target,
        candidate_dir=candidate_path.parent,
        workbook_path=workbook_path,
        confirmation_path=confirmation_path,
        trust_key=trust_key,
    )
    actual_files = set()
    for path in release_dir.rglob("*"):
        ensure_no_symlinks(path)
        if not path.is_dir():
            actual_files.add(path.relative_to(release_dir).as_posix())
    if actual_files != set(expected):
        raise CountryExtensionError(
            "release must contain exactly its replayable immutable artifacts"
        )
    for name, payload in expected.items():
        if (release_dir / name).read_bytes() != canonical_bytes(payload):
            raise CountryExtensionError(f"release artifact differs from exact replay: {name}")
    report: dict[str, Any] = expected[VALIDATION_NAME]
    return report


def prepare_country_extension_release(
    *,
    repo_root: Path,
    candidate_dir: Path,
    workbook_path: Path,
    confirmation_path: Path,
    output_dir: Path,
    trust_key: str,
) -> dict[str, Any]:
    """Consume one actual confirmation and create a new, inactive release directory."""
    repo = repo_root.resolve()
    target = _output_target(repo, output_dir, must_be_new=True)
    payloads = _release_payloads(
        repo=repo,
        target=target,
        candidate_dir=candidate_dir,
        workbook_path=workbook_path,
        confirmation_path=confirmation_path,
        trust_key=trust_key,
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".country-extension-release-", dir=target.parent
    ) as name:
        staging = Path(name) / "release"
        staging.mkdir()
        for filename, payload in payloads.items():
            _immutable_bytes(staging / filename, canonical_bytes(payload))
        report = _verify_directory(repo, staging, target, trust_key)
        _publish_directory(staging, target)
    return {**report, "output_dir": target.relative_to(repo).as_posix(), "activated": False}


def validate_country_extension_release(
    *, repo_root: Path, release_dir: Path, trust_key: str
) -> dict[str, Any]:
    """Replay every source, workbook, confirmation, generated file and machine MAC."""
    repo = repo_root.resolve()
    target = _output_target(repo, release_dir, must_be_new=False)
    report = _verify_directory(repo, target, target, trust_key)
    return {**report, "output_dir": target.relative_to(repo).as_posix(), "activated": False}


def add_country_extension_release_commands(commands: Any) -> None:
    prepare = commands.add_parser(
        "prepare-country-extension-release",
        help="Build an inactive BASIC61 release from the actual single-workbook confirmation.",
    )
    for name in ("candidate-dir", "workbook", "confirmation", "output-dir"):
        prepare.add_argument(f"--{name}", required=True, type=Path)
    validate = commands.add_parser(
        "validate-country-extension-release", help="Replay the BASIC61 release without activation."
    )
    validate.add_argument("--release-dir", required=True, type=Path)


def run_country_extension_release_command(args: argparse.Namespace, repo_root: Path) -> int:
    def path(value: Path) -> Path:
        return value if value.is_absolute() else repo_root / value

    try:
        trust_key = validate_runtime_attestation_key(os.environ.get(RUNTIME_ATTESTATION_KEY_ENV))
        if args.command == "prepare-country-extension-release":
            report = prepare_country_extension_release(
                repo_root=repo_root,
                candidate_dir=path(args.candidate_dir),
                workbook_path=path(args.workbook),
                confirmation_path=path(args.confirmation),
                output_dir=path(args.output_dir),
                trust_key=trust_key,
            )
        else:
            report = validate_country_extension_release(
                repo_root=repo_root, release_dir=path(args.release_dir), trust_key=trust_key
            )
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(
            json.dumps(
                {"status": "not_ready", "activated": False, "error": str(exc)}, ensure_ascii=False
            )
        )
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0
