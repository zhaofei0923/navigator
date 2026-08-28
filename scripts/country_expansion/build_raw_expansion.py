"""Append a collected country in new, review-only raw indexes; preserve all legacy files."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

TABLES = {
    "profiles": ("country_profiles", "00_country_profile/country_profile.csv"),
    "macro_energy": ("country_macro_energy", "00_country_profile/macro_energy.csv"),
    "official_sources": ("country_official_sources", "01_official_sources/official_sources.csv"),
    "policies": ("country_policy_register", "02_policy_documents/policy_register.csv"),
    "policy_topic_coverage": (
        "country_policy_topic_coverage",
        "02_policy_documents/policy_topic_coverage.csv",
    ),
}
TOPICS = {
    "tax_customs_vat_incentives",
    "grid_code",
    "grid_interconnection_access",
    "renewable_tariff_subsidy",
    "project_approval_permitting",
    "environmental_regulation",
    "battery_energy_storage_regulation",
}


def digest(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"A regular, non-symlink file is required: {path}")
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def write_json(path: Path, value: Any) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = list(reader.fieldnames or ())
        rows = list(reader)
    if (
        not headers
        or any(not header for header in headers)
        or len(headers) != len(set(headers))
        or any(None in row or any(value is None for value in row.values()) for row in rows)
    ):
        raise ValueError(f"Invalid CSV shape: {path}")
    return headers, rows


def freeze(repo: Path, output: Path, added: str) -> dict[str, Any]:
    raw = repo / "raw material"
    files = [
        path
        for path in raw.rglob("*")
        if path.is_file() and not path.is_relative_to(raw / "countries" / added)
    ]
    store = repo / "runtime/market-content"
    if store.exists():
        files.extend(path for path in store.rglob("*") if path.is_file())
    seed = repo / "runtime/basic60/basic60_seed.private_trial_ready.json"
    if seed.exists():
        files.append(seed)
    snapshot = {
        "schema_version": "navigator.country-expansion-preservation.v1",
        "created_at": datetime.now(UTC).isoformat(),
        "added_country": added,
        "files": {path.relative_to(repo).as_posix(): digest(path) for path in sorted(files)},
    }
    write_json(output, snapshot)
    return {"frozen_files": len(files), "snapshot_sha256": digest(output)}


def check_baseline(repo: Path, baseline: Path) -> dict[str, Any]:
    value = json.loads(baseline.read_text(encoding="utf-8"))
    if value.get("schema_version") != "navigator.country-expansion-preservation.v1":
        raise ValueError("Unrecognized preservation manifest")
    mismatches = []
    for name, expected in value["files"].items():
        path = repo / name
        # WSL's Windows file server maps ':' in Zone.Identifier sidecar names
        # to U+F03A. Resolve that exact OS alias without changing the snapshot.
        if not path.is_file() and path.name.endswith("\uf03aZone.Identifier"):
            path = path.with_name(
                path.name.removesuffix("\uf03aZone.Identifier") + ":Zone.Identifier"
            )
        if not path.resolve().is_relative_to(repo.resolve()):
            raise ValueError("Preservation path escapes repository")
        if not path.is_file() or digest(path) != expected:
            mismatches.append(name)
    if mismatches:
        raise ValueError(f"Legacy inputs changed: {mismatches}")
    return {"preserved_files": len(value["files"]), "hash_mismatches": []}


def _typed(row: dict[str, str], kind: str) -> dict[str, Any]:
    result: dict[str, Any] = dict(row)
    if kind == "macro_energy":
        for key, value in row.items():
            if key == "year" or key.endswith(("_year", "_usd", "_pct", "_mw", "_gwh")):
                result[key] = None if not value else float(value)
                if result[key] is not None:
                    if not math.isfinite(result[key]):
                        raise ValueError(f"Non-finite numeric value for {key}")
                    if result[key].is_integer():
                        result[key] = int(result[key])
    if kind == "policies":
        result["priority"] = int(row["priority"])
        # The original integrated package stores topic_tags as a semicolon string.
        # Keep the raw field unchanged rather than introducing a second JSON type.
    return result


def load_addition(raw: Path, code: str) -> dict[str, Any]:
    country = raw / "countries" / code
    result = {kind: read_csv(country / relative)[1] for kind, (_, relative) in TABLES.items()}
    if any(row.get("iso3") != code for rows in result.values() for row in rows):
        raise ValueError("Every new row must belong to the added country")
    if len(result["profiles"]) != 1:
        raise ValueError("Exactly one added profile is required")
    macro = [row for row in result["macro_energy"] if row["record_type"] == "macro_annual"]
    energy = [row for row in result["macro_energy"] if row["record_type"] == "energy_latest"]
    if len(macro) != 5 or {row["year"] for row in macro} != {str(y) for y in range(2020, 2025)}:
        raise ValueError("Five unique macro years 2020-2024 are required")
    if len(energy) != 1 or len(result["macro_energy"]) != 6:
        raise ValueError("Exactly one energy row is required")
    if not 6 <= len(result["official_sources"]) <= 10 or not 5 <= len(result["policies"]) <= 15:
        raise ValueError("Source or policy count is outside the existing collection contract")
    topics = result["policy_topic_coverage"]
    if len(topics) != 7 or {row["topic_code"] for row in topics} != TOPICS:
        raise ValueError("Exactly the seven existing policy topics are required")
    policy_ids = [row["policy_id"] for row in result["policies"]]
    source_ids = [row["source_id"] for row in result["official_sources"]]
    if len(policy_ids) != len(set(policy_ids)) or len(source_ids) != len(set(source_ids)):
        raise ValueError("Duplicate policy/source identifiers")
    filenames = set()
    for row in result["policies"]:
        filename, sha = row.get("local_filename", ""), row.get("sha256", "")
        if filename:
            if Path(filename).name != filename or not re.fullmatch(r"[a-f0-9]{64}", sha):
                raise ValueError("Invalid policy filename or hash")
            path = country / "02_policy_documents/files" / filename
            if digest(path) != sha:
                raise ValueError(f"Policy bytes do not match register: {filename}")
            if filename in filenames:
                raise ValueError("A policy file must not be registered twice")
            filenames.add(filename)
        elif sha or row.get("download_status", "").startswith("downloaded"):
            raise ValueError("Undownloaded policies must not claim a local hash/download")
    result["profile_json"] = json.loads(
        (country / "00_country_profile/country_profile.json").read_text(encoding="utf-8-sig")
    )
    return result


def validate_merged(rows: dict[str, Any], total: int) -> None:
    codes = [row["iso3"] for row in rows["profiles"]]
    if len(codes) != total or len(set(codes)) != total or "CHN" not in codes:
        raise ValueError("Merged raw scope must contain unique countries including archived CHN")
    if len({row["iso2"] for row in rows["profiles"]}) != total:
        raise ValueError("Duplicate ISO2 country codes")
    for kind in TABLES:
        if any(row["iso3"] not in codes for row in rows[kind]):
            raise ValueError("An aggregate row references a missing country")
    for code in codes:
        macro = [row for row in rows["macro_energy"] if row["iso3"] == code]
        annual = [row for row in macro if row["record_type"] == "macro_annual"]
        if (
            len(macro) != 6
            or len(annual) != 5
            or {row["year"] for row in annual} != {str(year) for year in range(2020, 2025)}
            or sum(row["record_type"] == "energy_latest" for row in macro) != 1
        ):
            raise ValueError(f"Incorrect aggregate observation rows for {code}")
        local_topics = [row for row in rows["policy_topic_coverage"] if row["iso3"] == code]
        if len(local_topics) != 7 or {row["topic_code"] for row in local_topics} != TOPICS:
            raise ValueError(f"Incorrect aggregate topics for {code}")
        for kind, key, minimum, maximum in (
            ("official_sources", "source_id", 6, 10),
            ("policies", "policy_id", 5, 15),
        ):
            identifiers = [row[key] for row in rows[kind] if row["iso3"] == code]
            if not minimum <= len(identifiers) <= maximum or len(set(identifiers)) != len(
                identifiers
            ):
                raise ValueError(f"Invalid {kind} count or duplicate identifiers for {code}")


def build(repo: Path, baseline: Path, code: str, total: int, as_of: str) -> dict[str, Any]:
    preserved = check_baseline(repo, baseline)
    raw = repo / "raw material"
    addition = load_addition(raw, code)
    old = json.loads((raw / "collection_manifest_60.json").read_text(encoding="utf-8-sig"))
    if total != old["country_count"] + 1:
        raise ValueError("This operation appends exactly one country to the frozen 60-country pack")
    merged: dict[str, Any] = {}
    targets = [raw / "global_sources" / f"{total}_{stem}.csv" for stem, _ in TABLES.values()]
    targets += [
        raw / "global_sources" / f"collection_integrated_{total}.json",
        raw / f"collection_manifest_{total}.json",
        raw / "countries" / code / "03_index/index.json",
        raw / "countries" / code / "03_index/research_bundle.json",
    ]
    if any(path.exists() for path in targets):
        raise FileExistsError("Refusing to overwrite a raw expansion; use a fresh version")
    for kind, (stem, _) in TABLES.items():
        headers, previous = read_csv(raw / "global_sources" / f"60_{stem}.csv")
        if any(row.get("iso3") == code for row in previous):
            raise ValueError("Added country is already present in the parent")
        extra = [{key: row.get(key, "") for key in headers} for row in addition[kind]]
        for row in extra:
            if "country_name_zh" in headers:
                row["country_name_zh"] = addition["profile_json"]["country_name_zh"]
        merged[kind] = previous + extra
    validate_merged(merged, total)
    old_integrated = json.loads(
        (raw / "global_sources/collection_integrated_60.json").read_text(encoding="utf-8-sig")
    )
    integrated = {}
    for kind in TABLES:
        extra: list[dict[str, Any]] = (
            [{**addition["profile_json"], "order": total}]
            if kind == "profiles"
            else [_typed(row, kind) for row in addition[kind]]
        )
        for row in extra:
            row.setdefault("country_name_zh", addition["profile_json"]["country_name_zh"])
        integrated[kind] = old_integrated[kind] + extra
    counts = {
        "macro_annual_records": 5,
        "energy_latest_records": 1,
        "official_sources": len(addition["official_sources"]),
        "policies": len(addition["policies"]),
        "expanded_regulatory_policies": sum(
            row["policy_group"] == "expanded_regulatory" for row in addition["policies"]
        ),
        "policy_topics": 7,
        "policy_topic_gaps": sum(
            row["coverage_status"] == "not_found_pending_research"
            for row in addition["policy_topic_coverage"]
        ),
        "policy_files_downloaded_and_hashed": sum(
            bool(row.get("local_filename")) for row in addition["policies"]
        ),
    }
    index = {
        "order": total,
        "iso3": code,
        "country_name_zh": addition["profile_json"]["country_name_zh"],
        "country_name_en": addition["profile_json"]["country_name_en"],
        "collected_at": as_of,
        "review_status": "machine_collected_pending_human_review",
        "files": {
            "country_profile": "00_country_profile/country_profile.json",
            "macro_energy": "00_country_profile/macro_energy.csv",
            "official_sources": "01_official_sources/official_sources.csv",
            "policy_register": "02_policy_documents/policy_register.csv",
            "policy_topic_coverage": "02_policy_documents/policy_topic_coverage.csv",
            "policy_files_directory": "02_policy_documents/files/",
        },
        "counts": counts,
        "limitations": [
            "用电需求留空，不用发电量代替。",
            "新增资料和正文待一次集中确认；本资料包不自动改变线上发布状态。",
            "未取得原文的政策仅保留官方入口及限制，不伪造下载与哈希。",
        ],
    }
    policies, topics = merged["policies"], merged["policy_topic_coverage"]
    status_counts = dict(Counter(row["coverage_status"] for row in topics))
    manifest = {
        "collection_name": f"全球新能源基础资料扩展包_{total}国_海外{total - 1}国",
        "schema_version": "navigator.raw-country-expansion.v1",
        "collected_at": as_of,
        "country_count": total,
        "outbound_country_count": total - 1,
        "excluded_from_outbound": ["CHN"],
        "added_country": code,
        "parent_manifest": "collection_manifest_60.json",
        "parent_manifest_sha256": digest(raw / "collection_manifest_60.json"),
        "legacy_preservation": preserved,
        "published": False,
        "review_status": "new_country_awaiting_single_review",
        "macro_annual_record_count": sum(
            row["record_type"] == "macro_annual" for row in merged["macro_energy"]
        ),
        "energy_latest_record_count": sum(
            row["record_type"] == "energy_latest" for row in merged["macro_energy"]
        ),
        "official_source_count": len(merged["official_sources"]),
        "policy_record_count": len(policies),
        "expanded_regulatory_policy_count": sum(
            row["policy_group"] == "expanded_regulatory" for row in policies
        ),
        "policy_topic_coverage_record_count": len(topics),
        "policy_topic_status_counts": status_counts,
        "policy_topic_gap_count": status_counts.get("not_found_pending_research", 0),
        "downloaded_policy_file_count": sum(bool(row.get("local_filename")) for row in policies),
        "downloaded_pending_validation_file_count": sum(
            row["download_status"] == "downloaded_pending_validation" for row in policies
        ),
        "policy_effective_date_missing_count": sum(
            not row.get("effective_date") for row in policies
        ),
        "per_country": old["per_country"] + [index],
        "indexes": {
            kind: f"global_sources/{total}_{stem}.csv" for kind, (stem, _) in TABLES.items()
        },
        "notes": [
            "原60国档案含中国；中国仅留档，不进入海外市场。",
            "本次只新增赞比亚，既有60国原件、索引、工作簿及已发布59篇概述不变。",
            "新旧资料的真实采集与统计日期分别保留，不统一伪刷新。",
            "许可由人工决定；结构及哈希检查不等于政策效力或内容批准。",
        ],
    }
    # Validate all inputs and prepare all rows before creating any new global index.
    for kind, (stem, _) in TABLES.items():
        headers, _ = read_csv(raw / "global_sources" / f"60_{stem}.csv")
        path = raw / "global_sources" / f"{total}_{stem}.csv"
        with path.open("x", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers)
            writer.writeheader()
            writer.writerows(merged[kind])
    write_json(raw / "global_sources" / f"collection_integrated_{total}.json", integrated)
    write_json(raw / "countries" / code / "03_index/index.json", index)
    write_json(
        raw / "countries" / code / "03_index/research_bundle.json",
        {
            "iso3": code,
            "collected_at": as_of,
            "review_status": "machine_collected_pending_human_review",
            "source_count": counts["official_sources"],
            "policy_count": counts["policies"],
            "downloaded_file_count": counts["policy_files_downloaded_and_hashed"],
            "official_sources": integrated["official_sources"][-counts["official_sources"] :],
            "policies": integrated["policies"][-counts["policies"] :],
            "policy_topic_coverage": integrated["policy_topic_coverage"][-7:],
        },
    )
    manifest["file_hashes"] = {
        path.relative_to(raw).as_posix(): digest(path) for path in targets if path.is_file()
    }
    write_json(raw / f"collection_manifest_{total}.json", manifest)
    check_baseline(repo, baseline)
    return {
        key: value for key, value in manifest.items() if key not in {"per_country", "file_hashes"}
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("freeze", "build", "verify"))
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--country", default="ZMB")
    parser.add_argument("--total", type=int, default=61)
    parser.add_argument("--as-of", default="2026-08-28")
    args = parser.parse_args()
    repo = args.repo.resolve()
    if not re.fullmatch(r"[A-Z]{3}", args.country) or args.country == "CHN":
        raise ValueError("An overseas ISO3 country is required")
    if args.operation == "freeze":
        result = freeze(repo, args.baseline, args.country)
    elif args.operation == "verify":
        result = check_baseline(repo, args.baseline)
    else:
        result = build(repo, args.baseline, args.country, args.total, args.as_of)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
