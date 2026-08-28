"""Strict, replayable machine evidence for the BASIC60 private release track.

This module is intentionally independent from :mod:`basic60_private`.  It does
not execute deployment drills or network probes.  A caller must supply raw
observations produced by those live operations; missing observations are a
hard collection error.  Validation derives every verdict from the raw rows and
never accepts a submitted pass flag, percentile, or summary sample count.
"""

from __future__ import annotations

import ast
import hashlib
import json
import math
import os
import re
import tempfile
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Any

MACHINE_EVIDENCE_SCHEMA = "basic60.machine-evidence.v2"
D3_STAGE_SCHEMA = "basic60.d3-stage.v2"
PROFILE_ID = "basic60_private"
RELEASE_ID = "BASIC60-PRIVATE-R1"

D3_STAGES = ("parse", "standardize", "entity")
REQUIRED_OPERATIONS = (
    "empty_database_import",
    "release_rebuild",
    "previous_release_rollback",
    "source_revocation",
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
ISO3_RE = re.compile(r"^[A-Z]{3}$")

SOURCE_PRESERVATION_FIELDS = (
    "source_ref",
    "source_snapshot_ref",
    "raw_record_ref",
    "source_text",
)
ORIGINAL_PRESERVATION_FIELDS = ("original_value", "original_unit", "source_text")

FORBIDDEN_SELF_ATTESTATION_KEYS = frozenset(
    {
        "passed",
        "pass",
        "status",
        "success",
        "succeeded",
        "history_preserved",
        "p95",
        "p95_ms",
        "sample_count",
        "route_count",
        "event_count",
    }
)

EXPECTED_API_ROUTES: dict[str, tuple[str, re.Pattern[str]]] = {
    "API-COUNTRY-001": ("GET", re.compile(r"^/api/v1/countries(?:\?.*)?$")),
    "API-COUNTRY-002": (
        "GET",
        re.compile(r"^/api/v1/countries/[A-Z]{3}(?:\?.*)?$"),
    ),
}

REQUIRED_ROUTE_PROBES: dict[tuple[str, str, str], int] = {
    ("api", "GET", "/health"): 200,
    ("api", "GET", "/api/v1/countries"): 200,
    ("api", "GET", "/api/v1/countries/IDN"): 200,
    ("api", "POST", "/api/v1/country-comparisons"): 404,
    ("api", "POST", "/api/v1/demo/country-comparisons"): 404,
    ("api", "GET", "/api/v1/policies"): 404,
    ("api", "GET", "/api/v1/search"): 404,
    ("api", "POST", "/api/v1/ai/chat"): 404,
    ("web", "GET", "/api/health"): 200,
    ("web", "GET", "/basic60"): 200,
    ("web", "GET", "/basic60/login"): 200,
    ("web", "GET", "/basic60/api/v1/countries"): 200,
    ("web", "GET", "/policies"): 404,
    ("web", "GET", "/tools/assistant"): 404,
    ("web", "GET", "/api/demo/countries"): 404,
    ("web", "GET", "/api/session"): 404,
    ("web", "GET", "/login"): 404,
}

_SOURCE_FIXED_PATHS = (
    PurePosixPath("deploy/basic60/compose.private-trial.yaml"),
    PurePosixPath("apps/web/proxy.ts"),
    PurePosixPath("apps/web/app/api/health/route.ts"),
    PurePosixPath("services/api/src/navigator_api/basic60_config.py"),
    PurePosixPath("services/api/src/navigator_api/basic60_governance.py"),
    PurePosixPath("services/api/src/navigator_api/basic60_main.py"),
    PurePosixPath("services/api/src/navigator_api/basic60_importer.py"),
    PurePosixPath("services/api/src/navigator_api/basic60_models.py"),
    PurePosixPath("services/api/src/navigator_api/basic60_service.py"),
    PurePosixPath("services/api/src/navigator_api/routers/basic60.py"),
    PurePosixPath("services/api/src/navigator_api/routers/basic60_countries.py"),
)


@dataclass(frozen=True, slots=True)
class EvidenceIssue:
    """A deterministic machine-evidence validation failure."""

    code: str
    message: str
    location: str


class EvidenceCollectionError(ValueError):
    """Raised when complete, valid machine evidence cannot be collected."""


def _json_safe(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (datetime, date, Decimal, Path)):
        return str(value)
    return value


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        _json_safe(value),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    """Return the SHA-256 of canonical UTF-8 JSON for ``value``."""

    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def implementation_sha256() -> str:
    """Hash the actual bytes of this module, never a caller-provided value."""

    return _sha256_file(Path(__file__).resolve(strict=True))


def _aware_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed.utcoffset() is not None


def _timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _exact_keys(value: Any, expected: set[str]) -> bool:
    return isinstance(value, Mapping) and set(value) == expected


def _safe_repository_root(repository_root: Path) -> Path:
    root = repository_root.resolve(strict=True)
    if not root.is_dir():
        raise EvidenceCollectionError(f"Repository root is not a directory: {root}")
    return root


def _has_symlink_component(root: Path, path: Path) -> bool:
    relative = path.relative_to(root)
    current = root
    for part in relative.parts:
        current /= part
        if current.is_symlink():
            return True
    return False


def _safe_file(repository_root: Path, value: Path | str) -> Path:
    root = _safe_repository_root(repository_root)
    raw = Path(value)
    candidate = raw if raw.is_absolute() else root / raw
    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise EvidenceCollectionError(f"Evidence file must be inside the repository: {value}")
    if _has_symlink_component(root, resolved):
        raise EvidenceCollectionError(f"Evidence file may not traverse a symlink: {value}")
    return resolved


def _safe_output_directory(repository_root: Path, output_directory: Path) -> Path:
    root = _safe_repository_root(repository_root)
    candidate = output_directory if output_directory.is_absolute() else root / output_directory
    absolute = candidate.absolute()
    if not absolute.is_relative_to(root) or absolute == root:
        raise EvidenceCollectionError(
            "D3 output directory must be a specific path inside the repository"
        )
    current = root
    for part in absolute.relative_to(root).parts:
        current /= part
        if current.exists() and current.is_symlink():
            raise EvidenceCollectionError("D3 output directory may not traverse a symlink")
    absolute.mkdir(parents=True, exist_ok=True)
    return absolute.resolve(strict=True)


def _reference(repository_root: Path, path: Path | str) -> dict[str, Any]:
    root = _safe_repository_root(repository_root)
    resolved = _safe_file(root, path)
    return {
        "path": resolved.relative_to(root).as_posix(),
        "sha256": _sha256_file(resolved),
        "byte_size": resolved.stat().st_size,
    }


def _write_json_atomic_no_overwrite(path: Path, payload: Mapping[str, Any]) -> None:
    if path.exists():
        raise FileExistsError(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = _serialized_json(payload)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False
        ) as handle:
            temporary_name = handle.name
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary_name, path)
    finally:
        if temporary_name is not None:
            Path(temporary_name).unlink(missing_ok=True)


def _serialized_json(payload: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(_json_safe(payload), ensure_ascii=False, indent=2, sort_keys=True).encode(
            "utf-8"
        )
        + b"\n"
    )


def _release_id(seed: Mapping[str, Any]) -> str:
    release = seed.get("release")
    value = release.get("release_id") if isinstance(release, Mapping) else seed.get("release_id")
    return str(value or "")


def _profile_id(seed: Mapping[str, Any]) -> str:
    release = seed.get("release")
    value = (
        release.get("release_profile")
        if isinstance(release, Mapping)
        else seed.get("profile_id") or seed.get("release_profile")
    )
    return str(value or "")


def _decimal_text(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None
    if not parsed.is_finite():
        return None
    normalized = parsed.normalize()
    text = format(normalized, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in {"", "-0"} else text


def _period_text(metric: Mapping[str, Any]) -> str:
    direct = metric.get("period") or metric.get("period_label")
    if direct is not None:
        return str(direct)
    start = metric.get("period_start")
    end = metric.get("period_end")
    return f"{start or ''}/{end or ''}"


def _base_metric_records(seed: Mapping[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    countries = seed.get("countries")
    if not isinstance(countries, list) or not countries:
        raise ValueError("Candidate seed must contain country rows")

    rows: list[dict[str, Any]] = []
    country_enum_unknown: list[str] = []
    for country_index, country_value in enumerate(countries):
        if not isinstance(country_value, Mapping):
            raise ValueError("Each candidate country must be an object")
        country = country_value
        iso3 = str(country.get("iso3") or "")
        iso2 = str(country.get("iso2") or "")
        invalid_country_enum = any(
            (
                country.get("coverage_status") not in {None, "covered"},
                country.get("coverage_level") not in {None, "Basic"},
                country.get("opportunity_level") not in {None, "pending"},
                country.get("policy_friendliness_level") not in {None, "pending"},
                country.get("risk_assessment_status") not in {None, "unknown"},
            )
        )
        metrics = country.get("metrics")
        if not isinstance(metrics, list):
            raise ValueError(f"Country {iso3 or country_index} must contain metric rows")
        for metric_index, metric_value in enumerate(metrics):
            if not isinstance(metric_value, Mapping):
                raise ValueError("Each candidate metric must be an object")
            metric = metric_value
            original_value = _json_safe(metric.get("original_value"))
            source_text = metric.get("source_text")
            if source_text is None:
                source_text = "" if original_value is None else str(original_value)
            identity = [
                country_index,
                metric_index,
                iso3,
                str(metric.get("metric_code") or ""),
                _period_text(metric),
                str(metric.get("source_ref") or ""),
            ]
            record_id = f"D3-{hashlib.sha256(_canonical_bytes(identity)).hexdigest()[:24]}"
            row = {
                "record_id": record_id,
                "iso3": iso3,
                "iso2": iso2,
                "metric_code": str(metric.get("metric_code") or ""),
                "period": _period_text(metric),
                "original_value": original_value,
                "original_unit": str(metric.get("original_unit") or metric.get("unit") or ""),
                "declared_normalized_value": _json_safe(metric.get("normalized_value")),
                "declared_normalized_unit": str(
                    metric.get("normalized_unit") or metric.get("unit") or ""
                ),
                "value_state": str(metric.get("value_status") or ""),
                "null_reason": metric.get("null_reason"),
                "quality_state": str(metric.get("quality_status") or ""),
                "source_ref": str(metric.get("source_ref") or ""),
                "source_snapshot_ref": str(metric.get("source_snapshot_ref") or ""),
                "raw_record_ref": str(metric.get("raw_record_ref") or ""),
                "source_text": str(source_text),
                "parsed_value": _decimal_text(original_value),
            }
            rows.append(row)
            if invalid_country_enum:
                country_enum_unknown.append(record_id)
    return rows, country_enum_unknown


def _quality_observations(
    records: Sequence[Mapping[str, Any]], country_enum_unknown: Sequence[str]
) -> dict[str, list[str]]:
    unknown: set[str] = set(country_enum_unknown)
    parse_errors: set[str] = set()
    fuzzy: set[str] = set()
    conflicts: set[str] = set()
    duplicates: set[str] = set()
    exact_groups: dict[str, list[str]] = defaultdict(list)
    entity_groups: dict[str, list[Mapping[str, Any]]] = defaultdict(list)

    for record in records:
        record_id = str(record["record_id"])
        iso3 = str(record.get("iso3") or "")
        canonical_iso3 = iso3.strip().upper()
        if not ISO3_RE.fullmatch(canonical_iso3):
            unknown.add(record_id)
        elif iso3 != canonical_iso3:
            fuzzy.add(record_id)
        if (
            record.get("value_state") not in {"available", "pending", "unavailable"}
            or not str(record.get("metric_code") or "").strip()
            or not str(record.get("source_ref") or "").strip()
            or not str(record.get("original_unit") or "").strip()
        ):
            unknown.add(record_id)
        if record.get("original_value") not in {None, ""} and record.get("parsed_value") is None:
            parse_errors.add(record_id)

        parsed_value = record.get("parsed_value")
        declared = _decimal_text(record.get("declared_normalized_value"))
        if declared is not None and declared != parsed_value:
            conflicts.add(record_id)

        exact_key = canonical_sha256(
            {
                key: record.get(key)
                for key in (
                    "iso3",
                    "metric_code",
                    "period",
                    "original_value",
                    "original_unit",
                    "source_ref",
                    "source_snapshot_ref",
                    "raw_record_ref",
                )
            }
        )
        exact_groups[exact_key].append(record_id)
        entity_key = "|".join(
            (
                canonical_iso3,
                str(record.get("metric_code") or ""),
                str(record.get("period") or ""),
            )
        )
        entity_groups[entity_key].append(record)

    for duplicate_group in exact_groups.values():
        duplicates.update(duplicate_group[1:])
    for entity_group in entity_groups.values():
        semantic_values = {
            (
                row.get("parsed_value"),
                str(row.get("declared_normalized_unit") or "").strip().upper(),
            )
            for row in entity_group
        }
        if len(semantic_values) > 1:
            conflicts.update(str(row["record_id"]) for row in entity_group)

    return {
        "unknown_enum_record_ids": sorted(unknown),
        "parse_error_record_ids": sorted(parse_errors),
        "fuzzy_match_record_ids": sorted(fuzzy),
        "conflict_record_ids": sorted(conflicts),
        "duplicate_record_ids": sorted(duplicates),
    }


def _preservation_hash(records: Sequence[Mapping[str, Any]], fields: Sequence[str]) -> str:
    rows = [
        {"record_id": record["record_id"], **{field: record.get(field) for field in fields}}
        for record in records
    ]
    return canonical_sha256(rows)


def _stage_payload(
    *,
    stage_id: str,
    records: list[dict[str, Any]],
    seed_sha256: str,
    raw_manifest_sha256: str,
    raw_root_sha256: str,
    input_payload_sha256: str,
    implementation_hash: str,
    country_enum_unknown: Sequence[str],
) -> dict[str, Any]:
    return {
        "schema_version": D3_STAGE_SCHEMA,
        "profile_id": PROFILE_ID,
        "release_id": RELEASE_ID,
        "stage_id": stage_id,
        "implementation_sha256": implementation_hash,
        "seed_payload_sha256": seed_sha256,
        "raw_manifest_payload_sha256": raw_manifest_sha256,
        "raw_root_sha256": raw_root_sha256,
        "input_payload_sha256": input_payload_sha256,
        "records": records,
        "records_sha256": canonical_sha256(records),
        "original_values_sha256": _preservation_hash(records, ORIGINAL_PRESERVATION_FIELDS),
        "source_fields_sha256": _preservation_hash(records, SOURCE_PRESERVATION_FIELDS),
        "quality_observations": _quality_observations(records, country_enum_unknown),
    }


def build_d3_stage_payloads(
    candidate_seed: Mapping[str, Any], raw_manifest: Mapping[str, Any]
) -> dict[str, dict[str, Any]]:
    """Build deterministic parse, standardize, and entity payloads from real inputs."""

    seed = _json_safe(candidate_seed)
    manifest = _json_safe(raw_manifest)
    if not isinstance(seed, Mapping) or not isinstance(manifest, Mapping):
        raise ValueError("Candidate seed and raw manifest must be objects")
    if _release_id(seed) != RELEASE_ID or _profile_id(seed) != PROFILE_ID:
        raise ValueError("Candidate seed must target BASIC60-PRIVATE-R1/basic60_private")
    raw_root_sha256 = str(manifest.get("root_sha256") or "")
    if not SHA256_RE.fullmatch(raw_root_sha256):
        raise ValueError("Raw manifest requires a lowercase SHA-256 root hash")
    source_root = seed.get("source_root_sha256")
    if source_root is not None and source_root != raw_root_sha256:
        raise ValueError("Candidate seed is not bound to the supplied raw manifest")

    implementation_hash = implementation_sha256()
    seed_hash = canonical_sha256(seed)
    manifest_hash = canonical_sha256(manifest)
    parsed_records, country_enum_unknown = _base_metric_records(seed)
    parse_payload = _stage_payload(
        stage_id="parse",
        records=parsed_records,
        seed_sha256=seed_hash,
        raw_manifest_sha256=manifest_hash,
        raw_root_sha256=raw_root_sha256,
        input_payload_sha256=seed_hash,
        implementation_hash=implementation_hash,
        country_enum_unknown=country_enum_unknown,
    )

    standardized_records: list[dict[str, Any]] = []
    for record in parsed_records:
        standardized_records.append(
            {
                **record,
                "normalized_value": record["parsed_value"],
                "normalized_unit": str(record["declared_normalized_unit"]).strip().upper(),
            }
        )
    standardize_payload = _stage_payload(
        stage_id="standardize",
        records=standardized_records,
        seed_sha256=seed_hash,
        raw_manifest_sha256=manifest_hash,
        raw_root_sha256=raw_root_sha256,
        input_payload_sha256=canonical_sha256(parse_payload),
        implementation_hash=implementation_hash,
        country_enum_unknown=country_enum_unknown,
    )

    entity_records: list[dict[str, Any]] = []
    for record in standardized_records:
        raw_iso3 = str(record["iso3"])
        canonical_iso3 = raw_iso3.strip().upper()
        if not ISO3_RE.fullmatch(canonical_iso3):
            match_kind = "unknown"
        elif raw_iso3 == canonical_iso3:
            match_kind = "exact"
        else:
            match_kind = "fuzzy_review_required"
        entity_records.append(
            {
                **record,
                "entity_key": "|".join(
                    (canonical_iso3, str(record["metric_code"]), str(record["period"]))
                ),
                "match_kind": match_kind,
            }
        )
    entity_payload = _stage_payload(
        stage_id="entity",
        records=entity_records,
        seed_sha256=seed_hash,
        raw_manifest_sha256=manifest_hash,
        raw_root_sha256=raw_root_sha256,
        input_payload_sha256=canonical_sha256(standardize_payload),
        implementation_hash=implementation_hash,
        country_enum_unknown=country_enum_unknown,
    )
    return {
        "parse": parse_payload,
        "standardize": standardize_payload,
        "entity": entity_payload,
    }


def write_d3_stage_payloads(
    candidate_seed: Mapping[str, Any],
    raw_manifest: Mapping[str, Any],
    *,
    repository_root: Path,
    output_directory: Path,
) -> dict[str, Any]:
    """Replay twice, compare hashes, and atomically publish the three D3 payloads."""

    first = build_d3_stage_payloads(candidate_seed, raw_manifest)
    second = build_d3_stage_payloads(candidate_seed, raw_manifest)
    first_hashes = {stage: canonical_sha256(first[stage]) for stage in D3_STAGES}
    second_hashes = {stage: canonical_sha256(second[stage]) for stage in D3_STAGES}
    if first_hashes != second_hashes:
        raise EvidenceCollectionError("D3 replay produced non-deterministic stage payloads")

    root = _safe_repository_root(repository_root)
    output = _safe_output_directory(root, output_directory)
    paths = {stage: output / f"basic60-d3-{stage}.stage.json" for stage in D3_STAGES}
    existing = {stage: path.exists() for stage, path in paths.items()}
    if any(existing.values()):
        if not all(existing.values()):
            raise EvidenceCollectionError("D3 stage output set is incomplete; refusing replacement")
        for stage in D3_STAGES:
            if paths[stage].read_bytes() != _serialized_json(first[stage]):
                raise EvidenceCollectionError(
                    f"Existing D3 {stage} payload differs from the deterministic replay"
                )
    else:
        for stage in D3_STAGES:
            _write_json_atomic_no_overwrite(paths[stage], first[stage])
    return {
        "stages": {stage: _reference(root, paths[stage]) for stage in D3_STAGES},
        "replay": {
            "first_output_sha256": first_hashes,
            "second_output_sha256": second_hashes,
        },
    }


def _iter_manifest_files(root: Path, directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    result: list[Path] = []
    for path in directory.rglob("*"):
        if path.is_symlink():
            raise EvidenceCollectionError(f"Isolation manifest may not include a symlink: {path}")
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
            result.append(path)
    return sorted(result, key=lambda item: item.relative_to(root).as_posix())


def _discover_isolation_source_files(repository_root: Path) -> list[Path]:
    root = _safe_repository_root(repository_root)
    files: set[Path] = set()
    for relative in _SOURCE_FIXED_PATHS:
        path = root / relative
        if not path.is_file():
            raise EvidenceCollectionError(f"Required isolation source is missing: {relative}")
        files.add(path.resolve(strict=True))

    recursive_roots = (
        root / "deploy/basic60",
        root / "apps/web/app/(basic60)",
        root / "apps/web/lib/basic60",
        root / "services/api/alembic_basic60",
    )
    for directory in recursive_roots:
        files.update(_iter_manifest_files(root, directory))

    optional_patterns = (
        (root / "apps/web/components", "basic60-*"),
        (root / "services/api/src/navigator_api", "basic60_*.py"),
        (root / "services/api/src/navigator_api/routers", "basic60*.py"),
    )
    for directory, pattern in optional_patterns:
        if directory.is_dir():
            for path in directory.glob(pattern):
                if path.is_symlink():
                    raise EvidenceCollectionError(
                        f"Isolation manifest may not include a symlink: {path}"
                    )
                if path.is_file():
                    files.add(path.resolve(strict=True))
    return sorted(files, key=lambda item: item.relative_to(root).as_posix())


def _file_manifest(repository_root: Path, paths: Sequence[Path]) -> list[dict[str, Any]]:
    return [_reference(repository_root, path) for path in paths]


def _public_tree(repository_root: Path) -> dict[str, Any]:
    root = _safe_repository_root(repository_root)
    public_root = root / "apps/web/public"
    if not public_root.is_dir() or public_root.is_symlink():
        raise EvidenceCollectionError("apps/web/public must be a real directory")
    files = _file_manifest(root, _iter_manifest_files(root, public_root))
    return {
        "root": public_root.relative_to(root).as_posix(),
        "files": files,
        "tree_sha256": canonical_sha256(files),
    }


def collect_machine_evidence(
    *,
    repository_root: Path,
    seed_path: Path,
    raw_manifest_path: Path,
    bundle_path: Path,
    d3_artifacts: Mapping[str, Any],
    operation_logs: Mapping[str, Mapping[str, Any]],
    api_observations: Mapping[str, Any],
    route_probes: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Aggregate complete raw observations without inventing missing live results."""

    if set(operation_logs) != set(REQUIRED_OPERATIONS):
        missing = sorted(set(REQUIRED_OPERATIONS) - set(operation_logs))
        raise EvidenceCollectionError(f"Missing live operation logs: {missing}")
    if not api_observations or not route_probes:
        raise EvidenceCollectionError("Live API samples and route probes are required")

    root = _safe_repository_root(repository_root)
    source_files = _file_manifest(root, _discover_isolation_source_files(root))
    isolation = {
        "source_files": source_files,
        "source_files_sha256": canonical_sha256(source_files),
        "route_probes": _json_safe(route_probes),
        "route_probes_sha256": canonical_sha256(route_probes),
        "public_tree": _public_tree(root),
    }
    payload = {
        "schema_version": MACHINE_EVIDENCE_SCHEMA,
        "profile_id": PROFILE_ID,
        "release_id": RELEASE_ID,
        "implementation_sha256": implementation_sha256(),
        "seed_artifact": _reference(root, seed_path),
        "raw_manifest": _reference(root, raw_manifest_path),
        "bundle_artifact": _reference(root, bundle_path),
        "d3": _json_safe(d3_artifacts),
        "operations": _json_safe(operation_logs),
        "api": _json_safe(api_observations),
        "isolation": isolation,
    }
    issues = validate_machine_evidence(payload, repository_root=root)
    if issues:
        summary = "; ".join(f"{item.code}@{item.location}" for item in issues[:8])
        raise EvidenceCollectionError(f"Machine evidence is incomplete or invalid: {summary}")
    return payload


def _add_issue(issues: list[EvidenceIssue], code: str, message: str, location: str) -> None:
    issues.append(EvidenceIssue(code=code, message=message, location=location))


def _forbidden_self_attestations(
    value: Any, issues: list[EvidenceIssue], location: str = "evidence"
) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            child = f"{location}.{key}"
            if str(key).lower() in FORBIDDEN_SELF_ATTESTATION_KEYS:
                _add_issue(
                    issues,
                    "B60_EVIDENCE_SELF_ATTESTATION",
                    f"Submitted verdict field is prohibited: {key}",
                    child,
                )
            _forbidden_self_attestations(item, issues, child)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _forbidden_self_attestations(item, issues, f"{location}.{index}")


def _validated_reference(
    repository_root: Path,
    reference: Any,
    issues: list[EvidenceIssue],
    location: str,
) -> Path | None:
    expected = {"path", "sha256", "byte_size"}
    if not _exact_keys(reference, expected):
        _add_issue(
            issues,
            "B60_EVIDENCE_REFERENCE_INVALID",
            "File reference must contain only path, sha256, and byte_size",
            location,
        )
        return None
    assert isinstance(reference, Mapping)
    raw_path = reference.get("path")
    digest = reference.get("sha256")
    size = reference.get("byte_size")
    if (
        not isinstance(raw_path, str)
        or not raw_path
        or "\\" in raw_path
        or PurePosixPath(raw_path).is_absolute()
        or ".." in PurePosixPath(raw_path).parts
        or not isinstance(digest, str)
        or SHA256_RE.fullmatch(digest) is None
        or not isinstance(size, int)
        or isinstance(size, bool)
        or size < 0
    ):
        _add_issue(
            issues,
            "B60_EVIDENCE_REFERENCE_INVALID",
            "File reference contains an unsafe path, hash, or size",
            location,
        )
        return None
    try:
        resolved = _safe_file(repository_root, raw_path)
    except (EvidenceCollectionError, OSError) as error:
        _add_issue(
            issues,
            "B60_EVIDENCE_REFERENCE_UNREADABLE",
            str(error),
            location,
        )
        return None
    if resolved.stat().st_size != size or _sha256_file(resolved) != digest:
        _add_issue(
            issues,
            "B60_EVIDENCE_REFERENCE_DRIFT",
            "Referenced file size or SHA-256 no longer matches",
            location,
        )
        return None
    return resolved


def _load_json_reference(
    repository_root: Path,
    reference: Any,
    issues: list[EvidenceIssue],
    location: str,
) -> dict[str, Any] | None:
    path = _validated_reference(repository_root, reference, issues, location)
    if path is None:
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        _add_issue(
            issues,
            "B60_EVIDENCE_JSON_INVALID",
            f"Referenced JSON is invalid: {error}",
            location,
        )
        return None
    if not isinstance(value, dict):
        _add_issue(
            issues,
            "B60_EVIDENCE_JSON_INVALID",
            "Referenced JSON must contain an object",
            location,
        )
        return None
    return value


def _seed_counts(seed: Mapping[str, Any]) -> dict[str, int]:
    countries = seed.get("countries")
    country_rows = countries if isinstance(countries, list) else []
    available = 0
    pending = 0
    unavailable = 0
    total = 0
    for country in country_rows:
        if not isinstance(country, Mapping):
            continue
        metrics = country.get("metrics")
        for metric in metrics if isinstance(metrics, list) else []:
            if not isinstance(metric, Mapping):
                continue
            total += 1
            state = metric.get("value_status")
            if state == "available":
                available += 1
            elif state == "pending":
                pending += 1
            elif state == "unavailable":
                unavailable += 1
    return {
        "countries": len(country_rows),
        "metric_values": total,
        "available_metric_values": available,
        "pending_metric_values": pending,
        "unavailable_metric_values": unavailable,
    }


def _validate_d3(
    d3: Any,
    repository_root: Path,
    seed: Mapping[str, Any] | None,
    raw_manifest: Mapping[str, Any] | None,
    issues: list[EvidenceIssue],
) -> None:
    if not _exact_keys(d3, {"stages", "replay"}):
        _add_issue(
            issues,
            "B60_D3_EVIDENCE_INVALID",
            "D3 evidence must contain only stages and replay",
            "d3",
        )
        return
    assert isinstance(d3, Mapping)
    stages = d3.get("stages")
    replay = d3.get("replay")
    if not isinstance(stages, Mapping) or set(stages) != set(D3_STAGES):
        _add_issue(
            issues,
            "B60_D3_STAGE_SET_INVALID",
            "Parse, standardize, and entity stage references are required",
            "d3.stages",
        )
        return
    if not _exact_keys(replay, {"first_output_sha256", "second_output_sha256"}):
        _add_issue(
            issues,
            "B60_D3_REPLAY_INVALID",
            "D3 replay must contain only first and second output hashes",
            "d3.replay",
        )
        return

    loaded: dict[str, dict[str, Any]] = {}
    for stage in D3_STAGES:
        payload = _load_json_reference(
            repository_root, stages.get(stage), issues, f"d3.stages.{stage}"
        )
        if payload is not None:
            loaded[stage] = payload
    if seed is None or raw_manifest is None or len(loaded) != len(D3_STAGES):
        return
    try:
        expected = build_d3_stage_payloads(seed, raw_manifest)
    except (TypeError, ValueError) as error:
        _add_issue(
            issues,
            "B60_D3_INPUT_INVALID",
            str(error),
            "d3",
        )
        return

    expected_hashes = {stage: canonical_sha256(expected[stage]) for stage in D3_STAGES}
    for stage in D3_STAGES:
        if loaded[stage] != expected[stage]:
            _add_issue(
                issues,
                "B60_D3_STAGE_CONTENT_INVALID",
                f"{stage} payload does not equal the independently replayed output",
                f"d3.stages.{stage}",
            )
    assert isinstance(replay, Mapping)
    first = replay.get("first_output_sha256")
    second = replay.get("second_output_sha256")
    if first != expected_hashes or second != expected_hashes or first != second:
        _add_issue(
            issues,
            "B60_D3_REPLAY_MISMATCH",
            "Both recorded replays must equal the independently recalculated stage hashes",
            "d3.replay",
        )


_SNAPSHOT_KEYS = {
    "seq",
    "event_type",
    "occurred_at",
    "database_id",
    "phase",
    "table_counts",
    "metric_value_states",
    "releases",
    "sources",
    "version_rows",
    "immutable_data_sha256",
}
_IMPORT_KEYS = {
    "seq",
    "event_type",
    "occurred_at",
    "database_id",
    "release_id",
    "seed_sha256",
    "returned_counts",
}
_ACTIVATION_KEYS = {
    "seq",
    "event_type",
    "occurred_at",
    "database_id",
    "target_release_id",
}
_REVOCATION_KEYS = {
    "seq",
    "event_type",
    "occurred_at",
    "database_id",
    "release_id",
    "source_ref",
}
_VISIBILITY_KEYS = {
    "seq",
    "event_type",
    "occurred_at",
    "method",
    "path",
    "http_status",
    "response_release_id",
    "source_ref",
    "source_ref_occurrences",
}


def _nonnegative_int_map(value: Any) -> bool:
    return (
        isinstance(value, Mapping)
        and bool(value)
        and all(
            isinstance(key, str)
            and bool(key)
            and isinstance(item, int)
            and not isinstance(item, bool)
            and item >= 0
            for key, item in value.items()
        )
    )


def _validate_snapshot(
    event: Mapping[str, Any], issues: list[EvidenceIssue], location: str
) -> bool:
    valid = True
    if set(event) != _SNAPSHOT_KEYS:
        _add_issue(
            issues,
            "B60_OPERATION_SNAPSHOT_SCHEMA_INVALID",
            "Snapshot event fields are not exact",
            location,
        )
        return False
    if not _nonnegative_int_map(event.get("table_counts")) or not _nonnegative_int_map(
        event.get("metric_value_states")
    ):
        _add_issue(
            issues,
            "B60_OPERATION_SNAPSHOT_COUNTS_INVALID",
            "Snapshot table and metric-state observations must be non-negative integer maps",
            location,
        )
        valid = False
    if SHA256_RE.fullmatch(str(event.get("immutable_data_sha256") or "")) is None:
        _add_issue(
            issues,
            "B60_OPERATION_SNAPSHOT_HASH_INVALID",
            "Snapshot immutable-data hash is invalid",
            location,
        )
        valid = False

    releases = event.get("releases")
    if (
        not isinstance(releases, list)
        or any(
            not _exact_keys(row, {"release_id", "lifecycle_state", "is_active", "artifact_sha256"})
            or not isinstance(row.get("is_active"), bool)
            or SHA256_RE.fullmatch(str(row.get("artifact_sha256") or "")) is None
            for row in releases
            if isinstance(row, Mapping)
        )
        or any(not isinstance(row, Mapping) for row in releases if isinstance(releases, list))
    ):
        _add_issue(
            issues,
            "B60_OPERATION_RELEASE_ROWS_INVALID",
            "Snapshot release rows are invalid",
            f"{location}.releases",
        )
        valid = False
    elif len({str(row["release_id"]) for row in releases}) != len(releases):
        _add_issue(
            issues,
            "B60_OPERATION_RELEASE_ROWS_INVALID",
            "Snapshot release IDs must be unique",
            f"{location}.releases",
        )
        valid = False

    sources = event.get("sources")
    if not isinstance(sources, list) or any(
        not isinstance(row, Mapping)
        or not _exact_keys(
            row,
            {
                "source_ref",
                "lifecycle_state",
                "stored_value_count",
                "visible_value_count",
            },
        )
        or not all(
            isinstance(row.get(key), int) and not isinstance(row.get(key), bool) and row[key] >= 0
            for key in ("stored_value_count", "visible_value_count")
        )
        for row in sources
        if isinstance(sources, list)
    ):
        _add_issue(
            issues,
            "B60_OPERATION_SOURCE_ROWS_INVALID",
            "Snapshot source rows are invalid",
            f"{location}.sources",
        )
        valid = False

    versions = event.get("version_rows")
    if (
        not isinstance(versions, list)
        or any(
            not _exact_keys(row, {"release_id", "record_state", "rows"})
            or not isinstance(row.get("rows"), int)
            or isinstance(row.get("rows"), bool)
            or row["rows"] < 0
            for row in versions
            if isinstance(row, Mapping)
        )
        or any(not isinstance(row, Mapping) for row in versions if isinstance(versions, list))
    ):
        _add_issue(
            issues,
            "B60_OPERATION_VERSION_ROWS_INVALID",
            "Snapshot version rows are invalid",
            f"{location}.version_rows",
        )
        valid = False
    return valid


def _validate_event_schema(
    event: Any, expected_seq: int, issues: list[EvidenceIssue], location: str
) -> bool:
    if not isinstance(event, Mapping):
        _add_issue(issues, "B60_OPERATION_EVENT_INVALID", "Event must be an object", location)
        return False
    if event.get("seq") != expected_seq or not _aware_timestamp(event.get("occurred_at")):
        _add_issue(
            issues,
            "B60_OPERATION_EVENT_ORDER_INVALID",
            "Event sequence must be contiguous and timestamp-aware",
            location,
        )
    event_type = event.get("event_type")
    expected_keys = {
        "snapshot": _SNAPSHOT_KEYS,
        "seed_import": _IMPORT_KEYS,
        "release_activation": _ACTIVATION_KEYS,
        "source_revocation": _REVOCATION_KEYS,
        "visibility_probe": _VISIBILITY_KEYS,
    }.get(str(event_type))
    if expected_keys is None or set(event) != expected_keys:
        _add_issue(
            issues,
            "B60_OPERATION_EVENT_SCHEMA_INVALID",
            f"Unknown event type or non-exact fields: {event_type}",
            location,
        )
        return False
    if event_type == "snapshot":
        return _validate_snapshot(event, issues, location)
    if event_type == "seed_import":
        if SHA256_RE.fullmatch(
            str(event.get("seed_sha256") or "")
        ) is None or not _nonnegative_int_map(event.get("returned_counts")):
            _add_issue(
                issues,
                "B60_OPERATION_IMPORT_EVENT_INVALID",
                "Import event requires a seed hash and raw returned counts",
                location,
            )
            return False
    elif event_type == "visibility_probe" and (
        event.get("method") not in {"GET", "POST"}
        or not isinstance(event.get("http_status"), int)
        or isinstance(event.get("http_status"), bool)
        or not isinstance(event.get("source_ref_occurrences"), int)
        or isinstance(event.get("source_ref_occurrences"), bool)
        or event["source_ref_occurrences"] < 0
    ):
        _add_issue(
            issues,
            "B60_OPERATION_VISIBILITY_PROBE_INVALID",
            "Visibility probe contains invalid raw observations",
            location,
        )
        return False
    return True


def _release_index(snapshot: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    rows = snapshot.get("releases")
    if not isinstance(rows, list):
        return {}
    return {str(row.get("release_id")): row for row in rows if isinstance(row, Mapping)}


def _source_index(snapshot: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    rows = snapshot.get("sources")
    if not isinstance(rows, list):
        return {}
    return {str(row.get("source_ref")): row for row in rows if isinstance(row, Mapping)}


def _snapshot_same_immutable(first: Mapping[str, Any], second: Mapping[str, Any]) -> bool:
    return all(
        first.get(key) == second.get(key)
        for key in (
            "table_counts",
            "metric_value_states",
            "sources",
            "version_rows",
            "immutable_data_sha256",
        )
    )


def _validate_operation_common(
    name: str,
    log: Any,
    issues: list[EvidenceIssue],
) -> list[Mapping[str, Any]] | None:
    location = f"operations.{name}"
    expected_keys = {
        "operation",
        "run_id",
        "started_at",
        "completed_at",
        "inputs",
        "events",
        "events_sha256",
    }
    if not _exact_keys(log, expected_keys):
        _add_issue(
            issues,
            "B60_OPERATION_LOG_SCHEMA_INVALID",
            "Operation log fields are not exact",
            location,
        )
        return None
    assert isinstance(log, Mapping)
    if (
        log.get("operation") != name
        or not isinstance(log.get("run_id"), str)
        or not str(log.get("run_id")).strip()
        or not _aware_timestamp(log.get("started_at"))
        or not _aware_timestamp(log.get("completed_at"))
        or _timestamp(str(log["started_at"])) > _timestamp(str(log["completed_at"]))
    ):
        _add_issue(
            issues,
            "B60_OPERATION_LOG_HEADER_INVALID",
            "Operation name, run ID, or time bounds are invalid",
            location,
        )
    events = log.get("events")
    if not isinstance(events, list) or not events:
        _add_issue(
            issues,
            "B60_OPERATION_EVENTS_MISSING",
            "Operation requires raw event rows",
            f"{location}.events",
        )
        return None
    valid_events = True
    for index, event in enumerate(events, start=1):
        valid_events = (
            _validate_event_schema(event, index, issues, f"{location}.events.{index - 1}")
            and valid_events
        )
    if log.get("events_sha256") != canonical_sha256(events):
        _add_issue(
            issues,
            "B60_OPERATION_EVENTS_HASH_MISMATCH",
            "Operation event hash does not match the raw events",
            f"{location}.events_sha256",
        )
    if valid_events:
        event_times = [_timestamp(str(event["occurred_at"])) for event in events]
        if event_times != sorted(event_times):
            _add_issue(
                issues,
                "B60_OPERATION_EVENT_ORDER_INVALID",
                "Operation event timestamps must be nondecreasing",
                f"{location}.events",
            )
        if (
            _timestamp(str(log["started_at"])) > event_times[0]
            or _timestamp(str(log["completed_at"])) < event_times[-1]
        ):
            _add_issue(
                issues,
                "B60_OPERATION_TIME_BOUNDS_INVALID",
                "Operation bounds must contain every event timestamp",
                location,
            )
    return events if valid_events else None


def _validate_import_or_rebuild(
    name: str,
    log: Mapping[str, Any],
    events: Sequence[Mapping[str, Any]],
    seed_reference: Mapping[str, Any],
    expected_counts: Mapping[str, int],
    issues: list[EvidenceIssue],
) -> None:
    expected_phases = {
        "empty_database_import": ("before_import", "after_import"),
        "release_rebuild": ("before_rebuild", "after_rebuild"),
    }[name]
    if len(events) != 3 or [event.get("event_type") for event in events] != [
        "snapshot",
        "seed_import",
        "snapshot",
    ]:
        _add_issue(
            issues,
            "B60_OPERATION_EVENT_SEQUENCE_INVALID",
            f"{name} must be snapshot, seed_import, snapshot",
            f"operations.{name}.events",
        )
        return
    before, action, after = events
    if before.get("phase") != expected_phases[0] or after.get("phase") != expected_phases[1]:
        _add_issue(
            issues,
            "B60_OPERATION_PHASE_INVALID",
            "Import/rebuild snapshot phases are invalid",
            f"operations.{name}.events",
        )
    database_ids = {str(event.get("database_id")) for event in events}
    if len(database_ids) != 1 or "" in database_ids:
        _add_issue(
            issues,
            "B60_OPERATION_DATABASE_BINDING_INVALID",
            "All import/rebuild events must bind one non-empty database ID",
            f"operations.{name}.events",
        )
    if (
        any(value != 0 for value in before.get("table_counts", {}).values())
        or any(value != 0 for value in before.get("metric_value_states", {}).values())
        or before.get("releases") != []
        or before.get("sources") != []
        or before.get("version_rows") != []
    ):
        _add_issue(
            issues,
            "B60_OPERATION_DATABASE_NOT_EMPTY",
            "The pre-import database snapshot is not empty",
            f"operations.{name}.events.0",
        )
    seed_hash = seed_reference.get("sha256")
    if (
        action.get("release_id") != RELEASE_ID
        or action.get("seed_sha256") != seed_hash
        or action.get("returned_counts")
        != {
            "countries": expected_counts["countries"],
            "available_metric_values": expected_counts["available_metric_values"],
            "pending_metric_values": expected_counts["pending_metric_values"],
            "unavailable_metric_values": expected_counts["unavailable_metric_values"],
        }
    ):
        _add_issue(
            issues,
            "B60_OPERATION_IMPORT_RESULT_INVALID",
            "Import result does not match the seed and recalculated counts",
            f"operations.{name}.events.1",
        )
    releases = _release_index(after)
    release = releases.get(RELEASE_ID)
    if (
        set(releases) != {RELEASE_ID}
        or release is None
        or release.get("lifecycle_state") != "private_trial_ready"
        or release.get("is_active") is not True
        or release.get("artifact_sha256") != seed_hash
    ):
        _add_issue(
            issues,
            "B60_OPERATION_ACTIVE_RELEASE_INVALID",
            "Post-import snapshot does not expose exactly the bound ready release",
            f"operations.{name}.events.2.releases",
        )
    table_counts = after.get("table_counts", {})
    metric_states = after.get("metric_value_states", {})
    if (
        table_counts.get("basic60_countries") != expected_counts["countries"]
        or table_counts.get("basic60_metric_values") != expected_counts["metric_values"]
        or metric_states
        != {
            "available": expected_counts["available_metric_values"],
            "pending": expected_counts["pending_metric_values"],
            "unavailable": expected_counts["unavailable_metric_values"],
        }
        or set(before.get("table_counts", {})) != set(table_counts)
    ):
        _add_issue(
            issues,
            "B60_OPERATION_POST_IMPORT_COUNTS_INVALID",
            "Post-import raw database counts do not match the seed",
            f"operations.{name}.events.2",
        )


def _validate_rollback(
    log: Mapping[str, Any],
    events: Sequence[Mapping[str, Any]],
    repository_root: Path,
    seed_reference: Mapping[str, Any],
    issues: list[EvidenceIssue],
) -> None:
    location = "operations.previous_release_rollback"
    inputs = log.get("inputs")
    expected_input_keys = {
        "seed_sha256",
        "previous_release_id",
        "previous_seed_artifact",
        "previous_authorization_artifact",
    }
    if not _exact_keys(inputs, expected_input_keys):
        _add_issue(
            issues,
            "B60_ROLLBACK_INPUT_INVALID",
            "Rollback requires current and previous immutable release inputs",
            f"{location}.inputs",
        )
        return
    assert isinstance(inputs, Mapping)
    previous_id = str(inputs.get("previous_release_id") or "")
    previous_seed = _validated_reference(
        repository_root,
        inputs.get("previous_seed_artifact"),
        issues,
        f"{location}.inputs.previous_seed_artifact",
    )
    previous_authorization = _validated_reference(
        repository_root,
        inputs.get("previous_authorization_artifact"),
        issues,
        f"{location}.inputs.previous_authorization_artifact",
    )
    if (
        inputs.get("seed_sha256") != seed_reference.get("sha256")
        or not previous_id
        or previous_id == RELEASE_ID
        or previous_seed is None
        or previous_authorization is None
    ):
        _add_issue(
            issues,
            "B60_ROLLBACK_INPUT_INVALID",
            "Rollback inputs are not independently hash-bound",
            f"{location}.inputs",
        )
    if len(events) != 5 or [event.get("event_type") for event in events] != [
        "snapshot",
        "release_activation",
        "snapshot",
        "release_activation",
        "snapshot",
    ]:
        _add_issue(
            issues,
            "B60_OPERATION_EVENT_SEQUENCE_INVALID",
            "Rollback must capture before, rollback, and restored snapshots",
            f"{location}.events",
        )
        return
    before, rollback_action, rolled_back, restore_action, restored = events
    if [before.get("phase"), rolled_back.get("phase"), restored.get("phase")] != [
        "before_rollback",
        "after_rollback",
        "after_restore",
    ]:
        _add_issue(
            issues,
            "B60_OPERATION_PHASE_INVALID",
            "Rollback snapshot phases are invalid",
            f"{location}.events",
        )
    database_ids = {
        str(event.get("database_id"))
        for event in (before, rollback_action, rolled_back, restore_action, restored)
    }
    if len(database_ids) != 1 or "" in database_ids:
        _add_issue(
            issues,
            "B60_OPERATION_DATABASE_BINDING_INVALID",
            "Rollback events must bind one database ID",
            f"{location}.events",
        )
    before_releases = _release_index(before)
    rollback_releases = _release_index(rolled_back)
    restored_releases = _release_index(restored)
    expected_ids = {RELEASE_ID, previous_id}
    states_valid = (
        set(before_releases) == expected_ids
        and set(rollback_releases) == expected_ids
        and set(restored_releases) == expected_ids
        and before_releases.get(RELEASE_ID, {}).get("is_active") is True
        and before_releases.get(previous_id, {}).get("is_active") is False
        and rollback_releases.get(RELEASE_ID, {}).get("is_active") is False
        and rollback_releases.get(previous_id, {}).get("is_active") is True
        and restored_releases == before_releases
        and rollback_action.get("target_release_id") == previous_id
        and restore_action.get("target_release_id") == RELEASE_ID
    )
    if not states_valid:
        _add_issue(
            issues,
            "B60_ROLLBACK_TRANSITION_INVALID",
            "Rollback and restore active-release transitions are invalid",
            f"{location}.events",
        )
    if not _snapshot_same_immutable(before, rolled_back) or not _snapshot_same_immutable(
        before, restored
    ):
        _add_issue(
            issues,
            "B60_ROLLBACK_HISTORY_CHANGED",
            "Rollback changed immutable rows, counts, sources, or version history",
            f"{location}.events",
        )


def _validate_source_revocation(
    log: Mapping[str, Any],
    events: Sequence[Mapping[str, Any]],
    seed_reference: Mapping[str, Any],
    issues: list[EvidenceIssue],
) -> None:
    location = "operations.source_revocation"
    inputs = log.get("inputs")
    if not _exact_keys(inputs, {"seed_sha256", "source_ref"}):
        _add_issue(
            issues,
            "B60_SOURCE_REVOCATION_INPUT_INVALID",
            "Source revocation requires the bound seed and exact source reference",
            f"{location}.inputs",
        )
        return
    assert isinstance(inputs, Mapping)
    source_ref = str(inputs.get("source_ref") or "")
    if inputs.get("seed_sha256") != seed_reference.get("sha256") or not source_ref:
        _add_issue(
            issues,
            "B60_SOURCE_REVOCATION_INPUT_INVALID",
            "Source revocation inputs are invalid",
            f"{location}.inputs",
        )
    if len(events) != 4 or [event.get("event_type") for event in events] != [
        "snapshot",
        "source_revocation",
        "snapshot",
        "visibility_probe",
    ]:
        _add_issue(
            issues,
            "B60_OPERATION_EVENT_SEQUENCE_INVALID",
            "Source revocation requires before/action/after/visibility raw events",
            f"{location}.events",
        )
        return
    before, action, after, probe = events
    if before.get("phase") != "before_revocation" or after.get("phase") != "after_revocation":
        _add_issue(
            issues,
            "B60_OPERATION_PHASE_INVALID",
            "Source revocation phases are invalid",
            f"{location}.events",
        )
    before_sources = _source_index(before)
    after_sources = _source_index(after)
    prior = before_sources.get(source_ref)
    current = after_sources.get(source_ref)
    other_before = {key: value for key, value in before_sources.items() if key != source_ref}
    other_after = {key: value for key, value in after_sources.items() if key != source_ref}
    transition_valid = (
        prior is not None
        and current is not None
        and prior.get("lifecycle_state") == "active"
        and current.get("lifecycle_state") == "revoked"
        and isinstance(prior.get("stored_value_count"), int)
        and prior.get("stored_value_count", 0) > 0
        and prior.get("visible_value_count", 0) > 0
        and current.get("stored_value_count") == prior.get("stored_value_count")
        and current.get("visible_value_count") == 0
        and other_before == other_after
        and action.get("release_id") == RELEASE_ID
        and action.get("source_ref") == source_ref
        and probe.get("http_status") == 200
        and probe.get("response_release_id") == RELEASE_ID
        and probe.get("source_ref") == source_ref
        and probe.get("source_ref_occurrences") == 0
    )
    if not transition_valid:
        _add_issue(
            issues,
            "B60_SOURCE_REVOCATION_TRANSITION_INVALID",
            "Raw events do not prove hidden values with preserved stored history",
            f"{location}.events",
        )
    storage_unchanged = all(
        before.get(key) == after.get(key)
        for key in (
            "table_counts",
            "metric_value_states",
            "version_rows",
            "immutable_data_sha256",
        )
    )
    if not storage_unchanged:
        _add_issue(
            issues,
            "B60_SOURCE_REVOCATION_HISTORY_CHANGED",
            "Source revocation changed immutable rows or version history",
            f"{location}.events",
        )


def _validate_operations(
    operations: Any,
    repository_root: Path,
    seed_reference: Mapping[str, Any],
    expected_counts: Mapping[str, int],
    issues: list[EvidenceIssue],
) -> None:
    if not isinstance(operations, Mapping) or set(operations) != set(REQUIRED_OPERATIONS):
        _add_issue(
            issues,
            "B60_OPERATION_SET_INCOMPLETE",
            "All four live operation logs are required",
            "operations",
        )
        return
    parsed: dict[str, tuple[Mapping[str, Any], list[Mapping[str, Any]]]] = {}
    for name in REQUIRED_OPERATIONS:
        log = operations[name]
        events = _validate_operation_common(name, log, issues)
        if isinstance(log, Mapping) and events is not None:
            parsed[name] = (log, events)

    for name in ("empty_database_import", "release_rebuild"):
        if name not in parsed:
            continue
        log, events = parsed[name]
        inputs = log.get("inputs")
        expected_input_keys = {"seed_sha256"}
        if name == "release_rebuild":
            expected_input_keys.add("reference_import_events_sha256")
        if not _exact_keys(inputs, expected_input_keys):
            _add_issue(
                issues,
                "B60_OPERATION_INPUT_INVALID",
                f"{name} inputs are not exact",
                f"operations.{name}.inputs",
            )
        elif isinstance(inputs, Mapping) and inputs.get("seed_sha256") != seed_reference.get(
            "sha256"
        ):
            _add_issue(
                issues,
                "B60_OPERATION_INPUT_INVALID",
                f"{name} seed binding is invalid",
                f"operations.{name}.inputs.seed_sha256",
            )
        _validate_import_or_rebuild(name, log, events, seed_reference, expected_counts, issues)

    if "empty_database_import" in parsed and "release_rebuild" in parsed:
        import_log, import_events = parsed["empty_database_import"]
        rebuild_log, rebuild_events = parsed["release_rebuild"]
        rebuild_inputs = rebuild_log.get("inputs")
        if (
            not isinstance(rebuild_inputs, Mapping)
            or rebuild_inputs.get("reference_import_events_sha256")
            != import_log.get("events_sha256")
            or import_events[2].get("database_id") == rebuild_events[2].get("database_id")
            or any(
                import_events[2].get(key) != rebuild_events[2].get(key)
                for key in (
                    "table_counts",
                    "metric_value_states",
                    "releases",
                    "sources",
                    "version_rows",
                    "immutable_data_sha256",
                )
            )
        ):
            _add_issue(
                issues,
                "B60_REBUILD_REPLAY_MISMATCH",
                "Rebuild must use a distinct empty database and reproduce the import snapshot",
                "operations.release_rebuild",
            )

    if "previous_release_rollback" in parsed:
        log, events = parsed["previous_release_rollback"]
        _validate_rollback(log, events, repository_root, seed_reference, issues)
    if "source_revocation" in parsed:
        log, events = parsed["source_revocation"]
        _validate_source_revocation(log, events, seed_reference, issues)


def _validate_api_observations(api: Any, issues: list[EvidenceIssue]) -> None:
    location = "api"
    expected_keys = {
        "run_id",
        "started_at",
        "completed_at",
        "warmup_count",
        "requests",
        "samples",
        "samples_sha256",
    }
    if not _exact_keys(api, expected_keys):
        _add_issue(
            issues,
            "B60_API_OBSERVATIONS_SCHEMA_INVALID",
            "API observations must contain only raw requests and samples",
            location,
        )
        return
    assert isinstance(api, Mapping)
    if (
        not isinstance(api.get("run_id"), str)
        or not str(api.get("run_id")).strip()
        or not _aware_timestamp(api.get("started_at"))
        or not _aware_timestamp(api.get("completed_at"))
        or not isinstance(api.get("warmup_count"), int)
        or isinstance(api.get("warmup_count"), bool)
        or api["warmup_count"] < 0
    ):
        _add_issue(
            issues,
            "B60_API_OBSERVATIONS_HEADER_INVALID",
            "API run ID, timestamps, or warmup observation is invalid",
            location,
        )

    requests = api.get("requests")
    request_index: dict[str, Mapping[str, Any]] = {}
    request_schema_valid = isinstance(requests, list) and len(requests) == len(EXPECTED_API_ROUTES)
    if isinstance(requests, list):
        for index, request in enumerate(requests):
            if not _exact_keys(request, {"route_id", "method", "path", "body"}):
                request_schema_valid = False
                continue
            assert isinstance(request, Mapping)
            route_id = str(request.get("route_id") or "")
            if route_id in request_index:
                request_schema_valid = False
            request_index[route_id] = request
            expected = EXPECTED_API_ROUTES.get(route_id)
            if (
                expected is None
                or request.get("method") != expected[0]
                or expected[1].fullmatch(str(request.get("path") or "")) is None
                or request.get("body") is not None
            ):
                request_schema_valid = False
            if not request_schema_valid:
                _add_issue(
                    issues,
                    "B60_API_REQUEST_INVALID",
                    "API request definition is invalid",
                    f"{location}.requests.{index}",
                )
    if set(request_index) != set(EXPECTED_API_ROUTES):
        request_schema_valid = False
    if not request_schema_valid:
        _add_issue(
            issues,
            "B60_API_ROUTE_SET_INCOMPLETE",
            "Exactly the current country list and detail routes are required",
            f"{location}.requests",
        )

    samples = api.get("samples")
    if not isinstance(samples, list) or not samples:
        _add_issue(
            issues,
            "B60_API_SAMPLES_MISSING",
            "Raw API latency samples are required",
            f"{location}.samples",
        )
        return
    if api.get("samples_sha256") != canonical_sha256(samples):
        _add_issue(
            issues,
            "B60_API_SAMPLES_HASH_MISMATCH",
            "API sample hash does not match the raw rows",
            f"{location}.samples_sha256",
        )

    elapsed_by_route: dict[str, list[int]] = defaultdict(list)
    sample_schema = {
        "seq",
        "route_id",
        "started_at",
        "elapsed_ns",
        "http_status",
        "response_sha256",
        "response_release_id",
        "response_profile",
        "response_gate_state",
    }
    for index, sample in enumerate(samples, start=1):
        sample_location = f"{location}.samples.{index - 1}"
        valid = _exact_keys(sample, sample_schema)
        if valid:
            assert isinstance(sample, Mapping)
            elapsed = sample.get("elapsed_ns")
            valid = (
                sample.get("seq") == index
                and sample.get("route_id") in EXPECTED_API_ROUTES
                and _aware_timestamp(sample.get("started_at"))
                and isinstance(elapsed, int)
                and not isinstance(elapsed, bool)
                and elapsed > 0
                and sample.get("http_status") == 200
                and SHA256_RE.fullmatch(str(sample.get("response_sha256") or "")) is not None
                and sample.get("response_release_id") == RELEASE_ID
                and sample.get("response_profile") == PROFILE_ID
                and sample.get("response_gate_state") == "pending"
            )
        if not valid:
            _add_issue(
                issues,
                "B60_API_SAMPLE_INVALID",
                "API sample contains invalid raw latency or response metadata",
                sample_location,
            )
            continue
        assert isinstance(sample, Mapping)
        elapsed_by_route[str(sample["route_id"])].append(int(sample["elapsed_ns"]))

    for route_id in EXPECTED_API_ROUTES:
        values = elapsed_by_route.get(route_id, [])
        if len(values) < 20:
            _add_issue(
                issues,
                "B60_API_SAMPLE_SET_INCOMPLETE",
                f"{route_id} requires at least 20 valid raw samples",
                f"{location}.samples",
            )
            continue
        sorted_values = sorted(values)
        p95 = sorted_values[math.ceil(0.95 * len(sorted_values)) - 1]
        if p95 > 800_000_000:
            _add_issue(
                issues,
                "B60_API_P95_EXCEEDED",
                f"{route_id} recalculated nearest-rank P95 is {p95}ns",
                f"{location}.samples",
            )


def _manifest_index(rows: Any) -> dict[str, Mapping[str, Any]] | None:
    if not isinstance(rows, list):
        return None
    result: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        if not _exact_keys(row, {"path", "sha256", "byte_size"}):
            return None
        assert isinstance(row, Mapping)
        path = str(row.get("path") or "")
        if not path or path in result:
            return None
        result[path] = row
    return result


def _compose_service_blocks(text: str) -> dict[str, str]:
    lines = text.splitlines()
    service_start = next(
        (index for index, line in enumerate(lines) if line.strip() == "services:"), None
    )
    if service_start is None:
        return {}
    blocks: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines[service_start + 1 :]:
        if line and not line.startswith(" "):
            break
        match = re.fullmatch(r"  ([A-Za-z0-9_-]+):\s*", line)
        if match:
            current = match.group(1)
            blocks[current] = []
        elif current is not None:
            blocks[current].append(line)
    return {key: "\n".join(value) for key, value in blocks.items()}


def _api_routes_from_source(repository_root: Path) -> set[tuple[str, str]]:
    root = repository_root
    country_path = root / "services/api/src/navigator_api/routers/basic60_countries.py"
    main_path = root / "services/api/src/navigator_api/basic60_main.py"
    routes: set[tuple[str, str]] = set()
    for path, prefix in ((country_path, "/api/v1"), (main_path, "")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call) or not isinstance(
                    decorator.func, ast.Attribute
                ):
                    continue
                method = decorator.func.attr.upper()
                if method not in {"GET", "POST"} or not decorator.args:
                    continue
                first = decorator.args[0]
                if isinstance(first, ast.Constant) and isinstance(first.value, str):
                    routes.add((method, f"{prefix}{first.value}"))
    return routes


def _validate_isolation_semantics(repository_root: Path, issues: list[EvidenceIssue]) -> None:
    compose_path = repository_root / "deploy/basic60/compose.private-trial.yaml"
    try:
        compose = compose_path.read_text(encoding="utf-8")
    except OSError as error:
        _add_issue(
            issues,
            "B60_ISOLATION_COMPOSE_INVALID",
            str(error),
            "isolation.source_files",
        )
        return
    blocks = _compose_service_blocks(compose)
    compose_valid = (
        set(blocks) == {"db", "api", "web"}
        and "ports:" not in blocks.get("db", "")
        and "ports:" not in blocks.get("api", "")
        and re.search(r"127\.0\.0\.1:\$\{[^}]+\}:3000", blocks.get("web", "")) is not None
        and re.search(r"^name:\s*navigator-basic60-private\s*$", compose, re.MULTILINE) is not None
        and compose.count("internal: true") >= 2
        and "NAVIGATOR_RUNTIME_PROFILE: basic60_private" in compose
        and 'BASIC60_AUTO_CREATE_SCHEMA: "false"' in compose
        and 'BASIC60_AUTO_IMPORT_SEED: "false"' in compose
        and "BASIC60_RUNTIME_ATTESTATION_PATH:" in compose
        and "BASIC60_RUNTIME_ATTESTATION_SHA256:" in compose
        and "BASIC60_RUNTIME_ATTESTATION_KEY:" in compose
        and "network_mode: host" not in compose
        and "extra_hosts:" not in compose
    )
    if not compose_valid:
        _add_issue(
            issues,
            "B60_ISOLATION_COMPOSE_INVALID",
            "Compose does not independently prove the isolated three-service topology",
            "isolation.source_files",
        )

    expected_routes = {
        ("GET", "/health"),
        ("GET", "/api/v1/countries"),
        ("GET", "/api/v1/countries/{country_code}"),
    }
    try:
        routes = _api_routes_from_source(repository_root)
    except (OSError, SyntaxError) as error:
        _add_issue(
            issues,
            "B60_ISOLATION_API_ROUTE_INVALID",
            str(error),
            "isolation.source_files",
        )
    else:
        if routes != expected_routes:
            _add_issue(
                issues,
                "B60_ISOLATION_API_ROUTE_INVALID",
                f"API source route inventory is not exact: {sorted(routes)}",
                "isolation.source_files",
            )

    basic60_app = repository_root / "apps/web/app/(basic60)"
    prohibited = re.compile(r"(?:^|[-_/])(polic|search|ai|assistant|demo)(?:[-_/]|$)", re.I)
    discovered = [
        path.relative_to(basic60_app).as_posix()
        for path in basic60_app.rglob("*")
        if path.is_file() and path.name in {"page.tsx", "route.ts"}
    ]
    if any(prohibited.search(path) for path in discovered):
        _add_issue(
            issues,
            "B60_ISOLATION_WEB_ROUTE_INVALID",
            "A prohibited policy, search, AI, assistant, or demo route exists in BASIC60",
            "isolation.source_files",
        )


def _validate_isolation(
    isolation: Any,
    repository_root: Path,
    protected_hashes: set[str],
    issues: list[EvidenceIssue],
) -> None:
    expected_keys = {
        "source_files",
        "source_files_sha256",
        "route_probes",
        "route_probes_sha256",
        "public_tree",
    }
    if not _exact_keys(isolation, expected_keys):
        _add_issue(
            issues,
            "B60_ISOLATION_SCHEMA_INVALID",
            "Isolation evidence fields are not exact",
            "isolation",
        )
        return
    assert isinstance(isolation, Mapping)
    source_rows = isolation.get("source_files")
    source_index = _manifest_index(source_rows)
    if source_index is None or isolation.get("source_files_sha256") != canonical_sha256(
        source_rows
    ):
        _add_issue(
            issues,
            "B60_ISOLATION_SOURCE_MANIFEST_INVALID",
            "Isolation source manifest is malformed or hash-mismatched",
            "isolation.source_files",
        )
    else:
        try:
            current_rows = _file_manifest(
                repository_root, _discover_isolation_source_files(repository_root)
            )
        except (EvidenceCollectionError, OSError) as error:
            _add_issue(
                issues,
                "B60_ISOLATION_SOURCE_DRIFT",
                str(error),
                "isolation.source_files",
            )
        else:
            if source_rows != current_rows:
                _add_issue(
                    issues,
                    "B60_ISOLATION_SOURCE_DRIFT",
                    "Current complete source discovery does not equal the recorded manifest",
                    "isolation.source_files",
                )

    probes = isolation.get("route_probes")
    if not isinstance(probes, list) or isolation.get("route_probes_sha256") != canonical_sha256(
        probes
    ):
        _add_issue(
            issues,
            "B60_ISOLATION_ROUTE_PROBES_INVALID",
            "Route probes are missing or hash-mismatched",
            "isolation.route_probes",
        )
    else:
        probe_index: dict[tuple[str, str, str], Mapping[str, Any]] = {}
        for index, probe in enumerate(probes):
            valid = _exact_keys(
                probe,
                {
                    "surface",
                    "method",
                    "path",
                    "observed_at",
                    "http_status",
                    "response_release_id",
                },
            )
            if valid:
                assert isinstance(probe, Mapping)
                key = (
                    str(probe.get("surface")),
                    str(probe.get("method")),
                    str(probe.get("path")),
                )
                valid = (
                    key not in probe_index
                    and key in REQUIRED_ROUTE_PROBES
                    and _aware_timestamp(probe.get("observed_at"))
                    and probe.get("http_status") == REQUIRED_ROUTE_PROBES[key]
                )
                if valid:
                    probe_index[key] = probe
                    if (
                        key[0] == "api"
                        and key[2]
                        in {
                            "/health",
                            "/api/v1/countries",
                            "/api/v1/countries/IDN",
                        }
                        and probe.get("response_release_id") != RELEASE_ID
                    ):
                        valid = False
            if not valid:
                _add_issue(
                    issues,
                    "B60_ISOLATION_ROUTE_PROBE_INVALID",
                    "Route probe is not an exact expected raw observation",
                    f"isolation.route_probes.{index}",
                )
        if set(probe_index) != set(REQUIRED_ROUTE_PROBES):
            _add_issue(
                issues,
                "B60_ISOLATION_ROUTE_SET_INCOMPLETE",
                "The complete allowed and denied route probe set is required",
                "isolation.route_probes",
            )

    public_tree = isolation.get("public_tree")
    if not _exact_keys(public_tree, {"root", "files", "tree_sha256"}):
        _add_issue(
            issues,
            "B60_ISOLATION_PUBLIC_TREE_INVALID",
            "Public tree fields are not exact",
            "isolation.public_tree",
        )
    else:
        assert isinstance(public_tree, Mapping)
        try:
            current_tree = _public_tree(repository_root)
        except (EvidenceCollectionError, OSError) as error:
            _add_issue(
                issues,
                "B60_ISOLATION_PUBLIC_TREE_DRIFT",
                str(error),
                "isolation.public_tree",
            )
        else:
            if public_tree != current_tree:
                _add_issue(
                    issues,
                    "B60_ISOLATION_PUBLIC_TREE_DRIFT",
                    "Current public tree does not equal the independently rediscovered manifest",
                    "isolation.public_tree",
                )
            files = public_tree.get("files")
            if isinstance(files, list) and any(
                isinstance(row, Mapping) and row.get("sha256") in protected_hashes for row in files
            ):
                _add_issue(
                    issues,
                    "B60_ISOLATION_PUBLIC_DATA_EXPOSED",
                    "A public asset exactly matches a protected release artifact",
                    "isolation.public_tree.files",
                )
    _validate_isolation_semantics(repository_root, issues)


def validate_machine_evidence(
    evidence: Mapping[str, Any], *, repository_root: Path
) -> list[EvidenceIssue]:
    """Independently validate a complete BASIC60 machine-evidence aggregate."""

    issues: list[EvidenceIssue] = []
    try:
        root = _safe_repository_root(repository_root)
    except (EvidenceCollectionError, OSError) as error:
        return [
            EvidenceIssue(
                code="B60_EVIDENCE_REPOSITORY_INVALID",
                message=str(error),
                location="repository_root",
            )
        ]
    if not isinstance(evidence, Mapping):
        return [
            EvidenceIssue(
                code="B60_MACHINE_EVIDENCE_SCHEMA_INVALID",
                message="Machine evidence must be an object",
                location="evidence",
            )
        ]

    _forbidden_self_attestations(evidence, issues)
    expected_keys = {
        "schema_version",
        "profile_id",
        "release_id",
        "implementation_sha256",
        "seed_artifact",
        "raw_manifest",
        "bundle_artifact",
        "d3",
        "operations",
        "api",
        "isolation",
    }
    if set(evidence) != expected_keys:
        _add_issue(
            issues,
            "B60_MACHINE_EVIDENCE_SCHEMA_INVALID",
            "Machine-evidence aggregate fields are not exact",
            "evidence",
        )
    if evidence.get("schema_version") != MACHINE_EVIDENCE_SCHEMA:
        _add_issue(
            issues,
            "B60_MACHINE_EVIDENCE_VERSION_INVALID",
            "Only basic60.machine-evidence.v2 is accepted",
            "schema_version",
        )
    if evidence.get("profile_id") != PROFILE_ID or evidence.get("release_id") != RELEASE_ID:
        _add_issue(
            issues,
            "B60_MACHINE_EVIDENCE_HEADER_INVALID",
            "Machine evidence must target BASIC60-PRIVATE-R1/basic60_private",
            "evidence",
        )
    current_implementation_hash = implementation_sha256()
    if evidence.get("implementation_sha256") != current_implementation_hash:
        _add_issue(
            issues,
            "B60_IMPLEMENTATION_HASH_MISMATCH",
            "implementation_sha256 must equal the current module bytes",
            "implementation_sha256",
        )

    seed = _load_json_reference(root, evidence.get("seed_artifact"), issues, "seed_artifact")
    raw_manifest = _load_json_reference(root, evidence.get("raw_manifest"), issues, "raw_manifest")
    _validated_reference(root, evidence.get("bundle_artifact"), issues, "bundle_artifact")
    if seed is not None and (_release_id(seed) != RELEASE_ID or _profile_id(seed) != PROFILE_ID):
        _add_issue(
            issues,
            "B60_SEED_HEADER_INVALID",
            "Referenced seed has the wrong release or profile",
            "seed_artifact",
        )
    if raw_manifest is not None:
        root_hash = raw_manifest.get("root_sha256")
        if not isinstance(root_hash, str) or SHA256_RE.fullmatch(root_hash) is None:
            _add_issue(
                issues,
                "B60_RAW_MANIFEST_ROOT_INVALID",
                "Raw manifest root_sha256 is invalid",
                "raw_manifest",
            )
        if seed is not None and seed.get("source_root_sha256") not in {None, root_hash}:
            _add_issue(
                issues,
                "B60_SEED_RAW_BINDING_MISMATCH",
                "Seed source root does not match the raw manifest",
                "seed_artifact",
            )

    _validate_d3(evidence.get("d3"), root, seed, raw_manifest, issues)
    seed_reference = evidence.get("seed_artifact")
    if isinstance(seed_reference, Mapping) and seed is not None:
        _validate_operations(
            evidence.get("operations"),
            root,
            seed_reference,
            _seed_counts(seed),
            issues,
        )
    else:
        _add_issue(
            issues,
            "B60_OPERATION_SEED_BINDING_UNAVAILABLE",
            "Operation validation requires a valid seed reference",
            "operations",
        )
    _validate_api_observations(evidence.get("api"), issues)

    protected_hashes = {
        str(reference.get("sha256"))
        for key in ("seed_artifact", "raw_manifest", "bundle_artifact")
        if isinstance((reference := evidence.get(key)), Mapping)
        and SHA256_RE.fullmatch(str(reference.get("sha256") or "")) is not None
    }
    d3 = evidence.get("d3")
    if isinstance(d3, Mapping) and isinstance(d3.get("stages"), Mapping):
        for reference in d3["stages"].values():
            if isinstance(reference, Mapping) and SHA256_RE.fullmatch(
                str(reference.get("sha256") or "")
            ):
                protected_hashes.add(str(reference["sha256"]))
    _validate_isolation(evidence.get("isolation"), root, protected_hashes, issues)
    return issues


__all__ = [
    "D3_STAGES",
    "D3_STAGE_SCHEMA",
    "MACHINE_EVIDENCE_SCHEMA",
    "PROFILE_ID",
    "RELEASE_ID",
    "REQUIRED_OPERATIONS",
    "REQUIRED_ROUTE_PROBES",
    "EvidenceCollectionError",
    "EvidenceIssue",
    "build_d3_stage_payloads",
    "canonical_sha256",
    "collect_machine_evidence",
    "implementation_sha256",
    "validate_machine_evidence",
    "write_d3_stage_payloads",
]
