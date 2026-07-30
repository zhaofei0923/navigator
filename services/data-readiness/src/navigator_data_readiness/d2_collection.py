from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .baseline import extract_contracts, sha256_file
from .models import CheckResult
from .paths import RepositoryPaths

RUN_STATES = {"planned", "running", "succeeded", "partial", "failed", "stopped"}
TERMINAL_RUN_STATES = {"succeeded", "partial", "failed", "stopped"}
BATCH_STATES = {"planned", "open", "blocked", "closed"}
JOB_STATES = {"planned", "enabled", "paused", "retired"}

STOP_SIGNALS: dict[str, dict[str, Any]] = {
    "none": {"must_stop": False, "retry_allowed": True},
    "auth_required": {"must_stop": True, "retry_allowed": False},
    "forbidden": {"must_stop": True, "retry_allowed": False},
    "captcha": {"must_stop": True, "retry_allowed": False},
    "paywall": {"must_stop": True, "retry_allowed": False},
    "geo_restricted": {"must_stop": True, "retry_allowed": False},
    "terms_changed": {"must_stop": True, "retry_allowed": False},
    "robots_blocked": {"must_stop": True, "retry_allowed": False},
    "legal_notice": {"must_stop": True, "retry_allowed": False},
    "personal_data_overreach": {"must_stop": True, "retry_allowed": False},
    "domain_changed": {"must_stop": True, "retry_allowed": False},
    "schema_drift": {"must_stop": True, "retry_allowed": False},
}

INCIDENT_TYPES = set(STOP_SIGNALS) - {"none"} | {
    "network",
    "timeout",
    "rate_limited",
    "server_error",
    "malware",
    "mime_mismatch",
    "checksum_mismatch",
    "partial_page",
}

DOMAIN_RULES = {
    "政策法规": ["COL-POLICY-001", "COL-WEB-001"],
    "项目招标": ["COL-PROJECT-001", "COL-TENDER-001", "COL-WEB-001"],
    "能源市场": ["COL-METRIC-001", "COL-WEB-001"],
}

SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


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
            "collection_batch_template",
            "collection_rules",
            "data_issue_template",
            "raw_asset_template",
            "source_registry_seed",
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
        "d2_input_sha256": _payload_sha256(relevant),
    }


def _job_from_batch(item: dict[str, Any]) -> dict[str, Any]:
    batch_id = str(item["批次编号"])
    domain = str(item["数据域"])
    return {
        "job_id": f"JOB-{batch_id}",
        "batch_id": batch_id,
        "source_id": item.get("来源编号"),
        "country": item.get("国家"),
        "data_domain": domain,
        "rule_ids": DOMAIN_RULES.get(domain, []),
        "owner_role": item.get("责任人"),
        "connector_type": "pending",
        "connector_version": None,
        "schedule": None,
        "schedule_timezone": None,
        "scope": {},
        "watermark_strategy": None,
        "idempotency_key_template": None,
        "deduplication_key_template": None,
        "rate_limit": None,
        "timeout_seconds": None,
        "max_retries": None,
        "retry_policy": None,
        "schema_fingerprint": None,
        "user_agent_policy": None,
        "stop_signals": sorted(set(STOP_SIGNALS) - {"none"}),
        "failure_action": "暂停并登记异常；失败不得推进成功水位",
        "access_control_bypass_prohibited": True,
        "status": "planned",
    }


def _batch_from_contract(item: dict[str, Any]) -> dict[str, Any]:
    batch_id = str(item["批次编号"])
    return {
        "batch_id": batch_id,
        "job_id": f"JOB-{batch_id}",
        "source_id": item.get("来源编号"),
        "country": item.get("国家"),
        "data_domain": item.get("数据域"),
        "owner_role": item.get("责任人"),
        "run_ids": [],
        "raw_object_ids": [],
        "incident_ids": [],
        "manifest_sha256": None,
        "reviewed_by": None,
        "reviewed_at": None,
        "evidence_ids": [],
        "status": "planned",
    }


def build_d2_bundle_template(paths: RepositoryPaths) -> dict[str, Any]:
    contracts = extract_contracts(paths)
    batches = contracts["collection_batch_template"]
    return {
        "schema_version": 1,
        "stage": "D2",
        "template_only": True,
        "append_only": True,
        "warning": "L0原始对象不可原地改写；访问拒绝、验证码、条款或模式漂移必须停止并留证",
        "baseline": _baseline(paths, contracts),
        "dependencies": {
            "d1_gate_status": "pending",
            "d1_gate_evidence_id": None,
        },
        "jobs": [_job_from_batch(item) for item in batches],
        "batches": [_batch_from_contract(item) for item in batches],
        "runs": [],
        "raw_objects": [],
        "incidents": [],
    }


def build_stop_signal_catalog() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "stage": "D2",
        "signals": [{"signal": signal, **rule} for signal, rule in sorted(STOP_SIGNALS.items())],
        "mandatory_behavior": {
            "access_or_legal_signal": "停止自动化、保持水位、登记异常、来源转复核",
            "schema_drift": "保存旧新schema与原始证据、暂停映射和发布",
            "forbidden_actions": [
                "验证码破解",
                "凭证猜测",
                "身份伪造",
                "代理轮换规避封禁",
                "绕过登录或付费墙",
            ],
        },
    }


def build_d2_assessment(paths: RepositoryPaths) -> dict[str, Any]:
    bundle = build_d2_bundle_template(paths)
    return {
        "schema_version": 1,
        "stage": "D2",
        "overall_status": "not_ready",
        "automated_assessment_only": True,
        "checks": [
            {
                "check_id": "D2-D1-DEPENDENCY",
                "status": "fail",
                "finding": "D1准入结论尚未批准",
            },
            {
                "check_id": "D2-JOB-CONTRACTS",
                "status": "candidate_generated",
                "finding": f"{len(bundle['jobs'])}个冻结批次已生成采集任务候选",
            },
            {
                "check_id": "D2-RUN-EVIDENCE",
                "status": "fail",
                "finding": "尚无实际运行、请求响应摘要或水位证据",
            },
            {
                "check_id": "D2-L0-RAW",
                "status": "fail",
                "finding": "尚无不可变L0原始对象清单",
            },
            {
                "check_id": "D2-BATCH-CLOSURE",
                "status": "fail",
                "finding": "6个批次均未关闭",
            },
        ],
    }


def d2_candidate_payloads(paths: RepositoryPaths) -> dict[str, dict[str, Any]]:
    return {
        "d2_acceptance_assessment.json": build_d2_assessment(paths),
        "d2_collection_bundle.template.json": build_d2_bundle_template(paths),
        "stop_signal_catalog.json": build_stop_signal_catalog(),
    }


def write_d2_candidates(paths: RepositoryPaths) -> list[Path]:
    paths.d2_candidates_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for filename, payload in d2_candidate_payloads(paths).items():
        destination = paths.d2_candidates_dir / filename
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
                code="D2_SECTION_INVALID",
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
                    code="D2_ENTRY_INVALID",
                    message=f"{section}[{index}] requires {identifier}",
                    location=section,
                )
            )
            continue
        value = str(item[identifier]).strip()
        if value in indexed:
            checks.append(
                CheckResult(
                    code="D2_ENTRY_DUPLICATE",
                    message=f"Duplicate {identifier}: {value}",
                    location=section,
                )
            )
            continue
        indexed[value] = item
    return indexed


def _validate_job(
    checks: list[CheckResult],
    job_id: str,
    item: dict[str, Any],
) -> None:
    location = f"jobs.{job_id}"
    if item.get("status") not in JOB_STATES:
        checks.append(
            CheckResult(
                code="D2_JOB_STATUS_INVALID",
                message=f"{job_id} has invalid status",
                location=location,
            )
        )
    if item.get("access_control_bypass_prohibited") is not True:
        checks.append(
            CheckResult(
                code="D2_JOB_BYPASS_PROHIBITION_MISSING",
                message=f"{job_id} must prohibit bypassing access controls",
                location=location,
            )
        )
    if item.get("status") != "enabled":
        checks.append(
            CheckResult(
                code="D2_JOB_NOT_ENABLED",
                message=f"{job_id} must be enabled for D2 acceptance",
                location=location,
            )
        )
        return
    _required_text(
        checks,
        item,
        (
            "connector_type",
            "connector_version",
            "schedule",
            "schedule_timezone",
            "watermark_strategy",
            "idempotency_key_template",
            "deduplication_key_template",
            "rate_limit",
            "retry_policy",
            "schema_fingerprint",
            "user_agent_policy",
        ),
        code="D2_JOB_CONFIG_INCOMPLETE",
        location=location,
    )
    timeout = item.get("timeout_seconds")
    retries = item.get("max_retries")
    if not isinstance(timeout, int) or timeout <= 0:
        checks.append(
            CheckResult(
                code="D2_JOB_TIMEOUT_INVALID",
                message=f"{job_id} timeout_seconds must be a positive integer",
                location=location,
            )
        )
    if not isinstance(retries, int) or retries < 0 or retries > 3:
        checks.append(
            CheckResult(
                code="D2_JOB_RETRY_INVALID",
                message=f"{job_id} max_retries must be between 0 and 3",
                location=location,
            )
        )
    required_signals = set(STOP_SIGNALS) - {"none"}
    if set(item.get("stop_signals", [])) != required_signals:
        checks.append(
            CheckResult(
                code="D2_JOB_STOP_SIGNALS_INCOMPLETE",
                message=f"{job_id} must retain every mandatory stop signal",
                location=location,
            )
        )
    if not SHA256_PATTERN.fullmatch(str(item.get("schema_fingerprint") or "")):
        checks.append(
            CheckResult(
                code="D2_JOB_SCHEMA_HASH_INVALID",
                message=f"{job_id} requires a lowercase schema SHA-256",
                location=location,
            )
        )


def _validate_run(
    checks: list[CheckResult],
    run_id: str,
    item: dict[str, Any],
    jobs: dict[str, dict[str, Any]],
    incidents: dict[str, dict[str, Any]],
) -> None:
    location = f"runs.{run_id}"
    job_id = str(item.get("job_id") or "")
    job = jobs.get(job_id)
    if job is None:
        checks.append(
            CheckResult(
                code="D2_RUN_JOB_UNKNOWN",
                message=f"{run_id} references unknown job {job_id}",
                location=location,
            )
        )
    elif any(item.get(field) != job.get(field) for field in ("batch_id", "source_id", "country")):
        checks.append(
            CheckResult(
                code="D2_RUN_JOB_MISMATCH",
                message=f"{run_id} source, country, or batch differs from its job",
                location=location,
            )
        )
    status = item.get("status")
    if status not in RUN_STATES:
        checks.append(
            CheckResult(
                code="D2_RUN_STATUS_INVALID",
                message=f"{run_id} has invalid status",
                location=location,
            )
        )
        return
    if status in TERMINAL_RUN_STATES:
        _required_text(
            checks,
            item,
            (
                "started_at",
                "finished_at",
                "connector_version",
                "parameters_sha256",
                "watermark_before",
                "observed_watermark",
                "committed_watermark",
            ),
            code="D2_RUN_TERMINAL_METADATA_INCOMPLETE",
            location=location,
        )
        if not SHA256_PATTERN.fullmatch(str(item.get("parameters_sha256") or "")):
            checks.append(
                CheckResult(
                    code="D2_RUN_PARAMETERS_HASH_INVALID",
                    message=f"{run_id} requires a lowercase parameters SHA-256",
                    location=location,
                )
            )
    if item.get("secret_material_logged") is not False:
        checks.append(
            CheckResult(
                code="D2_RUN_SECRET_LOGGING_UNSAFE",
                message=(
                    f"{run_id} must explicitly confirm no cookie, token, or password was logged"
                ),
                location=location,
            )
        )
    signal = item.get("access_signal")
    if signal not in STOP_SIGNALS:
        checks.append(
            CheckResult(
                code="D2_RUN_SIGNAL_INVALID",
                message=f"{run_id} has invalid access_signal",
                location=location,
            )
        )
    status_code = item.get("http_status")
    if status_code in {401, 403} and signal not in {"auth_required", "forbidden"}:
        checks.append(
            CheckResult(
                code="D2_RUN_HTTP_SIGNAL_MISMATCH",
                message=f"{run_id} HTTP {status_code} requires an access stop signal",
                location=location,
            )
        )
    if signal in STOP_SIGNALS and STOP_SIGNALS[str(signal)]["must_stop"]:
        if (
            status not in {"failed", "partial", "stopped"}
            or item.get("automation_stopped") is not True
        ):
            checks.append(
                CheckResult(
                    code="D2_RUN_STOP_NOT_ENFORCED",
                    message=f"{run_id} stop signal did not stop automation",
                    location=location,
                )
            )
        if item.get("retry_count") not in {0, None}:
            checks.append(
                CheckResult(
                    code="D2_RUN_FORBIDDEN_RETRY",
                    message=f"{run_id} retried after a non-retryable stop signal",
                    location=location,
                )
            )
        incident_id = str(item.get("incident_id") or "")
        if incident_id not in incidents:
            checks.append(
                CheckResult(
                    code="D2_RUN_INCIDENT_MISSING",
                    message=f"{run_id} stop signal requires a registered incident",
                    location=location,
                )
            )
        else:
            incident = incidents[incident_id]
            if incident.get("run_id") != run_id or incident.get("incident_type") != signal:
                checks.append(
                    CheckResult(
                        code="D2_RUN_INCIDENT_MISMATCH",
                        message=f"{run_id} incident does not match the run and stop signal",
                        location=location,
                    )
                )
    if status in {"failed", "partial", "stopped"} and (
        item.get("committed_watermark") != item.get("watermark_before")
    ):
        checks.append(
            CheckResult(
                code="D2_RUN_FAILURE_ADVANCED_WATERMARK",
                message=f"{run_id} advanced the committed watermark after an unsuccessful run",
                location=location,
            )
        )
    if job and isinstance(item.get("retry_count"), int):
        max_retries = job.get("max_retries")
        if isinstance(max_retries, int) and item["retry_count"] > max_retries:
            checks.append(
                CheckResult(
                    code="D2_RUN_RETRY_LIMIT_EXCEEDED",
                    message=f"{run_id} exceeded the job retry limit",
                    location=location,
                )
            )


def _validate_raw_object(
    checks: list[CheckResult],
    raw_id: str,
    item: dict[str, Any],
    runs: dict[str, dict[str, Any]],
) -> None:
    location = f"raw_objects.{raw_id}"
    run_id = str(item.get("run_id") or "")
    run = runs.get(run_id)
    if run is None:
        checks.append(
            CheckResult(
                code="D2_RAW_RUN_UNKNOWN",
                message=f"{raw_id} references unknown run {run_id}",
                location=location,
            )
        )
    elif any(
        item.get(field) != run.get(field)
        for field in ("job_id", "batch_id", "source_id", "country")
    ):
        checks.append(
            CheckResult(
                code="D2_RAW_RUN_MISMATCH",
                message=f"{raw_id} lineage differs from its run",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        (
            "original_url",
            "final_url",
            "organization",
            "title",
            "captured_at",
            "access_method",
            "language",
            "encoding",
            "mime_type",
            "sha256",
            "storage_object_id",
            "encryption_status",
            "malware_scan_status",
            "parse_status",
            "license_snapshot_id",
            "access_level",
            "retention_until",
            "response_metadata_sha256",
        ),
        code="D2_RAW_METADATA_INCOMPLETE",
        location=location,
    )
    if item.get("immutable") is not True or item.get("original_bytes_preserved") is not True:
        checks.append(
            CheckResult(
                code="D2_RAW_IMMUTABILITY_MISSING",
                message=f"{raw_id} must preserve immutable original bytes",
                location=location,
            )
        )
    if item.get("cookie_or_token_logged") is not False:
        checks.append(
            CheckResult(
                code="D2_RAW_SECRET_LOGGING_UNSAFE",
                message=f"{raw_id} must not store cookies or tokens in general metadata",
                location=location,
            )
        )
    if not isinstance(item.get("byte_size"), int) or item["byte_size"] <= 0:
        checks.append(
            CheckResult(
                code="D2_RAW_SIZE_INVALID",
                message=f"{raw_id} byte_size must be positive",
                location=location,
            )
        )
    if not SHA256_PATTERN.fullmatch(str(item.get("sha256") or "")):
        checks.append(
            CheckResult(
                code="D2_RAW_HASH_INVALID",
                message=f"{raw_id} requires a lowercase SHA-256",
                location=location,
            )
        )
    if not SHA256_PATTERN.fullmatch(str(item.get("response_metadata_sha256") or "")):
        checks.append(
            CheckResult(
                code="D2_RAW_RESPONSE_HASH_INVALID",
                message=f"{raw_id} requires a lowercase response-metadata SHA-256",
                location=location,
            )
        )
    for field in ("original_url", "final_url"):
        parsed = urlparse(str(item.get(field) or ""))
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            checks.append(
                CheckResult(
                    code="D2_RAW_URL_INVALID",
                    message=f"{raw_id} has invalid {field}",
                    location=location,
                )
            )


def _validate_incident(
    checks: list[CheckResult],
    incident_id: str,
    item: dict[str, Any],
    runs: dict[str, dict[str, Any]],
) -> None:
    location = f"incidents.{incident_id}"
    run_id = str(item.get("run_id") or "")
    if run_id not in runs:
        checks.append(
            CheckResult(
                code="D2_INCIDENT_RUN_UNKNOWN",
                message=f"{incident_id} references unknown run {run_id}",
                location=location,
            )
        )
    if item.get("incident_type") not in INCIDENT_TYPES:
        checks.append(
            CheckResult(
                code="D2_INCIDENT_TYPE_INVALID",
                message=f"{incident_id} has invalid incident_type",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        (
            "severity",
            "detected_at",
            "owner",
            "status",
            "action",
        ),
        code="D2_INCIDENT_METADATA_INCOMPLETE",
        location=location,
    )
    if item.get("bypass_attempted") is not False:
        checks.append(
            CheckResult(
                code="D2_INCIDENT_BYPASS_UNSAFE",
                message=f"{incident_id} must confirm no bypass was attempted",
                location=location,
            )
        )
    if item.get("incident_type") == "schema_drift" and (
        item.get("mapping_paused") is not True or item.get("raw_evidence_preserved") is not True
    ):
        checks.append(
            CheckResult(
                code="D2_DRIFT_CONTROLS_MISSING",
                message=f"{incident_id} schema drift must pause mapping and preserve raw evidence",
                location=location,
            )
        )


def _validate_batch(
    checks: list[CheckResult],
    batch_id: str,
    item: dict[str, Any],
    jobs: dict[str, dict[str, Any]],
    runs: dict[str, dict[str, Any]],
    raw_objects: dict[str, dict[str, Any]],
    incidents: dict[str, dict[str, Any]],
) -> None:
    location = f"batches.{batch_id}"
    job_id = str(item.get("job_id") or "")
    job = jobs.get(job_id)
    if job is None or any(
        item.get(field) != job.get(field)
        for field in ("batch_id", "source_id", "country", "data_domain")
    ):
        checks.append(
            CheckResult(
                code="D2_BATCH_JOB_MISMATCH",
                message=f"{batch_id} does not match its job",
                location=location,
            )
        )
    if item.get("status") not in BATCH_STATES:
        checks.append(
            CheckResult(
                code="D2_BATCH_STATUS_INVALID",
                message=f"{batch_id} has invalid status",
                location=location,
            )
        )
        return
    run_ids = item.get("run_ids")
    raw_ids = item.get("raw_object_ids")
    incident_ids = item.get("incident_ids")
    if (
        not isinstance(run_ids, list)
        or not isinstance(raw_ids, list)
        or not isinstance(incident_ids, list)
    ):
        checks.append(
            CheckResult(
                code="D2_BATCH_REFERENCES_INVALID",
                message=f"{batch_id} run/raw/incident references must be lists",
                location=location,
            )
        )
        return
    for referenced_id, registry, code in (
        *((value, runs, "D2_BATCH_RUN_UNKNOWN") for value in run_ids),
        *((value, raw_objects, "D2_BATCH_RAW_UNKNOWN") for value in raw_ids),
        *((value, incidents, "D2_BATCH_INCIDENT_UNKNOWN") for value in incident_ids),
    ):
        if referenced_id not in registry:
            checks.append(
                CheckResult(
                    code=code,
                    message=f"{batch_id} references unknown {referenced_id}",
                    location=location,
                )
            )
        elif registry[referenced_id].get("batch_id") != batch_id:
            checks.append(
                CheckResult(
                    code="D2_BATCH_LINEAGE_MISMATCH",
                    message=f"{referenced_id} belongs to a different batch",
                    location=location,
                )
            )
    if item.get("status") != "closed":
        checks.append(
            CheckResult(
                code="D2_BATCH_NOT_CLOSED",
                message=f"{batch_id} has not completed closure review",
                location=location,
            )
        )
        return
    batch_runs = [runs[run_id] for run_id in run_ids if run_id in runs]
    batch_raw = [raw_objects[raw_id] for raw_id in raw_ids if raw_id in raw_objects]
    if not any(run.get("status") == "succeeded" for run in batch_runs) or not batch_raw:
        checks.append(
            CheckResult(
                code="D2_BATCH_OUTPUT_INCOMPLETE",
                message=f"{batch_id} closure requires a successful run and raw objects",
                location=location,
            )
        )
    _required_text(
        checks,
        item,
        ("manifest_sha256", "reviewed_by", "reviewed_at"),
        code="D2_BATCH_CLOSURE_INCOMPLETE",
        location=location,
    )
    if not SHA256_PATTERN.fullmatch(str(item.get("manifest_sha256") or "")):
        checks.append(
            CheckResult(
                code="D2_BATCH_MANIFEST_HASH_INVALID",
                message=f"{batch_id} requires a lowercase manifest SHA-256",
                location=location,
            )
        )
    if not item.get("evidence_ids"):
        checks.append(
            CheckResult(
                code="D2_BATCH_EVIDENCE_MISSING",
                message=f"{batch_id} closure requires evidence IDs",
                location=location,
            )
        )


def _index_d1_sources(
    checks: list[CheckResult],
    registry: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    sources = registry.get("sources")
    if not isinstance(sources, list):
        checks.append(
            CheckResult(
                code="D2_D1_REGISTRY_INVALID",
                message="D1 registry sources must be a list",
                location="d1_registry",
            )
        )
        return {}
    indexed: dict[str, dict[str, Any]] = {}
    for item in sources:
        if isinstance(item, dict) and item.get("source_id"):
            indexed[str(item["source_id"])] = item
    return indexed


def validate_d2_bundle(
    paths: RepositoryPaths,
    bundle: dict[str, Any],
    d1_registry: dict[str, Any],
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    current = build_d2_bundle_template(paths)
    if bundle.get("schema_version") != 1 or bundle.get("stage") != "D2":
        checks.append(
            CheckResult(
                code="D2_HEADER_INVALID",
                message="Bundle requires schema_version 1 and stage D2",
                location="bundle",
            )
        )
    if bundle.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="D2_TEMPLATE_UNCOPIED",
                message="Copy the D2 template and set template_only to false",
                location="template_only",
            )
        )
    if bundle.get("append_only") is not True:
        checks.append(
            CheckResult(
                code="D2_APPEND_ONLY_MISSING",
                message="D2 bundle must declare append_only true",
                location="append_only",
            )
        )
    if bundle.get("baseline") != current["baseline"]:
        checks.append(
            CheckResult(
                code="D2_BASELINE_STALE",
                message="D2 baseline does not match current frozen inputs",
                location="baseline",
            )
        )
    dependencies = bundle.get("dependencies")
    if not isinstance(dependencies, dict) or (
        dependencies.get("d1_gate_status") != "approved"
        or not dependencies.get("d1_gate_evidence_id")
    ):
        checks.append(
            CheckResult(
                code="D2_D1_DEPENDENCY_PENDING",
                message="D1 gate approval and evidence are required before D2 execution",
                location="dependencies",
            )
        )

    jobs = _index(checks, bundle, "jobs", "job_id")
    batches = _index(checks, bundle, "batches", "batch_id")
    runs = _index(checks, bundle, "runs", "run_id")
    raw_objects = _index(checks, bundle, "raw_objects", "raw_id")
    incidents = _index(checks, bundle, "incidents", "incident_id")
    expected_jobs = {str(item["job_id"]): item for item in current["jobs"]}
    expected_batches = {str(item["batch_id"]): item for item in current["batches"]}
    if set(jobs) != set(expected_jobs):
        checks.append(
            CheckResult(
                code="D2_JOB_SET_INVALID",
                message="D2 jobs must retain all and only frozen seed jobs",
                location="jobs",
            )
        )
    if set(batches) != set(expected_batches):
        checks.append(
            CheckResult(
                code="D2_BATCH_SET_INVALID",
                message="D2 batches must retain all and only frozen seed batches",
                location="batches",
            )
        )
    for job_id, item in jobs.items():
        expected = expected_jobs.get(job_id)
        if expected and any(
            item.get(field) != expected.get(field)
            for field in (
                "batch_id",
                "source_id",
                "country",
                "data_domain",
                "rule_ids",
                "owner_role",
            )
        ):
            checks.append(
                CheckResult(
                    code="D2_JOB_INPUT_CHANGED",
                    message=f"{job_id} frozen inputs were changed",
                    location=f"jobs.{job_id}",
                )
            )
        _validate_job(checks, job_id, item)

    d1_sources = _index_d1_sources(checks, d1_registry)
    for job_id, item in jobs.items():
        source_id = str(item.get("source_id") or "")
        source = d1_sources.get(source_id)
        if source is None or source.get("status") != "active":
            checks.append(
                CheckResult(
                    code="D2_SOURCE_NOT_ACTIVE",
                    message=f"{job_id} source {source_id} is not active in D1",
                    location=f"jobs.{job_id}",
                )
            )

    for incident_id, item in incidents.items():
        _validate_incident(checks, incident_id, item, runs)
    for run_id, item in runs.items():
        _validate_run(checks, run_id, item, jobs, incidents)
    for raw_id, item in raw_objects.items():
        _validate_raw_object(checks, raw_id, item, runs)
    for batch_id, item in batches.items():
        _validate_batch(
            checks,
            batch_id,
            item,
            jobs,
            runs,
            raw_objects,
            incidents,
        )

    storage_ids = [
        str(item.get("storage_object_id"))
        for item in raw_objects.values()
        if item.get("storage_object_id")
    ]
    duplicate_storage_ids = sorted(
        value for value, count in Counter(storage_ids).items() if count > 1
    )
    if duplicate_storage_ids:
        checks.append(
            CheckResult(
                code="D2_STORAGE_OBJECT_DUPLICATE",
                message=f"Storage object IDs must be unique: {', '.join(duplicate_storage_ids)}",
                location="raw_objects",
            )
        )
    return checks


def load_and_validate_d2_bundle(
    paths: RepositoryPaths,
    bundle_path: Path,
    d1_registry_path: Path,
) -> list[CheckResult]:
    payloads: list[dict[str, Any]] = []
    for label, path in (("bundle", bundle_path), ("D1 registry", d1_registry_path)):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            return [
                CheckResult(
                    code="D2_ARTIFACT_INVALID",
                    message=f"Cannot read {label}: {error}",
                    location=str(path),
                )
            ]
        if not isinstance(payload, dict):
            return [
                CheckResult(
                    code="D2_ARTIFACT_INVALID",
                    message=f"{label} root must be an object",
                    location=str(path),
                )
            ]
        payloads.append(payload)
    return validate_d2_bundle(paths, payloads[0], payloads[1])
