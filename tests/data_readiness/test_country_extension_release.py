"""Offline, synthetic confirmations exercise release binding without real publication."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any

import openpyxl
import pytest
from navigator_api.basic60_seed_contract import Basic60SeedArtifact
from navigator_api.basic61_seed_contract import Basic61SeedArtifact
from navigator_api.market_storage import canonical_bytes, content_sha256
from navigator_data_readiness import country_extension as candidate_module
from navigator_data_readiness import country_extension_release as release
from navigator_data_readiness.market_content import (
    EDIT_HEADERS,
    REVIEW_SCHEMA,
    _validated_candidate,
    market_review_rows,
)

_SPEC = importlib.util.spec_from_file_location(
    "country_extension_candidate_fixtures", Path(__file__).with_name("test_country_extension.py")
)
assert _SPEC is not None and _SPEC.loader is not None
_FIXTURES = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_FIXTURES)


def _json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.chmod(0o600)
    path.write_bytes(canonical_bytes(payload))


def synthetic_confirmed_inputs(tmp_path: Path) -> dict[str, Any]:
    """Reusable synthetic full-chain fixture; no repository data, hashes or secrets."""
    parent = _FIXTURES.parent_payload.__wrapped__()
    inputs = _FIXTURES.inputs.__wrapped__(tmp_path, copy.deepcopy(parent))
    inputs["overview_path"] = _FIXTURES._overview(inputs)
    root: Path = inputs["repo_root"]
    candidate_dir = root / "runtime/country-extensions/zmb-synthetic-r1"
    candidate_module.prepare_country_extension(output_dir=candidate_dir, **inputs)
    candidate = json.loads((candidate_dir / "candidate.json").read_bytes())
    review = candidate_module.extension_review_data(candidate)
    market = _validated_candidate(
        "OVERVIEW-ZMB-20260828-R1", [candidate["overview"]], frozenset({"ZMB"})
    )
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)
    sheets = {
        "新增国包信息": [["key", "value"], *[list(item) for item in review["metadata"].items()]],
        "新增国内容": [list(candidate_module.REVIEW_HEADERS), *review["rows"]],
        "基础数据依据": [
            list(candidate_module.SOURCE_HEADERS),
            *[
                [
                    candidate_module.source_review_cell(item, key)
                    for key in candidate_module.SOURCE_HEADERS
                ]
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
        "内容编辑": [list(EDIT_HEADERS), *[list(row) for row in market_review_rows(market)]],
    }
    for name, rows in sheets.items():
        sheet = workbook.create_sheet(name)
        for row in rows:
            sheet.append(row)
    workbook_path = root / "outputs/zmb-synthetic/review.xlsx"
    workbook_path.parent.mkdir(parents=True)
    workbook.save(workbook_path)
    workbook.close()
    confirmation_path = root / "runtime/country-extensions/confirmations/synthetic.json"
    _json(
        confirmation_path,
        {
            "schema_version": release.CONFIRMATION_SCHEMA,
            "extension_id": candidate["extension_id"],
            "candidate_sha256": content_sha256(candidate),
            "parent_seed_sha256": candidate["parent"]["seed_sha256"],
            "workbook_sha256": hashlib.sha256(workbook_path.read_bytes()).hexdigest(),
            "market_overview_candidate_sha256": market.sha256,
            "decision": "approved",
            "approved_by": "kevin",
            "approved_at": "2026-08-28",
            "approval_statement": "审核通过",
        },
    )
    return {
        "repo_root": root,
        "candidate_dir": candidate_dir,
        "workbook_path": workbook_path,
        "confirmation_path": confirmation_path,
        "output_dir": root / "runtime/basic61/zmb-synthetic-r1",
        "trust_key": hashlib.sha256(b"offline fixture, not a runtime secret").hexdigest(),
    }


@pytest.fixture
def confirmed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    monkeypatch.setattr(release, "_now", lambda: "2026-08-29T12:00:00+08:00")
    return synthetic_confirmed_inputs(tmp_path)


def _read(inputs: dict[str, Any], name: str) -> dict[str, Any]:
    return json.loads((inputs["output_dir"] / name).read_bytes())  # type: ignore[no-any-return]


def _validate(inputs: dict[str, Any]) -> dict[str, Any]:
    return release.validate_country_extension_release(
        repo_root=inputs["repo_root"],
        release_dir=inputs["output_dir"],
        trust_key=inputs["trust_key"],
    )


def test_ready_release_preserves_parent_objects_and_replays(confirmed: dict[str, Any]) -> None:
    original = {
        path.relative_to(confirmed["repo_root"]): path.read_bytes()
        for path in confirmed["repo_root"].rglob("*")
        if path.is_file()
    }
    report = release.prepare_country_extension_release(**confirmed)
    assert report == _validate(confirmed)
    assert report["status"] == "private_trial_ready" and report["activated"] is False
    assert report["formal_gate_status"] == "pending" and report["checks"] == []
    assert report["machine_counts"] == {
        "country_count": 61,
        "macro_annual_record_count": 305,
        "energy_latest_record_count": 61,
        "available_observation_count": 2317,
        "pending_observation_count": 62,
    }
    seed = _read(confirmed, release.READY_SEED_NAME)
    Basic61SeedArtifact.model_validate(seed)
    with pytest.raises(ValueError):
        Basic60SeedArtifact.model_validate(seed)
    parent = json.loads(original[Path("runtime/basic60/basic60_seed.private_trial_ready.json")])
    assert seed["countries"][:60] == parent["countries"]
    assert seed["sources"][:3] == parent["sources"]
    assert seed["raw_records"][: len(parent["raw_records"])] == parent["raw_records"]
    assert seed["metric_definitions"] == parent["metric_definitions"]
    assert len(seed["sources"]) == 6
    assert seed["extension"]["parent_country_sha256"] == {
        country["iso3"]: content_sha256(country) for country in parent["countries"]
    }
    for path, value in original.items():
        assert (confirmed["repo_root"] / path).read_bytes() == value
    assert not (confirmed["repo_root"] / "runtime/market-content").exists()
    assert not list(confirmed["output_dir"].rglob("current*"))


def test_raw_source_collections_have_actual_hashes_and_full_mapping(
    confirmed: dict[str, Any],
) -> None:
    release.prepare_country_extension_release(**confirmed)
    seed = _read(confirmed, release.READY_SEED_NAME)
    for source, raw in zip(seed["sources"][-3:], seed["raw_records"][-3:], strict=True):
        collection_path = confirmed["repo_root"] / raw["object_key"]
        digest = hashlib.sha256(collection_path.read_bytes()).hexdigest()
        assert source["evidence_sha256"] == source["snapshots"][0]["content_sha256"] == digest
        assert raw["payload_sha256"] == digest
        collection = json.loads(collection_path.read_bytes())
        assert collection["data_domain"] == source["data_domain"]
        assert collection["sources"][0]["captured_at"] == "2026-08-28T10:00:00.123456+08:00"
        assert all(metric["source_ids"] for metric in collection["metrics"])
        for evidence in collection["sources"]:
            assert (
                hashlib.sha256(
                    (confirmed["repo_root"] / evidence["local_path"]).read_bytes()
                ).hexdigest()
                == evidence["sha256"]
            )


def test_missing_negative_extreme_values_and_date_precision(confirmed: dict[str, Any]) -> None:
    release.prepare_country_extension_release(**confirmed)
    seed = _read(confirmed, release.READY_SEED_NAME)
    zmb = seed["countries"][-1]
    assert zmb["last_reviewed_at"] is None
    assert all(metric["reviewed_at"] is None for metric in zmb["metrics"])
    assert {"-2.5", "-100", "125"}.issubset(
        {metric["normalized_value"] for metric in zmb["metrics"]}
    )
    missing = [metric for metric in zmb["metrics"] if metric["value_status"] == "pending"]
    assert len(missing) == 1 and missing[0]["metric_code"] == "electricity_demand_gwh"
    assert missing[0]["original_value"] is None and missing[0]["normalized_value"] is None
    assert missing[0]["period_label"] == "pending"
    assert missing[0]["null_reason"]
    authorization = _read(confirmed, release.AUTHORIZATION_NAME)
    assert authorization["approved_at"] == "2026-08-28"
    assert "signed_at" not in canonical_bytes(authorization).decode()


def test_manual_scope_projection_inherits_permissions_without_enabling_runtime(
    confirmed: dict[str, Any],
) -> None:
    release.prepare_country_extension_release(**confirmed)
    seed = _read(confirmed, release.READY_SEED_NAME)
    policy = _read(confirmed, release.POLICY_NAME)
    normalized = _read(confirmed, release.NORMALIZED_NAME)
    assert normalized["countries"] == seed["countries"]
    assert seed["ai_usage_policy"]["seed_sha256"] == content_sha256(normalized)
    assert seed["ai_usage_policy"]["policy_reference"]["sha256"] == content_sha256(policy)
    fields = release._normalized_data_field_paths(normalized)
    assert policy["field_scope"]["fields"] == fields
    assert policy["field_scope"]["field_count"] == len(fields)
    assert policy["field_scope"]["fields_sha256"] == content_sha256(fields)
    assert not any(seed["manual_usage_authorization"]["v1_runtime_capabilities"].values())
    assert seed["manual_usage_authorization"]["field_scope"] == {
        key: value for key, value in policy["field_scope"].items() if key != "fields"
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("decision", "pending"),
        ("approved_by", "codex"),
        ("candidate_sha256", "0" * 64),
        ("parent_seed_sha256", "1" * 64),
        ("workbook_sha256", "2" * 64),
        ("market_overview_candidate_sha256", "3" * 64),
        ("extension_id", "COUNTRY-EXT-NAM-20260828-R1"),
        ("approval_statement", "candidate_valid"),
        ("approved_at", "2026-08-27"),
        ("approved_at", "2030-01-01"),
        ("approved_at", "2026-08-28T12:00:00"),
        ("approved_at", "not-a-date"),
        ("approved_at", 20260828),
        ("extra", True),
    ],
)
def test_wrong_confirmation_cannot_create_ready_output(
    confirmed: dict[str, Any], field: str, value: object
) -> None:
    confirmation = json.loads(confirmed["confirmation_path"].read_bytes())
    confirmation[field] = value
    _json(confirmed["confirmation_path"], confirmation)
    with pytest.raises(ValueError):
        release.prepare_country_extension_release(**confirmed)
    assert not confirmed["output_dir"].exists()


def test_actual_timestamp_is_retained_when_supplied(confirmed: dict[str, Any]) -> None:
    confirmation = json.loads(confirmed["confirmation_path"].read_bytes())
    confirmation["approved_at"] = "2026-08-28T00:12:34.567890+08:00"
    _json(confirmed["confirmation_path"], confirmation)
    release.prepare_country_extension_release(**confirmed)
    assert (
        _read(confirmed, release.AUTHORIZATION_NAME)["approved_at"] == confirmation["approved_at"]
    )
    assert (
        _read(confirmed, release.READY_SEED_NAME)["countries"][-1]["last_reviewed_at"]
        == confirmation["approved_at"]
    )


@pytest.mark.parametrize(
    "name",
    [
        release.READY_SEED_NAME,
        release.VALIDATION_NAME,
        release.BUNDLE_NAME,
        release.POLICY_NAME,
        release.NORMALIZED_NAME,
        release.AUTHORIZATION_NAME,
        release.ATTESTATION_NAME,
        "source_collections/energy.json",
    ],
)
def test_any_ready_artifact_drift_is_rejected(confirmed: dict[str, Any], name: str) -> None:
    release.prepare_country_extension_release(**confirmed)
    payload = _read(confirmed, name)
    payload["unreviewed_change"] = True
    _json(confirmed["output_dir"] / name, payload)
    with pytest.raises(ValueError):
        _validate(confirmed)


@pytest.mark.parametrize("input_name", ["confirmation_path", "workbook_path"])
def test_input_drift_invalidates_ready_release(confirmed: dict[str, Any], input_name: str) -> None:
    release.prepare_country_extension_release(**confirmed)
    path = confirmed[input_name]
    path.write_bytes(path.read_bytes() + b" ")
    with pytest.raises(ValueError, match="frozen extension input changed"):
        _validate(confirmed)


def test_wrong_runtime_key_fails_replay(confirmed: dict[str, Any]) -> None:
    release.prepare_country_extension_release(**confirmed)
    with pytest.raises(ValueError, match="runtime_attestation"):
        _validate({**confirmed, "trust_key": hashlib.sha256(b"different offline key").hexdigest()})
    for key in ("", "short", "replace-with-a-random-long-example-placeholder"):
        with pytest.raises(ValueError):
            release.prepare_country_extension_release(
                **{
                    **confirmed,
                    "output_dir": confirmed["output_dir"].with_name("r2"),
                    "trust_key": key,
                }
            )


def test_no_overwrite_unknown_files_and_symlinks(confirmed: dict[str, Any]) -> None:
    release.prepare_country_extension_release(**confirmed)
    with pytest.raises(ValueError, match="already exists"):
        release.prepare_country_extension_release(**confirmed)
    unknown = confirmed["output_dir"] / "unknown.json"
    _json(unknown, {})
    with pytest.raises(ValueError, match="exactly"):
        _validate(confirmed)
    unknown.unlink()
    link = confirmed["output_dir"] / "symlink.json"
    link.symlink_to(confirmed["confirmation_path"])
    with pytest.raises(ValueError, match="symbolic links"):
        _validate(confirmed)


@pytest.mark.parametrize(
    "target",
    ["runtime/basic61", "runtime/basic60/new", "raw material/new", "data/new", "outside/new"],
)
def test_output_scope_cannot_touch_original_or_authoritative_data(
    confirmed: dict[str, Any], target: str
) -> None:
    with pytest.raises(ValueError, match="child of runtime/basic61"):
        release.prepare_country_extension_release(
            **{**confirmed, "output_dir": confirmed["repo_root"] / target}
        )


def test_failed_atomic_publication_leaves_no_ready_directory(
    confirmed: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(_staging: Path, _target: Path) -> None:
        raise OSError("synthetic atomic publication failure")

    monkeypatch.setattr(release, "_publish_directory", fail)
    with pytest.raises(OSError, match="synthetic atomic"):
        release.prepare_country_extension_release(**confirmed)
    assert not confirmed["output_dir"].exists()
    assert not list(confirmed["output_dir"].parent.glob(".country-extension-release-*"))


def test_cli_helpers_do_not_disclose_key_or_activate(
    confirmed: dict[str, Any], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    parser = argparse.ArgumentParser()
    release.add_country_extension_release_commands(
        parser.add_subparsers(dest="command", required=True)
    )
    args = parser.parse_args(
        [
            "prepare-country-extension-release",
            "--candidate-dir",
            str(confirmed["candidate_dir"]),
            "--workbook",
            str(confirmed["workbook_path"]),
            "--confirmation",
            str(confirmed["confirmation_path"]),
            "--output-dir",
            str(confirmed["output_dir"]),
        ]
    )
    monkeypatch.delenv(release.RUNTIME_ATTESTATION_KEY_ENV, raising=False)
    assert release.run_country_extension_release_command(args, confirmed["repo_root"]) == 1
    assert json.loads(capsys.readouterr().out)["status"] == "not_ready"
    monkeypatch.setenv(release.RUNTIME_ATTESTATION_KEY_ENV, confirmed["trust_key"])
    assert release.run_country_extension_release_command(args, confirmed["repo_root"]) == 0
    result = capsys.readouterr().out
    assert confirmed["trust_key"] not in result
    assert json.loads(result)["activated"] is False
    args = parser.parse_args(
        ["validate-country-extension-release", "--release-dir", str(confirmed["output_dir"])]
    )
    assert release.run_country_extension_release_command(args, confirmed["repo_root"]) == 0
    assert json.loads(capsys.readouterr().out)["ready"] is True
