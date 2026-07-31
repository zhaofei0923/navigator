from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, cast

from .baseline import extract_contracts, snapshot_manifest
from .models import CheckResult
from .p0_traceability import extract_references, p0_candidate_payloads
from .paths import RepositoryPaths

PROPOSED_STATUS = "proposed"
READY_FOR_CHANGE_REVIEW = "ready_for_baseline_change_review"

_ID_PATTERNS = {
    "requirements": re.compile(r"FR-[A-Z0-9]+(?:-[A-Z0-9]+)*"),
    "apis": re.compile(r"API-[A-Z0-9]+(?:-[A-Z0-9]+)*"),
    "tests": re.compile(r"TC-[A-Z0-9]+(?:-[A-Z0-9]+)*"),
    "permissions": re.compile(r"PERM-[A-Z0-9]+(?:-[A-Z0-9]+)*"),
}

PROPOSED_CONTRACT_SPECS: dict[
    str,
    tuple[str, str, tuple[str, ...], frozenset[str]],
] = {
    "requirements": (
        "feature_requirements",
        "需求编号",
        ("需求编号", "模块", "功能", "优先级", "需求状态"),
        frozenset(),
    ),
    "apis": (
        "api_catalog",
        "接口编号",
        ("接口编号", "模块", "用途", "方法", "路径", "状态"),
        frozenset(),
    ),
    "tests": (
        "test_cases",
        "用例编号",
        (
            "用例编号",
            "模块",
            "场景/目标",
            "测试类型",
            "优先级",
            "需求编号",
            "状态",
        ),
        frozenset(),
    ),
    "permissions": (
        "role_permissions",
        "权限编号",
        ("权限编号", "模块/对象", "操作"),
        frozenset({"权限代码"}),
    ),
}


def _text(record: dict[str, Any], column: str) -> str:
    return str(record.get(column, "")).strip()


def _payload_sha256(payload: Any) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


def _blocker_ids(assessment: dict[str, Any], code: str) -> list[str]:
    blockers = assessment.get("traceability_blockers")
    if not isinstance(blockers, list):
        return []
    for blocker in blockers:
        if isinstance(blocker, dict) and blocker.get("code") == code:
            identifiers = blocker.get("ids")
            if isinstance(identifiers, list):
                return sorted(str(item).strip() for item in identifiers if str(item).strip())
    return []


def build_p0_resolution_template(paths: RepositoryPaths) -> dict[str, Any]:
    contracts = extract_contracts(paths)
    candidates = p0_candidate_payloads(paths)
    assessment = cast(dict[str, Any], candidates["p0_traceability_assessment.json"])
    matrix = cast(list[dict[str, Any]], candidates["p0_traceability_matrix.json"])

    requirements: list[dict[str, Any]] = contracts["feature_requirements"]
    routes: list[dict[str, Any]] = contracts["page_routes"]
    p0_routes = [record for record in routes if _text(record, "优先级") == "P0"]

    requirement_lookup = {_text(record, "需求编号"): record for record in requirements}
    matrix_lookup = {str(record["requirement_id"]): record for record in matrix}
    route_lookup = {_text(record, "页面编号"): record for record in p0_routes}

    missing_test_ids = _blocker_ids(assessment, "P0_REQUIREMENT_WITHOUT_P0_TEST")
    pending_by_dimension = {
        "requirement": set(_blocker_ids(assessment, "P0_ROUTE_REQUIREMENT_MAPPING_PENDING")),
        "api": set(_blocker_ids(assessment, "P0_ROUTE_API_MAPPING_PENDING")),
        "test": set(_blocker_ids(assessment, "P0_ROUTE_TEST_MAPPING_PENDING")),
    }
    pending_route_ids = sorted(set().union(*pending_by_dimension.values()))

    permission_pages: dict[str, list[str]] = {}
    for route in p0_routes:
        permission_code = _text(route, "主权限")
        if permission_code:
            permission_pages.setdefault(permission_code, []).append(_text(route, "页面编号"))

    proposed_contract_schema: dict[str, dict[str, Any]] = {}
    for category, (
        contract_name,
        identifier_field,
        required_fields,
        extension_fields,
    ) in PROPOSED_CONTRACT_SPECS.items():
        records = cast(list[dict[str, Any]], contracts[contract_name])
        allowed_fields = set(extension_fields)
        for record in records:
            allowed_fields.update(record)
        proposed_contract_schema[category] = {
            "contract_name": contract_name,
            "identifier_field": identifier_field,
            "allowed_fields": sorted(allowed_fields),
            "required_fields": list(required_fields),
        }

    source_manifest = snapshot_manifest(paths)
    return {
        "schema_version": 2,
        "stage": "P0",
        "template_only": True,
        "baseline": {
            "version": "V1.0-BASELINE",
            "sources": source_manifest["sources"],
            "candidate_hashes": {
                filename: _payload_sha256(payload)
                for filename, payload in sorted(candidates.items())
            },
        },
        "proposed_contract_ids": {
            "requirements": [],
            "apis": [],
            "tests": [],
            "permissions": [],
        },
        "proposed_contract_rows": {
            "requirements": [],
            "apis": [],
            "tests": [],
            "permissions": [],
        },
        "proposed_contract_schema": proposed_contract_schema,
        "requirement_test_resolutions": [
            {
                "requirement_id": requirement_id,
                "module": _text(requirement_lookup[requirement_id], "模块"),
                "function": _text(requirement_lookup[requirement_id], "功能"),
                "current_test_case_ids": sorted(
                    str(item) for item in matrix_lookup[requirement_id].get("test_case_ids", [])
                ),
                "proposed_test_case_ids": [],
                "resolution_status": "pending",
                "change_request_id": None,
                "rationale": None,
                "reviewer": None,
                "reviewed_at": None,
            }
            for requirement_id in missing_test_ids
        ],
        "route_mapping_resolutions": [
            {
                "page_id": page_id,
                "page_name": _text(route_lookup[page_id], "页面名称"),
                "route": _text(route_lookup[page_id], "建议路由"),
                "unresolved_dimensions": [
                    dimension
                    for dimension in ("requirement", "api", "test")
                    if page_id in pending_by_dimension[dimension]
                ],
                "current_requirement_ids": extract_references(
                    route_lookup[page_id].get("关联需求编号"),
                    ("FR-",),
                ),
                "current_api_ids": extract_references(
                    route_lookup[page_id].get("依赖API"),
                    ("API-",),
                ),
                "current_test_case_ids": extract_references(
                    route_lookup[page_id].get("测试用例"),
                    ("TC-",),
                ),
                "proposed_requirement_ids": [],
                "proposed_api_ids": [],
                "proposed_test_case_ids": [],
                "api_not_applicable": False,
                "resolution_status": "pending",
                "change_request_id": None,
                "rationale": None,
                "reviewer": None,
                "reviewed_at": None,
            }
            for page_id in pending_route_ids
        ],
        "permission_code_resolutions": [
            {
                "permission_code": permission_code,
                "page_ids": sorted(permission_pages[permission_code]),
                "current_perm_ids": [],
                "proposed_perm_ids": [],
                "permission_not_applicable": False,
                "resolution_status": "pending",
                "change_request_id": None,
                "rationale": None,
                "reviewer": None,
                "reviewed_at": None,
            }
            for permission_code in sorted(permission_pages)
        ],
        "final_review": {
            "status": "pending",
            "change_set_id": None,
            "reviewed_by": None,
            "reviewed_at": None,
            "evidence_ids": [],
        },
        "warning": (
            "This packet records proposed baseline changes only. It cannot amend the read-only "
            "workbook, approve D0-D4, or authorize user-facing development."
        ),
    }


def write_p0_resolution_template(paths: RepositoryPaths) -> Path:
    paths.p0_candidates_dir.mkdir(parents=True, exist_ok=True)
    destination = paths.p0_candidates_dir / "p0_traceability_resolution.template.json"
    destination.write_text(
        json.dumps(
            build_p0_resolution_template(paths),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return destination


def _indexed_items(
    checks: list[CheckResult],
    payload: dict[str, Any],
    section: str,
    identifier_field: str,
) -> dict[str, dict[str, Any]]:
    raw_items = payload.get(section)
    if not isinstance(raw_items, list):
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_SECTION_INVALID",
                message=f"{section} must be a list",
                location=section,
            )
        )
        return {}

    result: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_ITEM_INVALID",
                    message=f"{section}[{index}] must be an object",
                    location=section,
                )
            )
            continue
        identifier = _text(item, identifier_field)
        if not identifier:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_IDENTIFIER_MISSING",
                    message=f"{section}[{index}] requires {identifier_field}",
                    location=section,
                )
            )
            continue
        if identifier in result:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_IDENTIFIER_DUPLICATE",
                    message=f"{section} contains duplicate {identifier}",
                    location=section,
                )
            )
            continue
        result[identifier] = item
    return result


def _required_metadata(
    checks: list[CheckResult],
    item: dict[str, Any],
    location: str,
) -> None:
    missing = [
        field
        for field in ("change_request_id", "rationale", "reviewer", "reviewed_at")
        if not _text(item, field)
    ]
    if missing:
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_METADATA_INCOMPLETE",
                message=f"Missing required fields: {', '.join(missing)}",
                location=location,
            )
        )


def _string_ids(
    checks: list[CheckResult],
    item: dict[str, Any],
    field: str,
    *,
    location: str,
) -> list[str]:
    value = item.get(field)
    if not isinstance(value, list):
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_ID_LIST_INVALID",
                message=f"{field} must be a list",
                location=location,
            )
        )
        return []
    identifiers = [str(entry).strip() for entry in value if str(entry).strip()]
    if len(identifiers) != len(set(identifiers)):
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_ID_DUPLICATE",
                message=f"{field} contains duplicate IDs",
                location=location,
            )
        )
    return identifiers


def _validate_exact_section(
    checks: list[CheckResult],
    actual: dict[str, dict[str, Any]],
    expected: dict[str, dict[str, Any]],
    *,
    section: str,
    immutable_fields: tuple[str, ...],
) -> None:
    actual_ids = set(actual)
    expected_ids = set(expected)
    if actual_ids != expected_ids:
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_SET_INVALID",
                message=(
                    f"{section} IDs differ; missing={sorted(expected_ids - actual_ids)}, "
                    f"unexpected={sorted(actual_ids - expected_ids)}"
                ),
                location=section,
            )
        )
    for identifier in sorted(actual_ids & expected_ids):
        if any(
            actual[identifier].get(field) != expected[identifier].get(field)
            for field in immutable_fields
        ):
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_INPUT_CHANGED",
                    message=f"{identifier} frozen inputs differ from the current template",
                    location=f"{section}.{identifier}",
                )
            )


def _validate_proposed_ids(
    checks: list[CheckResult],
    payload: dict[str, Any],
    contracts: dict[str, Any],
) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    raw_proposed = payload.get("proposed_contract_ids")
    if not isinstance(raw_proposed, dict):
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_PROPOSED_IDS_INVALID",
                message="proposed_contract_ids must be an object",
                location="proposed_contract_ids",
            )
        )
        raw_proposed = {}

    known = {
        "requirements": {_text(record, "需求编号") for record in contracts["feature_requirements"]},
        "apis": {_text(record, "接口编号") for record in contracts["api_catalog"]},
        "tests": {_text(record, "用例编号") for record in contracts["test_cases"]},
        "permissions": {_text(record, "权限编号") for record in contracts["role_permissions"]},
    }
    proposed: dict[str, set[str]] = {}
    for category, pattern in _ID_PATTERNS.items():
        values = raw_proposed.get(category)
        if not isinstance(values, list):
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_PROPOSED_ID_LIST_INVALID",
                    message=f"proposed_contract_ids.{category} must be a list",
                    location=f"proposed_contract_ids.{category}",
                )
            )
            proposed[category] = set()
            continue
        identifiers = [str(value).strip() for value in values if str(value).strip()]
        if len(identifiers) != len(set(identifiers)):
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_PROPOSED_ID_DUPLICATE",
                    message=f"proposed_contract_ids.{category} contains duplicate IDs",
                    location=f"proposed_contract_ids.{category}",
                )
            )
        invalid = sorted(
            identifier for identifier in identifiers if not pattern.fullmatch(identifier)
        )
        if invalid:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_PROPOSED_ID_FORMAT_INVALID",
                    message=f"Invalid {category} IDs: {', '.join(invalid)}",
                    location=f"proposed_contract_ids.{category}",
                )
            )
        collisions = sorted(set(identifiers) & known[category])
        if collisions:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_PROPOSED_ID_COLLISION",
                    message=f"Proposed IDs already exist: {', '.join(collisions)}",
                    location=f"proposed_contract_ids.{category}",
                )
            )
        proposed[category] = set(identifiers)
    allowed = {category: known[category] | proposed[category] for category in known}
    return allowed, proposed


def _validate_proposed_contract_rows(
    checks: list[CheckResult],
    payload: dict[str, Any],
    template: dict[str, Any],
    proposed_ids: dict[str, set[str]],
) -> None:
    if payload.get("proposed_contract_schema") != template["proposed_contract_schema"]:
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_CONTRACT_SCHEMA_STALE",
                message="Proposed contract schema differs from the current review template",
                location="proposed_contract_schema",
            )
        )

    raw_rows = payload.get("proposed_contract_rows")
    if not isinstance(raw_rows, dict):
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_PROPOSED_ROWS_INVALID",
                message="proposed_contract_rows must be an object",
                location="proposed_contract_rows",
            )
        )
        raw_rows = {}

    schema = cast(dict[str, dict[str, Any]], template["proposed_contract_schema"])
    for category, (
        _contract_name,
        identifier_field,
        required_fields,
        _extension_fields,
    ) in PROPOSED_CONTRACT_SPECS.items():
        location = f"proposed_contract_rows.{category}"
        values = raw_rows.get(category)
        if not isinstance(values, list):
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_PROPOSED_ROW_LIST_INVALID",
                    message=f"{location} must be a list",
                    location=location,
                )
            )
            values = []

        rows: dict[str, dict[str, Any]] = {}
        allowed_fields = set(cast(list[str], schema[category]["allowed_fields"]))
        for index, value in enumerate(values):
            item_location = f"{location}[{index}]"
            if not isinstance(value, dict):
                checks.append(
                    CheckResult(
                        code="P0_RESOLUTION_PROPOSED_ROW_INVALID",
                        message=f"{item_location} must be an object",
                        location=item_location,
                    )
                )
                continue
            identifier = _text(value, identifier_field)
            if not identifier:
                checks.append(
                    CheckResult(
                        code="P0_RESOLUTION_PROPOSED_ROW_ID_MISSING",
                        message=f"{item_location} requires {identifier_field}",
                        location=item_location,
                    )
                )
                continue
            if identifier in rows:
                checks.append(
                    CheckResult(
                        code="P0_RESOLUTION_PROPOSED_ROW_DUPLICATE",
                        message=f"{identifier} has more than one proposed row definition",
                        location=location,
                    )
                )
                continue
            rows[identifier] = value

            unexpected_fields = sorted(set(value) - allowed_fields)
            if unexpected_fields:
                checks.append(
                    CheckResult(
                        code="P0_RESOLUTION_PROPOSED_ROW_FIELD_UNKNOWN",
                        message=(
                            f"{identifier} contains fields outside the reviewed schema: "
                            f"{', '.join(unexpected_fields)}"
                        ),
                        location=item_location,
                    )
                )
            blank_fields = sorted(
                field
                for field, field_value in value.items()
                if field_value is None or not str(field_value).strip()
            )
            if blank_fields:
                checks.append(
                    CheckResult(
                        code="P0_RESOLUTION_PROPOSED_ROW_BLANK_FIELD",
                        message=(
                            f"{identifier} contains blank fields; omit them instead: "
                            f"{', '.join(blank_fields)}"
                        ),
                        location=item_location,
                    )
                )
            missing = [field for field in required_fields if not _text(value, field)]
            if missing:
                checks.append(
                    CheckResult(
                        code="P0_RESOLUTION_PROPOSED_ROW_INCOMPLETE",
                        message=f"{identifier} is missing: {', '.join(missing)}",
                        location=item_location,
                    )
                )

        actual_ids = set(rows)
        expected_ids = proposed_ids[category]
        if actual_ids != expected_ids:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_PROPOSED_ROW_SET_INVALID",
                    message=(
                        f"{category} row definitions differ; "
                        f"missing={sorted(expected_ids - actual_ids)}, "
                        f"unexpected={sorted(actual_ids - expected_ids)}"
                    ),
                    location=location,
                )
            )


def _check_known_ids(
    checks: list[CheckResult],
    identifiers: list[str],
    allowed: set[str],
    *,
    code: str,
    location: str,
) -> None:
    unknown = sorted(set(identifiers) - allowed)
    if unknown:
        checks.append(
            CheckResult(
                code=code,
                message=f"Unknown or undeclared IDs: {', '.join(unknown)}",
                location=location,
            )
        )


def validate_p0_resolution_packet(
    paths: RepositoryPaths,
    payload: dict[str, Any],
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    template = build_p0_resolution_template(paths)
    contracts = extract_contracts(paths)

    if payload.get("schema_version") != 2 or payload.get("stage") != "P0":
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_HEADER_INVALID",
                message="schema_version must be 2 and stage must be P0",
            )
        )
    if payload.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_TEMPLATE_ONLY",
                message="Copy the template and set template_only=false before validation",
            )
        )
    if payload.get("baseline") != template["baseline"]:
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_BASELINE_STALE",
                message="Baseline source or candidate hashes differ from the current repository",
                location="baseline",
            )
        )

    allowed_ids, proposed_ids = _validate_proposed_ids(checks, payload, contracts)
    _validate_proposed_contract_rows(
        checks,
        payload,
        template,
        proposed_ids,
    )

    requirements = _indexed_items(
        checks,
        payload,
        "requirement_test_resolutions",
        "requirement_id",
    )
    expected_requirements = {
        str(item["requirement_id"]): item for item in template["requirement_test_resolutions"]
    }
    _validate_exact_section(
        checks,
        requirements,
        expected_requirements,
        section="requirement_test_resolutions",
        immutable_fields=(
            "requirement_id",
            "module",
            "function",
            "current_test_case_ids",
        ),
    )
    for requirement_id, item in requirements.items():
        location = f"requirement_test_resolutions.{requirement_id}"
        if item.get("resolution_status") != PROPOSED_STATUS:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_REQUIREMENT_TEST_PENDING",
                    message=f"{requirement_id} test coverage proposal is pending",
                    location=location,
                )
            )
        proposed_tests = _string_ids(
            checks,
            item,
            "proposed_test_case_ids",
            location=location,
        )
        if not proposed_tests:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_REQUIREMENT_TEST_MISSING",
                    message=f"{requirement_id} requires at least one proposed test ID",
                    location=location,
                )
            )
        _check_known_ids(
            checks,
            proposed_tests,
            allowed_ids["tests"],
            code="P0_RESOLUTION_TEST_ID_UNKNOWN",
            location=location,
        )
        _required_metadata(checks, item, location)

    routes = _indexed_items(
        checks,
        payload,
        "route_mapping_resolutions",
        "page_id",
    )
    expected_routes = {str(item["page_id"]): item for item in template["route_mapping_resolutions"]}
    _validate_exact_section(
        checks,
        routes,
        expected_routes,
        section="route_mapping_resolutions",
        immutable_fields=(
            "page_id",
            "page_name",
            "route",
            "unresolved_dimensions",
            "current_requirement_ids",
            "current_api_ids",
            "current_test_case_ids",
        ),
    )
    route_fields = {
        "requirement": ("proposed_requirement_ids", "requirements"),
        "api": ("proposed_api_ids", "apis"),
        "test": ("proposed_test_case_ids", "tests"),
    }
    for page_id, item in routes.items():
        location = f"route_mapping_resolutions.{page_id}"
        if item.get("resolution_status") != PROPOSED_STATUS:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_ROUTE_PENDING",
                    message=f"{page_id} route mapping proposal is pending",
                    location=location,
                )
            )
        dimensions = item.get("unresolved_dimensions")
        if not isinstance(dimensions, list):
            dimensions = []
        for dimension in (str(value) for value in dimensions):
            if dimension not in route_fields:
                checks.append(
                    CheckResult(
                        code="P0_RESOLUTION_ROUTE_DIMENSION_INVALID",
                        message=f"{page_id} has unsupported dimension {dimension}",
                        location=location,
                    )
                )
                continue
            field, category = route_fields[dimension]
            identifiers = _string_ids(checks, item, field, location=location)
            not_applicable = dimension == "api" and item.get("api_not_applicable") is True
            if not identifiers and not not_applicable:
                checks.append(
                    CheckResult(
                        code="P0_RESOLUTION_ROUTE_MAPPING_MISSING",
                        message=f"{page_id} requires a proposed {dimension} mapping",
                        location=location,
                    )
                )
            _check_known_ids(
                checks,
                identifiers,
                allowed_ids[category],
                code="P0_RESOLUTION_ROUTE_ID_UNKNOWN",
                location=location,
            )
        _required_metadata(checks, item, location)

    permissions = _indexed_items(
        checks,
        payload,
        "permission_code_resolutions",
        "permission_code",
    )
    expected_permissions = {
        str(item["permission_code"]): item for item in template["permission_code_resolutions"]
    }
    _validate_exact_section(
        checks,
        permissions,
        expected_permissions,
        section="permission_code_resolutions",
        immutable_fields=("permission_code", "page_ids", "current_perm_ids"),
    )
    for permission_code, item in permissions.items():
        location = f"permission_code_resolutions.{permission_code}"
        if item.get("resolution_status") != PROPOSED_STATUS:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_PERMISSION_PENDING",
                    message=f"{permission_code} permission mapping proposal is pending",
                    location=location,
                )
            )
        proposed_permissions = _string_ids(
            checks,
            item,
            "proposed_perm_ids",
            location=location,
        )
        not_applicable = item.get("permission_not_applicable") is True
        if not proposed_permissions and not not_applicable:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_PERMISSION_MAPPING_MISSING",
                    message=f"{permission_code} requires a PERM mapping or not-applicable decision",
                    location=location,
                )
            )
        _check_known_ids(
            checks,
            proposed_permissions,
            allowed_ids["permissions"],
            code="P0_RESOLUTION_PERMISSION_ID_UNKNOWN",
            location=location,
        )
        _required_metadata(checks, item, location)

    final_review = payload.get("final_review")
    if not isinstance(final_review, dict):
        checks.append(
            CheckResult(
                code="P0_RESOLUTION_FINAL_REVIEW_INVALID",
                message="final_review must be an object",
                location="final_review",
            )
        )
    else:
        if final_review.get("status") != READY_FOR_CHANGE_REVIEW:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_FINAL_REVIEW_PENDING",
                    message="Resolution packet is not ready for baseline change review",
                    location="final_review",
                )
            )
        missing = [
            field
            for field in ("change_set_id", "reviewed_by", "reviewed_at")
            if not _text(final_review, field)
        ]
        evidence_ids = final_review.get("evidence_ids")
        if not isinstance(evidence_ids, list) or not any(
            str(value).strip() for value in evidence_ids
        ):
            missing.append("evidence_ids")
        if missing:
            checks.append(
                CheckResult(
                    code="P0_RESOLUTION_FINAL_REVIEW_INCOMPLETE",
                    message=f"Missing final review fields: {', '.join(missing)}",
                    location="final_review",
                )
            )
    return checks


def load_and_validate_p0_resolution_packet(
    paths: RepositoryPaths,
    packet_path: Path,
) -> list[CheckResult]:
    try:
        payload = json.loads(packet_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        return [
            CheckResult(
                code="P0_RESOLUTION_PACKET_INVALID",
                message=f"Cannot read resolution packet: {error}",
                location=str(packet_path),
            )
        ]
    if not isinstance(payload, dict):
        return [
            CheckResult(
                code="P0_RESOLUTION_PACKET_INVALID",
                message="Resolution packet root must be an object",
                location=str(packet_path),
            )
        ]
    return validate_p0_resolution_packet(paths, payload)
