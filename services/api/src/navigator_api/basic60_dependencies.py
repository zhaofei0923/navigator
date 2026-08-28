"""Authentication and release-binding dependencies for BASIC60 routes."""

from __future__ import annotations

import hmac
from typing import Annotated, cast

from fastapi import Header, Request

from navigator_api.basic60_config import Basic60Settings
from navigator_api.basic60_errors import Basic60APIError


def require_private_trial_key(
    request: Request,
    x_private_trial_key: Annotated[str | None, Header(alias="X-Private-Trial-Key")] = None,
) -> None:
    settings = cast(Basic60Settings, request.app.state.settings)
    supplied = x_private_trial_key or ""
    if not supplied or not hmac.compare_digest(supplied, settings.api_key):
        raise Basic60APIError(
            status_code=401,
            code="PRIVATE_TRIAL_KEY_REQUIRED",
            message="需要有效的 X-Private-Trial-Key 才能访问 BASIC60 私有试用接口。",
        )
