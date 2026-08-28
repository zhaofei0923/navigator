"""Read-only country discovery and detail endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from navigator_api.database import get_session
from navigator_api.localization import disclaimer_for
from navigator_api.schemas import (
    CountryDetail,
    CountrySummary,
    DemoMeta,
    DemoResponse,
    Locale,
)
from navigator_api.service import (
    country_detail,
    country_summary,
    get_country_detail,
    list_countries,
)

router = APIRouter(tags=["countries"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get(
    "/countries",
    response_model=DemoResponse[list[CountrySummary]],
    operation_id="API-COUNTRY-001",
)
def get_countries(
    session: SessionDependency, locale: Locale = "zh-CN"
) -> DemoResponse[list[CountrySummary]]:
    data = [country_summary(country, locale) for country in list_countries(session)]
    return DemoResponse(
        meta=DemoMeta(locale=locale, disclaimer=disclaimer_for(locale), result_count=len(data)),
        data=data,
    )


@router.get(
    "/countries/{country_code}",
    response_model=DemoResponse[CountryDetail],
    operation_id="API-COUNTRY-002",
)
def get_country(
    country_code: str, session: SessionDependency, locale: Locale = "zh-CN"
) -> DemoResponse[CountryDetail]:
    data = country_detail(get_country_detail(session, country_code), locale)
    return DemoResponse(
        meta=DemoMeta(locale=locale, disclaimer=disclaimer_for(locale), result_count=1), data=data
    )
