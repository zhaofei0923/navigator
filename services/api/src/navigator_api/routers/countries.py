"""Country discovery and comparison endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from navigator_api.database import get_session
from navigator_api.schemas import (
    ComparisonRequest,
    ComparisonResult,
    CountryDetail,
    CountrySummary,
    DemoMeta,
    DemoResponse,
)
from navigator_api.service import (
    compare_countries,
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
def get_countries(session: SessionDependency) -> DemoResponse[list[CountrySummary]]:
    data = [country_summary(country) for country in list_countries(session)]
    return DemoResponse(meta=DemoMeta(result_count=len(data)), data=data)


@router.get(
    "/countries/{country_code}",
    response_model=DemoResponse[CountryDetail],
    operation_id="API-COUNTRY-002",
)
def get_country(country_code: str, session: SessionDependency) -> DemoResponse[CountryDetail]:
    data = country_detail(get_country_detail(session, country_code))
    return DemoResponse(meta=DemoMeta(result_count=1), data=data)


@router.post(
    "/country-comparisons",
    response_model=DemoResponse[ComparisonResult],
    operation_id="API-COMPARE-001",
)
def create_country_comparison(
    request: ComparisonRequest, session: SessionDependency
) -> DemoResponse[ComparisonResult]:
    data = compare_countries(session, request.country_codes)
    return DemoResponse(meta=DemoMeta(result_count=len(data.countries)), data=data)
