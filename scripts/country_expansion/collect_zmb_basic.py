"""Collect only Zambia's candidate basic data and original official snapshots.

This is an operator-invoked collection, not an automatic refresh or approval.
Existing countries, global indexes, source workbooks, and runtime releases are untouched.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import ssl
from datetime import UTC, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from html import unescape
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / "raw material/countries/ZMB/00_country_profile"
EVIDENCE = DESTINATION / "evidence"
FETCH_MANIFEST = EVIDENCE / "fetch_manifest.json"
REVIEW_STATUS = "machine_collected_pending_human_review"
MACRO_INDICATORS = {
    "gdp_current_usd": "NY.GDP.MKTP.CD",
    "gdp_growth_pct": "NY.GDP.MKTP.KD.ZG",
    "gdp_per_capita_current_usd": "NY.GDP.PCAP.CD",
    "inflation_cpi_pct": "FP.CPI.TOTL.ZG",
    "official_exchange_rate_lcu_per_usd": "PA.NUS.FCRF",
    "fdi_net_inflows_usd": "BX.KLT.DINV.CD.WD",
}
IRENA_URL = (
    "https://pxweb.irena.org/api/v1/en/IRENASTAT/Power%20Capacity%20and%20Generation/"
    "Country_ELECCAP_2026_H1_v-PX%201.px"
)
IRENA_GENERATION_URL = (
    "https://pxweb.irena.org/api/v1/en/IRENASTAT/Power%20Capacity%20and%20Generation/"
    "Country_ELECGEN_2025_H2_v-PX%201.px"
)
WDI_URL = (
    "https://api.worldbank.org/v2/country/ZMB/indicator/"
    + ";".join([*MACRO_INDICATORS.values(), "SP.POP.TOTL", "AG.LND.TOTL.K2"])
    + "?source=2&date=2020:2025&format=json&per_page=1000"
)
SOURCES = {
    "world_bank_country": ("https://api.worldbank.org/v2/country/ZMB?format=json", "json"),
    "world_bank_wdi": (WDI_URL, "json"),
    "irena_metadata": (IRENA_URL, "json"),
    "iana_zone_tab": ("https://data.iana.org/time-zones/tzdb/zone.tab", "txt"),
    "luapula_about_zambia": ("https://www.lua.gov.zm/about-us-2/", "html"),
    "bank_of_zambia_currency": ("https://www.boz.zm/currency", "html"),
    "cabinet_country_background": ("https://www.cabinet.gov.zm/?page_id=436", "html"),
    "zambia_police_provinces": (
        "https://zambiapolice.gov.zm/police-divisions-10-provinces/",
        "html",
    ),
}


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_manifest() -> dict:
    if FETCH_MANIFEST.exists():
        return json.loads(FETCH_MANIFEST.read_text(encoding="utf-8"))
    return {
        "schema_version": "navigator.country-basic-collection.v1",
        "iso3": "ZMB",
        "requests": [],
    }


def fetch(
    name: str, url: str, suffix: str, *, body: object | None = None
) -> tuple[bytes | None, dict]:
    manifest = load_manifest()
    encoded = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    method = "GET" if encoded is None else "POST"
    request_hash = None if encoded is None else sha256(encoded)
    for old in reversed(manifest["requests"]):
        if (
            old["name"] == name
            and old["url"] == url
            and old.get("request_sha256") == request_hash
            and old.get("http_status") == 200
        ):
            path = DESTINATION / old["local_path"]
            payload = path.read_bytes()
            if sha256(payload) != old["sha256"]:
                raise ValueError("Existing original snapshot hash mismatch: " + name)
            return payload, old
    host = urlsplit(url).hostname
    stopped = any(
        urlsplit(row["url"]).hostname == host and row.get("stop_signal")
        for row in manifest["requests"]
    )
    if stopped:
        return None, {"name": name, "url": url, "status": "skipped_after_access_stop"}
    retrieved = datetime.now(UTC).isoformat()
    entry = {
        "name": name,
        "url": url,
        "method": method,
        "requested_at": retrieved,
        "request_sha256": request_hash,
    }
    headers = {"User-Agent": "NavigatorDataResearch/1.0 (operator-requested public-data snapshot)"}
    if encoded is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=encoded, headers=headers, method=method)
    response = None
    payload = None
    try:
        try:
            response = urlopen(request, timeout=40, context=ssl.create_default_context())
        except HTTPError as error:
            response = error
        with response:
            payload = response.read()
            entry.update(
                {
                    "http_status": response.status,
                    "final_url": response.geturl(),
                    "content_type": response.headers.get("Content-Type", ""),
                    "http_date": response.headers.get("Date"),
                    "etag": response.headers.get("ETag"),
                    "last_modified": response.headers.get("Last-Modified"),
                }
            )
        entry["retrieved_at"] = datetime.now(UTC).isoformat()
        entry["sha256"] = sha256(payload)
        entry["size_bytes"] = len(payload)
        filename = name + "_" + entry["sha256"][:16] + "." + suffix
        target = EVIDENCE / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.read_bytes() != payload:
                raise ValueError("Refusing to overwrite an original snapshot")
        else:
            target.write_bytes(payload)
            target.chmod(0o444)
        entry["local_path"] = "evidence/" + filename
        if encoded is not None:
            request_path = EVIDENCE / (name + "_request_" + request_hash[:16] + ".json")
            if not request_path.exists():
                request_path.write_bytes(encoded)
                request_path.chmod(0o444)
            entry["request_local_path"] = "evidence/" + request_path.name
        entry["stop_signal"] = response.status in {401, 403, 429}
        entry["status"] = (
            "downloaded_pending_validation" if response.status == 200 else "http_error_not_used"
        )
        if response.status != 200:
            payload = None
    except (OSError, URLError, TimeoutError) as error:
        entry.update(
            {
                "http_status": None,
                "status": "download_failed_url_retained",
                "failure_type": type(error).__name__,
                "completed_at": datetime.now(UTC).isoformat(),
            }
        )
    manifest["requests"].append(entry)
    write_json(FETCH_MANIFEST, manifest)
    print(
        json.dumps(
            {
                key: entry.get(key)
                for key in ("name", "http_status", "status", "size_bytes", "sha256")
            }
        ),
        flush=True,
    )
    return payload, entry


def fetch_initial() -> None:
    for name, (url, suffix) in SOURCES.items():
        fetch(name, url, suffix)


def fetch_energy() -> None:
    fetch("irena_table_directory", IRENA_URL.rsplit("/", 1)[0] + "/", "json")
    query = {
        "query": [
            {"code": "Country/area", "selection": {"filter": "item", "values": ["ZMB"]}},
            {"code": "Technology", "selection": {"filter": "item", "values": ["0", "16"]}},
            {"code": "Grid connection", "selection": {"filter": "item", "values": ["0", "1"]}},
            {"code": "Year", "selection": {"filter": "item", "values": ["25"]}},
        ],
        "response": {"format": "json"},
    }
    payload, _ = fetch("irena_capacity_zmb_2025", IRENA_URL, "json", body=query)
    if payload is not None:
        print(payload.decode("utf-8-sig"), flush=True)


def fetch_supplements() -> None:
    payload, _ = fetch("irena_generation_metadata", IRENA_GENERATION_URL, "json")
    if payload is not None:
        metadata = json.loads(payload)
        print(
            json.dumps(
                {
                    "generation_metadata": {
                        "title": metadata["title"],
                        "variables": [
                            row for row in metadata["variables"] if row["code"] != "Country/area"
                        ],
                    }
                }
            ),
            flush=True,
        )
    fetch("undata_country", "https://data.un.org/en/iso/zm.html", "html")
    fetch("cabinet_currency_notice", "https://www.cabinet.gov.zm/?p=8213", "html")


def fetch_generation() -> None:
    query = {
        "query": [
            {"code": "Country/area", "selection": {"filter": "item", "values": ["ZMB"]}},
            {"code": "Technology", "selection": {"filter": "item", "values": ["0", "13"]}},
            {"code": "Data Type", "selection": {"filter": "item", "values": ["0"]}},
            {"code": "Grid connection", "selection": {"filter": "item", "values": ["2"]}},
            {"code": "Year", "selection": {"filter": "item", "values": ["23"]}},
        ],
        "response": {"format": "json"},
    }
    payload, _ = fetch("irena_generation_zmb_2023", IRENA_GENERATION_URL, "json", body=query)
    if payload is not None:
        print(payload.decode("utf-8-sig"), flush=True)
    capacity_query = {
        "query": [
            {"code": "Country/area", "selection": {"filter": "item", "values": ["ZMB"]}},
            {"code": "Technology", "selection": {"filter": "item", "values": ["0", "16"]}},
            {"code": "Grid connection", "selection": {"filter": "item", "values": ["0", "1"]}},
            {"code": "Year", "selection": {"filter": "item", "values": ["25"]}},
        ],
        "response": {"format": "px"},
    }
    fetch("irena_capacity_zmb_2025_px", IRENA_URL, "px", body=capacity_query)


def snapshot(name: str) -> tuple[bytes, dict]:
    for row in reversed(load_manifest()["requests"]):
        if row["name"] == name and row.get("http_status") == 200:
            payload = (DESTINATION / row["local_path"]).read_bytes()
            if sha256(payload) != row["sha256"]:
                raise ValueError("Original snapshot changed: " + name)
            return payload, row
    raise ValueError("No successful original snapshot for " + name)


def snapshot_json(name: str) -> object:
    return json.loads(snapshot(name)[0], parse_float=Decimal)


def snapshot_text(name: str) -> str:
    payload = snapshot(name)[0]
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", payload.decode("utf-8-sig"))).split())


def source_entry(name: str, title: str, fields: list[str], note: str = "") -> dict:
    _, record = snapshot(name)
    result = {
        "source_name": title,
        "fields": fields,
        "url": record["url"],
        "retrieved_at": record["retrieved_at"][:10],
        "snapshot_sha256": record["sha256"],
        "local_path": record["local_path"],
    }
    if note:
        result["note"] = note
    return result


def decimal_value(value: object) -> Decimal | None:
    if value is None or value in ("", "..", "...", ":", "-"):
        return None
    parsed = Decimal(str(value))
    if not parsed.is_finite():
        raise ValueError("Non-finite official observation")
    return parsed


def write_csv(path: Path, fields: list[str], records: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(records)


def assemble() -> None:
    country_payload = snapshot_json("world_bank_country")
    country = country_payload[1][0]
    assert country["id"] == "ZMB" and country["iso2Code"] == "ZM"
    assert country["capitalCity"] == "Lusaka" and country["name"] == "Zambia"
    wdi_payload = snapshot_json("world_bank_wdi")
    assert wdi_payload[0]["pages"] == 1 and len(wdi_payload[1]) == 48
    observations = {}
    for row in wdi_payload[1]:
        assert row["countryiso3code"] == "ZMB"
        key = (row["indicator"]["id"], int(row["date"]))
        assert key not in observations
        observations[key] = decimal_value(row["value"])

    def latest(code: str) -> tuple[int, Decimal]:
        candidates = [
            (year, value)
            for (indicator, year), value in observations.items()
            if indicator == code and value is not None
        ]
        if not candidates:
            raise ValueError("No dated WDI identity observation: " + code)
        return max(candidates)

    population_year, population = latest("SP.POP.TOTL")
    area_year, area = latest("AG.LND.TOTL.K2")
    assert population == population.to_integral_value()
    luapula = snapshot_text("luapula_about_zambia")
    police = snapshot_text("zambia_police_provinces")
    cabinet = snapshot_text("cabinet_country_background")
    currency_notice = snapshot_text("cabinet_currency_notice")
    undata = snapshot_text("undata_country")
    assert "The official language of Zambia is English" in luapula
    assert "Zambia is divided into ten provinces" in luapula
    assert "10 divisions (10 provinces)" in police
    assert "Zambia, officially the Republic of Zambia" in cabinet
    assert "Zambian Kwacha (ZMW)" in undata and "alpha code (ZMW)" in currency_notice
    assert "southern Africa" in luapula
    province_names = (
        "Western",
        "North-Western",
        "Copperbelt",
        "Central",
        "Luapula",
        "Northern",
        "Eastern",
        "Lusaka",
        "Southern",
        "Muchinga",
    )
    assert all(name + " Province" in luapula for name in province_names)
    timezone_rows = [
        line.split("\t")
        for line in snapshot("iana_zone_tab")[0].decode("utf-8").splitlines()
        if line.startswith("ZM\t")
    ]
    assert len(timezone_rows) == 1 and timezone_rows[0][2] == "Africa/Lusaka"
    collected_at = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    profile = {
        "iso2": "ZM",
        "iso3": "ZMB",
        "country_name_zh": "赞比亚",
        "country_name_en": "Zambia",
        "official_name_en": "Republic of Zambia",
        "local_names": ["Zambia", "Republic of Zambia"],
        "capital": "Lusaka",
        "admin_level_1_count": 10,
        "admin_level_1_type": "provinces",
        "population": int(population),
        "population_year": population_year,
        "official_languages": ["English"],
        "currency_code": "ZMW",
        "currency_name": "Zambian kwacha",
        "time_zones": ["Africa/Lusaka"],
        "area_sq_km": float(area),
        "area_year": area_year,
        "region": "Southern Africa",
        "sources": [
            source_entry(
                "world_bank_country",
                "World Bank Country API",
                ["iso2", "iso3", "country_name_en", "capital"],
                "Chinese display name 赞比亚 is a normalized translation of Zambia.",
            ),
            source_entry(
                "world_bank_wdi",
                "World Bank World Development Indicators - Population, total; Land area",
                ["population", "population_year", "area_sq_km", "area_year"],
                "Population is the WDI annual estimate. Land area excludes inland water "
                "and is not total surface area; each value retains its observation year.",
            ),
            source_entry(
                "cabinet_country_background",
                "Cabinet Office of Zambia - Historical Data / Background",
                ["official_name_en", "local_names"],
            ),
            source_entry(
                "luapula_about_zambia",
                "Luapula Province Administration - About Zambia",
                ["official_languages", "admin_level_1_count", "admin_level_1_type", "region"],
                "Only English is classified as the official language. Southern Africa follows "
                "the national geography description and project business-region convention, "
                "not UN M49 Eastern Africa. The page's historical district count is not used.",
            ),
            source_entry(
                "zambia_police_provinces",
                "Zambia Police Service - Police Divisions / 10 Provinces",
                ["admin_level_1_count", "admin_level_1_type"],
                "Independent official cross-check of the ten-province count.",
            ),
            source_entry(
                "cabinet_currency_notice",
                "Cabinet Office / Bank of Zambia - New Zambian Currency Family",
                ["currency_code"],
                "Announcement states that alpha code ZMW remains unchanged.",
            ),
            source_entry(
                "undata_country",
                "United Nations Statistics Division - UNData Zambia profile",
                ["currency_code", "currency_name"],
                "National currency is explicitly Zambian Kwacha (ZMW); other UNData numeric "
                "fields are not substituted for WDI.",
            ),
            source_entry("iana_zone_tab", "IANA Time Zone Database zone.tab", ["time_zones"]),
        ],
        "collected_at": collected_at,
        "review_status": REVIEW_STATUS,
    }
    write_json(DESTINATION / "country_profile.json", profile)
    with (ROOT / "raw material/global_sources/60_country_profiles.csv").open(
        encoding="utf-8-sig", newline=""
    ) as stream:
        profile_fields = next(csv.reader(stream))
    profile_row = {name: profile.get(name, "") for name in profile_fields}
    profile_row["order"] = 61
    for field in ("local_names", "official_languages", "time_zones"):
        profile_row[field] = json.dumps(profile[field], ensure_ascii=False, separators=(",", ":"))
    write_csv(DESTINATION / "country_profile.csv", profile_fields, [profile_row])

    with (ROOT / "raw material/countries/NAM/00_country_profile/macro_energy.csv").open(
        encoding="utf-8-sig", newline=""
    ) as stream:
        metric_fields = next(csv.reader(stream))
    macro = []
    for year in range(2020, 2025):
        record = dict.fromkeys(metric_fields, "")
        record.update(
            {
                "iso3": "ZMB",
                "country_name_zh": "赞比亚",
                "record_type": "macro_annual",
                "year": year,
                "macro_source_url": WDI_URL,
                "notes": "World Bank WDI 2020-2024 observations; source lastupdated="
                + wdi_payload[0]["lastupdated"]
                + "; missing observations remain blank, not zero or estimates.",
                "collected_at": collected_at,
                "review_status": REVIEW_STATUS,
            }
        )
        for field, indicator in MACRO_INDICATORS.items():
            value = observations.get((indicator, year))
            record[field] = "" if value is None else str(value)
        macro.append(record)

    capacity = snapshot_json("irena_capacity_zmb_2025")
    generation = snapshot_json("irena_generation_zmb_2023")
    capacity_meta = snapshot_json("irena_metadata")
    generation_meta = snapshot_json("irena_generation_metadata")
    capacity_variables = {
        row["code"]: dict(zip(row["values"], row["valueTexts"], strict=True))
        for row in capacity_meta["variables"]
    }
    generation_variables = {
        row["code"]: dict(zip(row["values"], row["valueTexts"], strict=True))
        for row in generation_meta["variables"]
    }
    assert capacity_variables["Technology"]["0"] == "Total renewable energy"
    assert capacity_variables["Technology"]["16"] == "Total non-renewable energy"
    assert capacity_variables["Year"]["25"] == "2025"
    assert generation_variables["Technology"]["0"] == "Total renewable"
    assert generation_variables["Technology"]["13"] == "Total non-renewable"
    assert generation_variables["Data Type"]["0"] == "Electricity Generation (GWh)"
    assert generation_variables["Grid connection"]["2"] == "All"
    assert generation_variables["Year"]["23"] == "2023"
    assert 'UNITS="MW";' in snapshot("irena_capacity_zmb_2025_px")[0].decode("cp1252")
    cap_values = {tuple(row["key"]): decimal_value(row["values"][0]) for row in capacity["data"]}
    gen_values = {tuple(row["key"]): decimal_value(row["values"][0]) for row in generation["data"]}
    assert set(cap_values) == {
        ("ZMB", technology, grid, "25") for technology in ("0", "16") for grid in ("0", "1")
    }
    assert set(gen_values) == {("ZMB", technology, "0", "2", "23") for technology in ("0", "13")}
    assert all(
        value is not None and value >= 0 for value in [*cap_values.values(), *gen_values.values()]
    )
    renewable_capacity = sum(
        (cap_values[("ZMB", "0", grid, "25")] for grid in ("0", "1")), Decimal(0)
    )
    total_capacity = renewable_capacity + sum(
        (cap_values[("ZMB", "16", grid, "25")] for grid in ("0", "1")), Decimal(0)
    )
    renewable_generation = gen_values[("ZMB", "0", "0", "2", "23")]
    total_generation = renewable_generation + gen_values[("ZMB", "13", "0", "2", "23")]
    assert total_capacity > 0 and total_generation > 0
    ratio_capacity = (renewable_capacity / total_capacity * 100).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )
    ratio_generation = (renewable_generation / total_generation * 100).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )
    energy = dict.fromkeys(metric_fields, "")
    energy.update(
        {
            "iso3": "ZMB",
            "country_name_zh": "赞比亚",
            "record_type": "energy_latest",
            "electricity_installed_capacity_mw": str(total_capacity),
            "electricity_installed_capacity_year": 2025,
            "electricity_generation_gwh": str(total_generation),
            "electricity_generation_year": 2023,
            "renewable_capacity_mw": str(renewable_capacity),
            "renewable_capacity_year": 2025,
            "renewable_generation_gwh": str(renewable_generation),
            "renewable_generation_year": 2023,
            "renewable_share_capacity_pct": str(ratio_capacity),
            "renewable_share_capacity_year": 2025,
            "renewable_share_generation_pct": str(ratio_generation),
            "renewable_share_generation_year": 2023,
            "energy_source_url": IRENA_URL,
            "collected_at": collected_at,
            "review_status": REVIEW_STATUS,
        }
    )
    notes = [
        "Capacity: IRENA 2026 H1, 2025, maximum net generating capacity; on-grid plus off-grid, "
        "total renewable plus total non-renewable. All four input cells are present.",
        "Generation: IRENA 2025 H2, 2023, gross generation, Grid connection=All; "
        "total renewable plus total non-renewable. Generation source: " + IRENA_GENERATION_URL,
        "The CSV follows the official JSON response display precision (two decimals), "
        "consistent with the existing country files. Full-precision capacity PX is retained "
        "separately; its off-grid renewable value 9.670310 MW displays as 9.67 MW in JSON.",
        "Total electricity values are sums of the two non-overlapping renewable/non-renewable "
        "aggregates. Renewable shares are calculated from the CSV numerator and denominator "
        "for the same year and rounded to four decimal places.",
        "electricity_demand_gwh and electricity_demand_year intentionally remain blank; "
        "generation is not used as demand.",
    ]
    energy["notes"] = json.dumps(notes, ensure_ascii=False, separators=(",", ":"))
    write_csv(DESTINATION / "macro_energy.csv", metric_fields, [*macro, energy])
    write_extension_evidence()
    summary = {
        "schema_version": "navigator.country-basic-normalization.v1",
        "iso3": "ZMB",
        "collected_at": collected_at,
        "review_status": REVIEW_STATUS,
        "country_profile_count": 1,
        "macro_row_count": 5,
        "energy_row_count": 1,
        "macro_available_values": sum(
            row[field] != "" for row in macro for field in MACRO_INDICATORS
        ),
        "profile_available_values": 2,
        "energy_available_values": 6,
        "pending_electricity_demand_values": 1,
        "population": profile["population"],
        "population_year": population_year,
        "land_area_sq_km": profile["area_sq_km"],
        "land_area_year": area_year,
        "energy_values": {
            key: value
            for key, value in energy.items()
            if key
            in (
                "electricity_installed_capacity_mw",
                "electricity_generation_gwh",
                "renewable_capacity_mw",
                "renewable_generation_gwh",
                "renewable_share_capacity_pct",
                "renewable_share_generation_pct",
            )
        },
        "normalization_notes": notes,
        "unused_snapshot_notes": {
            "bank_of_zambia_currency": "HTTP 200 Angular shell contains no currency facts; "
            "excluded from field evidence. Cabinet Office's BOZ announcement and UNData "
            "provide the actual downloaded currency evidence."
        },
        "original_snapshot_count": len(load_manifest()["requests"]),
        "outputs": {
            path.name: sha256(path.read_bytes())
            for path in (
                DESTINATION / "country_profile.json",
                DESTINATION / "country_profile.csv",
                DESTINATION / "macro_energy.csv",
            )
        },
    }
    write_json(EVIDENCE / "normalization_summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


def write_extension_evidence() -> None:
    definitions = {
        "ZMB-WB-COUNTRY": ("world_bank_country", "World Bank Country API - Zambia"),
        "ZMB-WDI": (
            "world_bank_wdi",
            "World Bank WDI - Zambia, six macro indicators 2020-2024, population and land area",
        ),
        "ZMB-IANA": ("iana_zone_tab", "IANA Time Zone Database zone.tab - ZM / Africa/Lusaka"),
        "ZMB-LUAPULA": ("luapula_about_zambia", "Luapula Province Administration - About Zambia"),
        "ZMB-CABINET": (
            "cabinet_country_background",
            "Cabinet Office - Republic of Zambia country background",
        ),
        "ZMB-POLICE": ("zambia_police_provinces", "Zambia Police Service - 10 Provinces"),
        "ZMB-CABINET-CURRENCY": (
            "cabinet_currency_notice",
            "Cabinet Office - Bank of Zambia currency announcement",
        ),
        "ZMB-UN": ("undata_country", "UN Statistics Division - Zambia national currency"),
        "ZMB-IRENA-CAPACITY": (
            "irena_capacity_zmb_2025",
            "IRENASTAT 2026 H1 - Zambia renewable and non-renewable capacity 2025",
        ),
        "ZMB-IRENA-CAPACITY-METADATA": (
            "irena_metadata",
            "IRENASTAT 2026 H1 capacity dimension metadata",
        ),
        "ZMB-IRENA-CAPACITY-PX": (
            "irena_capacity_zmb_2025_px",
            "IRENASTAT 2026 H1 capacity PX, MW units and statistical definitions",
        ),
        "ZMB-IRENA-GENERATION": (
            "irena_generation_zmb_2023",
            "IRENASTAT 2025 H2 - Zambia renewable and non-renewable generation 2023",
        ),
        "ZMB-IRENA-GENERATION-METADATA": (
            "irena_generation_metadata",
            "IRENASTAT 2025 H2 generation metadata, GWh and All-grid scope",
        ),
    }
    sources = []
    for identifier, (name, title) in definitions.items():
        _, row = snapshot(name)
        sources.append(
            {
                "id": identifier,
                "title": title,
                "url": row["url"],
                "captured_at": datetime.fromisoformat(row["retrieved_at"])
                .astimezone(timezone(timedelta(hours=8)))
                .isoformat(),
                "local_path": (DESTINATION / row["local_path"]).relative_to(ROOT).as_posix(),
                "sha256": row["sha256"],
            }
        )
    metric_sources = {
        field: ["ZMB-WDI"] for field in ("population_total", "land_area_sq_km", *MACRO_INDICATORS)
    }
    for field in (
        "electricity_installed_capacity_mw",
        "renewable_capacity_mw",
        "renewable_share_capacity_pct",
    ):
        metric_sources[field] = [
            "ZMB-IRENA-CAPACITY",
            "ZMB-IRENA-CAPACITY-METADATA",
            "ZMB-IRENA-CAPACITY-PX",
        ]
    for field in (
        "electricity_generation_gwh",
        "renewable_generation_gwh",
        "renewable_share_generation_pct",
    ):
        metric_sources[field] = ["ZMB-IRENA-GENERATION", "ZMB-IRENA-GENERATION-METADATA"]
    metric_sources["electricity_demand_gwh"] = []
    evidence = {
        "schema_version": "navigator.country-extension-evidence.v1",
        "country_code": "ZMB",
        "sources": sources,
        "identity_source_ids": [
            "ZMB-WB-COUNTRY",
            "ZMB-IANA",
            "ZMB-LUAPULA",
            "ZMB-CABINET",
            "ZMB-POLICE",
            "ZMB-CABINET-CURRENCY",
            "ZMB-UN",
        ],
        "metric_source_ids": metric_sources,
    }
    write_json(ROOT / "runtime/country-expansion/zmb-20260828-r1/basic-evidence.json", evidence)


def inspect_snapshots() -> None:
    manifest = load_manifest()
    for row in manifest["requests"]:
        if row.get("http_status") != 200:
            continue
        if row["name"] not in {"world_bank_country", "world_bank_wdi", "irena_metadata"}:
            continue
        payload = json.loads((DESTINATION / row["local_path"]).read_text(encoding="utf-8-sig"))
        if row["name"] == "world_bank_country":
            print(json.dumps({"country": payload}, ensure_ascii=False), flush=True)
        elif row["name"] == "world_bank_wdi":
            print(
                json.dumps(
                    {
                        "wdi_metadata": payload[0],
                        "wdi_observations": len(payload[1]),
                        "2024_samples": [item for item in payload[1] if item.get("date") == "2024"],
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
        else:
            print(json.dumps({"irena_metadata": payload}, ensure_ascii=False), flush=True)


def verify_outputs() -> None:
    """Replay source/value bindings offline without changing any candidate or source file."""
    numeric_cases = [
        (None, None),
        ("", None),
        ("..", None),
        ("...", None),
        (":", None),
        ("-", None),
        (0, Decimal(0)),
        ("0.00", Decimal(0)),
        ("-6.25", Decimal("-6.25")),
        ("125.77", Decimal("125.77")),
    ]
    for original, expected in numeric_cases:
        assert decimal_value(original) == expected
    for non_finite in ("NaN", "Infinity", "-Infinity"):
        try:
            decimal_value(non_finite)
        except ValueError:
            pass
        else:
            raise AssertionError("Non-finite values must not be accepted")

    manifest = load_manifest()
    request_count = 0
    for record in manifest["requests"]:
        path = DESTINATION / record["local_path"]
        assert not path.is_symlink() and path.resolve().is_relative_to(EVIDENCE.resolve())
        assert record["http_status"] == 200 and not record["stop_signal"]
        assert sha256(path.read_bytes()) == record["sha256"]
        assert path.stat().st_size == record["size_bytes"]
        assert datetime.fromisoformat(record["retrieved_at"]).tzinfo is not None
        if record.get("request_local_path"):
            request_path = DESTINATION / record["request_local_path"]
            assert sha256(request_path.read_bytes()) == record["request_sha256"]
            request_count += 1

    def csv_rows(path: Path) -> tuple[list[str], list[dict]]:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            assert reader.fieldnames is not None
            return reader.fieldnames, list(reader)

    profile = json.loads((DESTINATION / "country_profile.json").read_text(encoding="utf-8"))
    profile_fields, profiles = csv_rows(DESTINATION / "country_profile.csv")
    original_fields, _ = csv_rows(ROOT / "raw material/global_sources/60_country_profiles.csv")
    assert profile_fields == original_fields and len(profiles) == 1
    assert profiles[0]["order"] == "61" and profile["iso3"] == profiles[0]["iso3"] == "ZMB"
    assert profiles[0]["iso2"] == "ZM"
    for name in ("local_names", "official_languages", "time_zones"):
        assert json.loads(profiles[0][name]) == profile[name]
    for name in set(profile_fields) - {"order", "local_names", "official_languages", "time_zones"}:
        assert profiles[0][name] == str(profile[name])

    metric_fields, records = csv_rows(DESTINATION / "macro_energy.csv")
    original_fields, _ = csv_rows(
        ROOT / "raw material/countries/NAM/00_country_profile/macro_energy.csv"
    )
    assert metric_fields == original_fields and len(metric_fields) == 29
    assert len(records) == 6 and all(row["iso3"] == "ZMB" for row in records)
    macro = [row for row in records if row["record_type"] == "macro_annual"]
    energy_rows = [row for row in records if row["record_type"] == "energy_latest"]
    assert [row["year"] for row in macro] == [str(year) for year in range(2020, 2025)]
    assert len(energy_rows) == 1
    wdi = {
        (row["indicator"]["id"], int(row["date"])): decimal_value(row["value"])
        for row in snapshot_json("world_bank_wdi")[1]
    }
    for row in macro:
        for field, indicator in MACRO_INDICATORS.items():
            assert decimal_value(row[field]) == wdi[(indicator, int(row["year"]))]
            assert row[field] != ""
    assert decimal_value(macro[0]["gdp_growth_pct"]) < 0
    assert decimal_value(macro[2]["fdi_net_inflows_usd"]) < 0
    for field, indicator in (("population", "SP.POP.TOTL"), ("area_sq_km", "AG.LND.TOTL.K2")):
        year_field = "population_year" if field == "population" else "area_year"
        assert decimal_value(profile[field]) == wdi[(indicator, profile[year_field])]

    energy = energy_rows[0]
    capacity = snapshot_json("irena_capacity_zmb_2025")["data"]
    generation = snapshot_json("irena_generation_zmb_2023")["data"]
    for family, raw, total_field, renewable_field, ratio_field, expected_year in (
        (
            "capacity",
            capacity,
            "electricity_installed_capacity_mw",
            "renewable_capacity_mw",
            "renewable_share_capacity_pct",
            "2025",
        ),
        (
            "generation",
            generation,
            "electricity_generation_gwh",
            "renewable_generation_gwh",
            "renewable_share_generation_pct",
            "2023",
        ),
    ):
        total = sum((Decimal(row["values"][0]) for row in raw), Decimal(0))
        renewable = sum(
            (Decimal(row["values"][0]) for row in raw if row["key"][1] == "0"), Decimal(0)
        )
        assert decimal_value(energy[total_field]) == total
        assert decimal_value(energy[renewable_field]) == renewable
        assert decimal_value(energy[ratio_field]) == (renewable / total * 100).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )
        total_year_field = (
            "electricity_installed_capacity_year"
            if family == "capacity"
            else "electricity_generation_year"
        )
        assert energy[total_year_field] == expected_year
        assert energy[f"renewable_{family}_year"] == expected_year
        assert energy[f"renewable_share_{family}_year"] == expected_year
    assert energy["electricity_demand_gwh"] == energy["electricity_demand_year"] == ""

    evidence_path = ROOT / "runtime/country-expansion/zmb-20260828-r1/basic-evidence.json"
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    assert evidence["schema_version"] == "navigator.country-extension-evidence.v1"
    assert evidence["country_code"] == "ZMB"
    source_ids = {source["id"] for source in evidence["sources"]}
    assert len(source_ids) == len(evidence["sources"]) == 13
    for source in evidence["sources"]:
        path = ROOT / source["local_path"]
        assert path.resolve().is_relative_to(EVIDENCE.resolve()) and not path.is_symlink()
        assert sha256(path.read_bytes()) == source["sha256"]
        assert datetime.fromisoformat(source["captured_at"]).tzinfo is not None
    assert len(evidence["metric_source_ids"]) == 15
    used_ids = set(evidence["identity_source_ids"])
    for field, ids in evidence["metric_source_ids"].items():
        assert ids or field == "electricity_demand_gwh"
        used_ids.update(ids)
    assert used_ids == source_ids
    summary = json.loads((EVIDENCE / "normalization_summary.json").read_text(encoding="utf-8"))
    for filename, expected in summary["outputs"].items():
        assert sha256((DESTINATION / filename).read_bytes()) == expected
    print(
        json.dumps(
            {
                "result": "passed",
                "country": "ZMB",
                "original_snapshots": len(manifest["requests"]),
                "request_payloads": request_count,
                "source_bindings": len(source_ids),
                "valued_metric_codes": 14,
                "valued_observations": 38,
                "pending_observations": 1,
                "numeric_semantics_cases": len(numeric_cases) + 3,
                "basic_evidence_sha256": sha256(evidence_path.read_bytes()),
            },
            indent=2,
        ),
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--stage",
        choices=("fetch", "inspect", "energy", "supplements", "generation", "assemble", "verify"),
        default="fetch",
    )
    args = parser.parse_args()
    if args.stage == "fetch":
        fetch_initial()
    elif args.stage == "energy":
        fetch_energy()
    elif args.stage == "supplements":
        fetch_supplements()
    elif args.stage == "generation":
        fetch_generation()
    elif args.stage == "assemble":
        assemble()
    elif args.stage == "verify":
        verify_outputs()
    else:
        inspect_snapshots()


if __name__ == "__main__":
    main()
