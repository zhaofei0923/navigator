from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .baseline import extract_contracts, sha256_file
from .paths import RepositoryPaths

PLACEHOLDER_VALUES = {"", "待填", "待复核", "待确认", "未执行"}


def _duplicates(values: list[str]) -> list[str]:
    return sorted(value for value, count in Counter(values).items() if value and count > 1)


def _machine_check(
    check_id: str,
    description: str,
    findings: list[Any],
) -> dict[str, Any]:
    return {
        "check_id": check_id,
        "description": description,
        "status": "pass" if not findings else "fail",
        "findings": findings,
    }


def _machine_evidence(
    *,
    acceptance_id: str,
    required_reviewer_roles: list[str],
    source_binding: dict[str, Any] | None,
    checks: list[dict[str, Any]],
    inventory: dict[str, Any],
    human_review_scope: list[str],
) -> dict[str, Any]:
    failed_checks = [
        {"check_id": check["check_id"], "findings": check["findings"]}
        for check in checks
        if check["status"] == "fail"
    ]
    return {
        "schema_version": 1,
        "stage": "D0",
        "acceptance_id": acceptance_id,
        "candidate_only": True,
        "automated_assessment_only": True,
        "machine_status": "pass" if not failed_checks else "fail",
        "human_status": "pending",
        "required_reviewer_roles": required_reviewer_roles,
        "warning": "机器证据不能代替实名责任人复核、批准或冻结基线变更",
        "source_binding": source_binding or {},
        "checks": checks,
        "findings": failed_checks,
        "inventory": inventory,
        "human_review_scope": human_review_scope,
    }


def build_core_entity_evidence(
    contracts: dict[str, Any],
    *,
    source_binding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    relationships = contracts["entities"]
    fields = contracts["fields"]
    relationship_ids = [str(item.get("关系编号") or "").strip() for item in relationships]
    missing_entity_codes = [
        str(item.get("关系编号") or f"row-{index + 1}")
        for index, item in enumerate(relationships)
        if not str(item.get("父实体") or "").strip() or not str(item.get("子实体") or "").strip()
    ]
    entity_codes = sorted(
        {
            str(item.get(key) or "").strip()
            for item in relationships
            for key in ("父实体", "子实体")
            if str(item.get(key) or "").strip()
        }
    )
    primary_key_entities = sorted(
        {
            str(item.get("实体") or "").strip()
            for item in fields
            if "主键" in str(item.get("唯一/索引") or "") and str(item.get("实体") or "").strip()
        }
    )
    missing_primary_keys = sorted(set(entity_codes) - set(primary_key_entities))
    missing_relation_keys = [
        relationship_id or f"row-{index + 1}"
        for index, (relationship_id, item) in enumerate(
            zip(relationship_ids, relationships, strict=True)
        )
        if not str(item.get("外键/唯一键") or "").strip()
    ]
    missing_authority = [
        relationship_id or f"row-{index + 1}"
        for index, (relationship_id, item) in enumerate(
            zip(relationship_ids, relationships, strict=True)
        )
        if not str(item.get("权威记录") or "").strip()
    ]
    missing_constraints = [
        relationship_id or f"row-{index + 1}"
        for index, (relationship_id, item) in enumerate(
            zip(relationship_ids, relationships, strict=True)
        )
        if not str(item.get("基数") or "").strip() or not str(item.get("关键约束") or "").strip()
    ]
    checks = [
        _machine_check(
            "ENTITY-RELATIONSHIP-ID-UNIQUE",
            "关系编号必须非空且唯一",
            [
                *[f"row-{index + 1}" for index, value in enumerate(relationship_ids) if not value],
                *_duplicates(relationship_ids),
            ],
        ),
        _machine_check(
            "ENTITY-CODE-PRESENT",
            "每条关系必须引用非空父实体和子实体代码",
            missing_entity_codes,
        ),
        _machine_check(
            "ENTITY-PRIMARY-KEY-COVERAGE",
            "每个关系实体必须在字段合同中显式标记主键",
            missing_primary_keys,
        ),
        _machine_check(
            "ENTITY-RELATION-KEY-PRESENT",
            "每条关系必须给出外键或唯一键合同",
            missing_relation_keys,
        ),
        _machine_check(
            "ENTITY-AUTHORITY-PRESENT",
            "每条关系必须给出权威记录",
            missing_authority,
        ),
        _machine_check(
            "ENTITY-CARDINALITY-CONSTRAINT-PRESENT",
            "每条关系必须给出基数和关键约束",
            missing_constraints,
        ),
    ]
    return _machine_evidence(
        acceptance_id="D0-AC-001",
        required_reviewer_roles=["数据负责人", "后端/数据架构负责人"],
        source_binding=source_binding,
        checks=checks,
        inventory={
            "relationship_count": len(relationships),
            "entity_code_count": len(entity_codes),
            "entity_codes": entity_codes,
            "primary_key_entity_count": len(primary_key_entities),
            "primary_key_entities": primary_key_entities,
        },
        human_review_scope=[
            "确认关系表中的实体代码覆盖全部核心实体",
            "确认每个核心实体的主键合同；缺失项必须补充基线或记录正式例外",
            "确认外键、唯一键、权威记录、基数和关键约束的业务语义",
        ],
    )


def build_core_field_evidence(
    contracts: dict[str, Any],
    *,
    source_binding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fields = contracts["fields"]
    field_ids = [str(item.get("字段编号") or "").strip() for item in fields]
    field_keys = [
        f"{str(item.get('实体') or '').strip()}.{str(item.get('字段名') or '').strip()}"
        for item in fields
    ]
    required_metadata = ("字段编号", "实体", "字段名", "类型", "必填", "来源要求")
    metadata_gaps = [
        {
            "field_id": str(item.get("字段编号") or f"row-{index + 1}"),
            "missing": [key for key in required_metadata if not str(item.get(key) or "").strip()],
        }
        for index, item in enumerate(fields)
        if any(not str(item.get(key) or "").strip() for key in required_metadata)
    ]
    allowed_required_values = {"是", "否", "条件必填"}
    invalid_required_values = [
        {
            "field_id": str(item.get("字段编号") or f"row-{index + 1}"),
            "value": item.get("必填"),
        }
        for index, item in enumerate(fields)
        if str(item.get("必填") or "").strip() not in allowed_required_values
    ]
    has_unit_metadata_column = any("单位" in item for item in fields)
    fields_without_unit_metadata = [
        str(item.get("字段编号") or f"row-{index + 1}")
        for index, item in enumerate(fields)
        if not str(item.get("单位") or "").strip()
    ]
    unit_findings: list[Any] = []
    if fields_without_unit_metadata:
        unit_findings.append(
            {
                "missing_contract_column": "单位" if not has_unit_metadata_column else None,
                "field_count": len(fields_without_unit_metadata),
                "field_ids": fields_without_unit_metadata,
                "required_resolution": "为每个字段显式记录单位代码或不适用",
            }
        )
    checks = [
        _machine_check(
            "FIELD-ID-UNIQUE",
            "字段编号必须非空且唯一",
            [
                *[f"row-{index + 1}" for index, value in enumerate(field_ids) if not value],
                *_duplicates(field_ids),
            ],
        ),
        _machine_check(
            "FIELD-ENTITY-NAME-UNIQUE",
            "实体与字段名组合必须唯一",
            _duplicates(field_keys),
        ),
        _machine_check(
            "FIELD-METADATA-COMPLETE",
            "字段必须给出代码、实体、名称、类型、空值和来源规则",
            metadata_gaps,
        ),
        _machine_check(
            "FIELD-NULLABILITY-VALID",
            "必填值必须明确为是、否或条件必填",
            invalid_required_values,
        ),
        _machine_check(
            "FIELD-UNIT-METADATA-PRESENT",
            "字段合同必须显式记录单位代码或不适用",
            unit_findings,
        ),
    ]
    return _machine_evidence(
        acceptance_id="D0-AC-002",
        required_reviewer_roles=["数据负责人", "数据质量负责人"],
        source_binding=source_binding,
        checks=checks,
        inventory={
            "field_count": len(fields),
            "entity_count": len(
                {str(item.get("实体") or "").strip() for item in fields if item.get("实体")}
            ),
            "required_value_counts": dict(
                sorted(Counter(str(item.get("必填") or "").strip() for item in fields).items())
            ),
            "unit_metadata_column_present": has_unit_metadata_column,
            "fields_with_explicit_unit_or_not_applicable": (
                len(fields) - len(fields_without_unit_metadata)
            ),
        },
        human_review_scope=[
            "确认字段代码、实体字段名、类型、空值和来源规则",
            "补充单位代码或明确不适用，禁止仅从备注或展示文案推断单位",
            "确认条件必填规则可由后续质量校验实现",
        ],
    )


def build_enum_migration_evidence(
    contracts: dict[str, Any],
    *,
    source_binding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    enums = contracts["enums"]
    migrations = contracts["identifier_migrations"]
    enum_ids = [str(item.get("枚举编号") or "").strip() for item in enums]
    enum_keys = [
        f"{str(item.get('对象.字段') or '').strip()}::{str(item.get('代码值') or '').strip()}"
        for item in enums
    ]
    enum_required = ("枚举编号", "对象.字段", "代码值", "中文名称", "可转向", "进入条件")
    enum_metadata_gaps = [
        {
            "enum_id": str(item.get("枚举编号") or f"row-{index + 1}"),
            "missing": [key for key in enum_required if not str(item.get(key) or "").strip()],
        }
        for index, item in enumerate(enums)
        if any(not str(item.get(key) or "").strip() for key in enum_required)
    ]
    migration_required = (
        "历史编号",
        "现行规范编号",
        "冲突类型",
        "处理规则",
        "状态",
    )
    migration_gaps = [
        {
            "historical_id": str(item.get("历史编号") or f"row-{index + 1}"),
            "missing": [key for key in migration_required if not str(item.get(key) or "").strip()],
        }
        for index, item in enumerate(migrations)
        if any(not str(item.get(key) or "").strip() for key in migration_required)
    ]
    historical_ids = [str(item.get("历史编号") or "").strip() for item in migrations]
    checks = [
        _machine_check(
            "ENUM-ID-UNIQUE",
            "枚举编号必须非空且唯一",
            [
                *[f"row-{index + 1}" for index, value in enumerate(enum_ids) if not value],
                *_duplicates(enum_ids),
            ],
        ),
        _machine_check(
            "ENUM-GROUP-CODE-UNIQUE",
            "同一对象字段内代码必须互斥且唯一",
            _duplicates(enum_keys),
        ),
        _machine_check(
            "ENUM-METADATA-COMPLETE",
            "枚举必须给出中文、代码、转向和进入条件",
            enum_metadata_gaps,
        ),
        _machine_check(
            "MIGRATION-HISTORICAL-ID-UNIQUE",
            "历史编号必须非空且唯一",
            [
                *[f"row-{index + 1}" for index, value in enumerate(historical_ids) if not value],
                *_duplicates(historical_ids),
            ],
        ),
        _machine_check(
            "MIGRATION-METADATA-COMPLETE",
            "迁移记录必须给出现行编号、冲突类型、处理规则和状态",
            migration_gaps,
        ),
    ]
    group_counts = Counter(str(item.get("对象.字段") or "").strip() for item in enums)
    return _machine_evidence(
        acceptance_id="D0-AC-003",
        required_reviewer_roles=["产品负责人", "数据负责人"],
        source_binding=source_binding,
        checks=checks,
        inventory={
            "enum_count": len(enums),
            "enum_group_count": len(group_counts),
            "enum_group_counts": dict(sorted(group_counts.items())),
            "migration_count": len(migrations),
            "migration_status_counts": dict(
                sorted(Counter(str(item.get("状态") or "").strip() for item in migrations).items())
            ),
        },
        human_review_scope=[
            "确认中文名称、代码和业务含义一致",
            "确认可转向表达式中的业务宏、重开事件和终态语义",
            "确认13条历史编号、实体和枚举迁移规则没有语义冲突",
        ],
    )


def _candidate_json_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def build_machine_evidence_review_queue(
    evidence_payloads: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    evidence_ids = {
        "core_entity_evidence.json": "EVD-D0-AC-001-MACHINE-BASELINE",
        "core_field_evidence.json": "EVD-D0-AC-002-MACHINE-BASELINE",
        "enum_migration_evidence.json": "EVD-D0-AC-003-MACHINE-BASELINE",
    }
    items: list[dict[str, Any]] = []
    for filename, evidence_id in evidence_ids.items():
        payload = evidence_payloads[filename]
        path = f"data/d0/candidates/{filename}"
        candidate_sha256 = hashlib.sha256(_candidate_json_bytes(payload)).hexdigest()
        items.append(
            {
                "evidence_id": evidence_id,
                "acceptance_id": payload["acceptance_id"],
                "candidate_path": path,
                "candidate_sha256": candidate_sha256,
                "machine_status": payload["machine_status"],
                "human_status": "pending",
                "required_reviewer_roles": payload["required_reviewer_roles"],
                "approval_blocked_when_machine_status_not_pass": True,
                "manifest_entry_template": {
                    "evidence_id": evidence_id,
                    "acceptance_id": payload["acceptance_id"],
                    "path": path,
                    "sha256": candidate_sha256,
                    "recorded_by": "navigator-data prepare-d0",
                    "recorded_at": None,
                    "reviewer": None,
                    "status": "待复核",
                },
            }
        )
    return {
        "schema_version": 1,
        "stage": "D0",
        "candidate_only": True,
        "warning": "不得把本队列或待复核模板直接登记为已批准证据",
        "instructions": [
            "先解决machine_status为fail的合同缺口并重新生成候选",
            "由指定角色检查候选文件及其SHA-256",
            "只有实名批准后才可把模板补全并登记到data/d0/evidence/manifest.json",
            "批准证据仍须在D0正式评审副本中由同一实名复核人引用",
        ],
        "items": items,
    }


def load_research_captures(paths: RepositoryPaths) -> list[dict[str, Any]]:
    if not paths.d0_research_dir.exists():
        return []
    captures: list[dict[str, Any]] = []
    for path in sorted(paths.d0_research_dir.glob("*_capture.json")):
        captures.append(json.loads(path.read_text(encoding="utf-8")))
    return captures


def load_license_snapshots(paths: RepositoryPaths) -> list[dict[str, Any]]:
    license_dir = paths.d0_research_dir / "licenses"
    if not license_dir.exists():
        return []
    snapshots: list[dict[str, Any]] = []
    for path in sorted(license_dir.glob("*.json")):
        snapshots.append(json.loads(path.read_text(encoding="utf-8")))
    return snapshots


def build_template_trial(
    contracts: dict[str, Any],
    mapping_decisions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    countries = {str(item["ISO3"]) for item in contracts["countries"]}
    sources = {str(item["来源编号"]) for item in contracts["source_registry_seed"]}
    batches = {
        str(item["批次编号"]): item
        for item in contracts["collection_batch_template"]
        if item.get("批次编号")
    }
    fields = {
        f"{item['实体']}.{item['字段名']}"
        for item in contracts["fields"]
        if item.get("实体") and item.get("字段名")
    }

    checks: list[dict[str, Any]] = []

    batch_country_failures = sorted(
        str(item["批次编号"])
        for item in contracts["collection_batch_template"]
        if str(item.get("国家", "")) not in countries
    )
    checks.append(
        {
            "check_id": "TRIAL-BATCH-COUNTRY",
            "description": "采集批次国家必须存在于首批国家范围",
            "status": "pass" if not batch_country_failures else "fail",
            "failures": batch_country_failures,
        }
    )

    batch_source_failures = sorted(
        str(item["批次编号"])
        for item in contracts["collection_batch_template"]
        if str(item.get("来源编号", "")) not in sources
    )
    checks.append(
        {
            "check_id": "TRIAL-BATCH-SOURCE",
            "description": "采集批次来源必须存在于来源起始清单",
            "status": "pass" if not batch_source_failures else "fail",
            "failures": batch_source_failures,
        }
    )

    raw_reference_failures: list[dict[str, str]] = []
    for item in contracts["raw_asset_template"]:
        raw_id = str(item.get("原始编号", ""))
        if str(item.get("国家", "")) not in countries:
            raw_reference_failures.append({"raw_id": raw_id, "reference": "国家"})
        if str(item.get("来源编号", "")) not in sources:
            raw_reference_failures.append({"raw_id": raw_id, "reference": "来源编号"})
        if str(item.get("批次编号", "")) not in batches:
            raw_reference_failures.append({"raw_id": raw_id, "reference": "批次编号"})
    checks.append(
        {
            "check_id": "TRIAL-RAW-REFERENCES",
            "description": "原始资料示例必须引用已登记国家、来源和批次",
            "status": "pass" if not raw_reference_failures else "fail",
            "failures": raw_reference_failures,
        }
    )

    decisions_by_id = {
        str(item.get("mapping_id", "")): item
        for item in (mapping_decisions or [])
        if item.get("mapping_id")
    }
    mapping_failures: list[dict[str, str]] = []
    resolved_mappings: list[dict[str, str | None]] = []
    for item in contracts["field_mapping_template"]:
        mapping_id = str(item.get("映射编号", ""))
        original_target = str(item.get("目标实体.字段", ""))
        decision = decisions_by_id.get(mapping_id)
        if decision and decision.get("review_status") == "approved":
            action = str(decision.get("decision", ""))
            final_target = str(decision.get("final_target") or "")
            resolved_mappings.append(
                {
                    "mapping_id": mapping_id,
                    "decision": action,
                    "original_target": original_target,
                    "effective_target": final_target or None,
                }
            )
            if action == "retire_mapping":
                continue
            if action == "replace_target" and final_target in fields:
                continue
            if action in {"add_field", "model_entity"} and final_target:
                continue
            mapping_failures.append(
                {
                    "mapping_id": mapping_id,
                    "target": final_target or original_target,
                    "reason": "approved decision has no implementable final target",
                }
            )
            continue
        if original_target not in fields:
            mapping_failures.append({"mapping_id": mapping_id, "target": original_target})
    mapping_failures.sort(key=lambda failure: failure["mapping_id"])
    checks.append(
        {
            "check_id": "TRIAL-MAPPING-TARGET",
            "description": (
                "字段映射目标必须存在于冻结字段清单"
                if mapping_decisions is None
                else "字段映射目标必须存在于冻结字段清单或具有已批准的新增字段/实体建模决定"
            ),
            "status": "pass" if not mapping_failures else "fail",
            "failures": mapping_failures,
        }
    )

    report = {
        "schema_version": 1,
        "status": "pass" if all(item["status"] == "pass" for item in checks) else "fail",
        "purpose": "D0模板交叉试填；不进入正式库，不代表来源准入或数据发布",
        "checks": checks,
    }
    if mapping_decisions is not None:
        report["resolved_mappings"] = resolved_mappings
    return report


def build_gold_standard_gap_report(
    contracts: dict[str, Any],
    captures: list[dict[str, Any]] | None = None,
    raw_sample_reviews: list[dict[str, Any]] | None = None,
    license_snapshots: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    required_fields = ("SHA-256", "发布日期", "采集时间", "许可快照")
    captures_by_raw_id = {
        str(item.get("raw_id", "")): item for item in (captures or []) if item.get("raw_id")
    }
    reviews_by_raw_id = {
        str(item.get("raw_id", "")): item
        for item in (raw_sample_reviews or [])
        if item.get("raw_id")
    }
    snapshots_by_id = {
        str(item.get("snapshot_id", "")): item
        for item in (license_snapshots or [])
        if item.get("snapshot_id")
    }
    candidates: list[dict[str, Any]] = []
    for item in contracts["raw_asset_template"]:
        raw_id = str(item.get("原始编号", ""))
        capture = captures_by_raw_id.get(raw_id, {})
        review = reviews_by_raw_id.get(raw_id, {})
        snapshot_id = str(capture.get("license_snapshot_id") or "")
        snapshot = snapshots_by_id.get(snapshot_id, {})
        document_snapshot = snapshot.get("document_snapshot")
        license_snapshot_verified = bool(
            snapshot_id
            and snapshot
            and snapshot.get("raw_id") == raw_id
            and snapshot.get("source_id") == item.get("来源编号")
            and isinstance(document_snapshot, dict)
            and document_snapshot.get("sha256") == capture.get("sha256")
            and document_snapshot.get("url") == capture.get("final_url")
        )
        license_review_complete = (
            license_snapshot_verified
            and review.get("license_snapshot_id") == snapshot_id
            and review.get("license_decision") in {"approved", "limited"}
            and bool(review.get("compliance_reviewer"))
            and bool(review.get("compliance_reviewed_at"))
        )
        professional_review_complete = (
            review.get("professional_review_status") == "approved"
            and bool(review.get("professional_reviewer"))
            and bool(review.get("professional_reviewed_at"))
        )
        resolved_values = {
            "SHA-256": capture.get("sha256"),
            "发布日期": capture.get("published_at"),
            "采集时间": capture.get("captured_at"),
            "许可快照": snapshot_id if license_snapshot_verified else None,
        }
        unresolved = [
            field
            for field in required_fields
            if not resolved_values[field] and str(item.get(field, "")).strip() in PLACEHOLDER_VALUES
        ]
        if str(item.get("行类型", "")).strip() == "示例" and not professional_review_complete:
            unresolved.append("行类型仍为示例")
        if (
            license_snapshot_verified
            and capture.get("license_status") != "approved"
            and not license_review_complete
        ):
            unresolved.append("许可结论待审")
        candidates.append(
            {
                "raw_id": raw_id,
                "country": item.get("国家"),
                "source_id": item.get("来源编号"),
                "verified_capture": bool(capture),
                "capture_record": capture.get("record_id"),
                "license_snapshot_id": snapshot_id or None,
                "license_snapshot_verified": license_snapshot_verified,
                "status": "candidate_incomplete" if unresolved else "candidate_ready_for_review",
                "unresolved": unresolved,
            }
        )
    return {
        "schema_version": 1,
        "status": (
            "candidate_ready_for_review"
            if candidates and all(not item["unresolved"] for item in candidates)
            else "incomplete"
        ),
        "purpose": "D0金标准样本缺口清单；禁止把示例行当作已复核事实",
        "required_professional_review": True,
        "candidates": candidates,
    }


def build_terminology_review_queue(contracts: dict[str, Any]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for item in contracts["enums"]:
        group = str(item.get("对象.字段", ""))
        groups[group].append(
            {
                "enum_id": str(item.get("枚举编号", "")),
                "code": str(item.get("代码值", "")),
                "zh_name": str(item.get("中文名称", "")),
            }
        )
    return {
        "schema_version": 1,
        "status": "pending_professional_review",
        "purpose": "D0术语复核队列；稳定代码不翻译，中文名称和跨语种译法需专业复核",
        "source_contract": "data/contracts/current/enums.json",
        "group_count": len(groups),
        "term_count": sum(len(items) for items in groups.values()),
        "groups": [
            {
                "object_field": group,
                "status": "pending_professional_review",
                "reviewer": None,
                "terms": sorted(items, key=lambda item: item["enum_id"]),
            }
            for group, items in sorted(groups.items())
        ],
    }


def build_conventions_candidate() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "status": "candidate_pending_approval",
        "purpose": "D0-02单位、货币、时区、精度与多语言规则候选",
        "rules": {
            "time": {
                "storage": "UTC语义的timestamptz",
                "preserve": ["来源当地时间", "IANA时区", "来源日期", "统计期"],
                "display": "按用户区域与业务时区显示，禁止浏览器时区静默改变业务含义",
                "source": "04-数据体系与数据采集.md:255,340,1042,1074",
            },
            "currency": {
                "preserve": ["原币种ISO代码", "原值"],
                "normalized": ["换算值", "汇率来源", "汇率类型", "基准日"],
                "constraint": "不同年度金额不得直接比较；名义价格与实际价格分开",
                "source": "03-页面交互与设计规范.md:774,1075,1239; 04-数据体系与数据采集.md:1077",
            },
            "unit": {
                "preserve": ["原值", "原单位", "换算系数", "原始精度"],
                "normalized": "使用批准的统一基础单位和单位代码",
                "constraint": "MW与MWh、AC与DC、额定与可用值不得混用",
                "source": "09-首批数据采集实施方案.md:118-119; 04-数据体系与数据采集.md:1076",
            },
            "precision": {
                "storage": "精确数值类型；格式化字符串不得作为计算依据",
                "constraint": "保留来源精度和换算规则，不得自动裁剪异常值",
                "source": "04-数据体系与数据采集.md:255,294,996,1076",
            },
            "language": {
                "encoding": "UTF-8",
                "principles": ["稳定代码不翻译", "原文不覆盖", "译文有状态", "缺失有回退"],
                "translation_status": [
                    "source",
                    "machine_translated",
                    "human_reviewed",
                    "stale",
                ],
                "constraint": "正式输出保留原文定位；机器翻译不得称为官方文本",
                "source": "04-数据体系与数据采集.md:238-255,1051-1064",
            },
        },
        "approval": {
            "product_owner": None,
            "data_owner": None,
            "language_reviewer": None,
            "approved_at": None,
        },
    }


def build_file_rules_candidate() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "status": "candidate_pending_approval",
        "source": "09-首批数据采集实施方案.md:164-184",
        "directories": [
            "data/l0_raw/{country}/{source_code}/{yyyy}/{mm}/{run_id}/",
            "data/l1_parsed/{entity}/{batch_id}/",
            "data/l2_standardized/{entity}/{batch_id}/",
            "data/l3_published/{release_id}/",
            "data/manifests/",
            "data/quality_reports/",
        ],
        "raw_filename": (
            "{country}_{source_code}_{document_type}_{published_date}_"
            "{source_id}_{content_hash8}.{ext}"
        ),
        "required_manifest_fields": [
            "original_url",
            "final_url",
            "organization",
            "title",
            "published_at",
            "captured_at",
            "access_method",
            "language",
            "mime_type",
            "byte_size",
            "sha256",
            "run_id",
            "license_snapshot_id",
            "parse_status",
            "retention_until",
        ],
        "approval": {"data_owner": None, "compliance_owner": None, "approved_at": None},
    }


def build_mapping_resolution_proposal() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "status": "decision_required",
        "warning": "候选处理不得直接改写冻结附件；每项需数据负责人批准并同步版本记录",
        "proposals": [
            {
                "mapping_id": "MAP-ISO3",
                "current_target": "country.iso3",
                "proposed_action": "replace_target",
                "proposed_target": "country.iso_code",
                "confidence": "high",
                "reason": "DATA-COUNTRY-001已冻结为country.iso_code，正文示例也使用该字段",
            },
            {
                "mapping_id": "MAP-COUNTRY-NAME",
                "current_target": "country.name_zh",
                "proposed_action": "domain_decision",
                "proposed_target": None,
                "confidence": "not_assessed",
                "reason": "正文采用国家本地化名称实体，冻结字段清单没有country.name_zh",
            },
            {
                "mapping_id": "MAP-POLICY-DATE",
                "current_target": "policy.published_at",
                "proposed_action": "add_or_model_field",
                "proposed_target": None,
                "confidence": "not_assessed",
                "reason": "published_at与已冻结effective_date语义不同，禁止直接互换",
            },
            {
                "mapping_id": "MAP-PROJECT-CAP",
                "current_target": "project.capacity_mw",
                "proposed_action": "add_or_model_field",
                "proposed_target": None,
                "confidence": "not_assessed",
                "reason": "需同时定义原值、原单位、标准值、标准单位和精度",
            },
            {
                "mapping_id": "MAP-AMOUNT",
                "current_target": "tender.budget_original",
                "proposed_action": "add_or_model_field",
                "proposed_target": None,
                "confidence": "not_assessed",
                "reason": "需同时定义原币、原值、换算值、汇率来源和基准日",
            },
            {
                "mapping_id": "MAP-ENTITY",
                "current_target": "partner.legal_name",
                "proposed_action": "domain_decision",
                "proposed_target": None,
                "confidence": "not_assessed",
                "reason": "需先明确伙伴展示实体与法律主体主数据边界",
            },
        ],
    }


def build_acceptance_assessment(
    contracts: dict[str, Any],
    *,
    template_trial: dict[str, Any] | None = None,
    gold_gap_report: dict[str, Any] | None = None,
    core_entity_evidence: dict[str, Any] | None = None,
    core_field_evidence: dict[str, Any] | None = None,
    enum_migration_evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    trial = template_trial or build_template_trial(contracts)
    gold = gold_gap_report or build_gold_standard_gap_report(contracts)
    entity_evidence = core_entity_evidence or build_core_entity_evidence(contracts)
    field_evidence = core_field_evidence or build_core_field_evidence(contracts)
    enum_evidence = enum_migration_evidence or build_enum_migration_evidence(contracts)

    unsigned_roles = [
        str(item.get("角色", ""))
        for item in contracts["responsibilities"]
        if not item.get("姓名") or str(item.get("状态", "")) != "已签署"
    ]
    incomplete_tasks = [
        str(item.get("任务编号", ""))
        for item in contracts["d0_tasks"]
        if str(item.get("状态", "")) not in {"已完成", "完成"}
    ]

    assessments = [
        {
            "acceptance_id": "D0-AC-001",
            "machine_status": entity_evidence["machine_status"],
            "human_status": "pending",
            "findings": entity_evidence["findings"],
            "summary": "核心实体代码、主键覆盖、关系键、权威记录和约束机器检查",
            "candidate_evidence": "core_entity_evidence.json",
        },
        {
            "acceptance_id": "D0-AC-002",
            "machine_status": field_evidence["machine_status"],
            "human_status": "pending",
            "findings": field_evidence["findings"],
            "summary": "核心字段代码、类型、单位、空值和来源规则机器检查",
            "candidate_evidence": "core_field_evidence.json",
        },
        {
            "acceptance_id": "D0-AC-003",
            "machine_status": enum_evidence["machine_status"],
            "human_status": "pending",
            "findings": enum_evidence["findings"],
            "summary": "状态枚举中文、代码互斥、转向元数据和迁移记录机器检查",
            "candidate_evidence": "enum_migration_evidence.json",
        },
        {
            "acceptance_id": "D0-AC-004",
            "machine_status": "candidate_generated",
            "human_status": "pending",
            "findings": ["conventions.json待产品、数据和语言审校批准"],
            "summary": "已从冻结正文生成单位、货币、时区、精度和多语言候选规则",
        },
        {
            "acceptance_id": "D0-AC-005",
            "machine_status": trial["status"],
            "human_status": "pending",
            "findings": [failure for check in trial["checks"] for failure in check["failures"]],
            "summary": "来源、批次、原始资料和字段映射跨模板试填",
        },
        {
            "acceptance_id": "D0-AC-006",
            "machine_status": gold["status"],
            "human_status": "pending",
            "findings": [
                {"raw_id": item["raw_id"], "unresolved": item["unresolved"]}
                for item in gold["candidates"]
                if item["unresolved"]
            ],
            "summary": "金标准样本仍含占位值；45组/251条术语已进入专业复核队列",
        },
        {
            "acceptance_id": "D0-AC-007",
            "machine_status": "fail" if unsigned_roles else "pass",
            "human_status": "pending",
            "findings": unsigned_roles,
            "summary": "实名责任人和替补签署检查",
        },
        {
            "acceptance_id": "D0-AC-008",
            "machine_status": "candidate_generated",
            "human_status": "pending",
            "findings": ["file_rules.json待数据和合规负责人批准"],
            "summary": "版本哈希、证据清单和原始文件命名规则候选已生成",
        },
        {
            "acceptance_id": "D0-AC-009",
            "machine_status": "fail" if incomplete_tasks else "pass",
            "human_status": "pending",
            "findings": incomplete_tasks,
            "summary": "D0任务和阻塞状态检查",
        },
        {
            "acceptance_id": "D0-AC-010",
            "machine_status": "blocked",
            "human_status": "pending",
            "findings": ["项目批准人尚未签署D0通过结论"],
            "summary": "最终D0结论只能由项目批准人签署",
        },
    ]
    return {
        "schema_version": 1,
        "overall_status": "not_ready",
        "automated_assessment_only": True,
        "warning": "机器检查不能代替专业复核、责任签署或项目批准",
        "assessments": assessments,
    }


def candidate_payloads(paths: RepositoryPaths) -> dict[str, dict[str, Any]]:
    contracts = extract_contracts(paths)
    template_trial = build_template_trial(contracts)
    gold_gap = build_gold_standard_gap_report(
        contracts,
        load_research_captures(paths),
        license_snapshots=load_license_snapshots(paths),
    )
    source_binding = {
        "baseline_version": "V1.0-BASELINE",
        "d0_workbook": {
            "path": paths.d0_workbook.relative_to(paths.root).as_posix(),
            "sha256": sha256_file(paths.d0_workbook),
        },
        "technical_workbook": {
            "path": paths.technical_workbook.relative_to(paths.root).as_posix(),
            "sha256": sha256_file(paths.technical_workbook),
        },
    }
    core_evidence_payloads = {
        "core_entity_evidence.json": build_core_entity_evidence(
            contracts,
            source_binding=source_binding,
        ),
        "core_field_evidence.json": build_core_field_evidence(
            contracts,
            source_binding=source_binding,
        ),
        "enum_migration_evidence.json": build_enum_migration_evidence(
            contracts,
            source_binding=source_binding,
        ),
    }
    payloads = {
        "acceptance_assessment.json": build_acceptance_assessment(
            contracts,
            template_trial=template_trial,
            gold_gap_report=gold_gap,
            core_entity_evidence=core_evidence_payloads["core_entity_evidence.json"],
            core_field_evidence=core_evidence_payloads["core_field_evidence.json"],
            enum_migration_evidence=core_evidence_payloads["enum_migration_evidence.json"],
        ),
        "conventions.json": build_conventions_candidate(),
        **core_evidence_payloads,
        "machine_evidence_review_queue.json": build_machine_evidence_review_queue(
            core_evidence_payloads
        ),
        "file_rules.json": build_file_rules_candidate(),
        "gold_standard_gap_report.json": gold_gap,
        "mapping_resolution_proposal.json": build_mapping_resolution_proposal(),
        "template_trial_report.json": template_trial,
        "terminology_review_queue.json": build_terminology_review_queue(contracts),
    }
    return payloads


def write_candidates(paths: RepositoryPaths) -> list[Path]:
    paths.d0_candidates_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for filename, payload in candidate_payloads(paths).items():
        destination = paths.d0_candidates_dir / filename
        destination.write_bytes(_candidate_json_bytes(payload))
        written.append(destination)
    return written
