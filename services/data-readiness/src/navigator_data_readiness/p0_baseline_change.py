from __future__ import annotations

import hashlib
import json
import re
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

from .baseline import TECH_SHEETS, extract_contracts, sha256_file
from .models import CheckResult
from .p0_resolution import validate_p0_resolution_packet
from .p0_traceability import build_p0_traceability_report, extract_references
from .paths import RepositoryPaths
from .validation import validate_structure

_PERMISSION_SEPARATOR = re.compile(r"[;；,，、\n]+")

_CHANGEABLE_CONTRACTS = {
    "feature_requirements",
    "role_permissions",
    "page_routes",
    "api_catalog",
    "test_cases",
}
_CONTRACT_IDS = {
    "feature_requirements": "需求编号",
    "role_permissions": "权限编号",
    "page_routes": "页面编号",
    "api_catalog": "接口编号",
    "test_cases": "用例编号",
}
_PROPOSED_CONTRACTS = {
    "requirements": ("feature_requirements", "需求编号"),
    "permissions": ("role_permissions", "权限编号"),
    "apis": ("api_catalog", "接口编号"),
    "tests": ("test_cases", "用例编号"),
}
_ROUTE_DIMENSIONS = {
    "requirement": ("关联需求编号", "proposed_requirement_ids", ("FR-",)),
    "api": ("依赖API", "proposed_api_ids", ("API-",)),
    "test": ("测试用例", "proposed_test_case_ids", ("TC-",)),
}
_NEW_ROW_REQUIRED_FIELDS = {
    "feature_requirements": ("需求编号", "模块", "功能", "优先级", "需求状态"),
    "role_permissions": ("权限编号", "模块/对象", "操作"),
    "api_catalog": ("接口编号", "模块", "用途", "方法", "路径", "状态"),
    "test_cases": (
        "用例编号",
        "模块",
        "场景/目标",
        "测试类型",
        "优先级",
        "需求编号",
        "状态",
    ),
}
_NOT_APPLICABLE_MARKERS = {"不适用", "无需API", "N/A", "NA"}


def _payload_sha256(payload: Any) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


def _text(record: dict[str, Any], field: str) -> str:
    return str(record.get(field, "")).strip()


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _records(contracts: dict[str, Any], name: str) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], contracts.get(name, []))


def _index(records: list[dict[str, Any]], identifier_field: str) -> dict[str, dict[str, Any]]:
    return {
        _text(record, identifier_field): record
        for record in records
        if _text(record, identifier_field)
    }


def _permission_codes(value: Any) -> set[str]:
    return {item.strip() for item in _PERMISSION_SEPARATOR.split(str(value or "")) if item.strip()}


def _changed_fields(before: dict[str, Any], after: dict[str, Any]) -> set[str]:
    return {field for field in set(before) | set(after) if before.get(field) != after.get(field)}


def _proposed_ids(resolution: dict[str, Any]) -> dict[str, set[str]]:
    proposed = resolution.get("proposed_contract_ids")
    if not isinstance(proposed, dict):
        return {category: set() for category in _PROPOSED_CONTRACTS}
    return {category: set(_string_list(proposed.get(category))) for category in _PROPOSED_CONTRACTS}


def _allowed_existing_changes(
    resolution: dict[str, Any],
) -> dict[str, dict[str, set[str]]]:
    allowed: dict[str, dict[str, set[str]]] = {contract: {} for contract in _CHANGEABLE_CONTRACTS}

    requirement_resolutions = resolution.get("requirement_test_resolutions")
    if isinstance(requirement_resolutions, list):
        for item in requirement_resolutions:
            if not isinstance(item, dict):
                continue
            for test_id in _string_list(item.get("proposed_test_case_ids")):
                allowed["test_cases"].setdefault(test_id, set()).add("需求编号")

    route_resolutions = resolution.get("route_mapping_resolutions")
    if isinstance(route_resolutions, list):
        for item in route_resolutions:
            if not isinstance(item, dict):
                continue
            page_id = _text(item, "page_id")
            dimensions = set(_string_list(item.get("unresolved_dimensions")))
            allowed_fields = {
                _ROUTE_DIMENSIONS[dimension][0]
                for dimension in dimensions
                if dimension in _ROUTE_DIMENSIONS
            }
            if page_id:
                allowed["page_routes"][page_id] = allowed_fields

    permission_resolutions = resolution.get("permission_code_resolutions")
    if isinstance(permission_resolutions, list):
        for item in permission_resolutions:
            if not isinstance(item, dict):
                continue
            for permission_id in _string_list(item.get("proposed_perm_ids")):
                allowed["role_permissions"].setdefault(permission_id, set()).add("权限代码")
    return allowed


def _validate_contract_delta(
    checks: list[CheckResult],
    original: dict[str, Any],
    candidate: dict[str, Any],
    resolution: dict[str, Any],
) -> None:
    proposed = _proposed_ids(resolution)
    allowed_changes = _allowed_existing_changes(resolution)

    for contract_name in TECH_SHEETS.values():
        original_records = _records(original, contract_name)
        candidate_records = _records(candidate, contract_name)
        if contract_name not in _CHANGEABLE_CONTRACTS:
            if candidate_records != original_records:
                checks.append(
                    CheckResult(
                        code="P0_CHANGE_UNAUTHORIZED_CONTRACT_CHANGE",
                        message=f"{contract_name} changed outside the reviewed P0 proposal",
                        location=contract_name,
                    )
                )
            continue

        identifier_field = _CONTRACT_IDS[contract_name]
        original_index = _index(original_records, identifier_field)
        candidate_index = _index(candidate_records, identifier_field)
        removed = sorted(set(original_index) - set(candidate_index))
        if removed:
            checks.append(
                CheckResult(
                    code="P0_CHANGE_CONTRACT_ROW_REMOVED",
                    message=f"Removed IDs: {', '.join(removed)}",
                    location=contract_name,
                )
            )

        category = next(
            (
                name
                for name, (mapped_contract, _field) in _PROPOSED_CONTRACTS.items()
                if mapped_contract == contract_name
            ),
            None,
        )
        expected_added = proposed[category] if category else set()
        actual_added = set(candidate_index) - set(original_index)
        if actual_added != expected_added:
            checks.append(
                CheckResult(
                    code="P0_CHANGE_ADDED_ID_SET_INVALID",
                    message=(
                        f"Added IDs differ; missing={sorted(expected_added - actual_added)}, "
                        f"unexpected={sorted(actual_added - expected_added)}"
                    ),
                    location=contract_name,
                )
            )

        for identifier in sorted(set(original_index) & set(candidate_index)):
            changed = _changed_fields(original_index[identifier], candidate_index[identifier])
            unauthorized = changed - allowed_changes[contract_name].get(identifier, set())
            if unauthorized:
                checks.append(
                    CheckResult(
                        code="P0_CHANGE_UNAUTHORIZED_FIELD_CHANGE",
                        message=(
                            f"{identifier} changed unreviewed fields: "
                            f"{', '.join(sorted(unauthorized))}"
                        ),
                        location=f"{contract_name}.{identifier}",
                    )
                )

        required_fields = _NEW_ROW_REQUIRED_FIELDS.get(contract_name)
        if required_fields:
            for identifier in sorted(actual_added):
                record = candidate_index[identifier]
                missing = [field for field in required_fields if not _text(record, field)]
                if missing:
                    checks.append(
                        CheckResult(
                            code="P0_CHANGE_NEW_CONTRACT_INCOMPLETE",
                            message=f"{identifier} is missing: {', '.join(missing)}",
                            location=f"{contract_name}.{identifier}",
                        )
                    )

    candidate_requirements = _index(_records(candidate, "feature_requirements"), "需求编号")
    for requirement_id in proposed["requirements"]:
        record = candidate_requirements.get(requirement_id, {})
        if _text(record, "优先级") != "P0":
            checks.append(
                CheckResult(
                    code="P0_CHANGE_NEW_REQUIREMENT_NOT_P0",
                    message=f"{requirement_id} must be a P0 requirement",
                    location=f"feature_requirements.{requirement_id}",
                )
            )

    candidate_apis = _index(_records(candidate, "api_catalog"), "接口编号")
    for api_id in proposed["apis"]:
        if "P1" in _text(candidate_apis.get(api_id, {}), "状态"):
            checks.append(
                CheckResult(
                    code="P0_CHANGE_NEW_API_NOT_P0",
                    message=f"{api_id} is marked as P1",
                    location=f"api_catalog.{api_id}",
                )
            )

    candidate_tests = _index(_records(candidate, "test_cases"), "用例编号")
    for test_id in proposed["tests"]:
        if _text(candidate_tests.get(test_id, {}), "优先级") != "P0":
            checks.append(
                CheckResult(
                    code="P0_CHANGE_NEW_TEST_NOT_P0",
                    message=f"{test_id} must be a P0 test",
                    location=f"test_cases.{test_id}",
                )
            )


def _validate_requirement_test_resolutions(
    checks: list[CheckResult],
    original: dict[str, Any],
    candidate: dict[str, Any],
    resolution: dict[str, Any],
) -> None:
    original_tests = _index(_records(original, "test_cases"), "用例编号")
    tests = _index(_records(candidate, "test_cases"), "用例编号")
    items = resolution.get("requirement_test_resolutions")
    if not isinstance(items, list):
        return
    expected_by_test: dict[str, set[str]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        requirement_id = _text(item, "requirement_id")
        for test_id in _string_list(item.get("proposed_test_case_ids")):
            expected = expected_by_test.setdefault(
                test_id,
                set(
                    extract_references(
                        original_tests.get(test_id, {}).get("需求编号"),
                        ("FR-",),
                    )
                ),
            )
            expected.add(requirement_id)
    for test_id, expected in sorted(expected_by_test.items()):
        actual = set(
            extract_references(
                tests.get(test_id, {}).get("需求编号"),
                ("FR-",),
            )
        )
        if actual != expected:
            checks.append(
                CheckResult(
                    code="P0_CHANGE_REQUIREMENT_TEST_NOT_APPLIED",
                    message=(
                        f"{test_id} requirement IDs differ; "
                        f"expected={sorted(expected)}, actual={sorted(actual)}"
                    ),
                    location=f"test_cases.{test_id}",
                )
            )


def _validate_route_resolutions(
    checks: list[CheckResult],
    candidate: dict[str, Any],
    resolution: dict[str, Any],
) -> None:
    routes = _index(_records(candidate, "page_routes"), "页面编号")
    items = resolution.get("route_mapping_resolutions")
    if not isinstance(items, list):
        return
    for item in items:
        if not isinstance(item, dict):
            continue
        page_id = _text(item, "page_id")
        route = routes.get(page_id, {})
        dimensions = set(_string_list(item.get("unresolved_dimensions")))
        for dimension in sorted(dimensions):
            if dimension not in _ROUTE_DIMENSIONS:
                continue
            field, proposed_field, prefixes = _ROUTE_DIMENSIONS[dimension]
            current_field = {
                "requirement": "current_requirement_ids",
                "api": "current_api_ids",
                "test": "current_test_case_ids",
            }[dimension]
            expected = set(_string_list(item.get(current_field)))
            expected.update(_string_list(item.get(proposed_field)))
            actual = set(extract_references(route.get(field), prefixes))
            api_not_applicable = dimension == "api" and item.get("api_not_applicable") is True
            if api_not_applicable:
                raw_value = _text(route, field).upper()
                if expected or raw_value not in _NOT_APPLICABLE_MARKERS:
                    checks.append(
                        CheckResult(
                            code="P0_CHANGE_ROUTE_NOT_APPLICABLE_INVALID",
                            message=(
                                f"{page_id} requires an explicit API not-applicable value "
                                "without API references"
                            ),
                            location=f"page_routes.{page_id}.{field}",
                        )
                    )
                continue
            if actual != expected:
                checks.append(
                    CheckResult(
                        code="P0_CHANGE_ROUTE_MAPPING_NOT_APPLIED",
                        message=(
                            f"{page_id} {dimension} IDs differ; "
                            f"expected={sorted(expected)}, actual={sorted(actual)}"
                        ),
                        location=f"page_routes.{page_id}.{field}",
                    )
                )


def _validate_permission_resolutions(
    checks: list[CheckResult],
    candidate: dict[str, Any],
    resolution: dict[str, Any],
) -> None:
    permissions = _index(_records(candidate, "role_permissions"), "权限编号")
    items = resolution.get("permission_code_resolutions")
    if not isinstance(items, list):
        return
    for item in items:
        if not isinstance(item, dict):
            continue
        permission_code = _text(item, "permission_code")
        if item.get("permission_not_applicable") is True:
            checks.append(
                CheckResult(
                    code="P0_CHANGE_PERMISSION_NOT_APPLICABLE_UNRESOLVED",
                    message=(
                        f"{permission_code} is used by a P0 route and requires an explicit "
                        "code-to-PERM mapping"
                    ),
                    location=f"permission_code_resolutions.{permission_code}",
                )
            )
            continue
        expected = set(_string_list(item.get("current_perm_ids")))
        expected.update(_string_list(item.get("proposed_perm_ids")))
        actual = {
            permission_id
            for permission_id, record in permissions.items()
            if permission_code in _permission_codes(record.get("权限代码"))
        }
        if actual != expected:
            checks.append(
                CheckResult(
                    code="P0_CHANGE_PERMISSION_MAPPING_NOT_APPLIED",
                    message=(
                        f"{permission_code} PERM IDs differ; "
                        f"expected={sorted(expected)}, actual={sorted(actual)}"
                    ),
                    location=f"permission_code_resolutions.{permission_code}",
                )
            )


def assess_p0_baseline_change(
    paths: RepositoryPaths,
    resolution: dict[str, Any],
    candidate_workbook: Path,
) -> dict[str, Any]:
    checks = validate_p0_resolution_packet(paths, resolution)
    source_workbook = paths.technical_workbook.resolve()
    candidate_path = candidate_workbook.resolve()
    report: dict[str, Any] = {
        "schema_version": 1,
        "stage": "P0",
        "assessment_scope": "P0 candidate technical workbook baseline-change verification",
        "automated_assessment_only": True,
        "does_not_activate_baseline": True,
        "source_workbook": {
            "path": source_workbook.relative_to(paths.root).as_posix(),
            "sha256": sha256_file(source_workbook),
        },
        "candidate_workbook": {
            "path": str(candidate_path),
            "sha256": None,
        },
        "resolution_sha256": _payload_sha256(resolution),
        "traceability_assessment": None,
        "candidate_ready_for_formal_baseline_review": False,
        "checks": [],
        "warning": (
            "Passing this verifier does not modify or approve the frozen baseline. "
            "The authorized technical workbook must be formally replaced before P0 or D4 "
            "can consume the change."
        ),
    }

    if candidate_path == source_workbook:
        checks.append(
            CheckResult(
                code="P0_CHANGE_SOURCE_WORKBOOK_FORBIDDEN",
                message="The read-only authoritative workbook cannot be used as the change target",
                location=str(candidate_path),
            )
        )
    if not candidate_path.is_file():
        checks.append(
            CheckResult(
                code="P0_CHANGE_WORKBOOK_MISSING",
                message="Candidate technical workbook does not exist",
                location=str(candidate_path),
            )
        )
    if checks:
        report["checks"] = [check.to_dict() for check in checks]
        return report

    candidate_hash = sha256_file(candidate_path)
    cast(dict[str, Any], report["candidate_workbook"])["sha256"] = candidate_hash
    if candidate_hash == report["source_workbook"]["sha256"]:
        checks.append(
            CheckResult(
                code="P0_CHANGE_WORKBOOK_UNCHANGED",
                message="Candidate workbook is byte-identical to the frozen source workbook",
                location=str(candidate_path),
            )
        )

    candidate_paths = replace(paths, technical_workbook=candidate_path)
    try:
        checks.extend(validate_structure(candidate_paths))
        original_contracts = extract_contracts(paths, data_only=False)
        candidate_contracts = extract_contracts(candidate_paths, data_only=False)
    except Exception as error:
        checks.append(
            CheckResult(
                code="P0_CHANGE_WORKBOOK_INVALID",
                message=f"Cannot read candidate technical workbook: {error}",
                location=str(candidate_path),
            )
        )
        report["checks"] = [check.to_dict() for check in checks]
        return report

    _validate_contract_delta(checks, original_contracts, candidate_contracts, resolution)
    _validate_requirement_test_resolutions(
        checks,
        original_contracts,
        candidate_contracts,
        resolution,
    )
    _validate_route_resolutions(checks, candidate_contracts, resolution)
    _validate_permission_resolutions(checks, candidate_contracts, resolution)

    traceability = build_p0_traceability_report(candidate_paths)
    report["traceability_assessment"] = traceability
    if traceability.get("traceability_ready") is not True:
        blocker_count = sum(
            int(item.get("count", 0))
            for item in traceability.get("traceability_blockers", [])
            if isinstance(item, dict)
            and isinstance(item.get("count"), int)
            and not isinstance(item.get("count"), bool)
        )
        checks.append(
            CheckResult(
                code="P0_CHANGE_TRACEABILITY_NOT_READY",
                message=f"Candidate workbook still has {blocker_count} traceability blocker items",
                location=str(candidate_path),
            )
        )

    report["checks"] = [check.to_dict() for check in checks]
    report["candidate_ready_for_formal_baseline_review"] = not checks
    return report


def load_and_assess_p0_baseline_change(
    paths: RepositoryPaths,
    resolution_path: Path,
    candidate_workbook: Path,
) -> dict[str, Any]:
    try:
        payload = json.loads(resolution_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        return {
            "schema_version": 1,
            "stage": "P0",
            "assessment_scope": "P0 candidate technical workbook baseline-change verification",
            "automated_assessment_only": True,
            "does_not_activate_baseline": True,
            "candidate_ready_for_formal_baseline_review": False,
            "checks": [
                CheckResult(
                    code="P0_CHANGE_RESOLUTION_INVALID",
                    message=f"Cannot read resolution packet: {error}",
                    location=str(resolution_path),
                ).to_dict()
            ],
        }
    if not isinstance(payload, dict):
        return {
            "schema_version": 1,
            "stage": "P0",
            "assessment_scope": "P0 candidate technical workbook baseline-change verification",
            "automated_assessment_only": True,
            "does_not_activate_baseline": True,
            "candidate_ready_for_formal_baseline_review": False,
            "checks": [
                CheckResult(
                    code="P0_CHANGE_RESOLUTION_INVALID",
                    message="Resolution packet root must be an object",
                    location=str(resolution_path),
                ).to_dict()
            ],
        }
    return assess_p0_baseline_change(paths, payload, candidate_workbook)
