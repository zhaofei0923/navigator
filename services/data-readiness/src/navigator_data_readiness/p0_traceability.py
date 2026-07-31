from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, cast

from .baseline import extract_contracts
from .paths import RepositoryPaths

EXPECTED_P0_REQUIREMENT_COUNT = 90
EXPECTED_MVP_ACCEPTANCE_IDS = {f"ACC-{index:03d}" for index in range(1, 12)}

_IDENTIFIER_PATTERN = re.compile(r"\b(?:FR|API|TC|NFR)-[A-Z0-9]+(?:-[A-Z0-9]+)*\b")
_REFERENCE_SEPARATOR = re.compile(r"[;；,，、\n]+")
_PENDING_MARKERS = ("待", "补充", "建立", "细化", "未建立")


def extract_references(value: Any, prefixes: tuple[str, ...]) -> list[str]:
    """Extract stable workbook IDs, including abbreviated suffixes such as FR-API-011;015."""

    text = str(value or "").strip().upper()
    if not text:
        return []

    references: list[str] = []
    last_stem: str | None = None
    for token in _REFERENCE_SEPARATOR.split(text):
        matches = [
            match for match in _IDENTIFIER_PATTERN.findall(token) if match.startswith(prefixes)
        ]
        if matches:
            for match in matches:
                if match not in references:
                    references.append(match)
                last_stem = match.rsplit("-", 1)[0]
            continue

        abbreviated = token.strip()
        if last_stem and re.fullmatch(r"\d{3}", abbreviated):
            reference = f"{last_stem}-{abbreviated}"
            if reference.startswith(prefixes) and reference not in references:
                references.append(reference)
    return references


def _text(record: dict[str, Any], column: str) -> str:
    return str(record.get(column, "")).strip()


def _is_pending(value: Any) -> bool:
    text = str(value or "").strip()
    return not text or any(marker in text for marker in _PENDING_MARKERS)


def _has_completion_marker(value: Any, markers: tuple[str, ...]) -> bool:
    text = str(value or "").strip().lower()
    return any(marker.lower() in text for marker in markers)


def _identifier_set(records: list[dict[str, Any]], column: str) -> set[str]:
    return {_text(record, column) for record in records if _text(record, column)}


def _separated_values(value: Any) -> list[str]:
    return [item.strip() for item in _REFERENCE_SEPARATOR.split(str(value or "")) if item.strip()]


def _issue(code: str, count: int, ids: list[str] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"code": code, "count": count}
    if ids is not None:
        payload["ids"] = ids
    return payload


def _build_payloads(
    contracts: dict[str, Any],
    *,
    expected_p0_requirement_count: int = EXPECTED_P0_REQUIREMENT_COUNT,
) -> dict[str, Any]:
    requirements: list[dict[str, Any]] = contracts["feature_requirements"]
    permissions: list[dict[str, Any]] = contracts["role_permissions"]
    routes: list[dict[str, Any]] = contracts["page_routes"]
    apis: list[dict[str, Any]] = contracts["api_catalog"]
    tests: list[dict[str, Any]] = contracts["test_cases"]
    engineering_tests: list[dict[str, Any]] = contracts["engineering_acceptance_tests"]
    acceptance: list[dict[str, Any]] = contracts["mvp_acceptance"]

    p0_requirements = [record for record in requirements if _text(record, "优先级") == "P0"]
    p0_routes = [record for record in routes if _text(record, "优先级") == "P0"]
    p0_apis = [record for record in apis if "P1" not in _text(record, "状态")]
    p0_tests = [record for record in tests if _text(record, "优先级") == "P0"]
    p0_engineering_tests = [
        record for record in engineering_tests if _text(record, "优先级") == "P0"
    ]

    requirement_ids = _identifier_set(requirements, "需求编号")
    p0_requirement_ids = _identifier_set(p0_requirements, "需求编号")
    api_ids = _identifier_set(apis, "接口编号")
    test_ids = _identifier_set(tests, "用例编号")

    routes_by_requirement: defaultdict[str, set[str]] = defaultdict(set)
    apis_by_requirement: defaultdict[str, set[str]] = defaultdict(set)
    permissions_by_requirement: defaultdict[str, set[str]] = defaultdict(set)
    tests_by_requirement: defaultdict[str, set[str]] = defaultdict(set)
    acceptance_by_requirement: defaultdict[str, set[str]] = defaultdict(set)

    pending_route_requirements: list[str] = []
    pending_route_apis: list[str] = []
    pending_route_tests: list[str] = []
    route_requirement_refs: set[str] = set()
    route_api_refs: set[str] = set()
    route_test_refs: set[str] = set()
    route_permission_codes: set[str] = set()

    for route in p0_routes:
        route_id = _text(route, "页面编号")
        requirement_refs = extract_references(route.get("关联需求编号"), ("FR-",))
        api_refs = extract_references(route.get("依赖API"), ("API-",))
        case_refs = extract_references(route.get("测试用例"), ("TC-",))
        route_requirement_refs.update(requirement_refs)
        route_api_refs.update(api_refs)
        route_test_refs.update(case_refs)
        if _is_pending(route.get("关联需求编号")):
            pending_route_requirements.append(route_id)
        if _is_pending(route.get("依赖API")):
            pending_route_apis.append(route_id)
        if _is_pending(route.get("测试用例")):
            pending_route_tests.append(route_id)

        permission_code = _text(route, "主权限")
        route_permission_codes.update(_separated_values(permission_code))
        for requirement_id in requirement_refs:
            if requirement_id not in p0_requirement_ids:
                continue
            routes_by_requirement[requirement_id].add(route_id)
            apis_by_requirement[requirement_id].update(api_refs)
            if permission_code:
                permissions_by_requirement[requirement_id].add(permission_code)

    test_requirement_refs: set[str] = set()
    for test in p0_tests:
        test_id = _text(test, "用例编号")
        references = extract_references(test.get("需求编号"), ("FR-",))
        test_requirement_refs.update(references)
        for requirement_id in references:
            if requirement_id in p0_requirement_ids:
                tests_by_requirement[requirement_id].add(test_id)

    for criterion in acceptance:
        acceptance_id = _text(criterion, "验收编号")
        for requirement_id in extract_references(criterion.get("需求编号"), ("FR-",)):
            if requirement_id in p0_requirement_ids:
                acceptance_by_requirement[requirement_id].add(acceptance_id)

    matrix = [
        {
            "requirement_id": requirement_id,
            "module": _text(requirement, "模块"),
            "function": _text(requirement, "功能"),
            "priority": "P0",
            "route_ids": sorted(routes_by_requirement[requirement_id]),
            "api_ids_via_routes": sorted(apis_by_requirement[requirement_id]),
            "permission_codes_via_routes": sorted(permissions_by_requirement[requirement_id]),
            "test_case_ids": sorted(tests_by_requirement[requirement_id]),
            "mvp_acceptance_ids": sorted(acceptance_by_requirement[requirement_id]),
            "has_p0_test": bool(tests_by_requirement[requirement_id]),
        }
        for requirement in sorted(p0_requirements, key=lambda item: _text(item, "需求编号"))
        if (requirement_id := _text(requirement, "需求编号"))
    ]

    requirements_without_tests = sorted(
        requirement_id
        for requirement_id in p0_requirement_ids
        if not tests_by_requirement[requirement_id]
    )
    unknown_route_requirement_refs = sorted(route_requirement_refs - requirement_ids)
    unknown_route_api_refs = sorted(route_api_refs - api_ids)
    unknown_route_test_refs = sorted(route_test_refs - test_ids)
    unknown_test_requirement_refs = sorted(test_requirement_refs - requirement_ids)
    declared_permission_codes = {
        permission_code
        for record in permissions
        for permission_code in _separated_values(record.get("权限代码"))
    }
    unmapped_permission_codes = sorted(route_permission_codes - declared_permission_codes)
    actual_acceptance_ids = _identifier_set(acceptance, "验收编号")
    missing_acceptance_ids = sorted(EXPECTED_MVP_ACCEPTANCE_IDS - actual_acceptance_ids)
    unexpected_acceptance_ids = sorted(actual_acceptance_ids - EXPECTED_MVP_ACCEPTANCE_IDS)

    traceability_blockers: list[dict[str, Any]] = []
    if len(p0_requirements) != expected_p0_requirement_count:
        traceability_blockers.append(_issue("P0_REQUIREMENT_COUNT_MISMATCH", len(p0_requirements)))
    if requirements_without_tests:
        traceability_blockers.append(
            _issue(
                "P0_REQUIREMENT_WITHOUT_P0_TEST",
                len(requirements_without_tests),
                requirements_without_tests,
            )
        )
    for code, identifiers in (
        ("P0_ROUTE_REQUIREMENT_MAPPING_PENDING", sorted(pending_route_requirements)),
        ("P0_ROUTE_API_MAPPING_PENDING", sorted(pending_route_apis)),
        ("P0_ROUTE_TEST_MAPPING_PENDING", sorted(pending_route_tests)),
        ("P0_ROUTE_REQUIREMENT_REFERENCE_UNKNOWN", unknown_route_requirement_refs),
        ("P0_ROUTE_API_REFERENCE_UNKNOWN", unknown_route_api_refs),
        ("P0_ROUTE_TEST_REFERENCE_UNKNOWN", unknown_route_test_refs),
        ("P0_TEST_REQUIREMENT_REFERENCE_UNKNOWN", unknown_test_requirement_refs),
        ("P0_PERMISSION_CODE_MAPPING_MISSING", unmapped_permission_codes),
        ("P0_MVP_ACCEPTANCE_MISSING", missing_acceptance_ids),
        ("P0_MVP_ACCEPTANCE_UNEXPECTED", unexpected_acceptance_ids),
    ):
        if identifiers:
            traceability_blockers.append(_issue(code, len(identifiers), identifiers))

    p0_routes_ready = sum(
        _has_completion_marker(record.get("追踪状态"), ("已准入", "可开发", "已开发", "已完成"))
        for record in p0_routes
    )
    p0_apis_implemented = sum(
        _has_completion_marker(record.get("状态"), ("已实现", "已上线", "已完成"))
        for record in p0_apis
    )
    p0_tests_executed = sum(
        _has_completion_marker(record.get("状态"), ("已通过", "执行通过", "已完成", "passed"))
        for record in p0_tests
    )
    engineering_tests_executed = sum(
        _has_completion_marker(record.get("状态"), ("已通过", "执行通过", "已完成", "passed"))
        for record in p0_engineering_tests
    )
    acceptance_completed = sum(
        _has_completion_marker(record.get("状态"), ("已通过", "验收通过", "已完成", "passed"))
        for record in acceptance
    )

    delivery_blockers = [
        _issue("P0_ROUTE_DEVELOPMENT_PENDING", len(p0_routes) - p0_routes_ready),
        _issue("P0_API_IMPLEMENTATION_PENDING", len(p0_apis) - p0_apis_implemented),
        _issue("P0_TEST_EXECUTION_PENDING", len(p0_tests) - p0_tests_executed),
        _issue(
            "P0_ENGINEERING_TEST_EXECUTION_PENDING",
            len(p0_engineering_tests) - engineering_tests_executed,
        ),
        _issue("P0_MVP_ACCEPTANCE_PENDING", len(acceptance) - acceptance_completed),
    ]
    delivery_blockers = [item for item in delivery_blockers if item["count"] > 0]

    assessment = {
        "schema_version": 1,
        "baseline_version": "V1.0-BASELINE",
        "assessment_scope": "P0 traceability and delivery preflight",
        "automated_assessment_only": True,
        "does_not_authorize_user_facing_development": True,
        "traceability_ready": not traceability_blockers,
        "delivery_ready": not traceability_blockers and not delivery_blockers,
        "counts": {
            "requirements_total": len(requirements),
            "p0_requirements": len(p0_requirements),
            "role_permission_rows": len(permissions),
            "routes_total": len(routes),
            "p0_routes": len(p0_routes),
            "api_contracts_total": len(apis),
            "p0_api_contracts": len(p0_apis),
            "test_cases_total": len(tests),
            "p0_test_cases": len(p0_tests),
            "p0_engineering_acceptance_tests": len(p0_engineering_tests),
            "mvp_acceptance_criteria": len(acceptance),
        },
        "coverage": {
            "p0_requirements_with_p0_tests": (
                len(p0_requirements) - len(requirements_without_tests)
            ),
            "p0_requirements_without_p0_tests": len(requirements_without_tests),
            "p0_routes_with_stable_requirement_ids": sum(
                bool(extract_references(record.get("关联需求编号"), ("FR-",)))
                for record in p0_routes
            ),
            "p0_routes_with_stable_api_ids": sum(
                bool(extract_references(record.get("依赖API"), ("API-",))) for record in p0_routes
            ),
            "p0_routes_with_stable_test_ids": sum(
                bool(extract_references(record.get("测试用例"), ("TC-",))) for record in p0_routes
            ),
            "p0_routes_with_permission_code": sum(
                bool(_text(record, "主权限")) for record in p0_routes
            ),
            "p0_permission_codes_total": len(route_permission_codes),
            "p0_permission_codes_mapped": (
                len(route_permission_codes) - len(unmapped_permission_codes)
            ),
        },
        "implementation_evidence": {
            "p0_routes_development_ready": p0_routes_ready,
            "p0_apis_implemented": p0_apis_implemented,
            "p0_tests_executed": p0_tests_executed,
            "p0_engineering_tests_executed": engineering_tests_executed,
            "mvp_acceptance_completed": acceptance_completed,
        },
        "traceability_blockers": traceability_blockers,
        "delivery_blockers": delivery_blockers,
        "warnings": [
            {
                "code": "P0_PERMISSION_ID_DIRECT_LINK_UNAVAILABLE",
                "message": (
                    "Page routes contain permission codes while the role matrix contains PERM-* "
                    "identifiers; unmapped permission codes remain a traceability hard blocker."
                ),
            }
        ],
        "authorization_boundary": (
            "Formal D0-D4 approvals remain mandatory; this report cannot change workbook states, "
            "approve evidence, or authorize V0.1/P0 user-facing implementation."
        ),
    }
    return {
        "p0_traceability_assessment.json": assessment,
        "p0_traceability_matrix.json": matrix,
    }


def p0_candidate_payloads(
    paths: RepositoryPaths,
    *,
    expected_p0_requirement_count: int = EXPECTED_P0_REQUIREMENT_COUNT,
) -> dict[str, Any]:
    return _build_payloads(
        extract_contracts(paths),
        expected_p0_requirement_count=expected_p0_requirement_count,
    )


def build_p0_traceability_report(
    paths: RepositoryPaths,
    *,
    expected_p0_requirement_count: int = EXPECTED_P0_REQUIREMENT_COUNT,
) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        p0_candidate_payloads(
            paths,
            expected_p0_requirement_count=expected_p0_requirement_count,
        )["p0_traceability_assessment.json"],
    )


def write_p0_traceability_candidates(paths: RepositoryPaths) -> list[Path]:
    paths.p0_candidates_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for filename, payload in p0_candidate_payloads(paths).items():
        destination = paths.p0_candidates_dir / filename
        destination.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        written.append(destination)
    return written
