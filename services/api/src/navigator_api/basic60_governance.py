"""Governance activation guard for real BASIC60 private-trial data."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from navigator_api.basic60_config import Basic60Settings, validate_runtime_attestation_key

DECISION_ID = "PBD-BASIC60-PRIVATE-001"


class Basic60DecisionScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    release_profile: Literal["basic60_private"]
    private_trial_only: Literal[True]
    real_data_enabled: Literal[True]
    policies_enabled: Literal[False]
    ai_enabled: Literal[False]
    external_model_calls_enabled: Literal[False]


class Basic60Approval(BaseModel):
    model_config = ConfigDict(extra="forbid")

    person_id: Literal["kevin"]
    role: Literal["project_approver"]
    signed_at: datetime
    signature_sha256: str

    @field_validator("signed_at")
    @classmethod
    def validate_signed_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("signed_at must be timezone-aware")
        return value

    @field_validator("signature_sha256")
    @classmethod
    def validate_signature_digest(cls, value: str) -> str:
        normalized = value.lower()
        if len(normalized) != 64 or any(
            character not in "0123456789abcdef" for character in normalized
        ):
            raise ValueError("signature_sha256 must be a SHA-256 digest")
        return normalized


class Basic60Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision_id: Literal["PBD-BASIC60-PRIVATE-001"]
    status: Literal["approved_and_effective"]
    effective_from: datetime
    scope: Basic60DecisionScope
    approval: Basic60Approval

    @model_validator(mode="after")
    def validate_dates(self) -> Basic60Decision:
        if self.effective_from.tzinfo is None or self.effective_from.utcoffset() is None:
            raise ValueError("effective_from must be timezone-aware")
        if self.approval.signed_at > self.effective_from:
            raise ValueError("approval signed_at cannot be after effective_from")
        return self


class Basic60GovernanceError(RuntimeError):
    """Raised when real-data activation is not explicitly authorized."""


def _read_verified(path: Path, expected_sha256: str, *, label: str) -> bytes:
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise Basic60GovernanceError(f"Cannot read BASIC60 {label} file: {path}") from exc
    actual = hashlib.sha256(payload).hexdigest()
    if actual != expected_sha256.lower():
        raise Basic60GovernanceError(f"BASIC60 {label} file SHA-256 does not match configuration")
    return payload


class Basic60ReleaseSignature(BaseModel):
    model_config = ConfigDict(extra="forbid")

    person_id: Literal["kevin"]
    role: Literal["project_approver"]
    signed_at: datetime
    signature_sha256: str

    @field_validator("signed_at")
    @classmethod
    def validate_signed_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("signed_at must be timezone-aware")
        return value

    @field_validator("signature_sha256")
    @classmethod
    def validate_signature_sha256(cls, value: str) -> str:
        normalized = value.lower()
        if len(normalized) != 64 or any(
            character not in "0123456789abcdef" for character in normalized
        ):
            raise ValueError("signature_sha256 must be a SHA-256 digest")
        return normalized


class Basic60ExcelReviewWorkbook(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=512)
    sha256: str

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        pure = PurePosixPath(value)
        if (
            pure.is_absolute()
            or ".." in pure.parts
            or not pure.is_relative_to(PurePosixPath("outputs/basic60"))
            or pure.suffix.lower() != ".xlsx"
            or pure.as_posix() != value
        ):
            raise ValueError(
                "single Excel review workbook path must be a canonical outputs/basic60/*.xlsx path"
            )
        return value

    @field_validator("sha256")
    @classmethod
    def validate_sha256(cls, value: str) -> str:
        normalized = value.lower()
        if len(normalized) != 64 or any(
            character not in "0123456789abcdef" for character in normalized
        ):
            raise ValueError("single Excel review workbook SHA-256 is invalid")
        return normalized


class Basic60SingleExcelReviewSignoff(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["approved"]
    review_scope: Literal["all_basic60_data_and_sources"]
    workbook: Basic60ExcelReviewWorkbook
    canonical_payload_sha256: str
    signature: Basic60ReleaseSignature

    @field_validator("canonical_payload_sha256")
    @classmethod
    def validate_payload_sha256(cls, value: str) -> str:
        normalized = value.lower()
        if len(normalized) != 64 or any(
            character not in "0123456789abcdef" for character in normalized
        ):
            raise ValueError("single Excel review canonical payload SHA-256 is invalid")
        return normalized


class Basic60ReleaseSignoffs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    single_excel_review: Basic60SingleExcelReviewSignoff


class Basic60ReleaseAuthorization(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["basic60.release-authorization.v1"]
    release_id: Literal["BASIC60-PRIVATE-R1"]
    release_profile: Literal["basic60_private"]
    status: Literal["private_trial_ready"]
    formal_gate_status: Literal["pending"]
    release_bundle_sha256: str
    validation_report_sha256: str
    seed_artifact_sha256: str
    approved_at: datetime
    pbd_decision_id: Literal["PBD-BASIC60-PRIVATE-001"]
    signoffs: Basic60ReleaseSignoffs
    does_not_complete_formal_d1_d4: Literal[True]
    does_not_authorize_p0_or_production: Literal[True]

    @field_validator("release_bundle_sha256", "validation_report_sha256", "seed_artifact_sha256")
    @classmethod
    def validate_digest(cls, value: str) -> str:
        normalized = value.lower()
        if len(normalized) != 64 or any(
            character not in "0123456789abcdef" for character in normalized
        ):
            raise ValueError("release authorization hashes must be SHA-256 digests")
        return normalized

    @model_validator(mode="after")
    def validate_approval_order(self) -> Basic60ReleaseAuthorization:
        if self.approved_at.tzinfo is None or self.approved_at.utcoffset() is None:
            raise ValueError("approved_at must be timezone-aware")
        signature = self.signoffs.single_excel_review.signature
        if signature.signed_at != self.approved_at:
            raise ValueError("release approval must match the single Excel review signature time")
        return self


class Basic60ValidationCounts(BaseModel):
    """Frozen BASIC60 V1 machine counts emitted by the readiness validator."""

    model_config = ConfigDict(extra="forbid")

    country_count: Literal[60]
    macro_annual_record_count: Literal[300]
    energy_latest_record_count: Literal[60]
    available_observation_count: Literal[2279]
    pending_observation_count: Literal[61]


class Basic60ValidationReport(BaseModel):
    """Strict final validator output; it is evidence binding, not a digital signature."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    profile_id: Literal["basic60_private"]
    release_id: Literal["BASIC60-PRIVATE-R1"]
    status: Literal["private_trial_ready"]
    ready: Literal[True]
    formal_gate_status: Literal["pending"]
    does_not_complete_formal_d1_d4: Literal[True]
    does_not_authorize_p0_or_production: Literal[True]
    release_bundle_sha256: str
    machine_counts: Basic60ValidationCounts
    checks: list[dict[str, object]]
    raw_root_sha256: str | None = None
    raw_file_count: int | None = Field(default=None, ge=1)
    excluded_zone_identifier_count: int | None = Field(default=None, ge=0)

    @field_validator("release_bundle_sha256", "raw_root_sha256")
    @classmethod
    def validate_hashes(cls, value: str | None, info: object) -> str | None:
        if value is None:
            return None
        normalized = value.lower()
        if len(normalized) != 64 or any(
            character not in "0123456789abcdef" for character in normalized
        ):
            field_name = getattr(info, "field_name", "digest")
            raise ValueError(f"{field_name} must be a SHA-256 digest")
        return normalized

    @field_validator("checks")
    @classmethod
    def validate_no_open_checks(cls, value: list[dict[str, object]]) -> list[dict[str, object]]:
        if value:
            raise ValueError("private_trial_ready validation report checks must be empty")
        return value


class Basic60RuntimeAttestationClaims(BaseModel):
    """Exact release artifacts authenticated by the machine-validation trust root."""

    model_config = ConfigDict(extra="forbid")

    release_id: Literal["BASIC60-PRIVATE-R1"]
    release_profile: Literal["basic60_private"]
    validation_report_sha256: str
    release_bundle_sha256: str
    seed_artifact_sha256: str
    release_authorization_sha256: str

    @field_validator(
        "validation_report_sha256",
        "release_bundle_sha256",
        "seed_artifact_sha256",
        "release_authorization_sha256",
    )
    @classmethod
    def validate_digest(cls, value: str) -> str:
        normalized = value.lower()
        if len(normalized) != 64 or any(
            character not in "0123456789abcdef" for character in normalized
        ):
            raise ValueError("runtime attestation claims must contain SHA-256 digests")
        return normalized


class Basic60RuntimeAttestation(BaseModel):
    """Machine-generated HMAC attestation; this is not a human signature."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["basic60.runtime-attestation.v1"]
    artifact_kind: Literal["machine_validation_attestation"]
    algorithm: Literal["HMAC-SHA256"]
    claims: Basic60RuntimeAttestationClaims
    mac_sha256: str

    @field_validator("mac_sha256")
    @classmethod
    def validate_mac(cls, value: str) -> str:
        normalized = value.lower()
        if len(normalized) != 64 or any(
            character not in "0123456789abcdef" for character in normalized
        ):
            raise ValueError("runtime attestation MAC must be a SHA-256 digest")
        return normalized


def _runtime_attestation_message(claims: Basic60RuntimeAttestationClaims) -> bytes:
    return json.dumps(
        claims.model_dump(),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def validate_basic60_decision(settings: Basic60Settings) -> Basic60Decision | None:
    """Validate the track-level PBD without binding a future release bundle."""

    if settings.candidate_only:
        return None
    if settings.decision_path is None or settings.decision_sha256 is None:
        raise Basic60GovernanceError("BASIC60 decision path and SHA-256 are required")

    payload = _read_verified(
        settings.decision_path,
        settings.decision_sha256,
        label="decision",
    )
    try:
        decision = Basic60Decision.model_validate_json(payload)
    except ValueError as exc:
        raise Basic60GovernanceError(f"BASIC60 decision is invalid: {exc}") from exc

    now = datetime.now(UTC)
    if decision.effective_from.astimezone(UTC) > now:
        raise Basic60GovernanceError("BASIC60 decision is not effective yet")
    return decision


def validate_basic60_activation(
    settings: Basic60Settings,
    *,
    release_id: str,
    release_bundle_sha256: str,
    validation_report_sha256: str,
    seed_artifact_sha256: str,
) -> tuple[Basic60Decision, Basic60ReleaseAuthorization, Basic60ValidationReport]:
    """Bind PBD, strict output, authorization, seed, HMAC proof, and active release."""

    decision = validate_basic60_decision(settings)
    if decision is None:
        raise Basic60GovernanceError("Candidate-only mode cannot activate or expose BASIC60 data")
    if settings.validation_report_path is None or settings.validation_report_sha256 is None:
        raise Basic60GovernanceError("BASIC60 validation report path and SHA-256 are required")
    report_payload = _read_verified(
        settings.validation_report_path,
        settings.validation_report_sha256,
        label="validation report",
    )
    try:
        validation_report = Basic60ValidationReport.model_validate_json(report_payload)
    except ValueError as exc:
        raise Basic60GovernanceError(f"BASIC60 validation report is invalid: {exc}") from exc

    report_expected = {
        "release_id": (validation_report.release_id, release_id),
        "release_bundle_sha256": (
            validation_report.release_bundle_sha256,
            release_bundle_sha256.lower(),
        ),
        "validation_report_sha256": (
            settings.validation_report_sha256.lower(),
            validation_report_sha256.lower(),
        ),
    }
    report_mismatched = [
        field for field, (actual, wanted) in report_expected.items() if actual != wanted
    ]
    if report_mismatched:
        raise Basic60GovernanceError(
            "BASIC60 validation report binding mismatch: " + ", ".join(report_mismatched)
        )
    if settings.release_authorization_path is None or settings.release_authorization_sha256 is None:
        raise Basic60GovernanceError("BASIC60 release authorization path and SHA-256 are required")
    payload = _read_verified(
        settings.release_authorization_path,
        settings.release_authorization_sha256,
        label="release authorization",
    )
    try:
        authorization = Basic60ReleaseAuthorization.model_validate_json(payload)
    except ValueError as exc:
        raise Basic60GovernanceError(f"BASIC60 release authorization is invalid: {exc}") from exc

    now = datetime.now(UTC)
    if authorization.approved_at.astimezone(UTC) > now:
        raise Basic60GovernanceError("BASIC60 release authorization is not effective yet")
    expected = {
        "release_id": (authorization.release_id, release_id),
        "release_bundle_sha256": (
            authorization.release_bundle_sha256,
            release_bundle_sha256.lower(),
        ),
        "validation_report_sha256": (
            authorization.validation_report_sha256,
            validation_report_sha256.lower(),
        ),
        "seed_artifact_sha256": (
            authorization.seed_artifact_sha256,
            seed_artifact_sha256.lower(),
        ),
    }
    mismatched = [field for field, (actual, wanted) in expected.items() if actual != wanted]
    if mismatched:
        raise Basic60GovernanceError(
            "BASIC60 release authorization binding mismatch: " + ", ".join(mismatched)
        )

    if (
        settings.runtime_attestation_path is None
        or settings.runtime_attestation_sha256 is None
        or settings.runtime_attestation_key is None
    ):
        raise Basic60GovernanceError(
            "BASIC60 runtime attestation path, SHA-256, and trust key are required"
        )
    try:
        runtime_attestation_key = validate_runtime_attestation_key(settings.runtime_attestation_key)
    except ValueError as exc:
        raise Basic60GovernanceError(str(exc)) from exc
    attestation_payload = _read_verified(
        settings.runtime_attestation_path,
        settings.runtime_attestation_sha256,
        label="runtime attestation",
    )
    try:
        attestation = Basic60RuntimeAttestation.model_validate_json(attestation_payload)
    except ValueError as exc:
        raise Basic60GovernanceError(f"BASIC60 runtime attestation is invalid: {exc}") from exc

    expected_mac = hmac.new(
        runtime_attestation_key.encode("utf-8"),
        _runtime_attestation_message(attestation.claims),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(attestation.mac_sha256, expected_mac):
        raise Basic60GovernanceError("BASIC60 runtime attestation MAC is invalid")

    attestation_expected = {
        "release_id": (attestation.claims.release_id, release_id),
        "release_profile": (attestation.claims.release_profile, "basic60_private"),
        "release_bundle_sha256": (
            attestation.claims.release_bundle_sha256,
            release_bundle_sha256.lower(),
        ),
        "validation_report_sha256": (
            attestation.claims.validation_report_sha256,
            validation_report_sha256.lower(),
        ),
        "seed_artifact_sha256": (
            attestation.claims.seed_artifact_sha256,
            seed_artifact_sha256.lower(),
        ),
        "release_authorization_sha256": (
            attestation.claims.release_authorization_sha256,
            settings.release_authorization_sha256.lower(),
        ),
    }
    attestation_mismatched = [
        field for field, (actual, wanted) in attestation_expected.items() if actual != wanted
    ]
    if attestation_mismatched:
        raise Basic60GovernanceError(
            "BASIC60 runtime attestation binding mismatch: " + ", ".join(attestation_mismatched)
        )
    return decision, authorization, validation_report
