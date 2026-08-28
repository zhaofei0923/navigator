"""Country overview reader under the existing private API boundary."""

from __future__ import annotations

import logging
import re
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from navigator_api.basic60_config import Basic60Settings
from navigator_api.basic60_errors import Basic60APIError
from navigator_api.basic60_service import get_active_release, get_active_source_refs, get_country
from navigator_api.database import get_session
from navigator_api.market_schemas import (
    CountryMarketOverview,
    LocalizedMarketOverview,
    MarketContentMeta,
    MarketContentResponse,
    MarketLocale,
)
from navigator_api.market_storage import (
    MarketContentError,
    MarketContentUnavailable,
    read_active_market_content,
)

LOGGER = logging.getLogger(__name__)
router = APIRouter(tags=["country-market-content"])
SessionDependency = Annotated[Session, Depends(get_session)]


def _visible_country(country_code: str, request: Request, session: Session) -> str:
    if not re.fullmatch(r"[A-Za-z]{3}", country_code):
        raise Basic60APIError(status_code=404, code="COUNTRY_NOT_FOUND", message="国家不存在。")
    code = country_code.upper()
    release = get_active_release(session, cast(str, request.app.state.authorized_release_id))
    sources = get_active_source_refs(session, release.release_id)
    get_country(session, release=release, country_code=code, active_source_refs=sources)
    return code


def _content(country_code: str, request: Request, session: Session) -> CountryMarketOverview:
    code = _visible_country(country_code, request, session)
    settings = cast(Basic60Settings, request.app.state.settings)
    try:
        return read_active_market_content(settings.market_content_root, code)
    except MarketContentUnavailable as exc:
        raise Basic60APIError(
            status_code=404,
            code="MARKET_CONTENT_UNAVAILABLE",
            message="该国家的市场概况暂未发布。",
        ) from exc
    except (MarketContentError, OSError) as exc:
        LOGGER.warning("Market content unavailable for %s: %s", code, type(exc).__name__)
        raise Basic60APIError(
            status_code=503,
            code="MARKET_CONTENT_INVALID",
            message="市场概况暂时无法读取，请稍后重试。",
        ) from exc


@router.get(
    "/countries/{country_code}/market-overview",
    response_model=MarketContentResponse[LocalizedMarketOverview],
)
def market_overview(
    country_code: str,
    request: Request,
    session: SessionDependency,
    locale: MarketLocale = "zh-CN",
) -> MarketContentResponse[LocalizedMarketOverview]:
    content = _content(country_code, request, session)
    return MarketContentResponse(
        meta=MarketContentMeta(
            country_code=content.country_code,
            content_version=content.content_version,
            as_of=content.as_of,
            locale=locale,
        ),
        data=content.locales[locale],
    )


@router.get("/countries/{country_code}/market-analysis", include_in_schema=False)
@router.get("/countries/{country_code}/market-report", include_in_schema=False)
def retired_market_content(
    country_code: str,
    request: Request,
    session: SessionDependency,
) -> None:
    _visible_country(country_code, request, session)
    raise Basic60APIError(
        status_code=410,
        code="MARKET_CONTENT_RETIRED",
        message="原市场分析与国别报告接口已停用，请使用市场概况。",
    )
