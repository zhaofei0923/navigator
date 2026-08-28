"""Machine bindings for the single approved Zambia extension, separate from BASIC60 R1."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import UTC, date, datetime
from pathlib import PurePosixPath
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from navigator_api.basic60_config import Basic60Settings, validate_runtime_attestation_key
from navigator_api.basic60_governance import (
    Basic60Decision,
    Basic60GovernanceError,
    _read_verified,
    validate_basic60_decision,
)
from navigator_api.basic60_seed_contract import SeedModel, _sha256


def _approval_date(value: str) -> date:
    """Accept the actual confirmation precision without manufacturing a signing time."""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return date.fromisoformat(value)
    approved = datetime.fromisoformat(value)
    if "T" not in value or approved.tzinfo is None or approved.utcoffset() is None:
        raise ValueError("approval must be an ISO date or timezone-aware ISO datetime")
    if approved > datetime.now(UTC):
        raise ValueError("approval cannot be in the future")
    return approved.date()


class Basic61ExtensionEvidence(SeedModel):
    extension_id: str = Field(pattern=r"^COUNTRY-EXT-ZMB-\d{8}-R[1-9]\d*$")
    added_country_code: Literal["ZMB"]
    parent_seed_sha256: str
    candidate_sha256: str
    workbook_sha256: str
    confirmation_sha256: str

    @field_validator(
        "parent_seed_sha256", "candidate_sha256", "workbook_sha256", "confirmation_sha256"
    )
    @classmethod
    def validate_digest(cls, value: str, info: Any) -> str:
        return _sha256(value, str(info.field_name))


class Basic61ValidationCounts(SeedModel):
    country_count: Literal[61]
    macro_annual_record_count: Literal[305]
    energy_latest_record_count: Literal[61]
    available_observation_count: Literal[2317]
    pending_observation_count: Literal[62]


class Basic61ValidationReport(SeedModel):
    schema_version: Literal["basic61.validation-report.v1"]
    profile_id: Literal["basic60_private"]
    release_id: Literal["BASIC61-PRIVATE-R1"]
    status: Literal["private_trial_ready"]
    ready: Literal[True]
    formal_gate_status: Literal["pending"]
    no_formal_d1_d4_changes: Literal[True]
    no_production_release_claim: Literal[True]
    bundle_sha256: str
    machine_counts: Basic61ValidationCounts
    checks: list[dict[str, Any]]
    extension: Basic61ExtensionEvidence

    @field_validator("bundle_sha256")
    @classmethod
    def validate_digest(cls, value: str) -> str:
        return _sha256(value, "bundle_sha256")

    @field_validator("checks")
    @classmethod
    def validate_checks(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if value:
            raise ValueError("a ready Zambia extension cannot contain open machine checks")
        return value


class Basic61FileReference(SeedModel):
    path: str = Field(min_length=1, max_length=512)
    sha256: str

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        path = PurePosixPath(value)
        if (
            path.is_absolute()
            or ".." in path.parts
            or ":" in value
            or "\\" in value
            or "\x00" in value
            or path.as_posix() != value
        ):
            raise ValueError("extension evidence references must be canonical repository paths")
        return value

    @field_validator("sha256")
    @classmethod
    def validate_digest(cls, value: str) -> str:
        return _sha256(value, "sha256")


class Basic61ReleaseAuthorization(SeedModel):
    schema_version: Literal["basic61.release-authorization.v1"]
    release_id: Literal["BASIC61-PRIVATE-R1"]
    release_profile: Literal["basic60_private"]
    status: Literal["private_trial_ready"]
    formal_gate_status: Literal["pending"]
    release_bundle_sha256: str
    validation_report_sha256: str
    seed_artifact_sha256: str
    approved_at: str
    approved_by: Literal["kevin"]
    pbd_decision_id: Literal["PBD-BASIC60-PRIVATE-001"]
    review_scope: Literal["added_country_data_sources_and_overview"]
    reviewed_workbook: Basic61FileReference
    confirmation: Basic61FileReference
    extension: Basic61ExtensionEvidence
    no_formal_d1_d4_changes: Literal[True]
    no_production_release_claim: Literal[True]

    @field_validator("release_bundle_sha256", "validation_report_sha256", "seed_artifact_sha256")
    @classmethod
    def validate_digest(cls, value: str, info: Any) -> str:
        return _sha256(value, str(info.field_name))

    @field_validator("approved_at")
    @classmethod
    def validate_approval(cls, value: str) -> str:
        if _approval_date(value) > datetime.now(UTC).date():
            raise ValueError("approval cannot be in the future")
        return value

    @model_validator(mode="after")
    def validate_review_bindings(self) -> Basic61ReleaseAuthorization:
        workbook = PurePosixPath(self.reviewed_workbook.path)
        confirmation = PurePosixPath(self.confirmation.path)
        if not workbook.is_relative_to("outputs") or workbook.suffix != ".xlsx":
            raise ValueError(
                "the added-country review must reference its actual Excel under outputs"
            )
        if confirmation.suffix != ".json" or not (
            confirmation.is_relative_to("runtime")
            or confirmation.is_relative_to("data/governance/evidence")
        ):
            raise ValueError("the added-country confirmation must reference its recorded JSON")
        if self.reviewed_workbook.sha256 != self.extension.workbook_sha256:
            raise ValueError("the authorization must bind the same reviewed Excel as the extension")
        if self.confirmation.sha256 != self.extension.confirmation_sha256:
            raise ValueError("the authorization must bind the same actual user confirmation")
        return self


class Basic61RuntimeAttestationClaims(SeedModel):
    release_id: Literal["BASIC61-PRIVATE-R1"]
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
    def validate_digest(cls, value: str, info: Any) -> str:
        return _sha256(value, str(info.field_name))


class Basic61RuntimeAttestation(SeedModel):
    schema_version: Literal["basic61.runtime-attestation.v1"]
    artifact_kind: Literal["machine_validation_attestation"]
    algorithm: Literal["HMAC-SHA256"]
    claims: Basic61RuntimeAttestationClaims
    mac_sha256: str

    @field_validator("mac_sha256")
    @classmethod
    def validate_digest(cls, value: str) -> str:
        return _sha256(value, "mac_sha256")


def validate_basic61_activation(
    settings: Basic60Settings,
    *,
    release_id: str,
    release_bundle_sha256: str,
    validation_report_sha256: str,
    seed_artifact_sha256: str,
) -> tuple[Basic60Decision, Basic61ReleaseAuthorization, Basic61ValidationReport]:
    decision = validate_basic60_decision(settings)
    if decision is None:
        raise Basic60GovernanceError("Candidate-only mode cannot expose a Zambia extension")
    required_files = (
        (settings.validation_report_path, settings.validation_report_sha256, "validation report"),
        (
            settings.release_authorization_path,
            settings.release_authorization_sha256,
            "authorization",
        ),
        (
            settings.runtime_attestation_path,
            settings.runtime_attestation_sha256,
            "runtime attestation",
        ),
    )
    payloads: list[bytes] = []
    for path, digest, label in required_files:
        if path is None or digest is None:
            raise Basic60GovernanceError(f"BASIC61 {label} path and SHA-256 are required")
        payloads.append(_read_verified(path, digest, label=f"BASIC61 {label}"))
    try:
        report = Basic61ValidationReport.model_validate_json(payloads[0])
        authorization = Basic61ReleaseAuthorization.model_validate_json(payloads[1])
        attestation = Basic61RuntimeAttestation.model_validate_json(payloads[2])
        trust_key = validate_runtime_attestation_key(settings.runtime_attestation_key)
    except ValueError as exc:
        raise Basic60GovernanceError(f"BASIC61 activation evidence is invalid: {exc}") from exc

    expected = {
        "release_id": release_id,
        "release_profile": "basic60_private",
        "release_bundle_sha256": release_bundle_sha256.lower(),
        "validation_report_sha256": validation_report_sha256.lower(),
        "seed_artifact_sha256": seed_artifact_sha256.lower(),
        "release_authorization_sha256": hashlib.sha256(payloads[1]).hexdigest(),
    }
    if attestation.claims.model_dump() != expected:
        raise Basic60GovernanceError("BASIC61 runtime attestation binding mismatch")
    message = json.dumps(
        attestation.claims.model_dump(), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    expected_mac = hmac.new(trust_key.encode("utf-8"), message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(attestation.mac_sha256, expected_mac):
        raise Basic60GovernanceError("BASIC61 runtime attestation MAC is invalid")
    if (
        report.release_id != release_id
        or report.bundle_sha256 != expected["release_bundle_sha256"]
        or hashlib.sha256(payloads[0]).hexdigest() != expected["validation_report_sha256"]
        or report.extension != authorization.extension
        or any(
            getattr(authorization, field) != expected[field]
            for field in (
                "release_id",
                "release_profile",
                "release_bundle_sha256",
                "validation_report_sha256",
                "seed_artifact_sha256",
            )
        )
    ):
        raise Basic60GovernanceError("BASIC61 validation and authorization binding mismatch")
    return decision, authorization, report
