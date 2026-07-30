from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from .baseline import D0_SHEETS, TECH_SHEETS, extract_contracts
from .models import CheckResult
from .paths import RepositoryPaths
from .workbook import load_read_only

APPROVED_EVIDENCE_STATES = {"已复核", "已批准", "通过", "已通过"}

IDENTIFIER_COLUMNS: dict[str, tuple[str, ...]] = {
    "entities": ("关系编号",),
    "fields": ("字段编号", "字段代码"),
    "enums": ("枚举编号", "枚举代码"),
    "collection_rules": ("规则编号", "采集规则编号"),
    "quality_rules": ("规则编号", "质量规则编号"),
    "countries": ("ISO3",),
    "domain_targets": ("域编号",),
    "d0_tasks": ("任务编号",),
    "d0_acceptance": ("验收编号",),
    "source_registry_seed": ("来源编号",),
    "d0_d4_roadmap": ("任务编号",),
}


def _identifier_value(record: dict[str, Any], candidates: tuple[str, ...]) -> str | None:
    for candidate in candidates:
        value = record.get(candidate)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def validate_structure(paths: RepositoryPaths) -> list[CheckResult]:
    checks: list[CheckResult] = []
    for workbook_path, expected_sheets in (
        (paths.d0_workbook, D0_SHEETS),
        (paths.technical_workbook, TECH_SHEETS),
    ):
        workbook = load_read_only(workbook_path)
        try:
            missing = sorted(set(expected_sheets) - set(workbook.sheetnames))
            for sheet_name in missing:
                checks.append(
                    CheckResult(
                        code="BASELINE_MISSING_SHEET",
                        message=f"Required sheet {sheet_name!r} is missing",
                        location=str(workbook_path),
                    )
                )
        finally:
            workbook.close()

    if checks:
        return checks

    contracts = extract_contracts(paths)
    for contract_name, candidates in IDENTIFIER_COLUMNS.items():
        records = contracts.get(contract_name, [])
        identifiers = [_identifier_value(record, candidates) for record in records]
        missing_count = sum(identifier is None for identifier in identifiers)
        if missing_count:
            checks.append(
                CheckResult(
                    code="BASELINE_MISSING_IDENTIFIER",
                    message=f"{contract_name} has {missing_count} row(s) without an identifier",
                    location=contract_name,
                )
            )
        duplicates = [
            identifier
            for identifier, count in Counter(item for item in identifiers if item).items()
            if count > 1
        ]
        if duplicates:
            checks.append(
                CheckResult(
                    code="BASELINE_DUPLICATE_IDENTIFIER",
                    message=f"{contract_name} has duplicate identifiers: {', '.join(duplicates)}",
                    location=contract_name,
                )
            )

    task_ids = {
        str(record["任务编号"]).strip()
        for record in contracts["d0_d4_roadmap"]
        if record.get("任务编号")
    }
    for record in contracts["d0_d4_roadmap"]:
        task_id = str(record.get("任务编号", "")).strip()
        dependencies = str(record.get("依赖", "")).replace("；", ";").split(";")
        for dependency in (item.strip() for item in dependencies if item.strip()):
            if dependency not in task_ids:
                checks.append(
                    CheckResult(
                        code="BASELINE_UNKNOWN_TASK_DEPENDENCY",
                        message=f"{task_id} depends on unknown task {dependency}",
                        location="d0_d4_roadmap",
                    )
                )
    return checks


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_evidence(
    paths: RepositoryPaths,
    *,
    required_acceptance_ids: set[str] | None = None,
) -> list[CheckResult]:
    if not paths.evidence_manifest.exists():
        return [
            CheckResult(
                code="EVIDENCE_MANIFEST_MISSING",
                message="D0 evidence manifest is missing",
                location=str(paths.evidence_manifest),
            )
        ]
    try:
        payload = json.loads(paths.evidence_manifest.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        return [
            CheckResult(
                code="EVIDENCE_MANIFEST_INVALID",
                message=f"Cannot read evidence manifest: {error}",
                location=str(paths.evidence_manifest),
            )
        ]

    checks: list[CheckResult] = []
    entries = payload.get("evidence", [])
    if not isinstance(entries, list):
        return [
            CheckResult(
                code="EVIDENCE_ENTRIES_INVALID",
                message="Manifest field 'evidence' must be a list",
                location=str(paths.evidence_manifest),
            )
        ]
    covered_acceptance_ids: set[str] = set()
    seen_evidence_ids: set[str] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            checks.append(
                CheckResult(
                    code="EVIDENCE_ENTRY_INVALID",
                    message=f"Evidence entry {index} must be an object",
                    location=str(paths.evidence_manifest),
                )
            )
            continue
        relative_path = entry.get("path")
        evidence_id = entry.get("evidence_id")
        expected_hash = entry.get("sha256")
        acceptance_id = entry.get("acceptance_id")
        reviewer = entry.get("reviewer")
        status = entry.get("status")
        if (
            not relative_path
            or not evidence_id
            or not expected_hash
            or not acceptance_id
            or not reviewer
            or not status
        ):
            checks.append(
                CheckResult(
                    code="EVIDENCE_METADATA_INCOMPLETE",
                    message=(
                        f"Evidence entry {index} requires evidence_id, acceptance_id, path, "
                        "sha256, reviewer, and status"
                    ),
                    location=str(paths.evidence_manifest),
                )
            )
            continue
        normalized_evidence_id = str(evidence_id).strip()
        if normalized_evidence_id in seen_evidence_ids:
            checks.append(
                CheckResult(
                    code="EVIDENCE_ID_DUPLICATE",
                    message=f"Evidence ID is duplicated: {normalized_evidence_id}",
                    location=str(paths.evidence_manifest),
                )
            )
        seen_evidence_ids.add(normalized_evidence_id)
        normalized_acceptance_id = str(acceptance_id).strip()
        covered_acceptance_ids.add(normalized_acceptance_id)
        if (
            required_acceptance_ids is not None
            and normalized_acceptance_id not in required_acceptance_ids
        ):
            checks.append(
                CheckResult(
                    code="EVIDENCE_ACCEPTANCE_UNKNOWN",
                    message=f"Evidence entry {index} references unknown {normalized_acceptance_id}",
                    location=str(paths.evidence_manifest),
                )
            )
        if str(status).strip() not in APPROVED_EVIDENCE_STATES:
            checks.append(
                CheckResult(
                    code="EVIDENCE_NOT_APPROVED",
                    message=f"Evidence entry {index} is not approved: {status}",
                    location=str(paths.evidence_manifest),
                )
            )
        evidence_path = (paths.root / str(relative_path)).resolve()
        try:
            evidence_path.relative_to(paths.root)
        except ValueError:
            checks.append(
                CheckResult(
                    code="EVIDENCE_PATH_OUTSIDE_REPOSITORY",
                    message=f"Evidence path escapes repository: {relative_path}",
                    location=str(paths.evidence_manifest),
                )
            )
            continue
        if not evidence_path.is_file():
            checks.append(
                CheckResult(
                    code="EVIDENCE_FILE_MISSING",
                    message=f"Evidence file does not exist: {relative_path}",
                    location=str(paths.evidence_manifest),
                )
            )
        elif _sha256(evidence_path) != str(expected_hash).lower():
            checks.append(
                CheckResult(
                    code="EVIDENCE_HASH_MISMATCH",
                    message=f"Evidence hash does not match: {relative_path}",
                    location=str(paths.evidence_manifest),
                )
            )
    for acceptance_id in sorted((required_acceptance_ids or set()) - covered_acceptance_ids):
        checks.append(
            CheckResult(
                code="EVIDENCE_ACCEPTANCE_MISSING",
                message=f"No evidence is registered for {acceptance_id}",
                location=str(paths.evidence_manifest),
            )
        )
    return checks
