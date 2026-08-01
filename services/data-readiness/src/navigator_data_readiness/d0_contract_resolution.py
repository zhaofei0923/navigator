from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .baseline import extract_contracts, sha256_file
from .d0_candidates import (
    build_core_contract_resolution_template,
    build_core_entity_evidence,
    build_core_field_evidence,
)
from .d0_review import validate_review_packet
from .models import CheckResult
from .paths import RepositoryPaths

READY_FOR_BASELINE_CHANGE_REVIEW = "ready_for_baseline_change_review"
PROPOSED = "proposed"


def _text(item: dict[str, Any], field: str) -> str:
    return str(item.get(field) or "").strip()


def _expected_template(paths: RepositoryPaths) -> dict[str, Any]:
    contracts = extract_contracts(paths)
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
    entity_evidence = build_core_entity_evidence(contracts, source_binding=source_binding)
    field_evidence = build_core_field_evidence(contracts, source_binding=source_binding)
    return build_core_contract_resolution_template(
        contracts,
        source_binding=source_binding,
        core_entity_evidence=entity_evidence,
        core_field_evidence=field_evidence,
    )


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
                code="D0_CONTRACT_RESOLUTION_SECTION_INVALID",
                message=f"{section} must be a list",
                location=section,
            )
        )
        return {}
    indexed: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict) or not _text(item, identifier_field):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_ENTRY_INVALID",
                    message=f"{section}[{index}] requires {identifier_field}",
                    location=section,
                )
            )
            continue
        identifier = _text(item, identifier_field)
        if identifier in indexed:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_ENTRY_DUPLICATE",
                    message=f"Duplicate {identifier_field}: {identifier}",
                    location=section,
                )
            )
            continue
        indexed[identifier] = item
    return indexed


def _check_exact_ids(
    checks: list[CheckResult],
    actual: set[str],
    expected: set[str],
    *,
    code: str,
    location: str,
) -> None:
    missing = sorted(expected - actual)
    unknown = sorted(actual - expected)
    if missing:
        checks.append(
            CheckResult(
                code=code, message=f"Missing entries: {', '.join(missing)}", location=location
            )
        )
    if unknown:
        checks.append(
            CheckResult(
                code=code, message=f"Unknown entries: {', '.join(unknown)}", location=location
            )
        )


def _temporal_value(
    checks: list[CheckResult],
    item: dict[str, Any],
    field: str,
    *,
    location: str,
) -> None:
    value = _text(item, field)
    if not value:
        return
    try:
        if len(value) == 10:
            date.fromisoformat(value)
        else:
            parsed = datetime.fromisoformat(value)
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                raise ValueError
    except ValueError:
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_TEMPORAL_INVALID",
                message=f"{field} must be an ISO date or timezone-aware ISO datetime",
                location=location,
            )
        )


def _evidence_ids(
    checks: list[CheckResult],
    item: dict[str, Any],
    *,
    location: str,
) -> list[str]:
    value = item.get("evidence_ids")
    if not isinstance(value, list) or not value or any(not str(entry).strip() for entry in value):
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_EVIDENCE_MISSING",
                message="At least one non-empty evidence ID is required",
                location=location,
            )
        )
        return []
    identifiers = [str(entry).strip() for entry in value]
    if len(identifiers) != len(set(identifiers)):
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_EVIDENCE_DUPLICATE",
                message="evidence_ids contains duplicate IDs",
                location=location,
            )
        )
    return identifiers


def _latest_formal_review(paths: RepositoryPaths) -> Path | None:
    candidates = sorted(
        path
        for path in paths.d0_review_dir.glob("d0_review_packet.*.json")
        if ".template." not in path.name
    )
    return candidates[-1] if candidates else None


def _role_holders(
    paths: RepositoryPaths,
    checks: list[CheckResult],
    authority_packet: dict[str, Any] | None = None,
) -> dict[str, str]:
    review_path = _latest_formal_review(paths) if authority_packet is None else None
    if review_path is None and authority_packet is None:
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_AUTHORITY_MISSING",
                message="No formal D0 review packet is available for named-role authorization",
                location="authority",
            )
        )
        return {}
    if authority_packet is not None:
        payload: Any = authority_packet
        authority_location = "authority_packet"
    else:
        assert review_path is not None
        try:
            payload = json.loads(review_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            payload = None
        try:
            authority_location = review_path.relative_to(paths.root).as_posix()
        except ValueError:
            authority_location = str(review_path)
    if not isinstance(payload, dict):
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_AUTHORITY_INVALID",
                message="The formal D0 review packet is not a valid JSON object",
                location=authority_location,
            )
        )
        return {}

    authority_codes = {
        "D0_REVIEW_HEADER_INVALID",
        "D0_REVIEW_TEMPLATE_UNCOPIED",
        "D0_REVIEW_BASELINE_INVALID",
        "D0_REVIEW_BASELINE_STALE",
        "D0_REVIEW_CANDIDATES_STALE",
        "D0_REVIEW_ROLE_SET_INVALID",
        "D0_REVIEW_ROLE_PENDING",
        "D0_REVIEW_ROLE_INCOMPLETE",
        "D0_REVIEW_ROLE_SEPARATION_INVALID",
    }
    authority_checks = [
        check
        for check in validate_review_packet(paths, payload)
        if check.code in authority_codes or (check.location or "").startswith("role_assignments")
    ]
    if authority_checks:
        for authority_check in authority_checks:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_AUTHORITY_INVALID",
                    message=f"{authority_check.code}: {authority_check.message}",
                    location=authority_check.location or "authority",
                )
            )
        return {}

    assignments = payload.get("role_assignments")
    if not isinstance(assignments, list):
        return {}
    return {
        str(item.get("role") or "").strip(): str(item.get("role_holder") or "").strip()
        for item in assignments
        if isinstance(item, dict)
        and item.get("status") == "signed"
        and str(item.get("role") or "").strip()
        and str(item.get("role_holder") or "").strip()
    }


def _decision_metadata(
    checks: list[CheckResult],
    item: dict[str, Any],
    *,
    location: str,
    role_holders: dict[str, str],
) -> None:
    required = (
        "change_request_id",
        "rationale",
        "proposed_by",
        "proposed_at",
        "reviewed_by",
        "reviewed_at",
    )
    missing = [field for field in required if not _text(item, field)]
    if missing:
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_METADATA_INCOMPLETE",
                message=f"Missing required fields: {', '.join(missing)}",
                location=location,
            )
        )
    for prefix in ("proposed", "reviewed"):
        role = _text(item, f"{prefix}_by_role")
        person = _text(item, f"{prefix}_by")
        if not role or person != role_holders.get(role):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_REVIEWER_UNAUTHORIZED",
                    message=f"{person or 'Missing person'} is not the signed holder of {role}",
                    location=location,
                )
            )
        _temporal_value(checks, item, f"{prefix}_at", location=location)
    _evidence_ids(checks, item, location=location)


def _id_list(
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
                code="D0_CONTRACT_RESOLUTION_ID_LIST_INVALID",
                message=f"{field} must be a list",
                location=location,
            )
        )
        return []
    identifiers = [str(entry).strip() for entry in value if str(entry).strip()]
    if len(identifiers) != len(value) or len(identifiers) != len(set(identifiers)):
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_ID_LIST_INVALID",
                message=f"{field} must contain unique non-empty IDs",
                location=location,
            )
        )
    return identifiers


def validate_d0_contract_resolution(
    paths: RepositoryPaths,
    payload: dict[str, Any],
    *,
    authority_packet: dict[str, Any] | None = None,
) -> list[CheckResult]:
    checks: list[CheckResult] = []
    if payload.get("schema_version") != 1 or payload.get("stage") != "D0":
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_HEADER_INVALID",
                message="Resolution packet requires schema_version 1 and stage D0",
                location="resolution_packet",
            )
        )
    if payload.get("template_only") is not False:
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_TEMPLATE_UNCOPIED",
                message="Copy the generated template and set template_only to false",
                location="template_only",
            )
        )

    template = _expected_template(paths)
    if payload.get("baseline") != template["baseline"]:
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_BASELINE_STALE",
                message="Baseline sources or machine-evidence hashes do not match current inputs",
                location="baseline",
            )
        )
    for field in (
        "allowed_entity_actions",
        "allowed_compound_actions",
        "proposed_field_contract_schema",
    ):
        if payload.get(field) != template[field]:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_SCHEMA_CHANGED",
                    message=f"{field} differs from the generated template",
                    location=field,
                )
            )

    role_holders = _role_holders(paths, checks, authority_packet)
    contracts = extract_contracts(paths)
    existing_fields = {
        str(item.get("字段编号") or "").strip(): item
        for item in contracts["fields"]
        if str(item.get("字段编号") or "").strip()
    }

    entities = _indexed_items(checks, payload, "entity_primary_key_resolutions", "entity_code")
    template_entities = {
        str(item["entity_code"]): item for item in template["entity_primary_key_resolutions"]
    }
    _check_exact_ids(
        checks,
        set(entities),
        set(template_entities),
        code="D0_CONTRACT_RESOLUTION_ENTITY_SET_INVALID",
        location="entity_primary_key_resolutions",
    )
    proposed_field_ids: set[str] = set()
    allowed_actions = set(template["allowed_entity_actions"])
    field_schema = template["proposed_field_contract_schema"]
    allowed_contract_fields = set(field_schema["allowed_fields"])
    required_contract_fields = set(field_schema["required_fields"])
    for entity_code, item in entities.items():
        location = f"entity_primary_key_resolutions.{entity_code}"
        expected = template_entities.get(entity_code)
        if expected and any(
            item.get(field) != expected.get(field)
            for field in (
                "entity_code",
                "current_field_ids",
                "proposed_by_role",
                "reviewed_by_role",
            )
        ):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_ENTITY_INPUT_CHANGED",
                    message=f"{entity_code} immutable inputs differ from the template",
                    location=location,
                )
            )
        action = item.get("action")
        if action is None and item.get("status") == "pending":
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_ENTITY_PENDING",
                    message=f"{entity_code} has no proposed primary-key resolution",
                    location=location,
                )
            )
            continue
        if action not in allowed_actions:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_ENTITY_ACTION_INVALID",
                    message=f"{entity_code} has an invalid action",
                    location=location,
                )
            )
            continue
        if item.get("status") != PROPOSED:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_STATUS_INVALID",
                    message=f"{entity_code} status must be {PROPOSED}",
                    location=location,
                )
            )
        _decision_metadata(checks, item, location=location, role_holders=role_holders)
        primary_key_ids = _id_list(checks, item, "primary_key_field_ids", location=location)
        current_ids = set(expected["current_field_ids"] if expected else [])
        proposed_contract = item.get("proposed_field_contract")
        if action in {"promote_existing_field", "model_composite_key"}:
            expected_count_ok = (
                len(primary_key_ids) == 1
                if action == "promote_existing_field"
                else len(primary_key_ids) >= 2
            )
            if (
                not expected_count_ok
                or not set(primary_key_ids) <= current_ids
                or proposed_contract is not None
            ):
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_ENTITY_KEY_INVALID",
                        message=(
                            f"{action} must reference the required number of current fields "
                            "and cannot include a new field contract"
                        ),
                        location=location,
                    )
                )
            for field_id in primary_key_ids:
                if str(existing_fields.get(field_id, {}).get("实体") or "").strip() != entity_code:
                    checks.append(
                        CheckResult(
                            code="D0_CONTRACT_RESOLUTION_ENTITY_FIELD_MISMATCH",
                            message=f"{field_id} does not belong to {entity_code}",
                            location=location,
                        )
                    )
        else:
            if primary_key_ids:
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_ENTITY_KEY_INVALID",
                        message="add_primary_key_field must use proposed_field_contract only",
                        location=location,
                    )
                )
            if not isinstance(proposed_contract, dict):
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_NEW_FIELD_INVALID",
                        message="add_primary_key_field requires a complete field contract",
                        location=location,
                    )
                )
                continue
            contract_fields = set(proposed_contract)
            missing_fields = sorted(
                field
                for field in required_contract_fields
                if not str(proposed_contract.get(field) or "").strip()
            )
            if contract_fields != allowed_contract_fields or missing_fields:
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_NEW_FIELD_INCOMPLETE",
                        message=(
                            "New field contract must contain exactly the approved schema with "
                            "non-empty required fields; missing: "
                            f"{', '.join(missing_fields) or 'none'}"
                        ),
                        location=location,
                    )
                )
            field_id = _text(proposed_contract, "字段编号")
            if not field_id or field_id in existing_fields or field_id in proposed_field_ids:
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_NEW_FIELD_ID_INVALID",
                        message=f"New field ID {field_id or 'missing'} is empty or already used",
                        location=location,
                    )
                )
            elif field_id:
                proposed_field_ids.add(field_id)
            if (
                _text(proposed_contract, "实体") != entity_code
                or _text(proposed_contract, "必填") != "是"
                or "主键" not in _text(proposed_contract, "唯一/索引")
                or _text(proposed_contract, "单位") in {"", "待填", "待确认", "pending"}
            ):
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_NEW_FIELD_CONTRACT_INVALID",
                        message=(
                            "New primary-key field must match the entity, be required, be marked "
                            "as a primary key, and state a unit or 不适用"
                        ),
                        location=location,
                    )
                )

    compounds = _indexed_items(
        checks,
        payload,
        "compound_field_resolutions",
        "source_field_id",
    )
    template_compounds = {
        str(item["source_field_id"]): item for item in template["compound_field_resolutions"]
    }
    _check_exact_ids(
        checks,
        set(compounds),
        set(template_compounds),
        code="D0_CONTRACT_RESOLUTION_COMPOUND_SET_INVALID",
        location="compound_field_resolutions",
    )
    resolved_compound_ids: set[str] = set()
    allowed_compound_actions = set(template["allowed_compound_actions"])
    immutable_compound_fields = (
        "source_field_id",
        "entity_code",
        "source_field_contract",
        "proposed_by_role",
        "reviewed_by_role",
    )
    for source_field_id, item in compounds.items():
        location = f"compound_field_resolutions.{source_field_id}"
        expected = template_compounds.get(source_field_id)
        if expected and any(
            item.get(field) != expected.get(field) for field in immutable_compound_fields
        ):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_COMPOUND_INPUT_CHANGED",
                    message=f"{source_field_id} immutable inputs differ from the template",
                    location=location,
                )
            )
        action = item.get("action")
        if action is None and item.get("status") == "pending":
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_COMPOUND_PENDING",
                    message=f"{source_field_id} has no atomic-field resolution",
                    location=location,
                )
            )
            continue
        if action not in allowed_compound_actions:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_COMPOUND_ACTION_INVALID",
                    message=f"{source_field_id} has an invalid compound action",
                    location=location,
                )
            )
            continue
        if item.get("status") != PROPOSED:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_STATUS_INVALID",
                    message=f"{source_field_id} status must be {PROPOSED}",
                    location=location,
                )
            )
        _decision_metadata(checks, item, location=location, role_holders=role_holders)

        raw_contracts = item.get("proposed_field_contracts")
        if not isinstance(raw_contracts, list) or len(raw_contracts) < 2:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_COMPOUND_FIELDS_INVALID",
                    message="split_field_contract requires at least two complete child contracts",
                    location=location,
                )
            )
            continue
        source_contract = expected.get("source_field_contract", {}) if expected else {}
        source_names = str(source_contract.get("字段名") or "").split("/")
        source_types = str(source_contract.get("类型") or "").split("/")
        if len(source_names) != len(source_types) or len(raw_contracts) != len(source_names):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_COMPOUND_ARITY_INVALID",
                    message=(
                        "Child contract count must exactly match the source field-name and "
                        "data-type components"
                    ),
                    location=location,
                )
            )

        child_ids: list[str] = []
        contracts_by_id: dict[str, dict[str, Any]] = {}
        for index, contract in enumerate(raw_contracts):
            child_location = f"{location}.proposed_field_contracts.{index}"
            if not isinstance(contract, dict):
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_COMPOUND_FIELD_INVALID",
                        message="Each child field contract must be an object",
                        location=child_location,
                    )
                )
                continue
            contract_fields = set(contract)
            missing_fields = sorted(
                field
                for field in required_contract_fields
                if not str(contract.get(field) or "").strip()
            )
            if contract_fields != allowed_contract_fields or missing_fields:
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_COMPOUND_FIELD_INCOMPLETE",
                        message=(
                            "Child field contract must contain exactly the approved schema with "
                            f"non-empty values; missing: {', '.join(missing_fields) or 'none'}"
                        ),
                        location=child_location,
                    )
                )
            child_id = _text(contract, "字段编号")
            if (
                not child_id
                or child_id in existing_fields
                or child_id in proposed_field_ids
                or child_id in contracts_by_id
            ):
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_COMPOUND_FIELD_ID_INVALID",
                        message=f"Child field ID {child_id or 'missing'} is empty or already used",
                        location=child_location,
                    )
                )
            elif child_id:
                proposed_field_ids.add(child_id)
                child_ids.append(child_id)
                contracts_by_id[child_id] = contract
            if (
                _text(contract, "实体") != _text(item, "entity_code")
                or index >= len(source_names)
                or _text(contract, "字段名") != source_names[index]
                or index >= len(source_types)
                or _text(contract, "类型") != source_types[index]
            ):
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_COMPOUND_COMPONENT_INVALID",
                        message=(
                            "Each child must preserve the source entity and the ordered "
                            "field-name/data-type component"
                        ),
                        location=child_location,
                    )
                )

        raw_child_units = item.get("proposed_field_unit_resolutions")
        if not isinstance(raw_child_units, list):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_COMPOUND_UNIT_SET_INVALID",
                    message="proposed_field_unit_resolutions must be a list",
                    location=location,
                )
            )
            raw_child_units = []
        child_units: dict[str, dict[str, Any]] = {}
        for index, child_unit in enumerate(raw_child_units):
            child_location = f"{location}.proposed_field_unit_resolutions.{index}"
            if not isinstance(child_unit, dict) or not _text(child_unit, "field_id"):
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_COMPOUND_UNIT_INVALID",
                        message="Each child unit entry requires a field_id",
                        location=child_location,
                    )
                )
                continue
            child_id = _text(child_unit, "field_id")
            if child_id in child_units:
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_COMPOUND_UNIT_INVALID",
                        message=f"Duplicate child unit entry: {child_id}",
                        location=child_location,
                    )
                )
                continue
            child_units[child_id] = child_unit
        if set(child_units) != set(child_ids):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_COMPOUND_UNIT_SET_INVALID",
                    message=(
                        "Child unit IDs must exactly match the proposed child contracts; "
                        f"missing={sorted(set(child_ids) - set(child_units))}, "
                        f"unexpected={sorted(set(child_units) - set(child_ids))}"
                    ),
                    location=location,
                )
            )
        for child_id, child_unit in child_units.items():
            child_location = f"{location}.proposed_field_unit_resolutions.{child_id}"
            applicability = child_unit.get("unit_applicability")
            unit_values = tuple(
                _text(child_unit, field)
                for field in ("unit_code", "unit_dimension", "unit_registry_reference")
            )
            contract_unit = _text(contracts_by_id.get(child_id, {}), "单位")
            if applicability == "unit_code":
                if not all(unit_values) or contract_unit != unit_values[0]:
                    checks.append(
                        CheckResult(
                            code="D0_CONTRACT_RESOLUTION_COMPOUND_UNIT_METADATA_INCOMPLETE",
                            message=(
                                "Child unit_code requires code, dimension, registry reference, "
                                "and the same code in the child contract"
                            ),
                            location=child_location,
                        )
                    )
            elif applicability == "not_applicable":
                if any(unit_values) or contract_unit != "不适用":
                    checks.append(
                        CheckResult(
                            code="D0_CONTRACT_RESOLUTION_COMPOUND_UNIT_METADATA_CONFLICT",
                            message=(
                                "A not-applicable child cannot include unit metadata and must "
                                "state 不适用 in its field contract"
                            ),
                            location=child_location,
                        )
                    )
            else:
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_COMPOUND_UNIT_INVALID",
                        message=f"{child_id} has an invalid unit_applicability",
                        location=child_location,
                    )
                )
        resolved_compound_ids.add(source_field_id)

    units = _indexed_items(checks, payload, "field_unit_resolutions", "field_id")
    template_units = {str(item["field_id"]): item for item in template["field_unit_resolutions"]}
    _check_exact_ids(
        checks,
        set(units),
        set(template_units),
        code="D0_CONTRACT_RESOLUTION_FIELD_SET_INVALID",
        location="field_unit_resolutions",
    )
    immutable_unit_fields = (
        "field_id",
        "entity_code",
        "field_name",
        "data_type",
        "required",
        "current_unit",
        "proposed_by_role",
        "reviewed_by_role",
    )
    for field_id, item in units.items():
        location = f"field_unit_resolutions.{field_id}"
        expected = template_units.get(field_id)
        if expected and any(
            item.get(field) != expected.get(field) for field in immutable_unit_fields
        ):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_FIELD_INPUT_CHANGED",
                    message=f"{field_id} immutable inputs differ from the template",
                    location=location,
                )
            )
        applicability = item.get("unit_applicability")
        if applicability == "pending" and item.get("status") == "pending":
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_UNIT_PENDING",
                    message=f"{field_id} has no unit or not-applicable decision",
                    location=location,
                )
            )
            continue
        if applicability == "replaced_by_split":
            unit_values = tuple(
                _text(item, field)
                for field in ("unit_code", "unit_dimension", "unit_registry_reference")
            )
            if field_id not in resolved_compound_ids or any(unit_values):
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_REPLACED_UNIT_INVALID",
                        message=(
                            "replaced_by_split is allowed only for a resolved compound source "
                            "and cannot include unit metadata"
                        ),
                        location=location,
                    )
                )
            if item.get("status") != PROPOSED:
                checks.append(
                    CheckResult(
                        code="D0_CONTRACT_RESOLUTION_STATUS_INVALID",
                        message=f"{field_id} status must be {PROPOSED}",
                        location=location,
                    )
                )
            _decision_metadata(checks, item, location=location, role_holders=role_holders)
            continue
        if field_id in resolved_compound_ids:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_REPLACED_UNIT_INVALID",
                    message="A split compound source must use replaced_by_split",
                    location=location,
                )
            )
        if applicability not in {"unit_code", "not_applicable"}:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_UNIT_INVALID",
                    message=f"{field_id} has an invalid unit_applicability",
                    location=location,
                )
            )
            continue
        if item.get("status") != PROPOSED:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_STATUS_INVALID",
                    message=f"{field_id} status must be {PROPOSED}",
                    location=location,
                )
            )
        _decision_metadata(checks, item, location=location, role_holders=role_holders)
        unit_values = tuple(
            _text(item, field)
            for field in ("unit_code", "unit_dimension", "unit_registry_reference")
        )
        if applicability == "unit_code" and not all(unit_values):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_UNIT_METADATA_INCOMPLETE",
                    message="unit_code requires code, dimension, and registry reference",
                    location=location,
                )
            )
        if applicability == "not_applicable" and any(unit_values):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_UNIT_METADATA_CONFLICT",
                    message="not_applicable cannot include unit metadata",
                    location=location,
                )
            )

    final_review = payload.get("final_review")
    if not isinstance(final_review, dict):
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_FINAL_INVALID",
                message="final_review must be an object",
                location="final_review",
            )
        )
    elif final_review.get("status") != READY_FOR_BASELINE_CHANGE_REVIEW:
        checks.append(
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_FINAL_PENDING",
                message="Final review has not marked the proposal ready for baseline change review",
                location="final_review",
            )
        )
    else:
        if final_review.get("reviewed_by_role") != template["final_review"]["reviewed_by_role"]:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_FINAL_ROLE_INVALID",
                    message="Final review must use the frozen project approver role",
                    location="final_review",
                )
            )
        missing = [
            field
            for field in ("change_set_id", "reviewed_by", "reviewed_at")
            if not _text(final_review, field)
        ]
        if missing:
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_FINAL_INCOMPLETE",
                    message=f"Missing final fields: {', '.join(missing)}",
                    location="final_review",
                )
            )
        reviewer_role = _text(final_review, "reviewed_by_role")
        reviewer = _text(final_review, "reviewed_by")
        if reviewer != role_holders.get(reviewer_role):
            checks.append(
                CheckResult(
                    code="D0_CONTRACT_RESOLUTION_REVIEWER_UNAUTHORIZED",
                    message=(
                        f"{reviewer or 'Missing person'} is not the signed holder of "
                        f"{reviewer_role}"
                    ),
                    location="final_review",
                )
            )
        _temporal_value(checks, final_review, "reviewed_at", location="final_review")
        _evidence_ids(checks, final_review, location="final_review")
    return checks


def load_and_validate_d0_contract_resolution(
    paths: RepositoryPaths,
    packet_path: Path,
) -> list[CheckResult]:
    try:
        payload = json.loads(packet_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return [
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_PACKET_INVALID",
                message=f"Could not load resolution packet: {exc}",
                location=str(packet_path),
            )
        ]
    if not isinstance(payload, dict):
        return [
            CheckResult(
                code="D0_CONTRACT_RESOLUTION_PACKET_INVALID",
                message="Resolution packet must be a JSON object",
                location=str(packet_path),
            )
        ]
    return validate_d0_contract_resolution(paths, payload)
