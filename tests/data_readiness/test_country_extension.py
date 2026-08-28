"""Synthetic, offline country-addition tests; no real approval or publication."""

from __future__ import annotations

import copy
import csv
import hashlib
import importlib.util
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from navigator_api.basic60_seed_contract import Basic60SeedArtifact
from navigator_api.market_storage import canonical_bytes, content_sha256
from navigator_data_readiness import cli
from navigator_data_readiness import country_extension as extension
from navigator_data_readiness.market_content import (
    REVIEW_SCHEMA,
    _validated_candidate,
    market_review_rows,
)
from navigator_data_readiness.paths import discover_repository

_SPEC = importlib.util.spec_from_file_location(
    "country_extension_api_fixtures", Path(__file__).parents[1] / "api/test_basic60_api.py"
)
assert _SPEC is not None and _SPEC.loader is not None
_API = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_API)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_bytes(payload))


def _write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


@pytest.fixture(scope="module")
def parent_payload() -> dict[str, Any]:
    countries = []
    for entry in _API.REVIEWED_COUNTRY_CODES:
        code, iso2 = entry.split(":")
        country = _API._country(code, iso2, f"合成{code}", f"Synthetic {code}")
        metrics = []
        for metric_code, domain, unit in _API.METRICS:
            for year in range(2020, 2025) if domain == "macro" else [2025]:
                value = (
                    None
                    if metric_code == "electricity_demand_gwh"
                    or (
                        code == "LKA"
                        and metric_code == "official_exchange_rate_lcu_per_usd"
                        and year == 2024
                    )
                    else "1"
                )
                source = {"identity": "ID", "macro": "MACRO", "energy": "ENERGY"}[domain]
                metrics.append(
                    _API._metric(
                        metric_code,
                        value,
                        unit,
                        str(year),
                        f"SRC-{source}-PRIMARY",
                        f"RAW-{code}-{domain.upper()}",
                    )
                )
        country["metrics"] = metrics
        countries.append(country)
    payload = _API._seed_payload(countries=countries)
    payload["release"]["counts"] = {
        "countries": 60,
        "macro_rows": 300,
        "energy_rows": 60,
        "available_metric_values": 2279,
        "pending_metric_values": 61,
    }
    Basic60SeedArtifact.model_validate(payload)
    return payload


@pytest.fixture
def inputs(tmp_path: Path, parent_payload: dict[str, Any]) -> dict[str, Any]:
    root = tmp_path / "repository"
    raw = root / "raw material/countries/ZMB"
    raw.mkdir(parents=True)
    parent_seed = root / "runtime/basic60/basic60_seed.private_trial_ready.json"
    _write_json(parent_seed, parent_payload)
    source = raw / "synthetic-official.json"
    source.write_text('{"synthetic":true}', encoding="utf-8")
    profile = dict.fromkeys(sorted(extension.PROFILE_FIELDS), "")
    profile.update(
        iso2="ZM",
        iso3="ZMB",
        country_name_zh="赞比亚合成测试",
        country_name_en="Synthetic Zambia",
        official_name_en="Synthetic Republic",
        local_names='["Synthetic Zambia"]',
        capital="Synthetic Capital",
        admin_level_1_count="10",
        admin_level_1_type="provinces",
        population="100",
        population_year="2025",
        official_languages='["English"]',
        currency_code="ZMW",
        currency_name="Kwacha",
        time_zones='["Africa/Lusaka"]',
        area_sq_km="1000",
        area_year="2023",
        region="Southern Africa",
        collected_at="2026-08-28",
    )
    profile_csv = raw / "country_profile.csv"
    _write_csv(profile_csv, [profile])
    rows = []
    for year in range(2020, 2025):
        row = dict.fromkeys(sorted(extension.METRIC_FIELDS), "")
        row.update(
            iso3="ZMB", record_type="macro_annual", year=str(year), collected_at="2026-08-28"
        )
        row.update({field: "1" for _code, field, _unit in extension.MACRO_METRICS})
        row.update(gdp_growth_pct="-2.5", inflation_cpi_pct="125", fdi_net_inflows_usd="-100")
        rows.append(row)
    energy = dict.fromkeys(sorted(extension.METRIC_FIELDS), "")
    energy.update(iso3="ZMB", record_type="energy_latest", collected_at="2026-08-28")
    for code, field, _unit, year_field in extension.ENERGY_METRICS:
        energy[field] = "50" if code.startswith("renewable_") else "100"
        energy[year_field] = "2025" if "capacity" in code else "2023"
    rows.append(energy)
    metrics_csv = raw / "macro_energy.csv"
    _write_csv(metrics_csv, rows)
    evidence = {
        "schema_version": extension.EVIDENCE_SCHEMA,
        "country_code": "ZMB",
        "sources": [
            {
                "id": "SYNTHETIC-OFFICIAL",
                "title": "Synthetic official source",
                "url": "https://example.test/zambia",
                "captured_at": "2026-08-28T10:00:00.123456+08:00",
                "local_path": source.relative_to(root).as_posix(),
                "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            }
        ],
        "identity_source_ids": ["SYNTHETIC-OFFICIAL"],
        "metric_source_ids": {
            code: ["SYNTHETIC-OFFICIAL"] for code, _domain, _unit in _API.METRICS
        },
    }
    evidence_path = raw / "evidence.json"
    _write_json(evidence_path, evidence)
    return {
        "repo_root": root,
        "parent_seed": parent_seed,
        "profile_csv": profile_csv,
        "metrics_csv": metrics_csv,
        "evidence_path": evidence_path,
        "as_of": "2026-08-28",
    }


def _prepare(inputs: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    output = inputs["repo_root"] / "runtime/country-extensions/zmb-r1"
    result = extension.prepare_country_extension(output_dir=output, **inputs)
    return output, result


def _mutate_csv(path: Path, field: str, value: str, index: int = 0) -> None:
    with path.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    rows[index][field] = value
    _write_csv(path, rows)


def test_review_row_order_is_stable_across_canonical_serialization(
    inputs: dict[str, Any],
) -> None:
    candidate = extension.build_country_extension(**inputs)
    serialized = json.loads(extension.canonical_bytes(candidate))
    assert extension.extension_review_data(candidate) == extension.extension_review_data(serialized)


def test_review_timestamp_encoding_preserves_timezone_seconds_and_microseconds() -> None:
    stamp = "2026-08-28T11:02:56.225285+08:00"
    encoded = extension.source_review_cell({"captured_at": stamp}, "captured_at")
    assert encoded == '"2026-08-28T11:02:56.225285+08:00"'
    assert json.loads(encoded) == stamp


def test_candidate_keeps_all_parent_hashes_counts_missing_and_signed_values(
    inputs: dict[str, Any],
) -> None:
    before = {
        key: path.read_bytes()
        for key, path in inputs.items()
        if isinstance(path, Path) and path.is_file()
    }
    output, result = _prepare(inputs)
    candidate = json.loads((output / "candidate.json").read_bytes())
    assert result["status"] == "candidate_valid" and result["published"] is False
    assert result["publication_status"] == "awaiting_single_review"
    assert result["raw_country_count"] == 61 and result["outbound_country_count"] == 60
    assert result["new_metric_count"] == 39 and result["changed_parent_country_codes"] == []
    assert candidate["target_release_id"] != "BASIC60-PRIVATE-R1"
    assert (
        "CHN" in candidate["scope"]["country_codes"]
        and "CHN" not in candidate["scope"]["outbound_country_codes"]
    )
    assert len(candidate["parent"]["country_sha256"]) == 60
    parent = json.loads(inputs["parent_seed"].read_bytes())
    assert candidate["parent"]["country_sha256"] == {
        country["iso3"]: content_sha256(country) for country in parent["countries"]
    }
    assert candidate["projected_counts"] == {
        "countries": 61,
        "macro_rows": 305,
        "energy_rows": 61,
        "available_metric_values": 2317,
        "pending_metric_values": 62,
    }
    metrics = candidate["new_country"]["metrics"]
    demand = next(item for item in metrics if item["metric_code"] == "electricity_demand_gwh")
    assert demand["normalized_value"] is None and demand["value_status"] == "pending"
    assert any(item["normalized_value"] == "-2.5" for item in metrics)
    assert any(item["normalized_value"] == "125" for item in metrics)
    assert all(path.read_bytes() == before[key] for key, path in inputs.items() if key in before)
    assert {path.name for path in output.iterdir()} == {
        "candidate.json",
        "review-data.json",
        "scope.csv",
        "validation.json",
    }
    with pytest.raises(ValueError):
        Basic60SeedArtifact.model_validate(candidate)
    assert not (inputs["repo_root"] / "runtime/market-content").exists()
    review = extension.extension_review_data(candidate)
    assert all(
        row[0] == "ZMB" and row[1] != "overview" and row[4] == row[5] for row in review["rows"]
    )
    assert any(row[3] == "/new_country/metrics/0/normalized_value" for row in review["rows"])
    replay = extension.validate_country_extension(
        candidate_dir=output, repo_root=inputs["repo_root"]
    )
    assert replay == {key: value for key, value in result.items() if key != "output_dir"}


@pytest.mark.parametrize(
    "input_name", ["parent_seed", "profile_csv", "metrics_csv", "evidence_path"]
)
def test_input_drift_is_detected_on_read_only_replay(
    inputs: dict[str, Any], input_name: str
) -> None:
    output, _result = _prepare(inputs)
    inputs[input_name].write_bytes(inputs[input_name].read_bytes() + b" ")
    with pytest.raises(ValueError, match="frozen extension input changed"):
        extension.validate_country_extension(candidate_dir=output, repo_root=inputs["repo_root"])


@pytest.mark.parametrize(
    "fault", ["scope", "status", "parent_hash", "review", "scope_csv", "inputs", "revision"]
)
def test_candidate_and_review_tampering_fail_closed(inputs: dict[str, Any], fault: str) -> None:
    output, _result = _prepare(inputs)
    path = output / "candidate.json"
    candidate = json.loads(path.read_bytes())
    if fault == "scope":
        candidate["scope"]["outbound_country_codes"].append("CHN")
    elif fault == "status":
        candidate["published"] = True
    elif fault == "parent_hash":
        candidate["parent"]["country_sha256"]["IDN"] = "a" * 64
    elif fault == "inputs":
        candidate["inputs"]["extra"] = candidate["inputs"]["parent_seed"]
    elif fault == "revision":
        candidate["revision"] = "1"
    elif fault == "review":
        path = output / "review-data.json"
        path.chmod(0o644)
        review = json.loads(path.read_bytes())
        review["rows"][0][5] = "changed"
        _write_json(path, review)
    elif fault == "scope_csv":
        path = output / "scope.csv"
        path.chmod(0o644)
        path.write_text("iso3,scope_role\nCHN,outbound\n", encoding="utf-8")
    if fault not in {"review", "scope_csv"}:
        path.chmod(0o644)
        _write_json(path, candidate)
    with pytest.raises(ValueError):
        extension.validate_country_extension(candidate_dir=output, repo_root=inputs["repo_root"])


@pytest.mark.parametrize(
    "field,value,index",
    [
        ("year", "2024", 0),
        ("iso3", "CHN", 0),
        ("gdp_current_usd", "NaN", 0),
        ("gdp_current_usd", "=1+2", 0),
        ("gdp_current_usd", "-1", 0),
        ("official_exchange_rate_lcu_per_usd", "0", 0),
        ("renewable_capacity_mw", "101", 5),
        ("renewable_share_capacity_pct", "75", 5),
        ("renewable_share_capacity_pct", "101", 5),
        ("electricity_generation_year", "", 5),
        ("electricity_generation_year", "2027", 5),
        ("collected_at", "2026-08-29", 0),
    ],
)
def test_invalid_metric_semantics_are_rejected(
    inputs: dict[str, Any], field: str, value: str, index: int
) -> None:
    _mutate_csv(inputs["metrics_csv"], field, value, index)
    with pytest.raises(ValueError):
        extension.build_country_extension(**inputs)


@pytest.mark.parametrize(
    "field,value",
    [
        ("iso3", "CHN"),
        ("iso3", "NAM"),
        ("iso3", "../"),
        ("iso2", "NA"),
        ("iso2", "z1"),
        ("currency_code", "kwacha"),
        ("country_name_zh", ""),
        ("admin_level_1_count", "1.5"),
        ("local_names", "[]"),
        ("official_languages", '["English","English"]'),
        ("official_languages", '["English"," English "]'),
        ("time_zones", '["Not/AZone"]'),
        ("population", "1.5"),
        ("population_year", "yesterday"),
        ("population_year", "2027"),
        ("collected_at", "2026-08-29"),
    ],
)
def test_invalid_profile_is_rejected(inputs: dict[str, Any], field: str, value: str) -> None:
    _mutate_csv(inputs["profile_csv"], field, value)
    with pytest.raises(ValueError):
        extension.build_country_extension(**inputs)


@pytest.mark.parametrize(
    "fault",
    [
        "hash",
        "path",
        "uri",
        "time",
        "country",
        "unknown_metric",
        "missing_mapping",
        "source_id",
        "duplicate_source",
        "extra_state",
        "source_drift",
    ],
)
def test_evidence_has_real_hashes_and_no_machine_licence_states(
    inputs: dict[str, Any], fault: str
) -> None:
    evidence = json.loads(inputs["evidence_path"].read_bytes())
    source = evidence["sources"][0]
    if fault == "hash":
        source["sha256"] = "0" * 64
    elif fault == "path":
        source["local_path"] = "raw material/../secret.json"
    elif fault == "uri":
        source["url"] = "https://user:secret@example.test/"
    elif fault == "time":
        source["captured_at"] = "2026-08-28T10:00:00"
    elif fault == "country":
        evidence["country_code"] = "NAM"
    elif fault == "unknown_metric":
        evidence["metric_source_ids"]["invented_metric"] = []
    elif fault == "missing_mapping":
        evidence["metric_source_ids"]["gdp_current_usd"] = []
    elif fault == "source_id":
        evidence["identity_source_ids"] = ["unknown"]
    elif fault == "duplicate_source":
        evidence["sources"].append(copy.deepcopy(source))
    elif fault == "extra_state":
        evidence["license_decision"] = "approved"
    elif fault == "source_drift":
        (inputs["repo_root"] / source["local_path"]).write_text("changed", encoding="utf-8")
    _write_json(inputs["evidence_path"], evidence)
    with pytest.raises(ValueError):
        extension.build_country_extension(**inputs)


def test_zero_missing_and_mixed_energy_years_are_preserved(inputs: dict[str, Any]) -> None:
    _mutate_csv(inputs["metrics_csv"], "fdi_net_inflows_usd", "0", 0)
    _mutate_csv(inputs["metrics_csv"], "gdp_current_usd", "", 1)
    _mutate_csv(inputs["metrics_csv"], "renewable_capacity_year", "2024", 5)
    candidate = extension.build_country_extension(**inputs)
    metrics = candidate["new_country"]["metrics"]
    assert (
        next(item for item in metrics if item["metric_code"] == "fdi_net_inflows_usd")[
            "normalized_value"
        ]
        == "0"
    )
    assert any(
        item["metric_code"] == "gdp_current_usd" and item["normalized_value"] is None
        for item in metrics
    )
    assert candidate["projected_counts"]["pending_metric_values"] == 63


def test_no_overwrite_and_no_writes_to_protected_or_online_paths(inputs: dict[str, Any]) -> None:
    output, _result = _prepare(inputs)
    before = (output / "candidate.json").read_bytes()
    for target in (
        output,
        inputs["repo_root"],
        inputs["repo_root"] / "raw material/new",
        inputs["repo_root"] / "runtime/market-content/new",
        inputs["repo_root"] / "runtime/basic60/new",
    ):
        with pytest.raises(ValueError):
            extension.prepare_country_extension(output_dir=target, **inputs)
    assert (output / "candidate.json").read_bytes() == before


def test_symlink_evidence_is_rejected(inputs: dict[str, Any]) -> None:
    original = inputs["profile_csv"]
    alias = original.parent / "alias.csv"
    alias.symlink_to(original)
    with pytest.raises(ValueError, match="symbolic"):
        extension.build_country_extension(**{**inputs, "profile_csv": alias})


def _overview(inputs: dict[str, Any]) -> Path:
    payload = {
        "schema_version": "navigator.market-overview.v1",
        "country_code": "ZMB",
        "content_version": "OVERVIEW-ZMB-20260828-R1",
        "as_of": "2026-08-28",
        "locales": {
            locale: {
                "title": "Synthetic overview",
                "paragraphs": ["合成测试" * 60 for _ in range(7)]
                if locale == "zh-CN"
                else ["Synthetic testing paragraph." for _ in range(7)],
                "disclaimer": "Synthetic test only.",
            }
            for locale in ("zh-CN", "en")
        },
    }
    path = inputs["repo_root"] / "runtime/zmb-overview.json"
    _write_json(path, payload)
    return path


class _Cell:
    def __init__(self, value: object) -> None:
        self.value = value
        self.data_type = "f" if isinstance(value, str) and value.startswith("=") else "s"


class _Sheet:
    def __init__(self, rows: list[list[Any]]) -> None:
        self.rows = rows
        self.max_row = len(rows)

    def iter_rows(self, *, max_col: int) -> Any:
        return [
            tuple(_Cell(item) for item in (row + [None] * max_col)[:max_col]) for row in self.rows
        ]


class _Workbook:
    def __init__(self, sheets: dict[str, list[list[Any]]]) -> None:
        self.sheets = sheets
        self.sheetnames = list(sheets)

    def __getitem__(self, key: str) -> _Sheet:
        return _Sheet(self.sheets[key])

    def close(self) -> None:
        pass


@pytest.mark.parametrize(
    "fault",
    [
        None,
        "identity",
        "source",
        "metadata",
        "formula",
        "missing_sheet",
        "overview",
        "overview_edit",
        "timestamp_raw",
        "timestamp_single_quote",
        "timestamp_no_timezone",
        "timestamp_no_microseconds",
        "timestamp_whitespace",
        "timestamp_double_encoded",
        "timestamp_serial",
    ],
)
def test_one_workbook_binds_new_country_and_standard_overview_without_publication(
    inputs: dict[str, Any], monkeypatch: pytest.MonkeyPatch, fault: str | None
) -> None:
    output, _result = _prepare({**inputs, "overview_path": _overview(inputs)})
    candidate = json.loads((output / "candidate.json").read_bytes())
    review = extension.extension_review_data(candidate)
    market = _validated_candidate(
        "OVERVIEW-ZMB-20260828-R1", [candidate["overview"]], frozenset({"ZMB"})
    )
    sheets = {
        "新增国包信息": [["key", "value"], *[list(item) for item in review["metadata"].items()]],
        "新增国内容": [list(extension.REVIEW_HEADERS), *copy.deepcopy(review["rows"])],
        "基础数据依据": [
            list(extension.SOURCE_HEADERS),
            *[
                [extension.source_review_cell(item, key) for key in extension.SOURCE_HEADERS]
                for item in review["source_rows"]
            ],
        ],
        "包信息": [
            ["key", "value"],
            ["schema_version", REVIEW_SCHEMA],
            ["package_id", market.package_id],
            ["candidate_sha256", market.sha256],
            ["country_count", "1"],
            ["created_at", "2026-08-28"],
        ],
        "内容编辑": [
            [
                "country_code",
                "content_version",
                "locale",
                "json_pointer",
                "original_value",
                "edited_value",
            ],
            *[list(row) for row in market_review_rows(market)],
        ],
    }
    if fault == "identity":
        sheets["新增国内容"][1][5] = "changed"
    elif fault == "source":
        sheets["基础数据依据"][1][1] = "wrong source"
    elif fault == "metadata":
        sheets["新增国包信息"][1][1] = "wrong schema"
    elif fault == "formula":
        sheets["新增国内容"][1][5] = "=1+1"
    elif fault == "missing_sheet":
        del sheets["新增国内容"]
    elif fault == "overview":
        sheets["内容编辑"][1][4] = "changed original"
    elif fault == "overview_edit":
        sheets["内容编辑"][1][5] += " changed"
    elif fault == "timestamp_raw":
        sheets["基础数据依据"][1][3] = review["source_rows"][0]["captured_at"]
    elif fault == "timestamp_single_quote":
        sheets["基础数据依据"][1][3] = "'" + review["source_rows"][0]["captured_at"]
    elif fault == "timestamp_no_timezone":
        sheets["基础数据依据"][1][3] = json.dumps(
            review["source_rows"][0]["captured_at"].replace("+08:00", "")
        )
    elif fault == "timestamp_no_microseconds":
        sheets["基础数据依据"][1][3] = json.dumps("2026-08-28T10:00:00+08:00")
    elif fault == "timestamp_whitespace":
        sheets["基础数据依据"][1][3] = " " + sheets["基础数据依据"][1][3]
    elif fault == "timestamp_double_encoded":
        sheets["基础数据依据"][1][3] = json.dumps(sheets["基础数据依据"][1][3])
    elif fault == "timestamp_serial":
        sheets["基础数据依据"][1][3] = 46262.1270396412
    workbook = inputs["repo_root"] / "synthetic-review.xlsx"
    workbook.write_bytes(b"synthetic workbook parser fixture, not a real approval")
    monkeypatch.setattr(extension, "_workbook_bytes", lambda path: path.read_bytes())
    monkeypatch.setattr(
        extension.openpyxl, "load_workbook", lambda *args, **kwargs: _Workbook(sheets)
    )
    if fault:
        with pytest.raises(ValueError):
            extension.validate_country_extension(
                candidate_dir=output, repo_root=inputs["repo_root"], workbook_path=workbook
            )
    else:
        result = extension.validate_country_extension(
            candidate_dir=output, repo_root=inputs["repo_root"], workbook_path=workbook
        )
        assert result["published"] is False and result["overview_included"] is True
        assert result["workbook_binding"]["actual_confirmation_required"] is True
        assert result["workbook_binding"]["market_overview"]["candidate_sha256"] == market.sha256
        assert (
            result["workbook_binding"]["workbook_sha256"]
            == hashlib.sha256(workbook.read_bytes()).hexdigest()
        )


def test_cli_commands_register_and_never_offer_publish_or_approval_flags(
    inputs: dict[str, Any], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    repository = replace(discover_repository(), root=inputs["repo_root"])
    monkeypatch.setattr(cli, "discover_repository", lambda value: repository)
    output = inputs["repo_root"] / "runtime/country-extensions/cli-r1"
    arguments = [
        "prepare-country-extension",
        "--parent-seed",
        str(inputs["parent_seed"]),
        "--profile-csv",
        str(inputs["profile_csv"]),
        "--metrics-csv",
        str(inputs["metrics_csv"]),
        "--evidence",
        str(inputs["evidence_path"]),
        "--as-of",
        inputs["as_of"],
        "--output-dir",
        str(output),
    ]
    assert cli.main(arguments) == 0
    assert json.loads(capsys.readouterr().out)["published"] is False
    assert cli.main(["validate-country-extension", "--candidate-dir", str(output)]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "candidate_valid"
    assert cli.main(arguments) == 1
    assert json.loads(capsys.readouterr().out)["status"] == "not_ready"
    with pytest.raises(SystemExit):
        cli.main([*arguments, "--approve"])
