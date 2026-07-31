from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .paths import RepositoryPaths
from .workbook import load_read_only, table_records

D0_SHEETS: dict[str, str] = {
    "核心实体冻结": "entities",
    "核心字段冻结": "fields",
    "枚举规则冻结": "enums",
    "采集规范冻结": "collection_rules",
    "质量规则冻结": "quality_rules",
    "首批国家范围": "countries",
    "首批数据域目标": "domain_targets",
    "D0任务计划": "d0_tasks",
    "D0责任签署": "responsibilities",
    "D0验收签署": "d0_acceptance",
}

TECH_SHEETS: dict[str, str] = {
    "功能优先级": "feature_requirements",
    "编号纠错映射": "identifier_migrations",
    "角色权限矩阵": "role_permissions",
    "页面路由清单": "page_routes",
    "API清单": "api_catalog",
    "测试用例": "test_cases",
    "工程验收用例": "engineering_acceptance_tests",
    "MVP验收矩阵": "mvp_acceptance",
    "首批来源建档": "source_registry_seed",
    "D0-D4任务计划": "d0_d4_roadmap",
    "采集批次台账": "collection_batch_template",
    "原始资料登记模板": "raw_asset_template",
    "字段映射模板": "field_mapping_template",
    "数据审核清单": "review_checklist",
    "数据问题台账": "data_issue_template",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_contracts(
    paths: RepositoryPaths,
    *,
    data_only: bool = True,
) -> dict[str, Any]:
    contracts: dict[str, Any] = {}
    for workbook_path, sheet_map in (
        (paths.d0_workbook, D0_SHEETS),
        (paths.technical_workbook, TECH_SHEETS),
    ):
        workbook = load_read_only(workbook_path, data_only=data_only)
        try:
            for sheet_name, contract_name in sheet_map.items():
                contracts[contract_name] = table_records(workbook[sheet_name])
        finally:
            workbook.close()
    return contracts


def snapshot_manifest(
    paths: RepositoryPaths,
    generated_at: str | None = None,
    record_counts: dict[str, int] | None = None,
) -> dict[str, Any]:
    timestamp = generated_at or datetime.now(UTC).replace(microsecond=0).isoformat()
    return {
        "schema_version": 1,
        "baseline_version": "V1.0-BASELINE",
        "generated_at": timestamp,
        "record_counts": record_counts or {},
        "sources": {
            "d0_workbook": {
                "path": paths.d0_workbook.relative_to(paths.root).as_posix(),
                "sha256": sha256_file(paths.d0_workbook),
            },
            "technical_workbook": {
                "path": paths.technical_workbook.relative_to(paths.root).as_posix(),
                "sha256": sha256_file(paths.technical_workbook),
            },
        },
    }


def write_snapshot(paths: RepositoryPaths) -> list[Path]:
    contracts = extract_contracts(paths)
    paths.contracts_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name, records in sorted(contracts.items()):
        destination = paths.contracts_dir / f"{name}.json"
        destination.write_text(
            json.dumps(records, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        written.append(destination)
    manifest_path = paths.contracts_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            snapshot_manifest(
                paths,
                record_counts={name: len(records) for name, records in contracts.items()},
            ),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    written.append(manifest_path)
    return written
