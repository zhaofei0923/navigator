"""Request dependencies shared by all bounded-demo routers."""

from __future__ import annotations

import hmac
from typing import Annotated, cast

from fastapi import Header, Request

from navigator_api.config import Settings
from navigator_api.errors import DemoAPIError


def require_demo_key(
    request: Request,
    x_demo_key: Annotated[str | None, Header(alias="X-Demo-Key")] = None,
) -> None:
    settings = cast(Settings, request.app.state.settings)
    supplied = x_demo_key or ""
    if not supplied or not hmac.compare_digest(supplied, settings.demo_api_key):
        raise DemoAPIError(
            status_code=401,
            code="DEMO_KEY_REQUIRED",
            message="需要有效的 X-Demo-Key 才能访问内部演示接口。",
        )
