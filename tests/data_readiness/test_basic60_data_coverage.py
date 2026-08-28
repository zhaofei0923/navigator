"""Focused branch coverage for Basic60 data-readiness validators."""

from __future__ import annotations

import copy
import json
from dataclasses import replace
from decimal import Decimal
from pathlib import Path, PurePosixPath
from typing import Any

import navigator_data_readiness.basic60_private as private
import pytest
from navigator_data_readiness.baseline import sha256_file
from navigator_data_readiness.models import CheckResult
from navigator_data_readiness.paths import RepositoryPaths, discover_repository
from test_basic60_private import (
    METRIC_FIELDS,
    PROFILE_FIELDS,
    _write_csv,
    _write_raw_fixture,
)


@pytest.fixture
def repository_paths(tmp_path: Path) -> RepositoryPaths:
    root = tmp_path / "repository"
    root.mkdir()
    return replace(discover_repository(), root=root)


def _codes(checks: list[CheckResult]) -> set[str]:
    return {item.code for item in checks}


def test_low_level_parsers_and_path_display_cover_invalid_values(
    repository_paths: RepositoryPaths,
    tmp_path: Path,
) -> None:
    relative = Path("data/example.json")
    assert (
        private._resolve(repository_paths, relative) == (repository_paths.root / relative).resolve()
    )
    assert private._resolve(repository_paths, tmp_path) == tmp_path.resolve()
    assert (
        private._display_path(repository_paths, repository_paths.root / relative)
        == relative.as_posix()
    )
    assert private._display_path(repository_paths, tmp_path / "outside") == str(
        (tmp_path / "outside").resolve()
    )

    non_object = tmp_path / "non-object.json"
    non_object.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="JSON root must be an object"):
        private._json_object(non_object)

    headerless = tmp_path / "headerless.csv"
    headerless.write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="CSV header is missing"):
        private._csv_rows(headerless)

    assert private._number_is_valid("1.25") is True
    assert private._number_is_valid("not-a-number") is False
    assert private._json_list("not-json") == []
    assert private._json_list('{"not": "a-list"}') == []
    assert private._json_list('[" one ", "", 2]') == ["one", "2"]


def test_raw_inspection_reports_missing_parse_and_content_failures(tmp_path: Path) -> None:
    summary, checks = private.inspect_basic60_raw(tmp_path / "missing")
    assert summary["country_count"] == 0
    assert _codes(checks) == {"B60_RAW_DIRECTORY_MISSING"}

    empty = tmp_path / "empty"
    empty.mkdir()
    _summary, checks = private.inspect_basic60_raw(empty)
    assert _codes(checks) == {"B60_RAW_REQUIRED_FILE_MISSING"}

    invalid_json = tmp_path / "invalid-json"
    _write_raw_fixture(invalid_json)
    (invalid_json / private.COLLECTION_MANIFEST).write_text("[]", encoding="utf-8")
    _summary, checks = private.inspect_basic60_raw(invalid_json)
    assert _codes(checks) == {"B60_RAW_PARSE_FAILED"}

    missing_header = tmp_path / "missing-header"
    _write_raw_fixture(missing_header)
    (missing_header / private.PROFILE_CSV).write_text("", encoding="utf-8")
    _summary, checks = private.inspect_basic60_raw(missing_header)
    assert _codes(checks) == {"B60_RAW_PARSE_FAILED"}

    invalid_content = tmp_path / "invalid-content"
    _write_raw_fixture(invalid_content)
    profiles = private._csv_rows(invalid_content / private.PROFILE_CSV)
    profiles.pop()
    profiles[0]["country_name_zh"] = ""
    profiles[0]["review_status"] = "approved"
    profiles[0]["population"] = "nan"
    _write_csv(invalid_content / private.PROFILE_CSV, PROFILE_FIELDS, profiles)

    metrics = private._csv_rows(invalid_content / private.METRIC_CSV)
    first_macro = next(item for item in metrics if item["record_type"] == "macro_annual")
    first_macro["record_type"] = "unsupported"
    second_macro = next(item for item in metrics if item["record_type"] == "macro_annual")
    second_macro["year"] = "invalid-year"
    second_macro["macro_source_url"] = ""
    second_macro["review_status"] = "approved"
    second_macro["gdp_current_usd"] = "nan"
    first_energy = next(item for item in metrics if item["record_type"] == "energy_latest")
    first_energy["record_type"] = "unsupported"
    second_energy = next(item for item in metrics if item["record_type"] == "energy_latest")
    second_energy["energy_source_url"] = ""
    second_energy["electricity_installed_capacity_mw"] = "nan"
    second_energy["electricity_installed_capacity_year"] = ""
    second_energy["electricity_demand_gwh"] = "1"
    second_energy["electricity_demand_year"] = "2024"
    _write_csv(invalid_content / private.METRIC_CSV, METRIC_FIELDS, metrics)

    manifest_path = invalid_content / private.COLLECTION_MANIFEST
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update(
        {
            "country_count": 0,
            "macro_annual_record_count": 0,
            "energy_latest_record_count": 0,
        }
    )
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    _summary, checks = private.inspect_basic60_raw(invalid_content)
    expected_codes = {
        "B60_PROFILE_COUNT_MISMATCH",
        "B60_PROFILE_ISO_INVALID",
        "B60_MACRO_COUNT_MISMATCH",
        "B60_ENERGY_COUNT_MISMATCH",
        "B60_RECORD_TYPE_INVALID",
        "B60_COUNTRY_SET_MISMATCH",
        "B60_PROFILE_FIELD_MISSING",
        "B60_RAW_REVIEW_STATUS_INVALID",
        "B60_NUMERIC_VALUE_INVALID",
        "B60_SOURCE_REF_MISSING",
        "B60_MACRO_YEARS_MISMATCH",
        "B60_ENERGY_VALUE_INVALID",
        "B60_DEMAND_MUST_REMAIN_PENDING",
        "B60_DEMAND_PENDING_COVERAGE_MISMATCH",
        "B60_AVAILABLE_COUNT_MISMATCH",
        "B60_SOURCE_MANIFEST_COUNT_MISMATCH",
    }
    actual_codes = _codes(checks)
    assert expected_codes.issubset(actual_codes), expected_codes - actual_codes


def test_raw_manifest_rejects_missing_and_detects_symlinks(
    repository_paths: RepositoryPaths,
    tmp_path: Path,
) -> None:
    with pytest.raises(ValueError, match="raw-material directory does not exist"):
        private.build_raw_manifest(repository_paths, tmp_path / "missing")

    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    target = raw_dir / "target.txt"
    target.write_text("payload", encoding="utf-8")
    (raw_dir / "download.pdf:Zone.Identifier").write_text("metadata", encoding="utf-8")
    (raw_dir / "nested").mkdir()
    (raw_dir / "link.txt").symlink_to(target)
    manifest = private.build_raw_manifest(repository_paths, raw_dir)
    assert manifest["unsafe_entries"] == ["link.txt"]
    assert manifest["excluded_zone_identifier_paths"] == ["download.pdf:Zone.Identifier"]


def test_file_reference_validation_covers_every_fail_closed_exit(
    repository_paths: RepositoryPaths,
    tmp_path: Path,
) -> None:
    prefix = PurePosixPath("data/basic60/evidence")

    def validate(reference: Any) -> tuple[Path | None, list[CheckResult]]:
        checks: list[CheckResult] = []
        resolved = private._validate_file_reference(
            checks,
            repository_paths,
            reference,
            code="B60_TEST_REFERENCE_INVALID",
            location="probe",
            prefix=prefix,
        )
        return resolved, checks

    for reference in (None, {"path": "bad\\path", "sha256": "a" * 64}):
        resolved, checks = validate(reference)
        assert resolved is None
        assert _codes(checks) == {"B60_TEST_REFERENCE_INVALID"}

    for relative in ("../escape.json", "data/basic60/evidence/missing.json"):
        resolved, checks = validate({"path": relative, "sha256": "a" * 64})
        assert resolved is None
        assert _codes(checks) == {"B60_TEST_REFERENCE_INVALID"}

    evidence_root = repository_paths.root / prefix
    evidence_root.mkdir(parents=True)
    directory = evidence_root / "directory.json"
    directory.mkdir()
    resolved, checks = validate(
        {"path": directory.relative_to(repository_paths.root).as_posix(), "sha256": "a" * 64}
    )
    assert resolved is None
    assert _codes(checks) == {"B60_TEST_REFERENCE_INVALID"}

    outside = tmp_path / "outside.json"
    outside.write_text("outside", encoding="utf-8")
    link = evidence_root / "link.json"
    link.symlink_to(outside)
    resolved, checks = validate(
        {"path": link.relative_to(repository_paths.root).as_posix(), "sha256": sha256_file(outside)}
    )
    assert resolved is None
    assert _codes(checks) == {"B60_TEST_REFERENCE_INVALID"}

    valid = evidence_root / "valid.json"
    valid.write_text('{"ok": true}', encoding="utf-8")
    relative = valid.relative_to(repository_paths.root).as_posix()
    for digest in ("invalid", "a" * 64):
        resolved, checks = validate({"path": relative, "sha256": digest})
        assert resolved is None
        assert _codes(checks) == {"B60_TEST_REFERENCE_INVALID"}
    resolved, checks = validate({"path": relative, "sha256": sha256_file(valid)})
    assert resolved == valid.resolve()
    assert checks == []


def test_approval_validation_rejects_missing_invalid_json_and_mismatch(
    repository_paths: RepositoryPaths,
) -> None:
    role = "数据负责人"
    subject = "a" * 64

    def validate(approval: Any) -> tuple[str | None, list[CheckResult]]:
        checks: list[CheckResult] = []
        person = private._validate_approval(
            checks,
            repository_paths,
            approval,
            expected_role=role,
            subject_sha256=subject,
            location="approval",
        )
        return person, checks

    person, checks = validate(None)
    assert person is None
    assert _codes(checks) == {"B60_HUMAN_APPROVAL_MISSING"}

    person, checks = validate({"role": "wrong"})
    assert person is None
    assert _codes(checks) == {"B60_HUMAN_APPROVAL_INVALID"}

    evidence_root = repository_paths.root / "data/basic60/evidence"
    evidence_root.mkdir(parents=True)

    def approval_for(path: Path) -> dict[str, Any]:
        return {
            "role": role,
            "person_name": "alice",
            "decision": "approved",
            "signed_at": "2026-08-25T12:00:00+08:00",
            "subject_sha256": subject,
            "evidence": {
                "evidence_id": "EVD-PROBE",
                "path": path.relative_to(repository_paths.root).as_posix(),
                "sha256": sha256_file(path),
            },
        }

    invalid_json = evidence_root / "invalid-root.json"
    invalid_json.write_text("[]", encoding="utf-8")
    person, checks = validate(approval_for(invalid_json))
    assert person is None
    assert _codes(checks) == {"B60_APPROVAL_EVIDENCE_INVALID"}

    mismatch = evidence_root / "mismatch.json"
    mismatch.write_text("{}", encoding="utf-8")
    person, checks = validate(approval_for(mismatch))
    assert person is None
    assert _codes(checks) == {"B60_APPROVAL_EVIDENCE_MISMATCH"}


def test_domain_validation_reports_missing_malformed_and_inactive_sources() -> None:
    checks: list[CheckResult] = []
    private._validate_domains(checks, None)
    private._validate_domains(checks, {})
    private._validate_domains(checks, {"domains": []})
    assert "B60_SOURCE_ADMISSION_INVALID" in _codes(checks)
    assert "B60_SOURCE_DOMAINS_INVALID" in _codes(checks)
    assert sum(item.code == "B60_SOURCE_DOMAIN_NOT_ACTIVE" for item in checks) == 3


def test_l0_and_evidence_path_guards_cover_unsafe_targets(
    repository_paths: RepositoryPaths,
    tmp_path: Path,
) -> None:
    raw_dir = repository_paths.root / "raw"
    raw_dir.mkdir()
    external = tmp_path / "external"
    external.mkdir()

    with pytest.raises(ValueError, match="must be an absolute path"):
        private._validated_l0_directory(repository_paths, raw_dir, Path("relative"))
    with pytest.raises(ValueError, match="broad filesystem root"):
        private._validated_l0_directory(repository_paths, raw_dir, Path("/tmp"))
    with pytest.raises(ValueError, match="outside both"):
        private._validated_l0_directory(repository_paths, raw_dir, repository_paths.root / "l0")

    l0_link = tmp_path / "l0-link"
    l0_link.symlink_to(external, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic links"):
        private._validated_l0_directory(repository_paths, raw_dir, l0_link)

    l0_file = tmp_path / "l0-file"
    l0_file.write_text("not a directory", encoding="utf-8")
    with pytest.raises(ValueError, match="must be a directory"):
        private._validated_l0_directory(repository_paths, raw_dir, l0_file)

    unsafe_object_root = tmp_path / "unsafe-object-root"
    unsafe_object_root.mkdir()
    (unsafe_object_root / "sha256").write_text("not a directory", encoding="utf-8")
    with pytest.raises(ValueError, match="object root is unsafe"):
        private._validated_l0_directory(repository_paths, raw_dir, unsafe_object_root)
    assert (
        private._validated_l0_directory(repository_paths, raw_dir, tmp_path / "valid-external-l0")
        == (tmp_path / "valid-external-l0").resolve()
    )

    approved_evidence = repository_paths.root / "data/basic60/evidence"
    approved_evidence.mkdir(parents=True)
    with pytest.raises(ValueError, match="must be an absolute path"):
        private._validated_evidence_directory(repository_paths, Path("relative"))
    with pytest.raises(ValueError, match="must remain under"):
        private._validated_evidence_directory(repository_paths, tmp_path / "outside-evidence")

    evidence_link_target = tmp_path / "evidence-target"
    evidence_link_target.mkdir()
    evidence_link = approved_evidence / "link"
    evidence_link.symlink_to(evidence_link_target, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic links"):
        private._validated_evidence_directory(repository_paths, evidence_link)

    evidence_file = approved_evidence / "not-a-directory"
    evidence_file.write_text("file", encoding="utf-8")
    with pytest.raises(ValueError, match="must be a directory"):
        private._validated_evidence_directory(repository_paths, evidence_file)
    assert (
        private._validated_evidence_directory(repository_paths, approved_evidence / "new-directory")
        == (approved_evidence / "new-directory").resolve()
    )

    missing_object = tmp_path / "missing-object"
    with pytest.raises(ValueError, match="not a regular file"):
        private._verify_l0_object(missing_object, "a" * 64, 1)
    mismatched_object = tmp_path / "mismatched-object"
    mismatched_object.write_text("x", encoding="utf-8")
    with pytest.raises(ValueError, match="does not match source"):
        private._verify_l0_object(mismatched_object, "a" * 64, 2)

    no_overwrite = tmp_path / "evidence-output.json"
    no_overwrite.write_text("existing", encoding="utf-8")
    with pytest.raises(ValueError, match="refusing to overwrite"):
        private._atomic_write_json_no_overwrite(no_overwrite, {"new": True})


def test_replay_manifest_builder_rejects_incomplete_and_mismatched_inputs() -> None:
    stage_ids = ("parse", "standardize", "entity")
    stages = {
        stage_id: {
            "quality_observations": {"conflicts": ["probe"] if stage_id == "entity" else []},
            "records": [] if stage_id != "entity" else "not-a-list",
            "implementation_sha256": "a" * 64,
            "input_payload_sha256": "b" * 64,
            "original_values_sha256": "c" * 64,
            "source_fields_sha256": "d" * 64,
        }
        for stage_id in stage_ids
    }
    hashes = {stage_id: private._canonical_sha256(stage) for stage_id, stage in stages.items()}
    references = {
        stage_id: {"path": f"runtime/basic60/{stage_id}.json", "sha256": digest}
        for stage_id, digest in hashes.items()
    }
    artifacts = {
        "stages": references,
        "replay": {
            "first_output_sha256": hashes,
            "second_output_sha256": hashes,
        },
    }

    with pytest.raises(ValueError, match="exact runtime seed"):
        private.build_basic60_replay_manifests(
            {"root_sha256": "a" * 64},
            runtime_seed_sha256="bad",
            d3_artifacts=artifacts,
            stage_payloads=stages,
        )
    with pytest.raises(ValueError, match="three stage references"):
        private.build_basic60_replay_manifests(
            {"root_sha256": "a" * 64},
            runtime_seed_sha256="a" * 64,
            d3_artifacts={},
            stage_payloads=stages,
        )
    with pytest.raises(ValueError, match="two independently computed"):
        private.build_basic60_replay_manifests(
            {"root_sha256": "a" * 64},
            runtime_seed_sha256="a" * 64,
            d3_artifacts={"stages": references, "replay": {}},
            stage_payloads=stages,
        )

    missing_stage = copy.deepcopy(stages)
    del missing_stage["parse"]
    with pytest.raises(ValueError, match="Missing D3 runtime stage"):
        private.build_basic60_replay_manifests(
            {"root_sha256": "a" * 64},
            runtime_seed_sha256="a" * 64,
            d3_artifacts=artifacts,
            stage_payloads=missing_stage,
        )

    invalid_quality = copy.deepcopy(stages)
    invalid_quality["parse"]["quality_observations"] = "invalid"
    invalid_quality_hashes = {
        stage_id: private._canonical_sha256(stage) for stage_id, stage in invalid_quality.items()
    }
    invalid_quality_artifacts = copy.deepcopy(artifacts)
    invalid_quality_artifacts["replay"]["first_output_sha256"] = invalid_quality_hashes
    invalid_quality_artifacts["replay"]["second_output_sha256"] = invalid_quality_hashes
    with pytest.raises(ValueError, match="Missing D3 quality observations"):
        private.build_basic60_replay_manifests(
            {"root_sha256": "a" * 64},
            runtime_seed_sha256="a" * 64,
            d3_artifacts=invalid_quality_artifacts,
            stage_payloads=invalid_quality,
        )

    mismatched = copy.deepcopy(artifacts)
    mismatched["replay"]["second_output_sha256"]["parse"] = "f" * 64
    with pytest.raises(ValueError, match="independent replay mismatch"):
        private.build_basic60_replay_manifests(
            {"root_sha256": "a" * 64},
            runtime_seed_sha256="a" * 64,
            d3_artifacts=mismatched,
            stage_payloads=stages,
        )

    manifests = private.build_basic60_replay_manifests(
        {"root_sha256": "a" * 64},
        runtime_seed_sha256="a" * 64,
        d3_artifacts=artifacts,
        stage_payloads=stages,
    )
    assert manifests[private.PIPELINE_IDS[2]]["status"] == "needs_review"
    assert manifests[private.PIPELINE_IDS[2]]["record_count"] == -1


def test_sample_review_and_ready_seed_builders_reject_invalid_contracts() -> None:
    with pytest.raises(ValueError, match="exact seed artifact"):
        private.build_basic60_sample_candidate({}, seed_artifact_sha256="bad")
    with pytest.raises(ValueError, match="exactly 60 seed countries"):
        private.build_basic60_sample_candidate({"countries": []}, seed_artifact_sha256="a" * 64)
    with pytest.raises(ValueError, match="country must be an object"):
        private.build_basic60_sample_candidate(
            {"countries": [None] * 60}, seed_artifact_sha256="a" * 64
        )
    with pytest.raises(ValueError, match="at least three available values"):
        private.build_basic60_sample_candidate(
            {"countries": [{"iso3": f"X{index:02d}", "metrics": []} for index in range(60)]},
            seed_artifact_sha256="a" * 64,
        )

    with pytest.raises(ValueError, match="slot must be 1 or 2"):
        private.build_basic60_sample_review_manifest({}, {}, review_slot=0)
    with pytest.raises(ValueError, match="records are required"):
        private.build_basic60_sample_review_manifest({}, {}, review_slot=1)
    with pytest.raises(ValueError, match="180 unique sample IDs"):
        private.build_basic60_sample_review_manifest(
            {}, {"records": [{"sample_id": "duplicate"}] * 180}, review_slot=1
        )

    with pytest.raises(ValueError, match="release-bundle and validation-report"):
        private.build_basic60_ready_seed(
            {},
            {},
            {},
            {},
            release_bundle_sha256="bad",
            validation_report_sha256="bad",
            reviewed_at="",
        )
    with pytest.raises(ValueError, match="timezone-aware"):
        private.build_basic60_ready_seed(
            {},
            {},
            {},
            {},
            release_bundle_sha256="a" * 64,
            validation_report_sha256="b" * 64,
            reviewed_at="2026-08-25",
        )
    with pytest.raises(ValueError, match="approved source admission"):
        private.build_basic60_ready_seed(
            {},
            {},
            {},
            {},
            release_bundle_sha256="a" * 64,
            validation_report_sha256="b" * 64,
            reviewed_at="2026-08-25T12:00:00+08:00",
        )

    sources = [
        {"source_ref": source_ref, "snapshots": []}
        for source_ref in ("SRC-IDENTITY", "SRC-MACRO", "SRC-ENERGY")
    ]
    domains = [
        {"domain_id": domain_id, "primary_source_id": source_ref}
        for domain_id, source_ref in (
            ("country_profile", "SRC-IDENTITY"),
            ("macroeconomic", "SRC-MACRO"),
            ("energy", "SRC-ENERGY"),
        )
    ]
    kwargs = {
        "release_bundle_sha256": "a" * 64,
        "validation_report_sha256": "b" * 64,
        "reviewed_at": "2026-08-25T12:00:00+08:00",
    }
    with pytest.raises(ValueError, match="Approved primary sources are incomplete"):
        private.build_basic60_ready_seed(
            {"countries": []},
            {"scoped_files": []},
            {"sources": sources},
            {"source_admission": {"domains": [None]}},
            **kwargs,
        )
    with pytest.raises(ValueError, match="missing Basic60 scoped file hashes"):
        private.build_basic60_ready_seed(
            {"countries": []},
            {"scoped_files": []},
            {"sources": sources},
            {"source_admission": {"domains": domains}},
            **kwargs,
        )
    scoped_files = [
        {"path": private.PROFILE_CSV.as_posix(), "sha256": "c" * 64},
        {"path": private.METRIC_CSV.as_posix(), "sha256": "d" * 64},
    ]
    with pytest.raises(ValueError, match="no approved snapshot"):
        private.build_basic60_ready_seed(
            {"countries": []},
            {"scoped_files": scoped_files},
            {"sources": sources},
            {"source_admission": {"domains": domains}},
            **kwargs,
        )


def test_source_matrix_and_item_review_math_cover_boundary_failures(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    _write_raw_fixture(raw_dir)
    profiles = private._csv_rows(raw_dir / private.PROFILE_CSV)
    _write_csv(raw_dir / private.PROFILE_CSV, PROFILE_FIELDS, profiles[:-1])
    with pytest.raises(ValueError, match="60 unique ISO3"):
        private.build_basic60_source_matrix_candidate(raw_dir)

    _write_raw_fixture(raw_dir)
    profiles = private._csv_rows(raw_dir / private.PROFILE_CSV)
    priority_index = next(index for index, item in enumerate(profiles) if item["iso3"] == "IDN")
    profiles[priority_index]["iso3"] = "ZZZ"
    _write_csv(raw_dir / private.PROFILE_CSV, PROFILE_FIELDS, profiles)
    with pytest.raises(ValueError, match="future deep-dive priority"):
        private.build_basic60_source_matrix_candidate(raw_dir)

    assert private._expected_item_review_ids({"countries": "invalid"}) == {
        "chinese_names": [],
        "pending_values": [],
        "derived_values": [],
    }
    assert private._decimal_text(Decimal("0")) == "0"
    seed = {
        "countries": [
            {
                "iso3": "IDN",
                "localized_texts": [],
                "metrics": [
                    {
                        "metric_code": "renewable_capacity_mw",
                        "normalized_value": "50",
                        "value_status": "available",
                    },
                    {
                        "metric_code": "electricity_installed_capacity_mw",
                        "normalized_value": "0",
                        "value_status": "available",
                    },
                    {
                        "metric_code": "renewable_share_capacity_pct",
                        "period": "2025",
                        "source_ref": "SRC",
                        "normalized_value": "0",
                        "value_status": "available",
                    },
                ],
            }
        ]
    }
    rows = private._item_review_rows(seed, blank=False)
    assert rows["derived_values"][0]["recomputed_value"] == ""

    assert private._derived_review_math_matches({"numerator_value": "invalid"}) is False
    assert (
        private._derived_review_math_matches(
            {
                "numerator_value": "1",
                "denominator_value": "0",
                "recomputed_value": "0",
                "reported_value": "0",
            }
        )
        is False
    )
    assert (
        private._derived_review_math_matches(
            {
                "numerator_value": "1",
                "denominator_value": "2",
                "recomputed_value": "50",
                "reported_value": "50.01",
            }
        )
        is True
    )
