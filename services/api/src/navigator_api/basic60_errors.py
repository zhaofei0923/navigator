"""Error envelope for the isolated BASIC60 private-trial API."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any


@dataclass(slots=True)
class Basic60APIError(Exception):
    status_code: int
    code: str
    message: str
    details: Sequence[Mapping[str, Any]] | None = None


def basic60_error_payload(
    *,
    code: str,
    message: str,
    details: Sequence[Mapping[str, Any]] | None = None,
    release_id: str | None = None,
    as_of: date | None = None,
) -> dict[str, object]:
    error: dict[str, object] = {"code": code, "message": message}
    if details:
        error["details"] = list(details)
    return {
        "meta": {
            "release_id": release_id,
            "release_profile": "basic60_private",
            "formal_gate_status": "pending",
            "coverage_level": "Basic",
            "as_of": as_of.isoformat() if as_of is not None else None,
        },
        "error": error,
    }
