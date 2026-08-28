"""Focused branch coverage for the BASIC60 private-trial API guardrails."""

from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
import test_basic60_api as fixtures
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from navigator_api import basic60_importer as importer
from navigator_api import basic60_service as service
from navigator_api.basic60_config import Basic60Settings, _bool_env
from navigator_api.basic60_errors import Basic60APIError
from navigator_api.basic60_governance import (
    Basic60Approval,
    Basic60Decision,
    Basic60GovernanceError,
    Basic60ReleaseAuthorization,
    Basic60ReleaseSignature,
    Basic60ValidationReport,
    validate_basic60_activation,
    validate_basic60_decision,
)
from navigator_api.basic60_importer import (
    Basic60ImportError,
    _source,
    _validate_activation,
    activate_basic60_release,
    import_basic60_seed_file,
    load_seed_artifact,
    revoke_basic60_release,
    revoke_basic60_source,
    validate_basic60_release_counts,
)
from navigator_api.basic60_main import create_app
from navigator_api.basic60_models import Basic60Base, Basic60Release
from navigator_api.basic60_seed_contract import (
    Basic60SeedArtifact,
    CountryArtifact,
    MetricValueArtifact,
    RawRecordArtifact,
    SourceSnapshotArtifact,
    _sha256,
)
from navigator_api.database import build_engine, build_session_factory
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session


def _minimal_settings(**changes: Any) -> Basic60Settings:
    settings = Basic60Settings(
        database_url="sqlite+pysqlite:///:memory:",
        api_key=fixtures.API_KEY,
        cors_origins=("http://localhost:3000",),
        candidate_only=True,
        enforce_baseline_counts=False,
    )
    return replace(settings, **changes)


def _decision_payload() -> dict[str, Any]:
    return {
        "decision_id": "PBD-BASIC60-PRIVATE-001",
        "status": "approved_and_effective",
        "effective_from": "2026-08-24T10:00:00+08:00",
        "scope": {
            "release_profile": "basic60_private",
            "private_trial_only": True,
            "real_data_enabled": True,
            "policies_enabled": False,
            "ai_enabled": False,
            "external_model_calls_enabled": False,
        },
        "approval": {
            "person_id": "kevin",
            "role": "project_approver",
            "signed_at": "2026-08-24T10:00:00+08:00",
            "signature_sha256": fixtures.HEX_A,
        },
    }


def _authorization_payload(seed_sha256: str = fixtures.HEX_C) -> dict[str, Any]:
    return {
        "schema_version": "basic60.release-authorization.v1",
        "release_id": "BASIC60-PRIVATE-R1",
        "release_profile": "basic60_private",
        "status": "private_trial_ready",
        "formal_gate_status": "pending",
        "release_bundle_sha256": fixtures.HEX_B,
        "validation_report_sha256": fixtures._validation_report_digest(),
        "seed_artifact_sha256": seed_sha256,
        "approved_at": "2026-08-24T10:00:00+08:00",
        "pbd_decision_id": "PBD-BASIC60-PRIVATE-001",
        "signoffs": {
            "single_excel_review": {
                "status": "approved",
                "review_scope": "all_basic60_data_and_sources",
                "workbook": {
                    "path": "outputs/basic60/BASIC60-PRIVATE-R1_review.xlsx",
                    "sha256": fixtures.HEX_A,
                },
                "canonical_payload_sha256": fixtures.HEX_C,
                "signature": fixtures._signature("kevin", "project_approver"),
            },
        },
        "does_not_complete_formal_d1_d4": True,
        "does_not_authorize_p0_or_production": True,
    }


def _write_payload(path: Path, payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True).encode()
    path.write_bytes(encoded)
    return hashlib.sha256(encoded).hexdigest()


def _database_session() -> tuple[Any, Any, Session]:
    engine = build_engine("sqlite+pysqlite:///:memory:")
    Basic60Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    return engine, session_factory, session_factory()


def test_bool_env_and_candidate_settings_cover_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BASIC60_TEST_FLAG", raising=False)
    assert _bool_env("BASIC60_TEST_FLAG") is False
    assert _bool_env("BASIC60_TEST_FLAG", default=True) is True
    monkeypatch.setenv("BASIC60_TEST_FLAG", " YES ")
    assert _bool_env("BASIC60_TEST_FLAG") is True
    monkeypatch.setenv("BASIC60_TEST_FLAG", "off")
    assert _bool_env("BASIC60_TEST_FLAG", default=True) is False

    monkeypatch.setenv("BASIC60_DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("BASIC60_API_KEY", fixtures.API_KEY)
    monkeypatch.setenv("BASIC60_CANDIDATE_ONLY", "true")
    monkeypatch.setenv("BASIC60_AUTO_CREATE_SCHEMA", "yes")
    monkeypatch.setenv("BASIC60_AUTO_IMPORT_SEED", "1")
    monkeypatch.setenv("BASIC60_ENFORCE_BASELINE_COUNTS", "false")
    for name in (
        "BASIC60_DECISION_PATH",
        "BASIC60_DECISION_SHA256",
        "BASIC60_RELEASE_AUTHORIZATION_PATH",
        "BASIC60_RELEASE_AUTHORIZATION_SHA256",
        "BASIC60_VALIDATION_REPORT_PATH",
        "BASIC60_VALIDATION_REPORT_SHA256",
    ):
        monkeypatch.delenv(name, raising=False)

    settings = Basic60Settings.from_env()
    assert settings.candidate_only is True
    assert settings.decision_path is None
    assert settings.release_authorization_path is None
    assert settings.validation_report_path is None
    assert settings.auto_create_schema is True
    assert settings.auto_import_seed is True
    assert settings.enforce_baseline_counts is False
    assert settings.seed_path == Path("runtime/basic60/basic60_seed.json")


@pytest.mark.parametrize(
    ("name", "value", "message"),
    (
        ("BASIC60_DECISION_PATH", None, "BASIC60_DECISION_PATH"),
        ("BASIC60_DECISION_SHA256", "short", "BASIC60_DECISION_SHA256"),
        (
            "BASIC60_RELEASE_AUTHORIZATION_PATH",
            None,
            "BASIC60_RELEASE_AUTHORIZATION_PATH",
        ),
        (
            "BASIC60_RELEASE_AUTHORIZATION_SHA256",
            "short",
            "BASIC60_RELEASE_AUTHORIZATION_SHA256",
        ),
        ("BASIC60_VALIDATION_REPORT_PATH", None, "BASIC60_VALIDATION_REPORT_PATH"),
        (
            "BASIC60_VALIDATION_REPORT_SHA256",
            "short",
            "BASIC60_VALIDATION_REPORT_SHA256",
        ),
    ),
)
def test_non_candidate_settings_reject_each_missing_binding(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str | None,
    message: str,
) -> None:
    values = {
        "BASIC60_DATABASE_URL": "sqlite+pysqlite:///:memory:",
        "BASIC60_API_KEY": fixtures.API_KEY,
        "BASIC60_CANDIDATE_ONLY": "false",
        "BASIC60_DECISION_PATH": "/decision.json",
        "BASIC60_DECISION_SHA256": fixtures.HEX_A,
        "BASIC60_RELEASE_AUTHORIZATION_PATH": "/authorization.json",
        "BASIC60_RELEASE_AUTHORIZATION_SHA256": fixtures.HEX_B,
        "BASIC60_VALIDATION_REPORT_PATH": "/report.json",
        "BASIC60_VALIDATION_REPORT_SHA256": fixtures.HEX_C,
    }
    for env_name, env_value in values.items():
        monkeypatch.setenv(env_name, env_value)
    if value is None:
        monkeypatch.delenv(name)
    else:
        monkeypatch.setenv(name, value)

    with pytest.raises(RuntimeError, match=message):
        Basic60Settings.from_env()


def test_governance_signature_and_decision_validators_reject_bad_inputs() -> None:
    approval = _decision_payload()["approval"]
    naive_approval = {**approval, "signed_at": "2026-08-24T10:00:00"}
    with pytest.raises(ValidationError, match="signed_at must be timezone-aware"):
        Basic60Approval.model_validate(naive_approval)
    with pytest.raises(ValidationError, match="signature_sha256 must be a SHA-256 digest"):
        Basic60Approval.model_validate({**approval, "signature_sha256": "not-a-digest"})

    decision = _decision_payload()
    with pytest.raises(ValidationError, match="effective_from must be timezone-aware"):
        Basic60Decision.model_validate({**decision, "effective_from": "2026-08-24T10:00:00"})
    decision["approval"]["signed_at"] = "2026-08-24T11:00:00+08:00"
    with pytest.raises(ValidationError, match="approval signed_at cannot be after effective_from"):
        Basic60Decision.model_validate(decision)

    signature = fixtures._signature("kevin", "project_approver")
    with pytest.raises(ValidationError, match="signed_at must be timezone-aware"):
        Basic60ReleaseSignature.model_validate({**signature, "signed_at": "2026-08-24T10:00:00"})
    with pytest.raises(ValidationError, match="signature_sha256 must be a SHA-256 digest"):
        Basic60ReleaseSignature.model_validate({**signature, "signature_sha256": "z" * 64})
    with pytest.raises(ValidationError, match="kevin"):
        Basic60ReleaseSignature.model_validate({**signature, "person_id": "other"})
    with pytest.raises(ValidationError, match="project_approver"):
        Basic60ReleaseSignature.model_validate({**signature, "role": "data_owner"})


@pytest.mark.parametrize(
    "case",
    (
        "legacy_signoff",
        "person",
        "role",
        "workbook_path",
        "workbook_hash",
        "payload_hash",
        "formal_gate",
        "formal_completion",
        "production",
        "hash",
        "approved_at",
        "order",
    ),
)
def test_release_authorization_rejects_invalid_single_excel_approval(
    case: str,
) -> None:
    payload = _authorization_payload()
    signoffs = payload["signoffs"]
    review = signoffs["single_excel_review"]
    if case == "legacy_signoff":
        signoffs["d1_source_admission"] = {
            "status": "approved",
            "signatures": [fixtures._signature("kevin", "project_approver")],
        }
        expected = "Extra inputs are not permitted"
    elif case == "person":
        review["signature"]["person_id"] = "other"
        expected = "kevin"
    elif case == "role":
        review["signature"]["role"] = "data_owner"
        expected = "project_approver"
    elif case == "workbook_path":
        review["workbook"]["path"] = "../review.xlsx"
        expected = "canonical outputs/basic60"
    elif case == "workbook_hash":
        review["workbook"]["sha256"] = "bad"
        expected = "workbook SHA-256 is invalid"
    elif case == "payload_hash":
        review["canonical_payload_sha256"] = "bad"
        expected = "canonical payload SHA-256 is invalid"
    elif case == "formal_gate":
        payload["formal_gate_status"] = "passed"
        expected = "pending"
    elif case == "formal_completion":
        payload["does_not_complete_formal_d1_d4"] = False
        expected = "Input should be True"
    elif case == "production":
        payload["does_not_authorize_p0_or_production"] = False
        expected = "Input should be True"
    elif case == "hash":
        payload["seed_artifact_sha256"] = "bad"
        expected = "release authorization hashes must be SHA-256"
    elif case == "approved_at":
        payload["approved_at"] = "2026-08-24T10:00:00"
        expected = "approved_at must be timezone-aware"
    else:
        review["signature"]["signed_at"] = "2026-08-24T11:00:00+08:00"
        expected = "must match the single Excel review signature time"

    with pytest.raises(ValidationError, match=expected):
        Basic60ReleaseAuthorization.model_validate(payload)


def test_validation_report_hash_validator_handles_none_and_bad_digest() -> None:
    payload = fixtures._validation_report_payload()
    payload["raw_root_sha256"] = None
    report = Basic60ValidationReport.model_validate(payload)
    assert report.raw_root_sha256 is None

    payload["raw_root_sha256"] = "g" * 64
    with pytest.raises(ValidationError, match="raw_root_sha256 must be a SHA-256 digest"):
        Basic60ValidationReport.model_validate(payload)


def test_decision_validation_covers_candidate_missing_invalid_and_future(
    tmp_path: Path,
) -> None:
    assert validate_basic60_decision(_minimal_settings()) is None

    with pytest.raises(Basic60GovernanceError, match="decision path and SHA-256 are required"):
        validate_basic60_decision(_minimal_settings(candidate_only=False))

    invalid_path = tmp_path / "invalid-decision.json"
    invalid_sha = _write_payload(invalid_path, {"unexpected": True})
    invalid_settings = _minimal_settings(
        candidate_only=False,
        decision_path=invalid_path,
        decision_sha256=invalid_sha,
    )
    with pytest.raises(Basic60GovernanceError, match="decision is invalid"):
        validate_basic60_decision(invalid_settings)

    future_payload = _decision_payload()
    future_at = datetime.now(UTC) + timedelta(days=1)
    future_payload["effective_from"] = future_at.isoformat()
    future_payload["approval"]["signed_at"] = future_at.isoformat()
    future_path = tmp_path / "future-decision.json"
    future_sha = _write_payload(future_path, future_payload)
    future_settings = replace(
        invalid_settings,
        decision_path=future_path,
        decision_sha256=future_sha,
    )
    with pytest.raises(Basic60GovernanceError, match="decision is not effective yet"):
        validate_basic60_decision(future_settings)


def test_activation_rejects_candidate_missing_invalid_and_future_authorization(
    tmp_path: Path,
) -> None:
    with pytest.raises(Basic60GovernanceError, match="Candidate-only mode cannot activate"):
        validate_basic60_activation(
            _minimal_settings(),
            release_id="BASIC60-PRIVATE-R1",
            release_bundle_sha256=fixtures.HEX_B,
            validation_report_sha256=fixtures.HEX_A,
            seed_artifact_sha256=fixtures.HEX_C,
        )

    seed_path = tmp_path / "seed.json"
    seed_sha = fixtures._write_json(seed_path, fixtures._seed_payload())
    settings = fixtures._settings(tmp_path, seed_path, seed_sha)
    call = {
        "release_id": "BASIC60-PRIVATE-R1",
        "release_bundle_sha256": fixtures.HEX_B,
        "validation_report_sha256": cast(str, settings.validation_report_sha256),
        "seed_artifact_sha256": seed_sha,
    }
    with pytest.raises(Basic60GovernanceError, match="release authorization path"):
        validate_basic60_activation(replace(settings, release_authorization_path=None), **call)

    assert settings.release_authorization_path is not None
    invalid_sha = _write_payload(settings.release_authorization_path, {"unexpected": True})
    invalid_settings = replace(settings, release_authorization_sha256=invalid_sha)
    with pytest.raises(Basic60GovernanceError, match="release authorization is invalid"):
        validate_basic60_activation(invalid_settings, **call)

    future = _authorization_payload(seed_sha)
    future["validation_report_sha256"] = settings.validation_report_sha256
    future["approved_at"] = "2999-01-01T00:00:00+00:00"
    future["signoffs"]["single_excel_review"]["signature"]["signed_at"] = future["approved_at"]
    future_sha = _write_payload(settings.release_authorization_path, future)
    future_settings = replace(settings, release_authorization_sha256=future_sha)
    with pytest.raises(Basic60GovernanceError, match="release authorization is not effective yet"):
        validate_basic60_activation(future_settings, **call)


def test_seed_leaf_validators_cover_invalid_hashes_dates_and_values() -> None:
    with pytest.raises(ValueError, match="field must be a SHA-256 digest"):
        _sha256("g" * 64, "field")

    snapshot = fixtures._source("SRC", "macro", "primary")["snapshots"][0]
    snapshot["captured_at"] = "2026-08-24T08:00:00"
    with pytest.raises(ValidationError, match="captured_at must be timezone-aware"):
        SourceSnapshotArtifact.model_validate(snapshot)

    raw = {
        "record_ref": "RAW-IDN",
        "source_ref": "SRC",
        "source_snapshot_ref": "SNAP-SRC",
        "country_code": None,
        "object_key": "sha256/item.json",
        "payload_sha256": fixtures.HEX_A,
        "media_type": "application/json",
    }
    assert RawRecordArtifact.model_validate(raw).country_code is None
    raw["country_code"] = "idn"
    assert RawRecordArtifact.model_validate(raw).country_code == "IDN"

    available = fixtures._metric("gdp_current_usd", "1", "USD", "2024", "SRC", "RAW-IDN")
    invalid_values = (
        ({**available, "period_start": "2025-01-01"}, "period_start cannot be after"),
        ({**available, "normalized_value": None}, "available values require"),
        (
            {
                **available,
                "value_status": "pending",
                "null_reason": "missing",
                "normalized_value": "1",
            },
            "non-available values require",
        ),
        ({**available, "reviewed_at": "2026-08-24T09:00:00"}, "timezone-aware"),
    )
    for payload, message in invalid_values:
        with pytest.raises(ValidationError, match=message):
            MetricValueArtifact.model_validate(payload)


def test_country_display_name_and_code_validators_reject_bad_values() -> None:
    country = fixtures._country("IDN", "ID", "印度尼西亚", "Indonesia")
    country["iso3"] = "I1N"
    with pytest.raises(ValidationError, match="country codes must contain only letters"):
        CountryArtifact.model_validate(country)

    country = fixtures._country("IDN", "ID", "印度尼西亚", "Indonesia")
    country["localized_texts"][1]["translation_status"] = "pending"
    with pytest.raises(ValidationError, match="reviewed preferred zh-CN and en"):
        CountryArtifact.model_validate(country)


def _mutate_seed_case(payload: dict[str, Any], case: str) -> str:
    if case == "manual_policy_field_count":
        payload["ai_usage_policy"]["field_count"] += 1
        return "AI usage policy field scope must match"
    if case == "manual_policy_fields_hash":
        payload["ai_usage_policy"]["fields_sha256"] = fixtures.HEX_A
        return "AI usage policy field scope must match"
    if case == "duplicate_source":
        payload["sources"][1]["source_ref"] = payload["sources"][0]["source_ref"]
        return "source_ref values must be unique"
    if case == "missing_role":
        payload["sources"][1]["data_domain"] = "country_identity"
        return "each data domain requires"
    if case == "duplicate_raw":
        payload["raw_records"].append(copy.deepcopy(payload["raw_records"][0]))
        return "raw record references must be unique"
    if case == "unknown_snapshot":
        payload["raw_records"][0]["source_snapshot_ref"] = "UNKNOWN"
        return "references an unknown snapshot"
    if case == "duplicate_metric":
        payload["metric_definitions"][-1]["metric_code"] = payload["metric_definitions"][0][
            "metric_code"
        ]
        return "metric definition codes must be unique"
    if case == "wrong_metric_set":
        payload["metric_definitions"][-1]["metric_code"] = "unknown_metric"
        return "fixed BASIC60 V1 metric set"
    if case == "duplicate_country":
        payload["countries"][1]["iso3"] = payload["countries"][0]["iso3"]
        return "country ISO codes must be unique"
    if case == "unknown_raw":
        payload["countries"][0]["localized_texts"][0]["raw_record_ref"] = "UNKNOWN"
        return "unknown raw_record_ref"
    if case == "source_mismatch":
        payload["countries"][0]["localized_texts"][0]["source_ref"] = "SRC-ID-ALT"
        return "source_ref mismatch"
    if case == "snapshot_mismatch":
        payload["countries"][0]["localized_texts"][0]["source_snapshot_ref"] = "SNAP-OTHER"
        return "source snapshot mismatch"
    if case == "unknown_metric":
        payload["countries"][0]["metrics"][0]["metric_code"] = "unknown_metric"
        return "unknown metric code"
    if case == "country_count":
        payload["release"]["counts"]["countries"] = 3
        return "declared country count"
    if case == "available_count":
        payload["release"]["counts"]["available_metric_values"] = 7
        return "declared available metric count"
    payload["release"]["counts"]["pending_metric_values"] = 3
    return "declared pending metric count"


@pytest.mark.parametrize(
    "case",
    (
        "manual_policy_field_count",
        "manual_policy_fields_hash",
        "duplicate_source",
        "missing_role",
        "duplicate_raw",
        "unknown_snapshot",
        "duplicate_metric",
        "wrong_metric_set",
        "duplicate_country",
        "unknown_raw",
        "source_mismatch",
        "snapshot_mismatch",
        "unknown_metric",
        "country_count",
        "available_count",
        "pending_count",
    ),
)
def test_seed_cross_reference_guards_fail_closed(case: str) -> None:
    payload = fixtures._seed_payload()
    expected = _mutate_seed_case(payload, case)
    with pytest.raises(ValidationError, match=expected):
        Basic60SeedArtifact.model_validate(payload)


def test_seed_allows_unavailable_without_counting_it_as_pending() -> None:
    payload = fixtures._seed_payload()
    metric = payload["countries"][0]["metrics"][-1]
    metric["value_status"] = "unavailable"
    metric["null_reason"] = "source_withdrew_value"
    payload["release"]["counts"]["pending_metric_values"] = 1
    artifact = Basic60SeedArtifact.model_validate(payload)
    assert artifact.countries[0].metrics[-1].value_status == "unavailable"


def test_seed_rejects_per_source_permission_state() -> None:
    payload = fixtures._seed_payload()
    payload["sources"][0]["license_scope"] = {"display": True}
    payload["sources"][0]["ai_processing"] = "allowed_by_manual_decision"
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        Basic60SeedArtifact.model_validate(payload)


def test_seed_loader_rejects_missing_oversized_and_invalid_files(tmp_path: Path) -> None:
    with pytest.raises(Basic60ImportError, match="Cannot read BASIC60 seed artifact"):
        load_seed_artifact(tmp_path / "missing.json")

    oversized = tmp_path / "oversized.json"
    with oversized.open("wb") as stream:
        stream.truncate(importer.MAX_SEED_BYTES + 1)
    with pytest.raises(Basic60ImportError, match="exceeds the 128 MiB"):
        load_seed_artifact(oversized)

    invalid = tmp_path / "invalid.json"
    invalid.write_text("{not-json", encoding="utf-8")
    with pytest.raises(Basic60ImportError, match="seed artifact is invalid"):
        load_seed_artifact(invalid)


def test_import_activation_guards_status_counts_and_governance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    not_ready = Basic60SeedArtifact.model_validate(fixtures._seed_payload(status="not_ready"))
    with pytest.raises(Basic60ImportError, match="private_trial_ready artifact"):
        _validate_activation(not_ready, fixtures.HEX_A, _minimal_settings())

    ready = Basic60SeedArtifact.model_validate(fixtures._seed_payload())
    with pytest.raises(Basic60ImportError, match="approved V1 baseline"):
        _validate_activation(
            ready,
            fixtures.HEX_A,
            _minimal_settings(enforce_baseline_counts=True),
        )

    def deny(*args: Any, **kwargs: Any) -> None:
        raise Basic60GovernanceError("governance denied")

    monkeypatch.setattr(importer, "validate_basic60_activation", deny)
    with pytest.raises(Basic60ImportError, match="governance denied"):
        _validate_activation(ready, fixtures.HEX_A, _minimal_settings())


def test_stored_count_guards_reject_declared_and_actual_mismatches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _minimal_settings(enforce_baseline_counts=True)
    release = SimpleNamespace(release_id="R1", declared_counts={})
    with pytest.raises(Basic60ImportError, match="release counts do not match"):
        validate_basic60_release_counts(cast(Session, MagicMock()), release, settings)

    release.declared_counts = dict(importer.EXPECTED_PRIVATE_TRIAL_COUNTS)
    monkeypatch.setattr(importer, "database_counts", lambda session, release_id: {})
    with pytest.raises(Basic60ImportError, match="Stored BASIC60 row counts"):
        validate_basic60_release_counts(cast(Session, MagicMock()), release, settings)


def test_source_and_release_mutations_cover_fail_closed_and_rollback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine, _factory, session = _database_session()
    try:
        with pytest.raises(Basic60ImportError, match="Unknown BASIC60 release"):
            _source(session, "UNKNOWN", "SRC")
        with pytest.raises(Basic60ImportError, match="Unknown BASIC60 release"):
            activate_basic60_release(session, "UNKNOWN", _minimal_settings())
        with pytest.raises(Basic60ImportError, match="Unknown BASIC60 release"):
            revoke_basic60_release(session, "UNKNOWN", _minimal_settings())
    finally:
        session.close()
        engine.dispose()

    unsupported = SimpleNamespace(status="pending")
    monkeypatch.setattr(importer, "_source", lambda *args, **kwargs: unsupported)
    with pytest.raises(Basic60ImportError, match="Unsupported BASIC60 source status"):
        revoke_basic60_source(cast(Session, MagicMock()), "R1", " SRC ")

    active = SimpleNamespace(status="active")
    monkeypatch.setattr(importer, "_source", lambda *args, **kwargs: active)
    failing_session = MagicMock(spec=Session)
    failing_session.commit.side_effect = RuntimeError("commit failed")
    with pytest.raises(RuntimeError, match="commit failed"):
        revoke_basic60_source(cast(Session, failing_session), "R1", "SRC")
    failing_session.rollback.assert_called_once()


def test_import_rolls_back_and_existing_inactive_release_can_activate(
    tmp_path: Path,
) -> None:
    seed_path = tmp_path / "seed.json"
    seed_sha = fixtures._write_json(seed_path, fixtures._seed_payload())
    settings = fixtures._settings(tmp_path, seed_path, seed_sha)

    failing_session = MagicMock(spec=Session)
    failing_session.get.return_value = None
    failing_session.add.side_effect = [None, RuntimeError("add failed")]
    with pytest.raises(RuntimeError, match="add failed"):
        import_basic60_seed_file(
            cast(Session, failing_session),
            seed_path,
            settings,
            activate=False,
        )
    failing_session.rollback.assert_called_once()

    engine, _factory, session = _database_session()
    try:
        import_basic60_seed_file(session, seed_path, settings, activate=False)
        release = session.get(Basic60Release, "BASIC60-PRIVATE-R1")
        assert release is not None and release.is_active is False
        import_basic60_seed_file(session, seed_path, settings, activate=True)
        session.refresh(release)
        assert release.is_active is True
    finally:
        session.close()
        engine.dispose()


def test_release_activation_and_revocation_wrap_governance_and_commit_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    authorization = fixtures._seed_payload()["manual_usage_authorization"]
    release = SimpleNamespace(
        release_id="BASIC60-PRIVATE-R1",
        status="private_trial_ready",
        release_bundle_sha256=fixtures.HEX_A,
        validation_report_sha256=fixtures.HEX_B,
        artifact_sha256=fixtures.HEX_C,
        manual_usage_authorization=authorization,
        manual_usage_authorization_sha256=importer._canonical_sha256(authorization),
        is_active=False,
        revoked_at=None,
    )
    session = MagicMock(spec=Session)
    session.get.return_value = release
    monkeypatch.setattr(importer, "validate_basic60_release_counts", lambda *args: None)

    def deny(*args: Any, **kwargs: Any) -> None:
        raise Basic60GovernanceError("denied")

    monkeypatch.setattr(importer, "validate_basic60_activation", deny)
    with pytest.raises(Basic60ImportError, match="denied"):
        activate_basic60_release(cast(Session, session), release.release_id, _minimal_settings())
    with pytest.raises(Basic60ImportError, match="denied"):
        revoke_basic60_release(cast(Session, session), release.release_id, _minimal_settings())

    monkeypatch.setattr(importer, "validate_basic60_activation", lambda *args, **kwargs: None)
    session.commit.side_effect = RuntimeError("commit failed")
    with pytest.raises(RuntimeError, match="commit failed"):
        activate_basic60_release(cast(Session, session), release.release_id, _minimal_settings())
    with pytest.raises(RuntimeError, match="commit failed"):
        revoke_basic60_release(cast(Session, session), release.release_id, _minimal_settings())
    assert session.rollback.call_count == 2


@pytest.mark.parametrize("operation", ("activate", "revoke", "import"))
def test_importer_cli_paths(
    operation: str,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    engine = MagicMock()
    session = MagicMock(spec=Session)
    context = MagicMock()
    context.__enter__.return_value = session
    factory = MagicMock(return_value=context)
    settings = _minimal_settings(seed_path=tmp_path / "default.json")
    create_schema = MagicMock()
    activate = MagicMock()
    revoke = MagicMock()
    import_seed = MagicMock(return_value={"countries": 60})

    monkeypatch.setattr(importer.Basic60Settings, "from_env", lambda: settings)
    monkeypatch.setattr(importer, "build_engine", lambda database_url: engine)
    monkeypatch.setattr(importer, "build_session_factory", lambda built_engine: factory)
    monkeypatch.setattr(importer.Basic60Base.metadata, "create_all", create_schema)
    monkeypatch.setattr(importer, "activate_basic60_release", activate)
    monkeypatch.setattr(importer, "revoke_basic60_release", revoke)
    monkeypatch.setattr(importer, "import_basic60_seed_file", import_seed)

    if operation == "activate":
        argv = ["--create-schema", "--activate-release", "R1"]
    elif operation == "revoke":
        argv = ["--revoke-release", "R1"]
    else:
        argv = ["--path", str(tmp_path / "override.json"), "--no-activate"]

    assert importer.main(argv) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["release_profile"] == "basic60_private"
    assert result["formal_gate_status"] == "pending"
    engine.dispose.assert_called_once()
    if operation == "activate":
        create_schema.assert_called_once_with(engine)
        activate.assert_called_once_with(session, "R1", settings)
    elif operation == "revoke":
        revoke.assert_called_once_with(session, "R1", settings)
    else:
        import_seed.assert_called_once_with(
            session,
            tmp_path / "override.json",
            settings,
            activate=False,
        )


def test_importer_cli_rejects_mutually_exclusive_release_actions() -> None:
    with pytest.raises(SystemExit, match="mutually exclusive"):
        importer.main(["--activate-release", "R1", "--revoke-release", "R1"])


def test_service_helpers_cover_empty_release_names_latest_rows_and_validation() -> None:
    engine, _factory, session = _database_session()
    try:
        with pytest.raises(Basic60APIError) as exc_info:
            service.get_active_release(session, "R1")
        assert exc_info.value.code == "BASIC60_NO_ACTIVE_RELEASE"
    finally:
        session.close()
        engine.dispose()

    fallback = SimpleNamespace(
        iso3="IDN",
        localized_texts=[
            SimpleNamespace(
                field_code="short_name",
                locale="en",
                source_ref="SRC",
                preferred=False,
                text="Indonesia fallback",
            )
        ],
    )
    assert service._preferred_name(fallback, "en", frozenset({"SRC"})) == "Indonesia fallback"
    assert service._preferred_name(fallback, "zh-CN", frozenset({"SRC"})) == "IDN"

    definition = SimpleNamespace(metric_code="metric")
    newer = SimpleNamespace(
        definition=definition,
        period_start=date(2024, 1, 1),
        period_end=date(2024, 12, 31),
        source_ref="SRC",
    )
    older = SimpleNamespace(
        definition=definition,
        period_start=date(2023, 1, 1),
        period_end=date(2023, 12, 31),
        source_ref="SRC",
    )
    country = SimpleNamespace(metric_values=[newer, older])
    assert service._latest_metric_values(
        country,
        date(2025, 1, 1),
        frozenset({"SRC"}),
    ) == [newer]

    assert service.effective_as_of(SimpleNamespace(as_of=date(2024, 12, 31)), None) == date(
        2024, 12, 31
    )
    assert service.effective_as_of(
        SimpleNamespace(as_of=date(2024, 12, 31)), date(2025, 1, 1)
    ) == date(2024, 12, 31)
    with pytest.raises(Basic60APIError) as exc_info:
        service.validated_expansions("identity,unknown")
    assert exc_info.value.code == "VALIDATION_ERROR"
    with pytest.raises(Basic60APIError) as exc_info:
        service.validated_expansions("provenance")
    assert exc_info.value.code == "VALIDATION_ERROR"


@pytest.fixture
def coverage_client(tmp_path: Path) -> Iterator[TestClient]:
    seed_path = tmp_path / "seed.json"
    seed_sha = fixtures._write_json(seed_path, fixtures._seed_payload())
    app = create_app(fixtures._settings(tmp_path, seed_path, seed_sha))

    @app.get("/coverage-http-error")
    def coverage_http_error() -> None:
        raise HTTPException(status_code=418, detail="coverage-only")

    with TestClient(app) as client:
        yield client


def test_api_validation_http_database_and_list_filter_branches(
    coverage_client: TestClient,
) -> None:
    headers = {"X-Private-Trial-Key": fixtures.API_KEY}
    invalid = coverage_client.get("/api/v1/countries", headers=headers, params={"limit": 0})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    assert invalid.json()["error"]["details"]

    http_error = coverage_client.get("/coverage-http-error", headers=headers)
    assert http_error.status_code == 418
    assert http_error.json()["error"]["code"] == "HTTP_418"

    filtered = coverage_client.get(
        "/api/v1/countries",
        headers=headers,
        params={"region": "TEST_REGION", "cursor": "IDN"},
    )
    assert filtered.status_code == 200
    assert [item["code"] for item in filtered.json()["data"]] == ["ZAF"]

    app = cast(FastAPI, coverage_client.app)
    with app.state.engine.begin() as connection:
        connection.execute(text("DROP TABLE basic60_release_snapshots"))
    unavailable = coverage_client.get("/health")
    assert unavailable.status_code == 503
    assert unavailable.json()["error"]["code"] == "BASIC60_DATABASE_UNAVAILABLE"
