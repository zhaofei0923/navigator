"""Fail-closed runtime configuration for the isolated BASIC60 private trial."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from navigator_api.config import _cors_origins, _required_env

RUNTIME_ATTESTATION_KEY_ENV = "BASIC60_RUNTIME_ATTESTATION_KEY"
RUNTIME_ATTESTATION_KEY_MIN_BYTES = 32
RUNTIME_ATTESTATION_FORBIDDEN_KEYS = frozenset(
    {
        "replace-me",
        "replace-with-at-least-32-random-bytes",
        "test-runtime-attestation-key-with-32-bytes",
        "basic60-test-runtime-attestation-key-32-bytes",
    }
)
RUNTIME_ATTESTATION_FORBIDDEN_MARKERS = (
    "changeme",
    "example-value",
    "placeholder",
    "replace-with",
)


def validate_runtime_attestation_key(value: str | None) -> str:
    """Reject missing, weak, and repository-known example trust keys."""

    candidate = value or ""
    folded = candidate.casefold()
    if candidate in RUNTIME_ATTESTATION_FORBIDDEN_KEYS or any(
        marker in folded for marker in RUNTIME_ATTESTATION_FORBIDDEN_MARKERS
    ):
        raise ValueError(
            f"{RUNTIME_ATTESTATION_KEY_ENV} must not use a known placeholder or example value"
        )
    if len(candidate.encode("utf-8")) < RUNTIME_ATTESTATION_KEY_MIN_BYTES:
        raise ValueError(
            f"{RUNTIME_ATTESTATION_KEY_ENV} must contain at least "
            f"{RUNTIME_ATTESTATION_KEY_MIN_BYTES} UTF-8 bytes"
        )
    return candidate


def _bool_env(name: str, *, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes"}


@dataclass(frozen=True, slots=True)
class Basic60Settings:
    """Settings that cannot silently fall back to the synthetic-demo runtime."""

    database_url: str
    api_key: str
    cors_origins: tuple[str, ...]
    seed_path: Path = Path("runtime/basic60/basic60_seed.json")
    market_content_root: Path | None = None
    decision_path: Path | None = None
    decision_sha256: str | None = None
    release_authorization_path: Path | None = None
    release_authorization_sha256: str | None = None
    validation_report_path: Path | None = None
    validation_report_sha256: str | None = None
    runtime_attestation_path: Path | None = None
    runtime_attestation_sha256: str | None = None
    runtime_attestation_key: str | None = field(default=None, repr=False)
    candidate_only: bool = False
    auto_create_schema: bool = False
    auto_import_seed: bool = False
    enforce_baseline_counts: bool = True

    @classmethod
    def from_env(cls) -> Basic60Settings:
        candidate_only = _bool_env("BASIC60_CANDIDATE_ONLY")
        decision_path_raw = os.getenv("BASIC60_DECISION_PATH", "").strip()
        decision_sha256 = os.getenv("BASIC60_DECISION_SHA256", "").strip().lower()
        release_authorization_path_raw = os.getenv("BASIC60_RELEASE_AUTHORIZATION_PATH", "").strip()
        release_authorization_sha256 = (
            os.getenv("BASIC60_RELEASE_AUTHORIZATION_SHA256", "").strip().lower()
        )
        validation_report_path_raw = os.getenv("BASIC60_VALIDATION_REPORT_PATH", "").strip()
        validation_report_sha256 = os.getenv("BASIC60_VALIDATION_REPORT_SHA256", "").strip().lower()
        runtime_attestation_path_raw = os.getenv("BASIC60_RUNTIME_ATTESTATION_PATH", "").strip()
        runtime_attestation_sha256 = (
            os.getenv("BASIC60_RUNTIME_ATTESTATION_SHA256", "").strip().lower()
        )
        runtime_attestation_key = os.getenv(RUNTIME_ATTESTATION_KEY_ENV)
        market_content_root_raw = os.getenv("BASIC60_MARKET_CONTENT_ROOT", "").strip()
        if not candidate_only and not decision_path_raw:
            raise RuntimeError("Required environment variable BASIC60_DECISION_PATH is not set")
        if not candidate_only and len(decision_sha256) != 64:
            raise RuntimeError("BASIC60_DECISION_SHA256 must be a 64-character SHA-256 digest")
        if not candidate_only and not release_authorization_path_raw:
            raise RuntimeError(
                "Required environment variable BASIC60_RELEASE_AUTHORIZATION_PATH is not set"
            )
        if not candidate_only and len(release_authorization_sha256) != 64:
            raise RuntimeError(
                "BASIC60_RELEASE_AUTHORIZATION_SHA256 must be a 64-character SHA-256 digest"
            )
        if not candidate_only and not validation_report_path_raw:
            raise RuntimeError(
                "Required environment variable BASIC60_VALIDATION_REPORT_PATH is not set"
            )
        if not candidate_only and len(validation_report_sha256) != 64:
            raise RuntimeError(
                "BASIC60_VALIDATION_REPORT_SHA256 must be a 64-character SHA-256 digest"
            )
        if not candidate_only and not runtime_attestation_path_raw:
            raise RuntimeError(
                "Required environment variable BASIC60_RUNTIME_ATTESTATION_PATH is not set"
            )
        if not candidate_only and len(runtime_attestation_sha256) != 64:
            raise RuntimeError(
                "BASIC60_RUNTIME_ATTESTATION_SHA256 must be a 64-character SHA-256 digest"
            )
        if runtime_attestation_key is not None or not candidate_only:
            try:
                runtime_attestation_key = validate_runtime_attestation_key(runtime_attestation_key)
            except ValueError as exc:
                raise RuntimeError(str(exc)) from exc
        return cls(
            database_url=_required_env("BASIC60_DATABASE_URL"),
            api_key=_required_env("BASIC60_API_KEY"),
            cors_origins=_cors_origins(
                os.getenv(
                    "BASIC60_CORS_ORIGINS",
                    "http://localhost:3000,http://127.0.0.1:3000",
                )
            ),
            seed_path=Path(os.getenv("BASIC60_SEED_PATH", "runtime/basic60/basic60_seed.json")),
            market_content_root=Path(market_content_root_raw) if market_content_root_raw else None,
            decision_path=Path(decision_path_raw) if decision_path_raw else None,
            decision_sha256=decision_sha256 or None,
            release_authorization_path=(
                Path(release_authorization_path_raw) if release_authorization_path_raw else None
            ),
            release_authorization_sha256=release_authorization_sha256 or None,
            validation_report_path=(
                Path(validation_report_path_raw) if validation_report_path_raw else None
            ),
            validation_report_sha256=validation_report_sha256 or None,
            runtime_attestation_path=(
                Path(runtime_attestation_path_raw) if runtime_attestation_path_raw else None
            ),
            runtime_attestation_sha256=runtime_attestation_sha256 or None,
            runtime_attestation_key=runtime_attestation_key,
            candidate_only=candidate_only,
            auto_create_schema=_bool_env("BASIC60_AUTO_CREATE_SCHEMA"),
            auto_import_seed=_bool_env("BASIC60_AUTO_IMPORT_SEED"),
            enforce_baseline_counts=_bool_env("BASIC60_ENFORCE_BASELINE_COUNTS", default=True),
        )
