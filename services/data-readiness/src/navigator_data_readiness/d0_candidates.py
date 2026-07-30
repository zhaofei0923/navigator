from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from .baseline import extract_contracts
from .paths import RepositoryPaths

PLACEHOLDER_VALUES = {"", "待填", "待复核", "待确认", "未执行"}


def load_research_captures(paths: RepositoryPaths) -> list[dict[str, Any]]:
    if not paths.d0_research_dir.exists():
        return []
    captures: list[dict[str, Any]] = []
    for path in sorted(paths.d0_research_dir.glob("*_capture.json")):
        captures.append(json.loads(path.read_text(encoding="utf-8")))
    return captures


def build_template_trial(contracts: dict[str, Any]) -> dict[str, Any]:
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

    mapping_failures = sorted(
        (
            {
                "mapping_id": str(item.get("映射编号", "")),
                "target": str(item.get("目标实体.字段", "")),
            }
            for item in contracts["field_mapping_template"]
            if str(item.get("目标实体.字段", "")) not in fields
        ),
        key=lambda item: item["mapping_id"],
    )
    checks.append(
        {
            "check_id": "TRIAL-MAPPING-TARGET",
            "description": "字段映射目标必须存在于冻结字段清单",
            "status": "pass" if not mapping_failures else "fail",
            "failures": mapping_failures,
        }
    )

    return {
        "schema_version": 1,
        "status": "pass" if all(item["status"] == "pass" for item in checks) else "fail",
        "purpose": "D0模板交叉试填；不进入正式库，不代表来源准入或数据发布",
        "checks": checks,
    }


def build_gold_standard_gap_report(
    contracts: dict[str, Any],
    captures: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    required_fields = ("SHA-256", "发布日期", "采集时间", "许可快照")
    captures_by_raw_id = {
        str(item.get("raw_id", "")): item for item in (captures or []) if item.get("raw_id")
    }
    candidates: list[dict[str, Any]] = []
    for item in contracts["raw_asset_template"]:
        raw_id = str(item.get("原始编号", ""))
        capture = captures_by_raw_id.get(raw_id, {})
        resolved_values = {
            "SHA-256": capture.get("sha256"),
            "发布日期": capture.get("published_at"),
            "采集时间": capture.get("captured_at"),
            "许可快照": (
                capture.get("license_snapshot_id")
                if capture.get("license_status") == "approved"
                else None
            ),
        }
        unresolved = [
            field
            for field in required_fields
            if not resolved_values[field] and str(item.get(field, "")).strip() in PLACEHOLDER_VALUES
        ]
        if str(item.get("行类型", "")).strip() == "示例":
            unresolved.append("行类型仍为示例")
        candidates.append(
            {
                "raw_id": raw_id,
                "country": item.get("国家"),
                "source_id": item.get("来源编号"),
                "verified_capture": bool(capture),
                "capture_record": capture.get("record_id"),
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
) -> dict[str, Any]:
    trial = template_trial or build_template_trial(contracts)
    gold = gold_gap_report or build_gold_standard_gap_report(contracts)

    relation_required = (
        "关系编号",
        "父实体",
        "子实体",
        "基数",
        "外键/唯一键",
        "权威记录",
        "关键约束",
    )
    relation_gaps = [
        str(item.get("关系编号", ""))
        for item in contracts["entities"]
        if any(not str(item.get(field, "")).strip() for field in relation_required)
    ]

    field_required = (
        "字段编号",
        "实体",
        "字段名",
        "类型",
        "必填",
        "敏感级别",
        "来源要求",
        "更新规则",
    )
    field_gaps = [
        str(item.get("字段编号", ""))
        for item in contracts["fields"]
        if any(not str(item.get(field, "")).strip() for field in field_required)
    ]
    field_keys = [f"{item.get('实体')}.{item.get('字段名')}" for item in contracts["fields"]]
    duplicate_field_keys = sorted(key for key in set(field_keys) if field_keys.count(key) > 1)

    enum_keys = [f"{item.get('对象.字段')}::{item.get('代码值')}" for item in contracts["enums"]]
    duplicate_enum_keys = sorted(key for key in set(enum_keys) if enum_keys.count(key) > 1)

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
            "machine_status": "pass" if not relation_gaps else "fail",
            "human_status": "pending",
            "findings": relation_gaps,
            "summary": "25条核心关系的编号、主子实体、键、权威记录和关键约束机器检查",
        },
        {
            "acceptance_id": "D0-AC-002",
            "machine_status": "pass" if not field_gaps and not duplicate_field_keys else "fail",
            "human_status": "pending",
            "findings": field_gaps + duplicate_field_keys,
            "summary": "92个字段的唯一标识、类型、必填、敏感、来源和更新规则机器检查",
        },
        {
            "acceptance_id": "D0-AC-003",
            "machine_status": "pass" if not duplicate_enum_keys else "fail",
            "human_status": "pending",
            "findings": duplicate_enum_keys,
            "summary": "251条枚举的对象内代码唯一性机器检查；迁移语义仍需业务复核",
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
    gold_gap = build_gold_standard_gap_report(contracts, load_research_captures(paths))
    return {
        "acceptance_assessment.json": build_acceptance_assessment(
            contracts,
            template_trial=template_trial,
            gold_gap_report=gold_gap,
        ),
        "conventions.json": build_conventions_candidate(),
        "file_rules.json": build_file_rules_candidate(),
        "gold_standard_gap_report.json": gold_gap,
        "mapping_resolution_proposal.json": build_mapping_resolution_proposal(),
        "template_trial_report.json": template_trial,
        "terminology_review_queue.json": build_terminology_review_queue(contracts),
    }


def write_candidates(paths: RepositoryPaths) -> list[Path]:
    paths.d0_candidates_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for filename, payload in candidate_payloads(paths).items():
        destination = paths.d0_candidates_dir / filename
        destination.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        written.append(destination)
    return written
