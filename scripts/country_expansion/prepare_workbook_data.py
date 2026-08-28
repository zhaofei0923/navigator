"""Prepare typed rows for the artifact-tool copy of the expanded raw workbook."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import posixpath
import re
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from typing import Any
from zipfile import ZipFile

SHEETS = [
    ("国家概况", "country_profiles", "原档案统计年份不变；本次新增赞比亚，具体字段年份见表。"),
    ("宏观能源", "country_macro_energy", "宏观2020—2024；能源按实际指标年份；缺失值不补零。"),
    ("官方来源", "country_official_sources", "仅新增赞比亚官方来源入口；许可由人工决定。"),
    ("政策目录", "country_policy_register", "原政策记录不变；赞比亚原文与受限条目如实登记。"),
    (
        "专题覆盖",
        "country_policy_topic_coverage",
        "每国7项专题；覆盖状态不等于政策效力或许可批准。",
    ),
]


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers, rows = list(reader.fieldnames or ()), list(reader)
    if (
        not headers
        or any(not header for header in headers)
        or len(headers) != len(set(headers))
        or any(None in row or any(value is None for value in row.values()) for row in rows)
    ):
        raise ValueError(f"Invalid CSV shape: {path}")
    return headers, rows


def _readable(value: Any) -> str:
    """Flatten display-only lists/notes; do not change the canonical JSON or CSV."""
    if isinstance(value, list):
        return "；".join(_readable(item) for item in value)
    if isinstance(value, dict):
        return "；".join(f"{key}：{_readable(item)}" for key, item in value.items())
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def cell(key: str, value: str) -> str | float | int | None:
    if value == "":
        return None
    numeric = key in {
        "order",
        "priority",
        "year",
        "population",
        "area_sq_km",
        "admin_level_1_count",
    } or key.endswith(("_year", "_usd", "_pct", "_mw", "_gwh"))
    if numeric:
        number = float(value)
        if not math.isfinite(number):
            raise ValueError(f"Non-finite numeric value for {key}")
        return int(number) if number.is_integer() else number
    if value.lstrip().startswith("[") or (key == "notes" and value.lstrip().startswith("{")):
        try:
            structured = json.loads(value)
        except json.JSONDecodeError:
            return value
        if isinstance(structured, list) or (key == "notes" and isinstance(structured, dict)):
            return _readable(structured)
    return value


def reference_layout(path: Path) -> tuple[str, dict[str, dict[str, Any]]]:
    """Read original OOXML headers/table bounds from the exact bytes being hashed."""
    payload = path.read_bytes()
    namespace = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    relationship_id = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

    def part_path(base: str, target: str) -> str:
        resolved = posixpath.normpath(
            target.lstrip("/")
            if target.startswith("/")
            else posixpath.join(posixpath.dirname(base), target)
        )
        if not resolved.startswith("xl/"):
            raise ValueError("Workbook relationship must remain inside xl/")
        return resolved

    with ZipFile(BytesIO(payload)) as archive:

        def relationships(part: str) -> dict[str, str]:
            name = posixpath.join(
                posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels"
            )
            if name not in archive.namelist():
                return {}
            root = ET.fromstring(archive.read(name))
            return {
                row.attrib["Id"]: part_path(part, row.attrib["Target"])
                for row in root
                if row.attrib.get("TargetMode") != "External"
            }

        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = [
                "".join(text.text or "" for text in item.findall(".//m:t", namespace))
                for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall(
                    "m:si", namespace
                )
            ]

        def cell_text(node: ET.Element) -> str:
            value = node.findtext("m:v", default="", namespaces=namespace)
            if node.attrib.get("t") == "s":
                return strings[int(value)]
            if node.attrib.get("t") == "inlineStr":
                return "".join(text.text or "" for text in node.findall(".//m:t", namespace))
            return value

        workbook_relationships = relationships("xl/workbook.xml")
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        expected_sheets = {name for name, _, _ in SHEETS} | {"质量检查"}
        layouts = {}
        for sheet in workbook.findall("m:sheets/m:sheet", namespace):
            name = sheet.attrib["name"]
            if name not in expected_sheets:
                continue
            part = workbook_relationships[sheet.attrib[relationship_id]]
            root = ET.fromstring(archive.read(part))
            table_parts = root.findall("m:tableParts/m:tablePart", namespace)
            if len(table_parts) != 1:
                raise ValueError(f"Expected one original table on {name}")
            table_path = relationships(part)[table_parts[0].attrib[relationship_id]]
            table = ET.fromstring(archive.read(table_path))
            bounds = re.fullmatch(r"A4:([A-Z]+)(\d+)", table.attrib["ref"])
            if (
                bounds is None
                or table.attrib.get("headerRowCount", "1") != "1"
                or table.attrib.get("totalsRowCount", "0") != "0"
            ):
                raise ValueError(f"Unsupported original table bounds on {name}")
            headers = [
                cell_text(cell) for cell in root.findall("m:sheetData/m:row[@r='4']/m:c", namespace)
            ]
            table_headers = [
                column.attrib["name"]
                for column in table.findall("m:tableColumns/m:tableColumn", namespace)
            ]
            column_count = 0
            for letter in bounds.group(1):
                column_count = column_count * 26 + ord(letter) - ord("A") + 1
            if headers != table_headers or len(headers) != column_count:
                raise ValueError(f"Original sheet/table headers disagree on {name}")
            layouts[name] = {
                "reference_headers": headers,
                "reference_table_name": table.attrib["name"],
                "reference_table_ref": table.attrib["ref"],
                "previous_count": int(bounds.group(2)) - 4,
            }
        if set(layouts) != expected_sheets:
            raise ValueError("Original workbook is missing a required data table")
    return hashlib.sha256(payload).hexdigest(), layouts


def prepare(repo: Path, output: Path) -> None:
    raw = repo / "raw material"
    manifest = json.loads((raw / "collection_manifest_61.json").read_text(encoding="utf-8"))
    reference_sha256, layouts = reference_layout(raw / "60国新能源基础信息与政策索引.xlsx")
    tables = []
    for title, stem, subtitle in SHEETS:
        headers, rows = read_csv(raw / "global_sources" / f"61_{stem}.csv")
        previous_headers, previous = read_csv(raw / "global_sources" / f"60_{stem}.csv")
        if headers != previous_headers:
            raise ValueError("Original CSV headers must remain unchanged")
        layout = layouts[title]
        if (
            len(headers) != len(layout["reference_headers"])
            or len(previous) != layout["previous_count"]
        ):
            raise ValueError(f"Original workbook and CSV shape disagree for {title}")
        if rows[: len(previous)] != previous:
            raise ValueError("Original CSV rows must remain unchanged")
        added = rows[len(previous) :]
        if not added or any(row["iso3"] != "ZMB" for row in added):
            raise ValueError("Only ZMB can be appended to this workbook")
        tables.append(
            {
                "sheet": title,
                "headers": headers,
                "previous_count": len(previous),
                "title": f"61国{title} · 海外60国",
                "subtitle": subtitle,
                "rows": [[cell(key, row[key]) for key in headers] for row in added],
                **layout,
            }
        )
    if (
        layouts["质量检查"]["previous_count"] != 60
        or len(layouts["质量检查"]["reference_headers"]) != 17
    ):
        raise ValueError("Original quality table must have 60 rows and 17 columns")
    tables.append(
        {
            "sheet": "质量检查",
            "headers": [
                "序号",
                "ISO3",
                "国家（中文）",  # noqa: RUF001 - preserve the original workbook header
                "画像数",
                "宏观年数",
                "能源最新数",
                "官方来源数",
                "政策数",
                "专题登记数",
                "待研究缺口数",
                "已下载原文数",
                "来源门槛",
                "政策门槛",
                "专题登记门槛",
                "结构结果",
                "电力需求",
                "复核状态",
            ],
            "previous_count": 60,
            "title": "61国资料结构检查 · 海外60国",
            "subtitle": "机器只检查数量、结构和哈希；新增国内容仍需一次实际确认，不自动发布。",
            "rows": [
                [61, "ZMB", "赞比亚"] + [None] * 13 + ["machine_collected_pending_human_review"]
            ],
            **layouts["质量检查"],
        }
    )
    result = {
        "schema_version": "navigator.raw-expansion-workbook.v1",
        "country_code": "ZMB",
        "country_count": 61,
        "reference_workbook_sha256": reference_sha256,
        "source_count": manifest["official_source_count"],
        "policy_count": manifest["policy_record_count"],
        "topic_count": 427,
        "macro_energy_count": 366,
        "tables": tables,
    }
    text = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    print(
        json.dumps(
            {
                "sheets": len(tables) + 1,
                "added_data_rows": sum(len(table["rows"]) for table in tables),
                "output": str(output),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.repo.resolve(), args.output)
