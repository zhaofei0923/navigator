"""Synthetic-only tests for append-only country collection indexes."""

from __future__ import annotations

import csv
import hashlib
import json
import runpy
from pathlib import Path
from types import SimpleNamespace
from xml.sax.saxutils import escape

import pytest

script = SimpleNamespace(
    **runpy.run_path(
        str(Path(__file__).parents[2] / "scripts/country_expansion/build_raw_expansion.py")
    )
)
workbook = SimpleNamespace(
    **runpy.run_path(
        str(Path(__file__).parents[2] / "scripts/country_expansion/prepare_workbook_data.py")
    )
)


def csv_file(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def collection(codes: list[str]) -> dict:
    return {
        "profiles": [
            {
                "iso3": code,
                "iso2": "CN" if code == "CHN" else code[1:],
                "country_name_zh": "合成测试",
                "country_name_en": "Synthetic",
                "order": n + 1,
            }
            for n, code in enumerate(codes)
        ],
        "macro_energy": [
            {
                "iso3": code,
                "record_type": kind,
                "year": year,
                "gdp_current_usd": "",
                "electricity_demand_gwh": "",
            }
            for code in codes
            for kind, year in [("macro_annual", str(y)) for y in range(2020, 2025)]
            + [("energy_latest", "")]
        ],
        "official_sources": [
            {"iso3": code, "source_id": f"{code}-SRC-{i}"} for code in codes for i in range(6)
        ],
        "policies": [
            {
                "iso3": code,
                "policy_id": f"{code}-POL-{i}",
                "priority": str(i + 1),
                "policy_group": "core_policy",
                "topic_tags": "grid_code",
                "local_filename": "",
                "sha256": "",
                "effective_date": "",
                "download_status": "official_url_only",
            }
            for code in codes
            for i in range(5)
        ],
        "policy_topic_coverage": [
            {"iso3": code, "topic_code": topic, "coverage_status": "official_url_only"}
            for code in codes
            for topic in sorted(script.TOPICS)
        ],
    }


def make_repo(tmp_path: Path) -> tuple[Path, Path]:
    codes = ["CHN"] + [f"A{chr(65 + i // 26)}{chr(65 + i % 26)}" for i in range(59)]
    original = collection(codes)
    raw = tmp_path / "raw material"
    for kind, (stem, _) in script.TABLES.items():
        csv_file(raw / "global_sources" / f"60_{stem}.csv", original[kind])
    script.write_json(raw / "global_sources/collection_integrated_60.json", original)
    script.write_json(
        raw / "collection_manifest_60.json",
        {"country_count": 60, "per_country": [{"iso3": code} for code in codes]},
    )
    added = collection(["ZMB"])
    for kind, (_, filename) in script.TABLES.items():
        csv_file(raw / "countries/ZMB" / filename, added[kind])
    script.write_json(
        raw / "countries/ZMB/00_country_profile/country_profile.json", added["profiles"][0]
    )
    baseline = tmp_path / "runtime/country-expansion/baseline.json"
    script.freeze(tmp_path, baseline, "ZMB")
    return tmp_path, baseline


def test_raw_extension_keeps_original_indexes_and_excludes_china_from_outbound(
    tmp_path: Path,
) -> None:
    repo, baseline = make_repo(tmp_path)
    summary = script.build(repo, baseline, "ZMB", 61, "2026-08-28")
    assert summary["country_count"] == 61
    assert summary["outbound_country_count"] == 60
    assert summary["macro_annual_record_count"] == 305
    assert summary["energy_latest_record_count"] == 61
    assert summary["published"] is False
    assert script.check_baseline(repo, baseline)["hash_mismatches"] == []
    raw = repo / "raw material"
    for _, (stem, _) in script.TABLES.items():
        headers, old = script.read_csv(raw / "global_sources" / f"60_{stem}.csv")
        new_headers, new = script.read_csv(raw / "global_sources" / f"61_{stem}.csv")
        assert headers == new_headers
        assert new[: len(old)] == old
        assert all(row["iso3"] == "ZMB" for row in new[len(old) :])
    integrated = json.loads(
        (raw / "global_sources/collection_integrated_61.json").read_text(encoding="utf-8")
    )
    assert all(isinstance(row["topic_tags"], str) for row in integrated["policies"])
    with pytest.raises(FileExistsError):
        script.build(repo, baseline, "ZMB", 61, "2026-08-28")


def test_original_mutation_is_rejected_before_any_output(tmp_path: Path) -> None:
    repo, baseline = make_repo(tmp_path)
    original = repo / "raw material/global_sources/60_country_profiles.csv"
    original.write_bytes(original.read_bytes() + b"changed")
    with pytest.raises(ValueError, match="Legacy inputs changed"):
        script.build(repo, baseline, "ZMB", 61, "2026-08-28")
    assert not (repo / "raw material/collection_manifest_61.json").exists()


def test_download_status_cannot_claim_an_unavailable_original(tmp_path: Path) -> None:
    repo, baseline = make_repo(tmp_path)
    policy = repo / "raw material/countries/ZMB/02_policy_documents/policy_register.csv"
    _, rows = script.read_csv(policy)
    rows[0]["download_status"] = "downloaded_pending_validation"
    csv_file(policy, rows)
    with pytest.raises(ValueError, match="must not claim"):
        script.build(repo, baseline, "ZMB", 61, "2026-08-28")


def test_native_wsl_zone_identifier_alias_preserves_the_same_bytes(tmp_path: Path) -> None:
    raw = tmp_path / "raw material"
    raw.mkdir()
    native = raw / "example.pdf:Zone.Identifier"
    if __import__("os").name == "nt":
        pytest.skip("Linux filename mapping is tested on WSL")
    native.write_bytes(b"Synthetic zone metadata")
    baseline = tmp_path / "baseline.json"
    script.write_json(
        baseline,
        {
            "schema_version": "navigator.country-expansion-preservation.v1",
            "files": {"raw material/example.pdf\uf03aZone.Identifier": script.digest(native)},
        },
    )
    assert script.check_baseline(tmp_path, baseline)["hash_mismatches"] == []


def test_duplicate_countries_or_missing_topics_fail_counts() -> None:
    values = collection(["CHN", "ZMB"])
    values["profiles"].append(values["profiles"][-1])
    with pytest.raises(ValueError, match="unique countries"):
        script.validate_merged(values, 3)
    values = collection(["CHN", "ZMB"])
    values["policy_topic_coverage"].pop()
    with pytest.raises(ValueError, match="topics"):
        script.validate_merged(values, 2)


@pytest.mark.parametrize("module", [script, workbook], ids=["raw-index", "workbook-data"])
@pytest.mark.parametrize(
    "contents",
    [
        "iso3,year,gdp_current_usd\nZMB,2024\n",
        "iso3,year\nZMB,2024,extra\n",
        "iso3,iso3\nZMB,ZMB\n",
        "iso3,,year\nZMB,ignored,2024\n",
        "",
    ],
    ids=["short-row", "extra-column", "duplicate-header", "empty-header", "empty-file"],
)
def test_csv_shape_rejects_truncated_or_ambiguous_rows(
    module: SimpleNamespace, contents: str, tmp_path: Path
) -> None:
    path = tmp_path / "synthetic.csv"
    path.write_text(contents, encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid CSV shape"):
        module.read_csv(path)


@pytest.mark.parametrize("module", [script, workbook], ids=["raw-index", "workbook-data"])
def test_explicit_blank_csv_value_is_not_a_truncated_row(
    module: SimpleNamespace, tmp_path: Path
) -> None:
    path = tmp_path / "synthetic.csv"
    path.write_text("iso3,year,gdp_current_usd\nZMB,2024,\n", encoding="utf-8")
    headers, rows = module.read_csv(path)
    assert headers == ["iso3", "year", "gdp_current_usd"]
    assert rows == [{"iso3": "ZMB", "year": "2024", "gdp_current_usd": ""}]


@pytest.mark.parametrize("tags", ["grid_code;environmental_regulation", "", '["grid_code"]'])
def test_integrated_policy_tags_keep_the_original_string_contract(tags: str) -> None:
    source = {"priority": "2", "topic_tags": tags}
    assert script._typed(source, "policies") == {"priority": 2, "topic_tags": tags}
    assert source == {"priority": "2", "topic_tags": tags}


@pytest.mark.parametrize("value", ["NaN", "nan", "Infinity", "-inf", "1e999"])
def test_non_finite_numeric_values_are_rejected_by_both_adapters(value: str) -> None:
    with pytest.raises(ValueError, match="Non-finite numeric value"):
        script._typed({"gdp_current_usd": value}, "macro_energy")
    with pytest.raises(ValueError, match="Non-finite numeric value"):
        workbook.cell("gdp_current_usd", value)


@pytest.mark.parametrize(
    "value,expected", [("", None), ("0", 0), ("-6.25", -6.25), ("125.77", 125.77)]
)
def test_numeric_adapters_preserve_missing_zero_negative_and_large_percentages(
    value: str, expected: float | None
) -> None:
    source = {"inflation_cpi_pct": value}
    assert script._typed(source, "macro_energy")["inflation_cpi_pct"] == expected
    assert workbook.cell("inflation_cpi_pct", value) == expected
    assert source == {"inflation_cpi_pct": value}


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_json_is_rejected_before_creating_an_output(
    value: float, tmp_path: Path
) -> None:
    target = tmp_path / "must-not-exist.json"
    with pytest.raises(ValueError):
        script.write_json(target, {"nested": {"value": value}})
    assert not target.exists()


def test_non_finite_macro_input_fails_before_any_expansion_output(tmp_path: Path) -> None:
    repo, baseline = make_repo(tmp_path)
    raw = repo / "raw material"
    path = raw / "countries/ZMB/00_country_profile/macro_energy.csv"
    _, rows = script.read_csv(path)
    rows[0]["gdp_current_usd"] = "NaN"
    csv_file(path, rows)
    with pytest.raises(ValueError, match="Non-finite numeric value"):
        script.build(repo, baseline, "ZMB", 61, "2026-08-28")
    assert not list((raw / "global_sources").glob("61_*"))
    assert not (raw / "collection_manifest_61.json").exists()


@pytest.mark.parametrize(
    "key,value,expected",
    [
        ("local_names", '["Zambia","Republic of Zambia"]', "Zambia；Republic of Zambia"),
        ("official_languages", '["English"]', "English"),
        ("time_zones", '["Africa/Lusaka"]', "Africa/Lusaka"),
        (
            "notes",
            '["Two distinct years","Demand remains blank"]',
            "Two distinct years；Demand remains blank",
        ),
        (
            "notes",
            '{"scope":"test","years":[2023,2025],"zero":0}',
            "scope：test；years：2023；2025；zero：0",
        ),
        ("notes", "Keep this literal text unchanged", "Keep this literal text unchanged"),
        ("notes", "[Incomplete JSON is still source text", "[Incomplete JSON is still source text"),
        ("notes", "[]", ""),
    ],
)
def test_json_lists_and_note_objects_are_formatted_only_for_display(
    key: str, value: str, expected: str
) -> None:
    source = {key: value}
    assert workbook.cell(key, source[key]) == expected
    assert source == {key: value}


def reference_parts() -> dict[str, bytes]:
    """Mock OOXML parts in memory: this fixture does not author an XLSX file."""
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    sheets = [name for name, _, _ in workbook.SHEETS] + ["质量检查"]
    items: dict[str, bytes] = {}
    sheet_nodes, relationship_nodes = [], []
    for index, name in enumerate(sheets, 1):
        sheet_nodes.append(f'<sheet name="{escape(name)}" sheetId="{index}" r:id="rId{index}"/>')
        relationship_nodes.append(
            f'<Relationship Id="rId{index}" Target="worksheets/sheet{index}.xml"/>'
        )
        items[f"xl/worksheets/sheet{index}.xml"] = (
            f'<worksheet xmlns="{ns}" xmlns:r="{rel}"><sheetData><row r="4">'
            '<c r="A4" t="str"><v>序号</v></c>'
            '<c r="B4" t="inlineStr"><is><t>国家</t></is></c></row></sheetData>'
            '<tableParts count="1"><tablePart r:id="table"/></tableParts></worksheet>'
        ).encode()
        items[f"xl/worksheets/_rels/sheet{index}.xml.rels"] = (
            '<Relationships><Relationship Id="table" '
            f'Target="../tables/table{index}.xml"/></Relationships>'
        ).encode()
        items[f"xl/tables/table{index}.xml"] = (
            f'<table xmlns="{ns}" name="SyntheticTable{index}" ref="A4:B64" '
            'headerRowCount="1" totalsRowCount="0"><tableColumns count="2">'
            '<tableColumn id="1" name="序号"/><tableColumn id="2" name="国家"/>'
            "</tableColumns></table>"
        ).encode()
    items["xl/workbook.xml"] = (
        f'<workbook xmlns="{ns}" xmlns:r="{rel}"><sheets>'
        + "".join(sheet_nodes)
        + "</sheets></workbook>"
    ).encode()
    items["xl/_rels/workbook.xml.rels"] = (
        "<Relationships>" + "".join(relationship_nodes) + "</Relationships>"
    ).encode()
    return items


@pytest.mark.parametrize("fault", [None, "header", "bounds", "missing-sheet"])
def test_reference_layout_binds_exact_bytes_headers_and_table_bounds(
    monkeypatch: pytest.MonkeyPatch, fault: str | None
) -> None:
    items = reference_parts()
    if fault == "header":
        items["xl/tables/table1.xml"] = items["xl/tables/table1.xml"].replace(
            "国家".encode(), "错误列".encode()
        )
    elif fault == "bounds":
        items["xl/tables/table1.xml"] = items["xl/tables/table1.xml"].replace(b"A4:B64", b"A5:B65")
    elif fault == "missing-sheet":
        items["xl/workbook.xml"] = items["xl/workbook.xml"].replace(
            'name="国家概况"'.encode(), 'name="缺失"'.encode()
        )

    class Archive:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def namelist(self):
            return list(items)

        def read(self, name):
            return items[name]

    payload = b"Synthetic source bytes; archive reads are mocked; no workbook is authored."
    monkeypatch.setattr(Path, "read_bytes", lambda self: payload)
    monkeypatch.setitem(workbook.reference_layout.__globals__, "ZipFile", lambda buffer: Archive())
    if fault:
        with pytest.raises(ValueError):
            workbook.reference_layout(Path("not-created.xlsx"))
    else:
        actual_hash, layouts = workbook.reference_layout(Path("not-created.xlsx"))
        assert actual_hash == hashlib.sha256(payload).hexdigest()
        assert len(layouts) == 6
        assert layouts["国家概况"] == {
            "reference_headers": ["序号", "国家"],
            "reference_table_name": "SyntheticTable1",
            "reference_table_ref": "A4:B64",
            "previous_count": 60,
        }


def prepare_fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    repo, baseline = make_repo(tmp_path)
    script.build(repo, baseline, "ZMB", 61, "2026-08-28")
    layouts = {}
    for title, stem, _ in workbook.SHEETS:
        headers, rows = script.read_csv(repo / f"raw material/global_sources/60_{stem}.csv")
        layouts[title] = {
            "reference_headers": [f"测试列{number}" for number in range(len(headers))],
            "reference_table_name": f"Synthetic{stem}",
            "reference_table_ref": f"A4:Z{len(rows) + 4}",
            "previous_count": len(rows),
        }
    layouts["质量检查"] = {
        "reference_headers": [f"测试列{number}" for number in range(17)],
        "reference_table_name": "SyntheticQuality",
        "reference_table_ref": "A4:Q64",
        "previous_count": 60,
    }
    monkeypatch.setitem(
        workbook.prepare.__globals__, "reference_layout", lambda path: ("a" * 64, layouts)
    )
    return repo, tmp_path / "prepared-rows.json"


def test_workbook_preparation_preserves_inputs_and_binds_reference_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo, output = prepare_fixture(tmp_path, monkeypatch)
    inputs = {
        path: script.digest(path) for path in (repo / "raw material").rglob("*") if path.is_file()
    }
    workbook.prepare(repo, output)
    result = json.loads(output.read_text(encoding="utf-8"))
    assert result["reference_workbook_sha256"] == "a" * 64
    assert result["country_count"] == 61
    assert len(result["tables"]) == 6
    assert all(table["reference_headers"] for table in result["tables"])
    assert all(table["reference_table_ref"].startswith("A4:") for table in result["tables"])
    assert inputs == {path: script.digest(path) for path in inputs}
    with pytest.raises(FileExistsError):
        workbook.prepare(repo, output)


def test_workbook_preparation_rejects_reordered_csv_headers_before_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo, output = prepare_fixture(tmp_path, monkeypatch)
    path = repo / "raw material/global_sources/61_country_profiles.csv"
    _, rows = script.read_csv(path)
    csv_file(path, [dict(reversed(list(row.items()))) for row in rows])
    with pytest.raises(ValueError, match="CSV headers"):
        workbook.prepare(repo, output)
    assert not output.exists()
