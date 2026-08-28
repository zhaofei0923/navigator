"""The country list and detail routes exposed by the BASIC60 private runtime."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from navigator_api.basic60_models import Basic60Release
from navigator_api.basic60_schemas import (
    Basic60Meta,
    Basic60Response,
    CountryDetail,
    CountrySummary,
)
from navigator_api.basic60_service import (
    country_detail,
    country_summary,
    effective_as_of,
    get_active_release,
    get_active_source_refs,
    get_country,
    list_countries,
    validated_expansions,
)
from navigator_api.database import get_session

router = APIRouter(tags=["basic60-countries"])
SessionDependency = Annotated[Session, Depends(get_session)]


def _release(session: Session, request: Request) -> Basic60Release:
    authorized_release_id = cast(str, request.app.state.authorized_release_id)
    return get_active_release(session, authorized_release_id)


@router.get(
    "/countries",
    response_model=Basic60Response[list[CountrySummary]],
    operation_id="API-COUNTRY-001",
)
def get_countries(
    request: Request,
    session: SessionDependency,
    q: Annotated[str | None, Query(max_length=160)] = None,
    region: Annotated[str | None, Query(max_length=40)] = None,
    coverage_level: Literal["Basic"] = "Basic",
    as_of: date | None = None,
    cursor: Annotated[str | None, Query(min_length=3, max_length=3)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    locale: Literal["zh-CN", "en"] = "zh-CN",
) -> Basic60Response[list[CountrySummary]]:
    del coverage_level
    release = _release(session, request)
    active_source_refs = get_active_source_refs(session, release.release_id)
    selected_as_of = effective_as_of(release, as_of)
    countries, next_cursor = list_countries(
        session,
        release=release,
        query=q,
        region=region,
        cursor=cursor,
        limit=limit,
        active_source_refs=active_source_refs,
    )
    data = [
        country_summary(country, selected_as_of, locale, active_source_refs)
        for country in countries
    ]
    return Basic60Response(
        meta=Basic60Meta(
            release_id=release.release_id,
            as_of=selected_as_of,
            result_count=len(data),
            next_cursor=next_cursor,
        ),
        data=data,
    )


@router.get(
    "/countries/{country_code}",
    response_model=Basic60Response[CountryDetail],
    response_model_exclude_none=True,
    operation_id="API-COUNTRY-002",
)
def get_country_detail(
    country_code: str,
    request: Request,
    session: SessionDependency,
    expand: str = "identity,macro,energy",
    as_of: date | None = None,
    locale: Literal["zh-CN", "en"] = "zh-CN",
) -> Basic60Response[CountryDetail]:
    release = _release(session, request)
    active_source_refs = get_active_source_refs(session, release.release_id)
    selected_as_of = effective_as_of(release, as_of)
    country = get_country(
        session,
        release=release,
        country_code=country_code,
        active_source_refs=active_source_refs,
    )
    data = country_detail(
        session,
        release=release,
        country=country,
        as_of=selected_as_of,
        locale=locale,
        expansions=validated_expansions(expand),
        active_source_refs=active_source_refs,
    )
    return Basic60Response(
        meta=Basic60Meta(
            release_id=release.release_id,
            as_of=selected_as_of,
            result_count=1,
        ),
        data=data,
    )
