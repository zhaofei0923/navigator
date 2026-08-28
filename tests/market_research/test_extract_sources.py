"""Safety and fidelity checks for the isolated policy text research cache."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parents[2] / "scripts" / "market_research" / "extract_sources.py"
SPEC = importlib.util.spec_from_file_location("market_research_extract", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
extract = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extract)


def test_html_keeps_visible_unicode_and_drops_active_content() -> None:
    blocks, _warnings = extract.html_blocks(
        "<h1>投资条例</h1><script>secret()</script><p>第1条 &amp; Article 1</p>".encode()
    )
    assert "投资条例" in blocks[0]["text"]
    assert "Article 1" in blocks[0]["text"]
    assert "secret" not in blocks[0]["text"]


def test_xml_blocks_do_not_resolve_entities() -> None:
    with pytest.raises(ValueError, match="declarations/entities"):
        extract.xml_blocks(b'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><x>&x;</x>')


def test_source_path_rejects_escape_and_china(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="escapes"):
        extract.source_path_for(tmp_path, {"iso3": "USA", "local_filename": "../../other.pdf"})
    with pytest.raises(ValueError, match="country"):
        extract.source_path_for(tmp_path, {"iso3": "CHN", "local_filename": "a.pdf"})


def test_hash_mismatch_refuses_text_extraction(tmp_path: Path) -> None:
    row = {
        "iso3": "USA",
        "policy_id": "USA-POL-001",
        "local_filename": "source.html",
        "sha256": "0" * 64,
    }
    path = extract.source_path_for(tmp_path, row)
    path.parent.mkdir(parents=True)
    path.write_text("<p>Real source text must not leak through a bad hash.</p>", encoding="utf-8")
    result = extract.extract_record(tmp_path, row)
    assert result["registration_hash_match"] is False
    assert result["extraction_status"] == "hash_mismatch"
    assert result["text"] == ""


def test_valid_html_retains_traceability_without_legal_approval(tmp_path: Path) -> None:
    row = {"iso3": "USA", "policy_id": "USA-POL-001", "local_filename": "source.html"}
    path = extract.source_path_for(tmp_path, row)
    path.parent.mkdir(parents=True)
    path.write_text(
        "<p>This is a source article and not a current legal opinion.</p>", encoding="utf-8"
    )
    row["sha256"] = extract.sha256_file(path)
    result = extract.extract_record(tmp_path, row)
    assert result["extraction_status"] == "extracted"
    assert result["registration_hash_match"] is True
    assert result["current_legal_validity_verified"] is False
    assert result["release_authorized"] is False
    assert result["page_blocks"][0]["locator"] == "html:visible_text"


def test_missing_local_file_is_not_fetched(tmp_path: Path) -> None:
    result = extract.extract_record(
        tmp_path,
        {"iso3": "USA", "policy_id": "USA-POL-001", "official_url": "https://example.org"},
    )
    assert result["extraction_status"] == "no_local_file"
    assert result["actual_sha256"] is None
