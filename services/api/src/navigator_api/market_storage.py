"""Read-only access to the separately published immutable market-content volume."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from navigator_api.market_schemas import CountryMarketContent, CountryMarketOverview

MAX_CONTENT_BYTES = 16 * 1024 * 1024
MAX_BATCH_BYTES = 128 * 1024 * 1024
SHA_PATTERN = re.compile(r"^[a-f0-9]{64}$")
VERSION_PATTERN = re.compile(r"^(?:MARKET|OVERVIEW)-[A-Z]{3}-\d{8}-R[1-9]\d*$")


class MarketContentError(ValueError):
    """An internal diagnostic. Never send its text to a public API response."""


class MarketContentUnavailable(MarketContentError):
    pass


def canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def content_sha256(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise MarketContentError("duplicate JSON keys are not permitted")
        result[key] = value
    return result


def _reject_nonfinite(value: str) -> None:
    raise MarketContentError("non-finite JSON numbers are not permitted")


def ensure_no_symlinks(path: Path) -> None:
    for item in (path, *path.parents):
        if item.is_symlink():
            raise MarketContentError("symbolic links are not permitted in market-content paths")


def checked_path(root: Path, *parts: str) -> Path:
    ensure_no_symlinks(root)
    candidate = root.joinpath(*parts)
    ensure_no_symlinks(candidate)
    if not candidate.resolve().is_relative_to(root.resolve()):
        raise MarketContentError("market-content path escapes its configured root")
    return candidate


def read_json(
    path: Path, *, expected_sha256: str | None = None, max_bytes: int = MAX_CONTENT_BYTES
) -> dict[str, Any]:
    ensure_no_symlinks(path)
    if not path.is_file() or path.stat().st_size > max_bytes:
        raise MarketContentError("missing or oversized market-content file")
    payload = path.read_bytes()
    if expected_sha256 is not None and hashlib.sha256(payload).hexdigest() != expected_sha256:
        raise MarketContentError("market-content file hash mismatch")
    try:
        parsed: object = json.loads(
            payload, object_pairs_hook=_unique_object, parse_constant=_reject_nonfinite
        )
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise MarketContentError("invalid market-content JSON") from exc
    if not isinstance(parsed, dict):
        raise MarketContentError("market-content file must be a JSON object")
    return parsed


def checked_sha(value: object) -> str:
    if not isinstance(value, str) or not SHA_PATTERN.fullmatch(value):
        raise MarketContentError("invalid market-content SHA-256 reference")
    return value


def load_market_state(root: Path) -> tuple[dict[str, Any], str | None]:
    pointer_path = checked_path(root, "current.json")
    if not pointer_path.exists():
        return {
            "schema_version": "navigator.market-state.v1",
            "generation": 0,
            "active": {},
            "revoked": [],
            "previous_sha256": None,
        }, None
    pointer = read_json(pointer_path)
    if (
        set(pointer) != {"schema_version", "manifest_sha256"}
        or pointer.get("schema_version") != "navigator.market-pointer.v1"
    ):
        raise MarketContentError("invalid market-content active pointer")
    digest = checked_sha(pointer.get("manifest_sha256"))
    state = read_json(checked_path(root, "manifests", f"{digest}.json"), expected_sha256=digest)
    if (
        state.get("schema_version") != "navigator.market-state.v1"
        or type(state.get("generation")) is not int
        or state["generation"] < 1
        or not isinstance(state.get("active"), dict)
        or not isinstance(state.get("revoked"), list)
    ):
        raise MarketContentError("invalid market-content state manifest")
    if any(
        not isinstance(code, str)
        or not re.fullmatch(r"[A-Z]{3}", code)
        or code == "CHN"
        or not isinstance(version, str)
        or not VERSION_PATTERN.fullmatch(version)
        for code, version in state["active"].items()
    ) or any(
        not isinstance(version, str) or not VERSION_PATTERN.fullmatch(version)
        for version in state["revoked"]
    ):
        raise MarketContentError("invalid versions in market-content manifest")
    return state, digest


def load_published_version(
    root: Path, version: str
) -> CountryMarketContent | CountryMarketOverview:
    """Validate historical objects; callers must explicitly require the public schema."""
    if not VERSION_PATTERN.fullmatch(version) or len(version) > 80:
        raise MarketContentError("invalid content version")
    if checked_path(root, "revocations", f"{version}.json").exists():
        raise MarketContentUnavailable("this content version was revoked")
    release = read_json(checked_path(root, "releases", f"{version}.json"))
    if (
        release.get("schema_version") != "navigator.market-release.v1"
        or release.get("content_version") != version
    ):
        raise MarketContentError("invalid published market release")
    object_hash = checked_sha(release.get("object_sha256"))
    confirmation_hash = checked_sha(release.get("confirmation_sha256"))
    confirmation = read_json(
        checked_path(root, "confirmations", f"{confirmation_hash}.json"),
        expected_sha256=confirmation_hash,
    )
    if (
        confirmation.get("schema_version") != "navigator.market-confirmation.v1"
        or confirmation.get("decision") != "approved"
        or confirmation.get("approved_by") != "kevin"
        or confirmation.get("package_id") != release.get("package_id")
        or confirmation.get("candidate_sha256") != release.get("candidate_sha256")
        or confirmation.get("workbook_sha256") != release.get("workbook_sha256")
    ):
        raise MarketContentError("published version is not bound to its human confirmation")
    batch_hash = checked_sha(release.get("candidate_sha256"))
    batch = read_json(
        checked_path(root, "batches", f"{batch_hash}.json"),
        expected_sha256=batch_hash,
        max_bytes=MAX_BATCH_BYTES,
    )
    if (
        set(batch) != {"schema_version", "package_id", "countries"}
        or batch.get("schema_version") != "navigator.market-candidate.v1"
        or batch.get("package_id") != release.get("package_id")
        or not isinstance(batch.get("countries"), list)
    ):
        raise MarketContentError("invalid confirmed market-content batch")
    matched = [
        item
        for item in batch["countries"]
        if isinstance(item, dict) and item.get("content_version") == version
    ]
    if len(matched) != 1 or content_sha256(matched[0]) != object_hash:
        raise MarketContentError("content object is outside the human-confirmed batch")
    payload = read_json(
        checked_path(root, "objects", f"{object_hash}.json"), expected_sha256=object_hash
    )
    try:
        content: CountryMarketContent | CountryMarketOverview
        if payload.get("schema_version") == "navigator.market-overview.v1":
            content = CountryMarketOverview.model_validate(payload)
        else:
            content = CountryMarketContent.model_validate(payload)
    except ValueError as exc:
        raise MarketContentError("published market content violates its contract") from exc
    if content.content_version != version or content.country_code != release.get("country_code"):
        raise MarketContentError("published version identifies different content")
    return content


def read_active_market_content(root: Path | None, country_code: str) -> CountryMarketOverview:
    if root is None:
        raise MarketContentUnavailable("market content is not configured")
    state, _ = load_market_state(root)
    version = state["active"].get(country_code)
    if version is None or version in state["revoked"]:
        raise MarketContentUnavailable("no published market content for country")
    if not isinstance(version, str):
        raise MarketContentError("invalid active market-content version")
    content = load_published_version(root, version)
    if content.country_code != country_code:
        raise MarketContentError("active version belongs to another country")
    if not isinstance(content, CountryMarketOverview):
        raise MarketContentUnavailable("the active historical content type is retired")
    return content
