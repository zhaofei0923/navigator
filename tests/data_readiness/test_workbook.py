from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from navigator_data_readiness.workbook import (
    normalized_headers,
    normalized_value,
    rows_from_sections,
    table_records,
)
from openpyxl import Workbook


def test_normalized_headers_are_non_empty_and_unique() -> None:
    assert normalized_headers(["编号", "状态", "状态", None]) == [
        "编号",
        "状态",
        "状态_2",
        "column_4",
    ]


def test_table_records_skips_titles_and_stops_after_blank_rows() -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["标题"])
    sheet.append(["说明"])
    sheet.append([])
    sheet.append(["编号", "状态"])
    sheet.append(["D0-01", "进行中"])
    sheet.append([])
    sheet.append([])
    sheet.append(["不应读取", "不应读取"])

    assert table_records(sheet) == [{"编号": "D0-01", "状态": "进行中"}]


def test_normalized_value_serializes_dates() -> None:
    assert normalized_value(datetime(2026, 7, 31, tzinfo=UTC)) == "2026-07-31T00:00:00+00:00"
    assert normalized_value(Decimal("1.25")) == 1.25


def test_empty_sheet_and_section_reader() -> None:
    workbook = Workbook()
    sheet = workbook.active

    assert table_records(sheet) == []
    assert rows_from_sections(sheet, [("empty", 4, 4)]) == {"empty": []}
