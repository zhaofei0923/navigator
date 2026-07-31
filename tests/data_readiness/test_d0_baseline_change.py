from __future__ import annotations

import copy
import json
import shutil
from pathlib import Path
from typing import Any

from navigator_data_readiness.d0_baseline_change import (
    assess_d0_baseline_change,
    load_and_assess_d0_baseline_change,
)
from navigator_data_readiness.d0_candidates import candidate_payloads
from navigator_data_readiness.d0_contract_resolution import (
    READY_FOR_BASELINE_CHANGE_REVIEW,
)
from navigator_data_readiness.paths import RepositoryPaths, discover_repository
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet


def _completed_resolution(paths: RepositoryPaths) -> dict[str, Any]:
    packet = copy.deepcopy(candidate_payloads(paths)["core_contract_resolution.template.json"])
    packet["template_only"] = False
    for index, item in enumerate(packet["entity_primary_key_resolutions"], start=1):
        if item["current_field_ids"]:
            item["action"] = "promote_existing_field"
            item["primary_key_field_ids"] = [item["current_field_ids"][0]]
        else:
            item["action"] = "add_primary_key_field"
            contract = dict.fromkeys(
                packet["proposed_field_contract_schema"]["allowed_fields"], "test"
            )
            contract.update(
                {
                    "字段编号": f"DATA-PK-{index:03d}",
                    "实体": item["entity_code"],
                    "字段名": "id",
                    "中文名称": "主键",
                    "类型": "uuid",
                    "必填": "是",
                    "来源要求": "系统生成",
                    "唯一/索引": "主键",
                    "单位": "不适用",
                }
            )
            item["proposed_field_contract"] = contract
        item.update(
            {
                "change_request_id": f"CR-D0-ENTITY-{index:03d}",
                "rationale": "补齐显式主键合同",
                "proposed_by": "kevin",
                "proposed_at": "2026-07-31",
                "reviewed_by": "kevin",
                "reviewed_at": "2026-07-31T18:00:00+08:00",
                "evidence_ids": [f"EVD-D0-ENTITY-{index:03d}"],
                "status": "proposed",
            }
        )
    for index, item in enumerate(packet["field_unit_resolutions"], start=1):
        item.update(
            {
                "unit_applicability": "not_applicable",
                "change_request_id": f"CR-D0-UNIT-{index:03d}",
                "rationale": "该字段不适用计量单位",
                "proposed_by": "kevin",
                "proposed_at": "2026-07-31",
                "reviewed_by": "kevin",
                "reviewed_at": "2026-07-31T18:00:00+08:00",
                "evidence_ids": [f"EVD-D0-UNIT-{index:03d}"],
                "status": "proposed",
            }
        )
    packet["final_review"].update(
        {
            "status": READY_FOR_BASELINE_CHANGE_REVIEW,
            "change_set_id": "CR-D0-CORE-CONTRACT-001",
            "reviewed_by": "kevin",
            "reviewed_at": "2026-07-31T19:00:00+08:00",
            "evidence_ids": ["EVD-D0-CORE-CONTRACT-RESOLUTION"],
        }
    )
    return packet


def _headers(sheet: Worksheet) -> dict[str, int]:
    return {
        str(cell.value).strip(): cell.column
        for cell in sheet[4]
        if cell.value is not None and str(cell.value).strip()
    }


def _row_index(sheet: Worksheet, field_id: str) -> int:
    column = _headers(sheet)["字段编号"]
    for row in range(5, sheet.max_row + 1):
        if str(sheet.cell(row, column).value or "").strip() == field_id:
            return row
    raise AssertionError(f"Cannot find {field_id}")


def _next_record_row(sheet: Worksheet) -> int:
    column = _headers(sheet)["字段编号"]
    row = 5
    while str(sheet.cell(row, column).value or "").strip():
        row += 1
    return row


def _key_marker(value: Any) -> str:
    current = str(value or "").strip()
    if "主键" in current:
        return current
    return f"{current}/主键" if current else "主键"


def _apply_resolution(candidate: Path, packet: dict[str, Any]) -> None:
    workbook = load_workbook(candidate)
    try:
        sheet = workbook["核心字段冻结"]
        headers = _headers(sheet)
        unit_column = headers.get("单位")
        if unit_column is None:
            unit_column = max(headers.values()) + 1
            sheet.cell(4, unit_column, "单位")
            headers["单位"] = unit_column

        for item in packet["field_unit_resolutions"]:
            row = _row_index(sheet, item["field_id"])
            value = (
                "不适用" if item["unit_applicability"] == "not_applicable" else item["unit_code"]
            )
            sheet.cell(row, unit_column, value)

        for item in packet["entity_primary_key_resolutions"]:
            if item["action"] in {"promote_existing_field", "model_composite_key"}:
                for field_id in item["primary_key_field_ids"]:
                    row = _row_index(sheet, field_id)
                    column = headers["唯一/索引"]
                    sheet.cell(row, column, _key_marker(sheet.cell(row, column).value))

        next_row = _next_record_row(sheet)
        for item in packet["entity_primary_key_resolutions"]:
            contract = item.get("proposed_field_contract")
            if item["action"] != "add_primary_key_field" or not isinstance(contract, dict):
                continue
            for field, value in contract.items():
                sheet.cell(next_row, headers[field], value)
            next_row += 1
        workbook.save(candidate)
    finally:
        workbook.close()


def _candidate_workbook(
    tmp_path: Path,
    packet: dict[str, Any],
) -> Path:
    paths = discover_repository()
    candidate = tmp_path / "d0-candidate.xlsx"
    shutil.copy2(paths.d0_workbook, candidate)
    _apply_resolution(candidate, packet)
    return candidate


def _codes(report: dict[str, Any]) -> set[str]:
    return {
        str(item["code"])
        for item in report.get("checks", [])
        if isinstance(item, dict) and item.get("code")
    }


def test_candidate_workbook_exactly_applying_resolution_is_ready(tmp_path: Path) -> None:
    paths = discover_repository()
    packet = _completed_resolution(paths)
    candidate = _candidate_workbook(tmp_path, packet)

    report = assess_d0_baseline_change(paths, packet, candidate)

    assert report["candidate_ready_for_formal_baseline_review"] is True, report["checks"]
    assert report["does_not_activate_baseline"] is True
    assert report["checks"] == []
    assert report["core_entity_assessment"]["machine_status"] == "pass"
    assert report["core_field_assessment"]["machine_status"] == "pass"
    assert paths.d0_workbook != candidate


def test_candidate_applies_registered_unit_and_composite_key(tmp_path: Path) -> None:
    paths = discover_repository()
    packet = _completed_resolution(paths)
    unit = packet["field_unit_resolutions"][0]
    unit.update(
        {
            "unit_applicability": "unit_code",
            "unit_code": "MW",
            "unit_dimension": "power",
            "unit_registry_reference": "UNIT-REGISTRY-SI-POWER",
        }
    )
    composite = next(
        item
        for item in packet["entity_primary_key_resolutions"]
        if len(item["current_field_ids"]) >= 2
    )
    composite["action"] = "model_composite_key"
    composite["primary_key_field_ids"] = composite["current_field_ids"][:2]
    candidate = _candidate_workbook(tmp_path, packet)

    report = assess_d0_baseline_change(paths, packet, candidate)

    assert report["candidate_ready_for_formal_baseline_review"] is True, report["checks"]


def test_unchanged_candidate_cannot_satisfy_resolution(tmp_path: Path) -> None:
    paths = discover_repository()
    candidate = tmp_path / "unchanged.xlsx"
    shutil.copy2(paths.d0_workbook, candidate)

    report = assess_d0_baseline_change(paths, _completed_resolution(paths), candidate)
    codes = _codes(report)

    assert report["candidate_ready_for_formal_baseline_review"] is False
    assert "D0_CHANGE_WORKBOOK_UNCHANGED" in codes
    assert "D0_CHANGE_FIELD_HEADER_INVALID" in codes
    assert "D0_CHANGE_FIELD_EVIDENCE_NOT_READY" in codes


def test_unreviewed_field_change_is_rejected(tmp_path: Path) -> None:
    paths = discover_repository()
    packet = _completed_resolution(paths)
    candidate = _candidate_workbook(tmp_path, packet)
    workbook = load_workbook(candidate)
    try:
        sheet = workbook["核心字段冻结"]
        row = _row_index(sheet, "DATA-USER-001")
        sheet.cell(row, _headers(sheet)["中文名称"], "未评审名称")
        workbook.save(candidate)
    finally:
        workbook.close()

    report = assess_d0_baseline_change(paths, packet, candidate)

    assert "D0_CHANGE_FIELD_ROW_MISMATCH" in _codes(report)
    assert "D0_CHANGE_UNAUTHORIZED_CELL_CHANGE" in _codes(report)


def test_unit_and_primary_key_must_be_applied_exactly(tmp_path: Path) -> None:
    paths = discover_repository()
    packet = _completed_resolution(paths)
    candidate = _candidate_workbook(tmp_path, packet)
    workbook = load_workbook(candidate)
    try:
        sheet = workbook["核心字段冻结"]
        unit_row = _row_index(sheet, "DATA-USER-001")
        sheet.cell(unit_row, _headers(sheet)["单位"], "MW")
        key_item = next(
            item
            for item in packet["entity_primary_key_resolutions"]
            if item["primary_key_field_ids"]
        )
        key_row = _row_index(sheet, key_item["primary_key_field_ids"][0])
        sheet.cell(key_row, _headers(sheet)["唯一/索引"], "索引")
        workbook.save(candidate)
    finally:
        workbook.close()

    report = assess_d0_baseline_change(paths, packet, candidate)
    codes = _codes(report)

    assert "D0_CHANGE_FIELD_ROW_MISMATCH" in codes
    assert "D0_CHANGE_ENTITY_EVIDENCE_NOT_READY" in codes


def test_candidate_cannot_add_unreviewed_field_or_header(tmp_path: Path) -> None:
    paths = discover_repository()
    packet = _completed_resolution(paths)
    candidate = _candidate_workbook(tmp_path, packet)
    workbook = load_workbook(candidate)
    try:
        sheet = workbook["核心字段冻结"]
        extra_column = max(_headers(sheet).values()) + 1
        sheet.cell(4, extra_column, "未评审列")
        row = _next_record_row(sheet)
        sheet.cell(row, _headers(sheet)["字段编号"], "DATA-UNREVIEWED-001")
        workbook.save(candidate)
    finally:
        workbook.close()

    report = assess_d0_baseline_change(paths, packet, candidate)
    codes = _codes(report)

    assert "D0_CHANGE_FIELD_HEADER_INVALID" in codes
    assert "D0_CHANGE_FIELD_ID_SET_INVALID" in codes
    assert "D0_CHANGE_FIELD_ID_SEQUENCE_INVALID" in codes


def test_candidate_cannot_change_other_d0_contract_or_formula_cell(tmp_path: Path) -> None:
    paths = discover_repository()
    packet = _completed_resolution(paths)
    candidate = _candidate_workbook(tmp_path, packet)
    workbook = load_workbook(candidate)
    try:
        sheet = workbook["枚举规则冻结"]
        sheet.cell(5, _headers(sheet)["中文名称"], '="未评审公式"')
        workbook.save(candidate)
    finally:
        workbook.close()

    report = assess_d0_baseline_change(paths, packet, candidate)
    codes = _codes(report)

    assert "D0_CHANGE_UNAUTHORIZED_CONTRACT_CHANGE" in codes
    assert "D0_CHANGE_UNAUTHORIZED_CELL_CHANGE" in codes


def test_candidate_cannot_change_sheet_set(tmp_path: Path) -> None:
    paths = discover_repository()
    packet = _completed_resolution(paths)
    candidate = _candidate_workbook(tmp_path, packet)
    workbook = load_workbook(candidate)
    try:
        workbook.create_sheet("未评审工作表")
        workbook.save(candidate)
    finally:
        workbook.close()

    report = assess_d0_baseline_change(paths, packet, candidate)

    assert "D0_CHANGE_SHEET_SET_INVALID" in _codes(report)


def test_source_workbook_and_missing_candidate_are_rejected(tmp_path: Path) -> None:
    paths = discover_repository()
    packet = _completed_resolution(paths)

    source_report = assess_d0_baseline_change(paths, packet, paths.d0_workbook)
    missing_report = assess_d0_baseline_change(paths, packet, tmp_path / "missing.xlsx")

    assert _codes(source_report) == {"D0_CHANGE_SOURCE_WORKBOOK_FORBIDDEN"}
    assert _codes(missing_report) == {"D0_CHANGE_WORKBOOK_MISSING"}


def test_invalid_resolution_and_workbook_are_reported(tmp_path: Path) -> None:
    paths = discover_repository()
    invalid_resolution = tmp_path / "resolution.json"
    invalid_resolution.write_text("[]", encoding="utf-8")
    broken_workbook = tmp_path / "broken.xlsx"
    broken_workbook.write_bytes(b"not an xlsx")

    invalid_report = load_and_assess_d0_baseline_change(
        paths,
        invalid_resolution,
        broken_workbook,
    )
    broken_report = assess_d0_baseline_change(
        paths,
        _completed_resolution(paths),
        broken_workbook,
    )

    assert _codes(invalid_report) == {"D0_CHANGE_RESOLUTION_INVALID"}
    assert "D0_CHANGE_WORKBOOK_INVALID" in _codes(broken_report)


def test_assessment_can_be_serialized(tmp_path: Path) -> None:
    paths = discover_repository()
    packet = _completed_resolution(paths)
    candidate = _candidate_workbook(tmp_path, packet)

    payload = json.dumps(
        assess_d0_baseline_change(paths, packet, candidate),
        ensure_ascii=False,
    )

    assert "candidate_ready_for_formal_baseline_review" in payload
