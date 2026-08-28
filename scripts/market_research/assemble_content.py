"""Package authored overviews; never generate, pad, approve or publish prose.

The old brief-to-report template generator is retired. Existing manuscripts and
review workbooks remain historical archives, not inputs or fallback content.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import tempfile
from collections import Counter
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from navigator_api.market_schemas import CountryMarketOverview, overview_character_count
from navigator_api.market_storage import ensure_no_symlinks
from navigator_data_readiness.market_content import (
    CANDIDATE_SCHEMA,
    EDIT_HEADERS,
    REVIEW_SCHEMA,
    _publish_directory,
    load_market_candidate,
    market_review_rows,
)

RESEARCH_SCHEMA = "navigator.market-overview-research.v1"
VERSION = "authored-market-overview-assembly-v1"
PUBLIC_INTERNAL = re.compile(
    r"https?://|source_ref|evidence_id|json_pointer|formal_gate_status|"
    r"private_trial_ready|Basic60|待审核|审核通过|九格评级|项目核实清单",
    re.IGNORECASE,
)
NUMBER = re.compile(r"-?\d+(?:\.\d+)?")


def sha256(path: Path) -> str:
    ensure_no_symlinks(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    ensure_no_symlinks(path)
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected a JSON object: {path.name}")
    return payload


def _read_input(path: Path, repo: Path, fingerprints: dict[str, str]) -> bytes:
    """Bind the fingerprint to the exact bytes used for parsing, not a later read."""
    ensure_no_symlinks(path)
    payload = path.read_bytes()
    fingerprints[path.relative_to(repo).as_posix()] = hashlib.sha256(payload).hexdigest()
    return payload


def numeric_signature(value: str) -> Counter[str]:
    """Translation transcription check, not proof of facts or legal effect."""
    months = (
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    )
    for number, name in enumerate(months, 1):
        value = re.sub(rf"(?i)\b{name}\b(?=\s+\d)|(?<=\d)\s+{name}\b", f" {number} ", value)
    value = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", value).replace("\u2212", "-")
    value = re.sub(r"(?<=\d)[\u2013\u2014/-](?=\d)", " ", value)
    return Counter(str(Decimal(item).normalize()) for item in NUMBER.findall(value))


def validate_public_and_bilingual(payload: dict[str, Any]) -> list[dict[str, Any]]:
    overview = CountryMarketOverview.model_validate(payload)
    problems = []
    for locale, text in overview.locales.items():
        if any(PUBLIC_INTERNAL.search(value) for value in (text.title, text.disclaimer)):
            raise ValueError(f"public overview contains internal metadata: {locale}")
        for paragraph in text.paragraphs:
            if PUBLIC_INTERNAL.search(paragraph) or re.search(
                r"\n|^\s*(?:#{1,6}\s|[-*]\s|\d+[.、]\s*)", paragraph
            ):
                raise ValueError(f"public overview contains internal metadata or a list: {locale}")
    for index, (zh, en) in enumerate(
        zip(overview.locales["zh-CN"].paragraphs, overview.locales["en"].paragraphs, strict=True), 1
    ):
        if numeric_signature(zh) != numeric_signature(en):
            problems.append({"country_code": overview.country_code, "paragraph": index})
    return problems


def _require_text(item: dict[str, Any], key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"research requires nonempty {key}")
    return value


def validate_research(
    research: dict[str, Any], overview: CountryMarketOverview, repo: Path
) -> dict[str, str]:
    """Validate traceability without machine licence or approval states."""
    if (
        research.get("schema_version") != RESEARCH_SCHEMA
        or research.get("country_code") != overview.country_code
        or research.get("content_version") != overview.content_version
        or research.get("as_of") != overview.as_of.isoformat()
    ):
        raise ValueError("research identity, date and version must match the manuscript")
    evidence, facts = research.get("evidence"), research.get("facts")
    mapping, gaps = research.get("paragraph_map"), research.get("uncertainties")
    if not isinstance(evidence, list) or not evidence:
        raise ValueError("research requires evidence")
    if not isinstance(facts, list) or not 6 <= len(facts) <= 10:
        raise ValueError("research requires 6 to 10 commercial fact anchors")
    if not isinstance(mapping, list) or len(mapping) != len(overview.locales["zh-CN"].paragraphs):
        raise ValueError("research requires one mapping per paragraph")
    if not isinstance(gaps, list) or any(
        not isinstance(gap, str) or not gap.strip() for gap in gaps
    ):
        raise ValueError("research uncertainties must be a list of strings")
    evidence_ids: set[str] = set()
    fingerprints = {}
    for item in evidence:
        if not isinstance(item, dict):
            raise ValueError("research evidence must be an object")
        evidence_id = _require_text(item, "id")
        if evidence_id in evidence_ids:
            raise ValueError("duplicate evidence ID")
        evidence_ids.add(evidence_id)
        for key in ("title", "locator", "verification_scope"):
            _require_text(item, key)
        parsed = urlsplit(_require_text(item, "url"))
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("research sources require a public HTTPS URL without credentials")
        if date.fromisoformat(_require_text(item, "checked_on")) > overview.as_of:
            raise ValueError("research checks cannot be later than information as_of")
        local = item.get("local_path")
        if local is not None:
            if (
                not isinstance(local, str)
                or "\\" in local
                or any(part in {"", ".", ".."} for part in local.split("/"))
                or not local.startswith("raw material/")
            ):
                raise ValueError("local research evidence must be canonical within raw material")
            path = repo / local
            ensure_no_symlinks(path)
            if not path.resolve().is_relative_to(repo / "raw material"):
                raise ValueError("local research evidence escapes raw material")
            digest = sha256(path)
            if item.get("local_sha256") != digest:
                raise ValueError("local source hash differs from research evidence")
            fingerprints[local] = digest
        elif "local_sha256" in item:
            raise ValueError("a local source hash requires its original path")
    fact_ids: set[str] = set()
    for fact in facts:
        if not isinstance(fact, dict):
            raise ValueError("research fact must be an object")
        fact_id = _require_text(fact, "id")
        if fact_id in fact_ids:
            raise ValueError("duplicate fact ID")
        fact_ids.add(fact_id)
        for key in ("statement", "commercial_implication"):
            _require_text(fact, key)
        ids = fact.get("source_ids")
        if not isinstance(ids, list) or not ids or any(item not in evidence_ids for item in ids):
            raise ValueError("every fact must reference existing evidence")
    indices, used_facts = [], set()
    for item in mapping:
        if not isinstance(item, dict) or type(item.get("paragraph")) is not int:
            raise ValueError("paragraph mapping requires integer indices")
        indices.append(item["paragraph"])
        _require_text(item, "analysis_note")
        ids = item.get("fact_ids")
        if not isinstance(ids, list) or not ids or any(fact not in fact_ids for fact in ids):
            raise ValueError("every paragraph must reference existing commercial facts")
        used_facts.update(ids)
    if sorted(indices) != list(range(1, len(mapping) + 1)) or used_facts != fact_ids:
        raise ValueError("paragraph mappings must cover all paragraphs and facts")
    return fingerprints


def _check_directories(repo: Path, authored: Path, output: Path) -> None:
    for path in (repo, authored, output):
        ensure_no_symlinks(path)
    allowed = repo / "runtime/market-overview"
    if output == allowed or not output.is_relative_to(allowed):
        raise ValueError("output must be a new bundle within runtime/market-overview")
    if not authored.is_relative_to(allowed):
        raise ValueError("authored inputs must be within runtime/market-overview")
    if output.is_relative_to(authored) or authored.is_relative_to(output):
        raise ValueError("authored inputs and output must be disjoint")
    if output.exists():
        raise FileExistsError("refusing to overwrite an existing overview bundle")


def _new_json(path: Path, payload: Any) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _reading_markdown(
    countries: dict[str, CountryMarketOverview], order: tuple[str, ...], locale: str
) -> str:
    title = (
        "# Navigator 新能源市场概述"
        if locale == "zh-CN"
        else "# Navigator renewable energy market overviews"
    )
    if locale == "zh-CN" and len(order) == 5:
        title += " · 五国样稿"
    lines = [title, ""]
    for code in order:
        item, text = countries[code], countries[code].locales[locale]
        label = "信息截至：" if locale == "zh-CN" else "Information as of: "
        lines.extend([f"## {text.title}", "", label + item.as_of.isoformat(), ""])
        for paragraph in text.paragraphs:
            lines.extend([paragraph, ""])
        lines.extend([text.disclaimer, ""])
    return "\n".join(lines)


def assemble(
    repo: Path,
    authored_dir: Path,
    output: Path,
    *,
    package_id: str,
    countries: tuple[str, ...],
    expected_scope_count: int = 59,
) -> dict[str, Any]:
    for path in (repo, authored_dir, output):
        ensure_no_symlinks(path)
    repo, authored_dir, output = repo.resolve(), authored_dir.resolve(), output.resolve()
    _check_directories(repo, authored_dir, output)
    profiles_path = repo / "raw material/global_sources/60_country_profiles.csv"
    fingerprints: dict[str, str] = {}
    profiles_bytes = _read_input(profiles_path, repo, fingerprints)
    profile_rows = list(csv.DictReader(io.StringIO(profiles_bytes.decode("utf-8-sig"))))
    codes = [row.get("iso3", "") for row in profile_rows]
    if (
        not codes
        or len(set(codes)) != len(codes)
        or any(not re.fullmatch(r"[A-Z]{3}", code) for code in codes)
    ):
        raise ValueError("country profiles contain invalid or duplicate ISO3 codes")
    scope = frozenset(code for code in codes if code != "CHN")
    if len(scope) != expected_scope_count:
        raise ValueError("outbound scope count differs from the declared scope")
    if not countries or len(countries) != len(set(countries)) or not set(countries).issubset(scope):
        raise ValueError("country selection contains missing, duplicate or unsupported targets")
    profiles = {row["iso3"]: row for row in profile_rows}
    manuscripts, research_by_code, qualities = {}, {}, []
    seen: dict[tuple[str, str], str] = {}
    for code in countries:
        path = authored_dir / "countries" / f"{code}.json"
        research_path = authored_dir / "research" / f"{code}.json"
        payload = json.loads(_read_input(path, repo, fingerprints))
        research = json.loads(_read_input(research_path, repo, fingerprints))
        overview = CountryMarketOverview.model_validate(payload)
        if overview.country_code != code:
            raise ValueError("manuscript filename and country disagree")
        problems = validate_public_and_bilingual(payload)
        if problems:
            raise ValueError(f"bilingual numeric discrepancies: {problems}")
        fingerprints.update(validate_research(research, overview, repo))
        for locale, text in overview.locales.items():
            for paragraph in text.paragraphs:
                key = (locale, re.sub(r"\s", "", paragraph).casefold())
                if key in seen:
                    raise ValueError(f"duplicate authored paragraph: {seen[key]} / {code}")
                seen[key] = code
        manuscripts[code], research_by_code[code] = overview, research
        qualities.append(
            {
                "code": code,
                "country_name": profiles[code].get("country_name_zh", code),
                "country_name_en": profiles[code].get("country_name_en", code),
                "content_version": overview.content_version,
                "as_of": overview.as_of.isoformat(),
                "overview_zh_chars": overview_character_count(
                    "".join(overview.locales["zh-CN"].paragraphs)
                ),
                "paragraph_count": len(overview.locales["zh-CN"].paragraphs),
                "fact_count": len(research["facts"]),
                "evidence_count": len(research["evidence"]),
            }
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".overview-assembling-", dir=output.parent
    ) as temporary:
        staging = Path(temporary) / "bundle"
        (staging / "candidate/countries").mkdir(parents=True)
        _new_json(
            staging / "candidate/package.json",
            {
                "schema_version": CANDIDATE_SCHEMA,
                "package_id": package_id,
            },
        )
        for code, item in manuscripts.items():
            _new_json(staging / f"candidate/countries/{code}.json", item.model_dump(mode="json"))
        candidate = load_market_candidate(staging / "candidate", profiles_path)
        metadata = {
            "schema_version": REVIEW_SCHEMA,
            "package_id": package_id,
            "candidate_sha256": candidate.sha256,
            "country_count": len(countries),
            "created_at": date.today().isoformat(),
        }
        rows, labels = market_review_rows(candidate), []
        evidence_rows, gap_rows, claim_rows = [], [], []
        for code, _version, locale, pointer, _original, _edited in rows:
            research = research_by_code[code]
            index = int(pointer.rsplit("/", 1)[1]) if "/paragraphs/" in pointer else None
            mapping = next(
                (
                    item
                    for item in research["paragraph_map"]
                    if index is not None and item["paragraph"] == index + 1
                ),
                None,
            )
            ids = mapping["fact_ids"] if mapping else []
            sources = sorted(
                {
                    source
                    for fact in research["facts"]
                    if fact["id"] in ids
                    for source in fact["source_ids"]
                }
            )
            leaf = (
                f"第{index + 1}自然段"
                if index is not None
                else "标题"
                if pointer.endswith("/title")
                else "适用说明"
            )
            labels.append(
                {
                    "country_code": code,
                    "country_name": profiles[code].get("country_name_zh", code),
                    "country_name_en": profiles[code].get("country_name_en", code),
                    "locale": locale,
                    "json_pointer": pointer,
                    "layer": "overview",
                    "section_label": "新能源市场概述",
                    "leaf_label": leaf,
                    "claim_kind": "country_analysis" if index is not None else "structure",
                    "claim_id": ",".join(ids),
                    "evidence_ids": sources,
                }
            )
        for code, research in research_by_code.items():
            common = {
                "country_code": code,
                "country_name": profiles[code].get("country_name_zh", code),
            }
            evidence_rows.extend(
                {
                    **common,
                    "evidence_id": item["id"],
                    "title": item["title"],
                    "url": item["url"],
                    "locator": item["locator"],
                    "checked_on": item["checked_on"],
                    "verification": "text_checked",
                    "notes": item["verification_scope"],
                    "source_path": item.get("local_path", ""),
                    "sha256": item.get("local_sha256", ""),
                }
                for item in research["evidence"]
            )
            gap_rows.extend(
                {
                    **common,
                    "claim_id": f"{code}-GAP-{index:02}",
                    "topic": "research_gap",
                    "text_zh": gap,
                    "text_en": "",
                    "verification": "unresolved",
                    "checked_on": research["as_of"],
                    "notes": "内部研究事项，不是对客正文。",
                }
                for index, gap in enumerate(research["uncertainties"], 1)
            )
            claim_rows.extend({**common, **fact} for fact in research["facts"])
        changed = [path for path, digest in fingerprints.items() if sha256(repo / path) != digest]
        if changed:
            raise ValueError(f"inputs changed during read-only assembly: {changed}")
        lengths = [item["overview_zh_chars"] for item in qualities]
        full_scope = set(countries) == scope
        quality = {
            "status": "authored_review_bundle_valid"
            if full_scope
            else "authored_sample_bundle_valid",
            "published": False,
            "country_count": len(countries),
            "candidate_sha256": candidate.sha256,
            "content_row_count": len(rows),
            "evidence_count": len(evidence_rows),
            "fact_count": len(claim_rows),
            "bilingual_numeric_discrepancies": [],
            "duplicate_paragraphs": [],
            "input_hash_mismatches": [],
            "input_files_rehashed_before_and_after": len(fingerprints),
            "overview_zh_char_range": [min(lengths), max(lengths)],
            "editorial_note": (
                "机器检查不证明事实、判断或翻译正确；全量正文待集中Excel一次确认，不授权发布。"
                if full_scope
                else "机器检查不证明事实、判断或翻译正确；子集稿不代表全量完成，不授权发布。"
            ),
            "countries": qualities,
        }
        _new_json(
            staging / "review-data.json",
            {
                "metadata": metadata,
                "content_kind": "market-overview",
                "countries": qualities,
                "content_headers": list(EDIT_HEADERS),
                "content_rows": [list(row) for row in rows],
                "row_labels": labels,
                "evidence_rows": evidence_rows,
                "gap_rows": gap_rows,
                "claim_rows": claim_rows,
                "quality": quality,
            },
        )
        _new_json(
            staging / "research-index.json",
            {
                "schema_version": "navigator.market-overview-research-index.v1",
                "assembly_version": VERSION,
                "package_id": package_id,
                "published": False,
                "candidate_sha256": candidate.sha256,
                "input_fingerprints": fingerprints,
                "countries": research_by_code,
            },
        )
        _new_json(staging / "content-quality.json", quality)
        for locale, filename in (("zh-CN", "reading-zh-CN.md"), ("en", "reading-en.md")):
            with (staging / filename).open("x", encoding="utf-8", newline="\n") as handle:
                handle.write(_reading_markdown(manuscripts, countries, locale))
        _check_directories(repo, authored_dir, output)
        changed = [path for path, digest in fingerprints.items() if sha256(repo / path) != digest]
        if changed:
            raise ValueError(f"inputs changed during read-only assembly: {changed}")
        _publish_directory(staging, output)
    return quality


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--authored-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--package-id", required=True)
    parser.add_argument("--countries", nargs="+", required=True)
    parser.add_argument("--expected-scope-count", type=int, default=59)
    args = parser.parse_args()
    result = assemble(
        args.repo,
        args.authored_dir,
        args.output,
        package_id=args.package_id,
        countries=tuple(args.countries),
        expected_scope_count=args.expected_scope_count,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
