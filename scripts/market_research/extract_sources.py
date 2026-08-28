"""Extract read-only policy originals into an ignored, evidence-linked research cache.

Extraction is not a policy-effectiveness, licensing, or publication decision. This
script never fetches a URL and never writes inside ``raw material`` or ``data``.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

EXTRACTOR_VERSION = "market-research-text-v1"
MIN_TEXT_CHARACTERS = 24


class PolicyHTMLText(HTMLParser):
    """Retain visible document text without executing or following page content."""

    hidden = frozenset({"script", "style", "noscript", "template", "svg", "canvas"})
    blocks = frozenset(
        {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section"}
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.hidden:
            self.hidden_depth += 1
        elif not self.hidden_depth and tag in self.blocks:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.hidden:
            self.hidden_depth = max(0, self.hidden_depth - 1)
        elif not self.hidden_depth and tag in self.blocks:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden_depth:
            self.parts.append(data)

    def text(self) -> str:
        return normalize_text("".join(self.parts))


def normalize_text(value: str) -> str:
    value = value.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"[^\S\n]+", " ", value)
    value = re.sub(r"\n[ \t]+", "\n", value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decode_document(payload: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            if encoding == "utf-16" and not payload.startswith((b"\xff\xfe", b"\xfe\xff")):
                continue
            return payload.decode(encoding), encoding
        except UnicodeError:
            continue
    declared = re.search(rb"charset\s*=\s*[\"']?\s*([\w-]+)", payload[:8192], re.I)
    if declared:
        try:
            encoding = declared.group(1).decode("ascii")
            return payload.decode(encoding), encoding
        except (LookupError, UnicodeError):
            pass
    try:
        from charset_normalizer import from_bytes

        match = from_bytes(payload).best()
        if match is not None:
            return str(match), f"detected:{match.encoding}"
    except ImportError:
        pass
    return payload.decode("utf-8", errors="replace"), "utf-8-with-replacement"


def html_blocks(payload: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    content, encoding = decode_document(payload)
    parser = PolicyHTMLText()
    parser.feed(content)
    parser.close()
    text = parser.text()
    warnings = [f"encoding:{encoding}"]
    if "\ufffd" in text:
        warnings.append("replacement_characters_present")
    return [{"page": None, "locator": "html:visible_text", "text": text}], warnings


def xml_blocks(payload: bytes, locator: str = "xml:document") -> list[dict[str, Any]]:
    # Reject declarations rather than resolving external entities or exponential entities.
    if re.search(rb"<!\s*(?:DOCTYPE|ENTITY)\b", payload, re.I):
        raise ValueError("XML declarations/entities require a separately reviewed parser")
    root = ET.fromstring(payload)
    text = normalize_text("\n".join(part for part in root.itertext() if part.strip()))
    return [{"page": None, "locator": locator, "text": text}]


def pdf_blocks(path: Path, timeout: int) -> tuple[list[dict[str, Any]], str, list[str]]:
    executable = shutil.which("pdftotext")
    if executable:
        process = subprocess.run(
            [executable, "-layout", "-enc", "UTF-8", str(path), "-"],
            capture_output=True,
            check=False,
            timeout=timeout,
        )
        if process.returncode == 0:
            pages = process.stdout.decode("utf-8", errors="replace").split("\f")
            if pages and not pages[-1].strip():
                pages.pop()
            warnings = []
            if process.stderr.strip():
                warnings.append(process.stderr.decode("utf-8", errors="replace")[:1200])
            return (
                [
                    {"page": number, "locator": f"pdf:page:{number}", "text": normalize_text(page)}
                    for number, page in enumerate(pages, 1)
                ],
                "poppler-pdftotext-layout",
                warnings,
            )
        failure = process.stderr.decode("utf-8", errors="replace")[:1200]
    else:
        failure = "pdftotext not available"
    from pypdf import PdfReader

    reader = PdfReader(path, strict=False)
    if reader.is_encrypted and not reader.decrypt(""):
        raise ValueError("PDF encrypted; no access-control bypass attempted")
    blocks = []
    warnings = [f"Poppler fallback: {failure}"]
    for number, page in enumerate(reader.pages, 1):
        try:
            text = normalize_text(page.extract_text() or "")
        except Exception as error:  # Preserve the rest of a partly readable document.
            text = ""
            warnings.append(f"Page {number}: {type(error).__name__}: {error}")
        blocks.append({"page": number, "locator": f"pdf:page:{number}", "text": text})
    return blocks, "pypdf", warnings


def source_path_for(repo: Path, row: dict[str, str]) -> Path:
    iso3 = row["iso3"]
    if not re.fullmatch(r"[A-Z]{3}", iso3) or iso3 == "CHN":
        raise ValueError("Unsupported country scope")
    base = (repo / "raw material" / "countries" / iso3 / "02_policy_documents" / "files").resolve()
    path = (base / row["local_filename"]).resolve()
    if not path.is_relative_to(base) or path == base:
        raise ValueError("Source path escapes country policy directory")
    return path


def extract_record(repo: Path, row: dict[str, str], timeout: int = 120) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schema_version": 1,
        "extractor_version": EXTRACTOR_VERSION,
        "policy_id": row["policy_id"],
        "iso3": row["iso3"],
        "title": row.get("title_zh") or row.get("title_en") or row.get("title_original"),
        "title_original": row.get("title_original", ""),
        "title_en": row.get("title_en", ""),
        "official_url": row.get("official_url", ""),
        "download_url": row.get("download_url", ""),
        "source_path": None,
        "registration_sha256": row.get("sha256", ""),
        "actual_sha256": None,
        "registration_hash_match": None,
        "registered_download_status": row.get("download_status", ""),
        "registered_policy_status": row.get("status", ""),
        "publication_date": row.get("publication_date", ""),
        "effective_date": row.get("effective_date", ""),
        "registered_notes": row.get("notes", ""),
        "generated_at": datetime.now(UTC).isoformat(),
        "current_legal_validity_verified": False,
        "release_authorized": False,
        "extraction_status": "no_local_file",
        "extractor": None,
        "warnings": [],
        "page_blocks": [],
        "text": "",
    }
    if not row.get("local_filename"):
        result["reason"] = "Registry retains URL only; no file fetched by this extractor"
        return result
    try:
        path = source_path_for(repo, row)
        result["source_path"] = path.relative_to(repo.resolve()).as_posix()
        if not path.is_file():
            result.update(extraction_status="missing_file", reason="Registered file is absent")
            return result
        actual_hash = sha256_file(path)
        result["actual_sha256"] = actual_hash
        result["registration_hash_match"] = actual_hash == row.get("sha256", "").lower()
        result["file_size_bytes"] = path.stat().st_size
        if not result["registration_hash_match"]:
            result.update(extraction_status="hash_mismatch", reason="Text extraction refused")
            return result
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            blocks, extractor, warnings = pdf_blocks(path, timeout)
            result.update(page_blocks=blocks, extractor=extractor, warnings=warnings)
        elif suffix in {".html", ".htm"}:
            blocks, warnings = html_blocks(path.read_bytes())
            result.update(page_blocks=blocks, extractor="stdlib-htmlparser", warnings=warnings)
        elif suffix == ".xml":
            result.update(page_blocks=xml_blocks(path.read_bytes()), extractor="stdlib-elementtree")
        elif suffix == ".hwpx":
            blocks = []
            with zipfile.ZipFile(path) as archive:
                for name in sorted(archive.namelist()):
                    if re.fullmatch(r"Contents/section\d+\.xml", name):
                        info = archive.getinfo(name)
                        if info.file_size > 50 * 1024 * 1024:
                            raise ValueError("HWPX XML section exceeds safe extraction limit")
                        blocks.extend(xml_blocks(archive.read(name), f"hwpx:{name}"))
            result.update(page_blocks=blocks, extractor="hwpx-zipped-xml")
        else:
            result.update(
                extraction_status="unsupported_format",
                reason=f"No reviewed extractor for {suffix}; original retained unchanged",
            )
            return result
        result["text"] = "\n\n".join(block["text"] for block in result["page_blocks"])
        result["page_count"] = len(result["page_blocks"]) if suffix == ".pdf" else None
        result["character_count"] = len(result["text"])
        empty = [block["locator"] for block in result["page_blocks"] if not block["text"].strip()]
        result["empty_blocks"] = empty
        if len(result["text"].strip()) < MIN_TEXT_CHARACTERS:
            result["extraction_status"] = "no_text"
            result["reason"] = "No usable text; scanned/image-only source or unreadable text layer"
        else:
            result["extraction_status"] = "partial" if empty else "extracted"
            if empty:
                result["warnings"].append("Empty pages/blocks retained; no OCR was invented")
    except Exception as error:
        result.update(extraction_status="unreadable", reason=f"{type(error).__name__}: {error}")
    return result


def atomic_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".extract-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def store_record(output: Path, record: dict[str, Any]) -> str:
    policy_id = record["policy_id"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", policy_id):
        raise ValueError("Unsafe policy identifier")
    base = output / record["iso3"] / policy_id
    atomic_text(base.with_suffix(".json"), json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    blocks = [f"[{block['locator']}]\n{block['text']}" for block in record["page_blocks"]]
    atomic_text(base.with_suffix(".txt"), "\n\n".join(blocks) + "\n")
    return base.with_suffix(".json").relative_to(output).as_posix()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 9))
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--country", action="append", default=[])
    args = parser.parse_args()
    repo = args.repo.resolve()
    output = repo / "runtime" / "market-research" / "extracted"
    if not output.resolve().is_relative_to((repo / "runtime" / "market-research").resolve()):
        raise ValueError("Extraction output escaped the research scratch directory")
    registry = repo / "raw material" / "global_sources" / "60_country_policy_register.csv"
    with registry.open(encoding="utf-8-sig", newline="") as stream:
        rows = [
            row
            for row in csv.DictReader(stream)
            if row["iso3"] != "CHN" and (not args.country or row["iso3"] in args.country)
        ]
    summaries = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(extract_record, repo, row, args.timeout): row for row in rows}
        for number, future in enumerate(as_completed(futures), 1):
            record = future.result()
            filename = store_record(output, record)
            summaries.append(
                {
                    key: record.get(key)
                    for key in (
                        "policy_id",
                        "iso3",
                        "title",
                        "source_path",
                        "actual_sha256",
                        "registration_hash_match",
                        "extraction_status",
                        "page_count",
                        "character_count",
                        "reason",
                    )
                }
                | {"extracted_json": filename}
            )
            if number % 25 == 0 or number == len(rows):
                print(f"Extracted {number}/{len(rows)} registry records", flush=True)
    summaries.sort(key=lambda item: (item["iso3"], item["policy_id"]))
    manifest = {
        "schema_version": 1,
        "extractor_version": EXTRACTOR_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "registry_path": registry.relative_to(repo).as_posix(),
        "registry_sha256": sha256_file(registry),
        "country_count": len({row["iso3"] for row in rows}),
        "policy_count": len(rows),
        "local_source_count": sum(bool(row.get("local_filename")) for row in rows),
        "status_counts": dict(Counter(item["extraction_status"] for item in summaries)),
        "current_legal_validity_verified": False,
        "release_authorized": False,
        "records": summaries,
    }
    atomic_text(output / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in manifest.items() if key != "records"}))
    return int(
        any(item["extraction_status"] in {"hash_mismatch", "missing_file"} for item in summaries)
    )


if __name__ == "__main__":
    raise SystemExit(main())
