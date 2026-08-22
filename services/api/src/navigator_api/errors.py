"""Consistent API error types and response payloads."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from navigator_api.constants import DATA_ORIGIN, DISCLAIMER


@dataclass(slots=True)
class DemoAPIError(Exception):
    status_code: int
    code: str
    message: str
    details: Sequence[Mapping[str, Any]] | None = None


def error_payload(
    *, code: str, message: str, details: Sequence[Mapping[str, Any]] | None = None
) -> dict[str, object]:
    error: dict[str, object] = {"code": code, "message": message}
    if details:
        error["details"] = list(details)
    return {
        "meta": {"data_origin": DATA_ORIGIN, "disclaimer": DISCLAIMER},
        "error": error,
    }
