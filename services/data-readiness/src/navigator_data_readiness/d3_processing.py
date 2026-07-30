from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from .baseline import extract_contracts, sha256_file
from .models import CheckResult
from .paths import RepositoryPaths

SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
PIPELINE_STATES = {"planned", "enabled", "paused", "retired"}
RUN_STATES = {"succeeded", "partial", "failed"}
RECORD_STATES = {"candidate", "needs_review", "rejected"}
VALUE_STATES = {"available", "pending", "not_public", "unverified", "not_applicable"}
TRANSLATION_STATES = {"source", "machine_translated", "human_reviewed", "stale"}
ENTITY_METHODS = {"deterministic", "fuzzy", "new_entity"}
ENTITY_DECISIONS = {"pending", "confirmed", "rejected"}
CONFLICT_STATES = {"open", "resolved", "dismissed"}
MERGE_STATES = {"approved", "executed", "reversed"}

PIPELINE_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "pipeline_id": "D3-PARSE",
        "task_id": "D3-01",
        "name": "解析、语言识别和字段映射",
        "input_layer": "L0",
        "output_layer": "L0.5",
        "required_config": [
            "parser_version",
            "ocr_version",
            "language_detector_version",
            "locator_strategy_version",
            "mapping_contract_version",
        ],
    },
    {
        "pipeline_id": "D3-STANDARDIZE",
        "task_id": "D3-02",
        "name": "单位币种标准化、翻译和术语复核",
        "input_layer": "L0.5",
        "output_layer": "L1",
        "required_config": [
            "unit_rule_version",
            "currency_rule_version",
            "timezone_rule_version",
            "enum_contract_version",
            "glossary_version",
        ],
    },
    {
        "pipeline_id": "D3-ENTITY",
        "task_id": "D3-03",
        "name": "实体解析、去重、冲突和版本化",
        "input_layer": "L1",
        "output_layer": "L2-candidate",
        "required_config": [
            "deterministic_key_version",
            "fuzzy_model_version",
            "fuzzy_review_threshold",
            "conflict_rule_version",
            "merge_policy_version",
        ],
    },
)


def _payload_sha256(payload: Any) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return hashlib.sha256(serialized).hexdigest()


def _baseline(paths: RepositoryPaths, contracts: dict[str, Any]) -> dict[str, Any]:
    relevant = {
        key: contracts[key]
        for key in (
            "fields",
            "enums",
            "field_mapping_template",
            "quality_rules",
            "review_checklist",
            "d0_d4_roadmap",
        )
    }
    return {
        "version": "V1.0-BASELINE",
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
        "d3_input_sha256": _payload_sha256(relevant),
    }


def _pipeline_template(definition: dict[str, Any]) -> dict[str, Any]:
    return {
        **definition,
        "config": dict.fromkeys(definition["required_config"]),
        "idempotency_key_template": None,
        "input_snapshot_immutable": True,
        "preserve_original_values": True,
        "preserve_source_text": True,
        "unknown_enum_action": "candidate_dictionary_and_review",
        "fuzzy_merge_action": "preview_and_human_review",
        "conflict_action": "preserve_all_evidence_and_review",
        "status": "planned",
    }


def build_d3_bundle_template(paths: RepositoryPaths) -> dict[str, Any]:
    contracts = extract_contracts(paths)
    return {
        "schema_version": 1,
        "stage": "D3",
        "template_only": True,
        "append_only": True,
        "warning": ("D3仅生成候选版本；原值、原文和冲突证据不可覆盖，模糊实体不得自动合并"),
        "baseline": _baseline(paths, contracts),
        "dependencies": {
            "d2_gate_status": "pending",
            "d2_gate_evidence_id": None,
        },
        "pipelines": [_pipeline_template(item) for item in PIPELINE_DEFINITIONS],
        "transformation_runs": [],
        "records": [],
        "field_values": [],
        "translations": [],
        "entity_decisions": [],
        "conflicts": [],
        "merge_actions": [],
    }


def build_d3_rule_catalog() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "stage": "D3",
        "rules": {
            "source_preservation": [
                "原始对象和源文不可覆盖",
                "标准值始终保留原值、原单位和来源定位",
                "派生值记录规则版本和输入版本",
            ],
            "currency": [
                "保存原币种、原值、换算值、汇率、类型、来源和基准日",
                "不同年度金额不得无调整直接比较",
            ],
            "time": [
                "保存来源日期、当地时间、IANA时区和UTC值",
                "政策生效、发布、采集、审核和有效期不得混用",
            ],
            "translation": [
                "原文、机器译文、人工译文和平台解读分层",
                "高风险字段必须人工校对",
                "源哈希变化后译文转stale",
            ],
            "entity_resolution": [
                "确定性重复幂等",
                "模糊匹配必须预览、人工确认、保存历史ID且可撤销",
                "同名不足以证明同一主体",
            ],
            "conflict": [
                "保存双方值、来源、时间和定位",
                "不得用多数票自动覆盖关键冲突",
            ],
            "publication_boundary": [
                "D3记录只能是candidate、needs_review或rejected",
                "D3记录不得标记可发布或可进入AI索引",
            ],
        },
    }


def build_d3_assessment(paths: RepositoryPaths) -> dict[str, Any]:
    bundle = build_d3_bundle_template(paths)
    return {
        "schema_version": 1,
        "stage": "D3",
        "overall_status": "not_ready",
        "automated_assessment_only": True,
        "checks": [
            {
                "check_id": "D3-D2-DEPENDENCY",
                "status": "fail",
                "finding": "D2不可变原始包尚未通过正式门禁",
            },
            {
                "check_id": "D3-PIPELINES",
                "status": "candidate_generated",
                "finding": f"{len(bundle['pipelines'])}条D3流水线已生成配置候选",
            },
            {
                "check_id": "D3-REPLAY",
                "status": "fail",
                "finding": "尚无输入快照、规则版本、参数哈希或成功运行",
            },
            {
                "check_id": "D3-CANDIDATE-DATA",
                "status": "fail",
                "finding": "尚无解析记录、字段值、翻译、实体决策或冲突记录",
            },
            {
                "check_id": "D3-MAPPING-DEPENDENCY",
                "status": "fail",
                "finding": "D0发现的6条未知字段映射仍须正式解决",
            },
        ],
    }


def d3_candidate_payloads(paths: RepositoryPaths) -> dict[str, dict[str, Any]]:
    return {
        "d3_acceptance_assessment.json": build_d3_assessment(paths),
        "d3_processing_bundle.template.json": build_d3_bundle_template(paths),
        "d3_rule_catalog.json": build_d3_rule_catalog(),
    }


def write_d3_candidates(paths: RepositoryPaths) -> list[Path]:
    paths.d3_candidates_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for filename, payload in d3_candidate_payloads(paths).items():
        destination = paths.d3_candidates_dir / filename
        destination.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        written.append(destination)
    return written


def _required_text(
    checks: list[CheckResult],
    item: dict[str, Any],
    fields: tuple[str, ...],
    *,
    code: str,
    location: str,
) -> None:
    missing = [field for field in fields if not str(item.get(field) or "").strip()]
    if missing:
        checks.append(
            CheckResult(
                code=code,
                message=f"Missing required fields: {', '.join(missing)}",
                location=location,
            )
        )


def _index(
    checks: list[CheckResult],
    payload: dict[str, Any],
    section: str,
    identifier: str,
) -> dict[str, dict[str, Any]]:
    items = payload.get(section)
    if not isinstance(items, list):
        checks.append(
            CheckResult(
                code="D3_SECTION_INVALID",
                message=f"{section} must be a list",
                location=section,
            )
        )
        return {}
    indexed: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not str(item.get(identifier) or "").strip():
            checks.append(
                CheckResult(
                    code="D3_ENTRY_INVALID",
                    message=f"{section}[{index}] requires {identifier}",
                    location=section,
                )
            )
            continue
        value = str(item[identifier]).strip()
        if value in indexed:
            checks.append(
                CheckResult(
                    code="D3_ENTRY_DUPLICATE",
                    message=f"Duplicate {identifier}: {value}",
                    location=section,
                )
            )
            continue
        indexed[value] = item
    return indexed


def _validate_pipeline(
    checks: list[CheckResult],
    pipeline_id: str,
    item: dict[str, Any],
    expected: dict[str, Any] | None,
) -> None:
    location = f"pipelines.{pipeline_id}"
    if expected and any(
        item.get(field) != expected.get(field)
        for field in (
            "task_id",
            "name",
            "input_layer",
            "output_layer",
            "required_config",
        )
    ):
        checks.append(
            CheckResult(
                code="D3_PIPELINE_INPUT_CHANGED",
                message=f"{pipeline_id} frozen inputs were changed",
                location=location,
            )
        )
    if item.get("status") not in PIPELINE_STATES:
        checks.append(
            CheckResult(
                code="D3_PIPELINE_STATUS_INVALID",
                message=f"{pipeline_id} has invalid status",
                location=location,
            )
        )
    if item.get("status") != "enabled":
        checks.append(
            CheckResult(
                code="D3_PIPELINE_NOT_ENABLED",
                message=f"{pipeline_id} must be enabled for D3 acceptance",
                location=location,
            )
        )
        return
    _required_text(
        checks,
        item,
        ("idempotency_key_template",),
        code="D3_PIPELINE_CONFIG_INCOMPLETE",
        location=location,
    )
    config = item.get("config")
    required_config = item.get("required_config")
    if (
        not isinstance(config, dict)
        or not isinstance(required_config, list)
        or any(not str(config.get(name) or "").strip() for name in required_config)
    ):
        checks.append(
            CheckResult(
                code="D3_PIPELINE_CONFIG_INCOMPLETE",
                message=f"{pipeline_id} required configuration is incomplete",
                location=location,
            )
        )
    for field in (
        "input_snapshot_immutable",
        "preserve_original_values",
        "preserve_source_text",
    ):
        if item.get(field) is not True:
            checks.append(
                CheckResult(
                    code="D3_PIPELINE_PRESERVATION_MISSING",
                    message=f"{pipeline_id} must enforce {field}",
                    location=location,
                )
            )
    expected_actions = {
        "unknown_enum_action": "candidate_dictionary_and_review",
        "fuzzy_merge_action": "preview_and_human_review",
        "conflict_action": "preserve_all_evidence_and_review",
    }
    if any(item.get(field) != value for field, value in expected_actions.items()):
        checks.append(
            CheckResult(
                code="D3_PIPELINE_REVIEW_POLICY_UNSAFE",
                message=f"{pipeline_id} review policies were weakened",
                location=location,
            )
        )


def _validate_run(
    checks: list[CheckResult],
    run_id: str,
    item: dict[str, Any],
    pipelines: dict[str, dict[str, Any]],
) -> None:
    location = f"transformation_runs.{run_id}"
    pipeline_id = str(item.get("pipeline_id") or "")
    if pipeline_id not in pipelines:
        checks.append(
            CheckResult(
                code="D3_RUN_PIPELINE_UNKNOWN",
                message=f"{run_id} references unknown pipeline {pipeline_id}",
                location=location,
            )
        )
    if item.get("status") not in RUN_STATES:
        checks.append(
            CheckResult(
                code="D3_RUN_STATUS_INVALID",
                message=f"{run_id} has invalid status",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        (
            "started_at",
            "finished_at",
            "code_version",
            "rule_version",
            "parameters_sha256",
            "input_manifest_sha256",
            "output_manifest_sha256",
        ),
        code="D3_RUN_METADATA_INCOMPLETE",
        location=location,
    )
    for field in ("parameters_sha256", "input_manifest_sha256", "output_manifest_sha256"):
        if not SHA256_PATTERN.fullmatch(str(item.get(field) or "")):
            checks.append(
                CheckResult(
                    code="D3_RUN_HASH_INVALID",
                    message=f"{run_id} requires lowercase SHA-256 in {field}",
                    location=location,
                )
            )
    input_ids = item.get("input_ids")
    output_ids = item.get("output_ids")
    if not isinstance(input_ids, list) or not input_ids or not isinstance(output_ids, list):
        checks.append(
            CheckResult(
                code="D3_RUN_INPUT_OUTPUT_INVALID",
                message=f"{run_id} requires non-empty input_ids and an output_ids list",
                location=location,
            )
        )
    if item.get("input_mutated") is not False:
        checks.append(
            CheckResult(
                code="D3_RUN_MUTATED_INPUT",
                message=f"{run_id} must confirm inputs were not mutated",
                location=location,
            )
        )
    if item.get("secret_material_logged") is not False:
        checks.append(
            CheckResult(
                code="D3_RUN_SECRET_LOGGING_UNSAFE",
                message=f"{run_id} must not log credentials or raw personal secrets",
                location=location,
            )
        )


def _d2_raw_index(
    checks: list[CheckResult],
    d2_bundle: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    if d2_bundle.get("schema_version") != 1 or d2_bundle.get("stage") != "D2":
        checks.append(
            CheckResult(
                code="D3_D2_HEADER_INVALID",
                message="Input requires a schema_version 1 D2 bundle",
                location="d2_bundle",
            )
        )
    batches = d2_bundle.get("batches")
    if not isinstance(batches, list) or not batches:
        checks.append(
            CheckResult(
                code="D3_D2_BATCHES_INVALID",
                message="D2 input requires a non-empty batches list",
                location="d2_bundle.batches",
            )
        )
    elif any(not isinstance(item, dict) or item.get("status") != "closed" for item in batches):
        checks.append(
            CheckResult(
                code="D3_D2_BATCH_NOT_CLOSED",
                message="Every D2 input batch must be closed before D3 processing",
                location="d2_bundle.batches",
            )
        )
    raw_objects = d2_bundle.get("raw_objects")
    if not isinstance(raw_objects, list):
        checks.append(
            CheckResult(
                code="D3_D2_RAW_INVALID",
                message="D2 raw_objects must be a list",
                location="d2_bundle",
            )
        )
        return {}
    indexed: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(raw_objects):
        location = f"d2_bundle.raw_objects[{index}]"
        if not isinstance(item, dict) or not str(item.get("raw_id") or "").strip():
            checks.append(
                CheckResult(
                    code="D3_D2_RAW_ENTRY_INVALID",
                    message="Every D2 raw object requires a raw_id",
                    location=location,
                )
            )
            continue
        raw_id = str(item["raw_id"]).strip()
        if raw_id in indexed:
            checks.append(
                CheckResult(
                    code="D3_D2_RAW_DUPLICATE",
                    message=f"Duplicate D2 raw object: {raw_id}",
                    location=location,
                )
            )
            continue
        indexed[raw_id] = item
        _required_text(
            checks,
            item,
            ("source_id", "batch_id", "country"),
            code="D3_D2_RAW_METADATA_INCOMPLETE",
            location=location,
        )
        if (
            item.get("immutable") is not True
            or item.get("original_bytes_preserved") is not True
            or item.get("cookie_or_token_logged") is not False
        ):
            checks.append(
                CheckResult(
                    code="D3_D2_RAW_UNSAFE",
                    message=f"{raw_id} is not a safe immutable L0 input",
                    location=location,
                )
            )
        if not SHA256_PATTERN.fullmatch(str(item.get("sha256") or "")):
            checks.append(
                CheckResult(
                    code="D3_D2_RAW_HASH_INVALID",
                    message=f"{raw_id} requires a lowercase SHA-256",
                    location=location,
                )
            )
    return indexed


def _validate_record(
    checks: list[CheckResult],
    record_id: str,
    item: dict[str, Any],
    raw_objects: dict[str, dict[str, Any]],
    runs: dict[str, dict[str, Any]],
) -> None:
    location = f"records.{record_id}"
    raw_id = str(item.get("raw_id") or "")
    raw = raw_objects.get(raw_id)
    if raw is None:
        checks.append(
            CheckResult(
                code="D3_RECORD_RAW_UNKNOWN",
                message=f"{record_id} references unknown raw object {raw_id}",
                location=location,
            )
        )
    elif any(
        item.get(field) != raw.get(field) for field in ("source_id", "batch_id", "country")
    ) or item.get("source_snapshot_sha256") != raw.get("sha256"):
        checks.append(
            CheckResult(
                code="D3_RECORD_RAW_MISMATCH",
                message=f"{record_id} provenance differs from its L0 object",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        (
            "source_locator",
            "source_text",
            "source_text_sha256",
            "source_language",
            "extraction_method",
            "schema_version",
        ),
        code="D3_RECORD_METADATA_INCOMPLETE",
        location=location,
    )
    if not SHA256_PATTERN.fullmatch(str(item.get("source_text_sha256") or "")):
        checks.append(
            CheckResult(
                code="D3_RECORD_TEXT_HASH_INVALID",
                message=f"{record_id} requires a lowercase source-text SHA-256",
                location=location,
            )
        )
    elif hashlib.sha256(str(item.get("source_text") or "").encode()).hexdigest() != item.get(
        "source_text_sha256"
    ):
        checks.append(
            CheckResult(
                code="D3_RECORD_TEXT_HASH_MISMATCH",
                message=f"{record_id} source-text SHA-256 does not match source_text",
                location=location,
            )
        )
    confidence = item.get("extraction_confidence")
    if (
        not isinstance(confidence, int | float)
        or isinstance(confidence, bool)
        or not 0 <= confidence <= 1
    ):
        checks.append(
            CheckResult(
                code="D3_RECORD_CONFIDENCE_INVALID",
                message=f"{record_id} extraction_confidence must be between 0 and 1",
                location=location,
            )
        )
    if item.get("status") not in RECORD_STATES:
        checks.append(
            CheckResult(
                code="D3_RECORD_STATUS_INVALID",
                message=f"{record_id} has invalid D3 candidate status",
                location=location,
            )
        )
    if item.get("publish_eligible") is not False or item.get("ai_index_eligible") is not False:
        checks.append(
            CheckResult(
                code="D3_RECORD_PUBLICATION_BOUNDARY_BROKEN",
                message=f"{record_id} cannot be publishable or AI-indexable in D3",
                location=location,
            )
        )
    run_ids = item.get("transformation_run_ids")
    if not isinstance(run_ids, list):
        checks.append(
            CheckResult(
                code="D3_RECORD_RUNS_INVALID",
                message=f"{record_id} transformation_run_ids must be a list",
                location=location,
            )
        )
        return
    referenced_runs = [runs[run_id] for run_id in run_ids if run_id in runs]
    if len(referenced_runs) != len(run_ids):
        checks.append(
            CheckResult(
                code="D3_RECORD_RUN_UNKNOWN",
                message=f"{record_id} references unknown transformation runs",
                location=location,
            )
        )
    required_pipeline_ids = {str(item["pipeline_id"]) for item in PIPELINE_DEFINITIONS}
    successful_pipeline_ids = {
        str(run.get("pipeline_id")) for run in referenced_runs if run.get("status") == "succeeded"
    }
    if successful_pipeline_ids != required_pipeline_ids:
        checks.append(
            CheckResult(
                code="D3_RECORD_PIPELINE_COVERAGE_INCOMPLETE",
                message=f"{record_id} requires successful parse, standardize, and entity runs",
                location=location,
            )
        )
        return
    run_by_pipeline = {
        str(run.get("pipeline_id")): run
        for run in referenced_runs
        if run.get("status") == "succeeded"
    }
    parse_run = run_by_pipeline["D3-PARSE"]
    downstream_runs = (run_by_pipeline["D3-STANDARDIZE"], run_by_pipeline["D3-ENTITY"])
    if (
        raw_id not in parse_run.get("input_ids", [])
        or record_id not in parse_run.get("output_ids", [])
        or any(
            record_id not in run.get("input_ids", []) or record_id not in run.get("output_ids", [])
            for run in downstream_runs
        )
    ):
        checks.append(
            CheckResult(
                code="D3_RECORD_RUN_LINEAGE_MISMATCH",
                message=f"{record_id} is not traceable through all three run manifests",
                location=location,
            )
        )


def _field_keys(contracts: dict[str, Any]) -> set[str]:
    return {
        f"{item['实体']}.{item['字段名']}"
        for item in contracts["fields"]
        if item.get("实体") and item.get("字段名")
    }


def _enum_keys(contracts: dict[str, Any]) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for item in contracts["enums"]:
        field = str(item.get("对象.字段") or "")
        result.setdefault(field, set()).add(str(item.get("代码值") or ""))
    return result


def _validate_field_value(
    checks: list[CheckResult],
    value_id: str,
    item: dict[str, Any],
    records: dict[str, dict[str, Any]],
    runs: dict[str, dict[str, Any]],
    fields: set[str],
    enums: dict[str, set[str]],
) -> None:
    location = f"field_values.{value_id}"
    record_id = str(item.get("record_id") or "")
    record = records.get(record_id)
    if record is None:
        checks.append(
            CheckResult(
                code="D3_FIELD_RECORD_UNKNOWN",
                message=f"{value_id} references unknown record {record_id}",
                location=location,
            )
        )
    target_field = str(item.get("target_field") or "")
    if target_field not in fields:
        checks.append(
            CheckResult(
                code="D3_FIELD_TARGET_UNKNOWN",
                message=f"{value_id} target field is not frozen: {target_field}",
                location=location,
            )
        )
    value_status = item.get("value_status")
    if value_status not in VALUE_STATES:
        checks.append(
            CheckResult(
                code="D3_VALUE_STATUS_INVALID",
                message=f"{value_id} has invalid value_status",
                location=location,
            )
        )
    if value_status == "available" and (
        item.get("original_value") is None or item.get("normalized_value") is None
    ):
        checks.append(
            CheckResult(
                code="D3_VALUE_AVAILABLE_INCOMPLETE",
                message=f"{value_id} available values require original and normalized values",
                location=location,
            )
        )
    if value_status in {"pending", "not_public", "unverified"} and (
        item.get("normalized_value") is not None
    ):
        checks.append(
            CheckResult(
                code="D3_VALUE_STATUS_CONTRADICTION",
                message=f"{value_id} unresolved status cannot carry a normalized value",
                location=location,
            )
        )
    if item.get("normalized_unit") is not None:
        _required_text(
            checks,
            item,
            ("original_unit", "conversion_factor", "conversion_rule_version"),
            code="D3_UNIT_CONVERSION_INCOMPLETE",
            location=location,
        )
        conversion_factor = item.get("conversion_factor")
        if (
            not isinstance(conversion_factor, int | float)
            or isinstance(conversion_factor, bool)
            or conversion_factor <= 0
        ):
            checks.append(
                CheckResult(
                    code="D3_UNIT_CONVERSION_FACTOR_INVALID",
                    message=f"{value_id} conversion_factor must be positive",
                    location=location,
                )
            )
    if item.get("normalized_currency") is not None:
        _required_text(
            checks,
            item,
            (
                "original_currency",
                "fx_rate",
                "fx_source",
                "fx_type",
                "fx_date",
            ),
            code="D3_CURRENCY_CONVERSION_INCOMPLETE",
            location=location,
        )
        fx_rate = item.get("fx_rate")
        if not isinstance(fx_rate, int | float) or isinstance(fx_rate, bool) or fx_rate <= 0:
            checks.append(
                CheckResult(
                    code="D3_CURRENCY_RATE_INVALID",
                    message=f"{value_id} fx_rate must be positive",
                    location=location,
                )
            )
    if item.get("normalized_utc") is not None:
        _required_text(
            checks,
            item,
            ("local_time", "iana_timezone", "source_date"),
            code="D3_TIME_CONVERSION_INCOMPLETE",
            location=location,
        )
    _required_text(
        checks,
        item,
        (
            "raw_id",
            "source_locator",
            "transformation_run_id",
            "rule_version",
        ),
        code="D3_FIELD_PROVENANCE_INCOMPLETE",
        location=location,
    )
    if record and (
        item.get("raw_id") != record.get("raw_id")
        or item.get("source_locator") != record.get("source_locator")
    ):
        checks.append(
            CheckResult(
                code="D3_FIELD_PROVENANCE_MISMATCH",
                message=f"{value_id} provenance differs from its record",
                location=location,
            )
        )
    transformation_run_id = str(item.get("transformation_run_id") or "")
    transformation_run = runs.get(transformation_run_id)
    if (
        transformation_run is None
        or transformation_run.get("status") != "succeeded"
        or transformation_run.get("pipeline_id") != "D3-STANDARDIZE"
        or record_id not in transformation_run.get("output_ids", [])
    ):
        checks.append(
            CheckResult(
                code="D3_FIELD_RUN_INVALID",
                message=f"{value_id} must reference a successful standardization run",
                location=location,
            )
        )
    enum_status = item.get("enum_status")
    if target_field in enums:
        enum_code = str(item.get("enum_code") or "")
        if enum_status == "approved" and enum_code not in enums[target_field]:
            checks.append(
                CheckResult(
                    code="D3_ENUM_CODE_UNKNOWN",
                    message=f"{value_id} approved enum code is not frozen",
                    location=location,
                )
            )
        if enum_status not in {"approved", "candidate", "unknown"}:
            checks.append(
                CheckResult(
                    code="D3_ENUM_STATUS_INVALID",
                    message=f"{value_id} enum_status is invalid",
                    location=location,
                )
            )
        if (
            enum_status in {"candidate", "unknown"}
            and record
            and (record.get("status") != "needs_review")
        ):
            checks.append(
                CheckResult(
                    code="D3_ENUM_REVIEW_NOT_ENFORCED",
                    message=f"{value_id} unresolved enum requires record review",
                    location=location,
                )
            )


def _validate_translation(
    checks: list[CheckResult],
    translation_id: str,
    item: dict[str, Any],
    records: dict[str, dict[str, Any]],
    runs: dict[str, dict[str, Any]],
) -> None:
    location = f"translations.{translation_id}"
    record_id = str(item.get("record_id") or "")
    record = records.get(record_id)
    if record is None:
        checks.append(
            CheckResult(
                code="D3_TRANSLATION_RECORD_UNKNOWN",
                message=f"{translation_id} references unknown record",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        (
            "source_hash",
            "source_language",
            "target_language",
            "source_text",
            "translated_text",
            "source_locator",
            "generated_at",
            "version",
            "transformation_run_id",
        ),
        code="D3_TRANSLATION_METADATA_INCOMPLETE",
        location=location,
    )
    status = item.get("status")
    if status not in TRANSLATION_STATES:
        checks.append(
            CheckResult(
                code="D3_TRANSLATION_STATUS_INVALID",
                message=f"{translation_id} has invalid status",
                location=location,
            )
        )
    if record and item.get("source_hash") != record.get("source_text_sha256") and status != "stale":
        checks.append(
            CheckResult(
                code="D3_TRANSLATION_STALE_NOT_ENFORCED",
                message=f"{translation_id} source changed but translation is not stale",
                location=location,
            )
        )
    if record and any(
        item.get(field) != record.get(record_field)
        for field, record_field in (
            ("source_language", "source_language"),
            ("source_text", "source_text"),
            ("source_locator", "source_locator"),
        )
    ):
        checks.append(
            CheckResult(
                code="D3_TRANSLATION_SOURCE_MISMATCH",
                message=f"{translation_id} source fields differ from the candidate record",
                location=location,
            )
        )
    if item.get("high_risk") is True and status != "human_reviewed":
        checks.append(
            CheckResult(
                code="D3_TRANSLATION_HIGH_RISK_UNREVIEWED",
                message=f"{translation_id} high-risk text requires human review",
                location=location,
            )
        )
    if status == "machine_translated":
        _required_text(
            checks,
            item,
            ("engine_or_model", "glossary_version"),
            code="D3_TRANSLATION_ENGINE_INCOMPLETE",
            location=location,
        )
    transformation_run = runs.get(str(item.get("transformation_run_id") or ""))
    if (
        transformation_run is None
        or transformation_run.get("status") != "succeeded"
        or transformation_run.get("pipeline_id") != "D3-STANDARDIZE"
        or record_id not in transformation_run.get("output_ids", [])
    ):
        checks.append(
            CheckResult(
                code="D3_TRANSLATION_RUN_INVALID",
                message=f"{translation_id} must reference a successful standardization run",
                location=location,
            )
        )
    if status == "human_reviewed":
        _required_text(
            checks,
            item,
            ("reviewer", "reviewed_at"),
            code="D3_TRANSLATION_REVIEW_INCOMPLETE",
            location=location,
        )


def _validate_entity_decision(
    checks: list[CheckResult],
    decision_id: str,
    item: dict[str, Any],
    records: dict[str, dict[str, Any]],
    runs: dict[str, dict[str, Any]],
) -> None:
    location = f"entity_decisions.{decision_id}"
    record = records.get(str(item.get("record_id") or ""))
    if record is None:
        checks.append(
            CheckResult(
                code="D3_ENTITY_RECORD_UNKNOWN",
                message=f"{decision_id} references unknown record",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        ("entity_type", "transformation_run_id", "rule_version"),
        code="D3_ENTITY_METADATA_INCOMPLETE",
        location=location,
    )
    transformation_run = runs.get(str(item.get("transformation_run_id") or ""))
    if (
        transformation_run is None
        or transformation_run.get("status") != "succeeded"
        or transformation_run.get("pipeline_id") != "D3-ENTITY"
        or str(item.get("record_id") or "") not in transformation_run.get("output_ids", [])
    ):
        checks.append(
            CheckResult(
                code="D3_ENTITY_RUN_INVALID",
                message=f"{decision_id} must reference a successful entity-resolution run",
                location=location,
            )
        )
    method = item.get("method")
    decision = item.get("decision")
    if method not in ENTITY_METHODS or decision not in ENTITY_DECISIONS:
        checks.append(
            CheckResult(
                code="D3_ENTITY_DECISION_INVALID",
                message=f"{decision_id} method or decision is invalid",
                location=location,
            )
        )
        return
    if decision == "confirmed":
        _required_text(
            checks,
            item,
            ("resolved_entity_id", "decided_at"),
            code="D3_ENTITY_CONFIRMATION_INCOMPLETE",
            location=location,
        )
        if not item.get("evidence_ids"):
            checks.append(
                CheckResult(
                    code="D3_ENTITY_EVIDENCE_MISSING",
                    message=f"{decision_id} confirmed resolution requires evidence",
                    location=location,
                )
            )
    if method == "fuzzy":
        if item.get("preview_generated") is not True or item.get("reversible") is not True:
            checks.append(
                CheckResult(
                    code="D3_FUZZY_PREVIEW_OR_REVERSAL_MISSING",
                    message=f"{decision_id} fuzzy resolution requires preview and reversal",
                    location=location,
                )
            )
        if decision == "confirmed":
            _required_text(
                checks,
                item,
                ("reviewer", "decided_at", "preview_sha256", "reversal_plan"),
                code="D3_FUZZY_REVIEW_INCOMPLETE",
                location=location,
            )
            if not item.get("evidence_ids"):
                checks.append(
                    CheckResult(
                        code="D3_FUZZY_EVIDENCE_MISSING",
                        message=f"{decision_id} fuzzy confirmation requires evidence",
                        location=location,
                    )
                )
            if not SHA256_PATTERN.fullmatch(str(item.get("preview_sha256") or "")):
                checks.append(
                    CheckResult(
                        code="D3_FUZZY_PREVIEW_HASH_INVALID",
                        message=f"{decision_id} requires a lowercase preview SHA-256",
                        location=location,
                    )
                )
        elif record and record.get("status") != "needs_review":
            checks.append(
                CheckResult(
                    code="D3_FUZZY_REVIEW_NOT_ENFORCED",
                    message=f"{decision_id} unresolved fuzzy match requires record review",
                    location=location,
                )
            )
    if method == "deterministic":
        _required_text(
            checks,
            item,
            ("deterministic_key", "rule_version"),
            code="D3_DETERMINISTIC_KEY_MISSING",
            location=location,
        )


def _validate_conflict(
    checks: list[CheckResult],
    conflict_id: str,
    item: dict[str, Any],
    records: dict[str, dict[str, Any]],
) -> None:
    location = f"conflicts.{conflict_id}"
    record = records.get(str(item.get("record_id") or ""))
    if record is None:
        checks.append(
            CheckResult(
                code="D3_CONFLICT_RECORD_UNKNOWN",
                message=f"{conflict_id} references unknown record",
                location=location,
            )
        )
    if item.get("status") not in CONFLICT_STATES:
        checks.append(
            CheckResult(
                code="D3_CONFLICT_STATUS_INVALID",
                message=f"{conflict_id} has invalid status",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        ("target_field", "rule_version", "detected_at"),
        code="D3_CONFLICT_METADATA_INCOMPLETE",
        location=location,
    )
    evidence = item.get("evidence")
    if not isinstance(evidence, list) or len(evidence) < 2:
        checks.append(
            CheckResult(
                code="D3_CONFLICT_EVIDENCE_INCOMPLETE",
                message=f"{conflict_id} requires both sides of the evidence",
                location=location,
            )
        )
    elif any(
        not isinstance(evidence_item, dict)
        or evidence_item.get("value") is None
        or any(
            not str(evidence_item.get(field) or "").strip()
            for field in ("evidence_id", "source_id", "observed_at", "source_locator")
        )
        for evidence_item in evidence
    ):
        checks.append(
            CheckResult(
                code="D3_CONFLICT_EVIDENCE_METADATA_INCOMPLETE",
                message=f"{conflict_id} evidence requires value, source, time, and locator",
                location=location,
            )
        )
    if item.get("majority_vote_auto_resolution") is not False:
        checks.append(
            CheckResult(
                code="D3_CONFLICT_AUTO_OVERWRITE_UNSAFE",
                message=f"{conflict_id} must prohibit majority-vote auto-overwrite",
                location=location,
            )
        )
    if item.get("status") == "open" and record and record.get("status") != "needs_review":
        checks.append(
            CheckResult(
                code="D3_CONFLICT_REVIEW_NOT_ENFORCED",
                message=f"{conflict_id} open conflict requires record review",
                location=location,
            )
        )
    if item.get("status") == "resolved":
        _required_text(
            checks,
            item,
            ("resolution", "reviewer", "resolved_at"),
            code="D3_CONFLICT_RESOLUTION_INCOMPLETE",
            location=location,
        )


def _validate_merge(
    checks: list[CheckResult],
    merge_id: str,
    item: dict[str, Any],
) -> None:
    location = f"merge_actions.{merge_id}"
    if item.get("status") not in MERGE_STATES:
        checks.append(
            CheckResult(
                code="D3_MERGE_STATUS_INVALID",
                message=f"{merge_id} has invalid status",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        (
            "entity_type",
            "survivor_id",
            "preview_sha256",
            "reviewer",
            "approved_at",
            "reversal_plan",
        ),
        code="D3_MERGE_METADATA_INCOMPLETE",
        location=location,
    )
    if not SHA256_PATTERN.fullmatch(str(item.get("preview_sha256") or "")):
        checks.append(
            CheckResult(
                code="D3_MERGE_PREVIEW_HASH_INVALID",
                message=f"{merge_id} requires a lowercase preview SHA-256",
                location=location,
            )
        )
    merged_ids = item.get("merged_ids")
    history_id_map = item.get("history_id_map")
    if (
        not isinstance(merged_ids, list)
        or not merged_ids
        or not isinstance(history_id_map, dict)
        or any(merged_id not in history_id_map for merged_id in merged_ids)
    ):
        checks.append(
            CheckResult(
                code="D3_MERGE_HISTORY_MAP_INCOMPLETE",
                message=f"{merge_id} requires merged IDs and a complete history map",
                location=location,
            )
        )
    if item.get("reversible") is not True:
        checks.append(
            CheckResult(
                code="D3_MERGE_NOT_REVERSIBLE",
                message=f"{merge_id} must be reversible",
                location=location,
            )
        )
    if item.get("status") == "executed" and not item.get("execution_audit_id"):
        checks.append(
            CheckResult(
                code="D3_MERGE_EXECUTION_AUDIT_MISSING",
                message=f"{merge_id} executed merge requires an audit ID",
                location=location,
            )
        )


def validate_d3_bundle(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    d2_bundle: dict[str, Any],
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    current = build_d3_bundle_template(paths)
    contracts = extract_contracts(paths)
    if bundle.get("schema_version") != 1 or bundle.get("stage") != "D3":
        checks.append(
            CheckResult(
                code="D3_HEADER_INVALID",
                message="Bundle requires schema_version 1 and stage D3",
                location="bundle",
            )
        )
    if bundle.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="D3_TEMPLATE_UNCOPIED",
                message="Copy the D3 template and set template_only to false",
                location="template_only",
            )
        )
    if bundle.get("append_only") is not True:
        checks.append(
            CheckResult(
                code="D3_APPEND_ONLY_MISSING",
                message="D3 bundle must declare append_only true",
                location="append_only",
            )
        )
    if bundle.get("baseline") != current["baseline"]:
        checks.append(
            CheckResult(
                code="D3_BASELINE_STALE",
                message="D3 baseline does not match current frozen inputs",
                location="baseline",
            )
        )
    dependencies = bundle.get("dependencies")
    if not isinstance(dependencies, dict) or (
        dependencies.get("d2_gate_status") != "approved"
        or not dependencies.get("d2_gate_evidence_id")
    ):
        checks.append(
            CheckResult(
                code="D3_D2_DEPENDENCY_PENDING",
                message="D2 gate approval and evidence are required before D3",
                location="dependencies",
            )
        )

    pipelines = _index(checks, bundle, "pipelines", "pipeline_id")
    runs = _index(checks, bundle, "transformation_runs", "run_id")
    records = _index(checks, bundle, "records", "record_id")
    field_values = _index(checks, bundle, "field_values", "field_value_id")
    translations = _index(checks, bundle, "translations", "translation_id")
    entity_decisions = _index(checks, bundle, "entity_decisions", "decision_id")
    conflicts = _index(checks, bundle, "conflicts", "conflict_id")
    merges = _index(checks, bundle, "merge_actions", "merge_id")
    expected_pipelines = {str(item["pipeline_id"]): item for item in current["pipelines"]}
    if set(pipelines) != set(expected_pipelines):
        checks.append(
            CheckResult(
                code="D3_PIPELINE_SET_INVALID",
                message="D3 must retain parse, standardize, and entity pipelines",
                location="pipelines",
            )
        )
    for pipeline_id, item in pipelines.items():
        _validate_pipeline(checks, pipeline_id, item, expected_pipelines.get(pipeline_id))
    for run_id, item in runs.items():
        _validate_run(checks, run_id, item, pipelines)
    successful_pipeline_ids = {
        str(item.get("pipeline_id")) for item in runs.values() if item.get("status") == "succeeded"
    }
    if successful_pipeline_ids != set(expected_pipelines):
        checks.append(
            CheckResult(
                code="D3_SUCCESSFUL_PIPELINE_RUNS_INCOMPLETE",
                message="Each D3 pipeline requires at least one successful run",
                location="transformation_runs",
            )
        )

    raw_objects = _d2_raw_index(checks, d2_bundle)
    for record_id, item in records.items():
        _validate_record(checks, record_id, item, raw_objects, runs)
    covered_raw_ids = {str(item.get("raw_id")) for item in records.values() if item.get("raw_id")}
    missing_raw_ids = sorted(set(raw_objects) - covered_raw_ids)
    if missing_raw_ids:
        checks.append(
            CheckResult(
                code="D3_RAW_COVERAGE_INCOMPLETE",
                message=f"Unprocessed D2 raw objects: {', '.join(missing_raw_ids)}",
                location="records",
            )
        )

    fields = _field_keys(contracts)
    enums = _enum_keys(contracts)
    for value_id, item in field_values.items():
        _validate_field_value(checks, value_id, item, records, runs, fields, enums)
    value_counts = Counter(str(item.get("record_id")) for item in field_values.values())
    for record_id in records:
        if value_counts[record_id] == 0:
            checks.append(
                CheckResult(
                    code="D3_RECORD_FIELDS_MISSING",
                    message=f"{record_id} has no extracted field values",
                    location=f"records.{record_id}",
                )
            )

    for translation_id, item in translations.items():
        _validate_translation(checks, translation_id, item, records, runs)
    translated_record_ids = {str(item.get("record_id")) for item in translations.values()}
    for record_id, item in records.items():
        if item.get("source_language") != "zh" and record_id not in translated_record_ids:
            checks.append(
                CheckResult(
                    code="D3_TRANSLATION_MISSING",
                    message=f"{record_id} non-Chinese source requires a translation record",
                    location=f"records.{record_id}",
                )
            )

    for decision_id, item in entity_decisions.items():
        _validate_entity_decision(checks, decision_id, item, records, runs)
    entity_counts = Counter(str(item.get("record_id")) for item in entity_decisions.values())
    for record_id in records:
        if entity_counts[record_id] == 0:
            checks.append(
                CheckResult(
                    code="D3_ENTITY_DECISION_MISSING",
                    message=f"{record_id} has no entity-resolution decision",
                    location=f"records.{record_id}",
                )
            )

    for conflict_id, item in conflicts.items():
        _validate_conflict(checks, conflict_id, item, records)
    for merge_id, item in merges.items():
        _validate_merge(checks, merge_id, item)
    return checks


def load_and_validate_d3_bundle(
    paths: RepositoryPaths,
    bundle_path: Path,
    d2_bundle_path: Path,
) -> list[CheckResult]:
    payloads: list[dict[str, Any]] = []
    for label, path in (("bundle", bundle_path), ("D2 bundle", d2_bundle_path)):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            return [
                CheckResult(
                    code="D3_ARTIFACT_INVALID",
                    message=f"Cannot read {label}: {error}",
                    location=str(path),
                )
            ]
        if not isinstance(payload, dict):
            return [
                CheckResult(
                    code="D3_ARTIFACT_INVALID",
                    message=f"{label} root must be an object",
                    location=str(path),
                )
            ]
        payloads.append(payload)
    return validate_d3_bundle(paths, payloads[0], payloads[1])
