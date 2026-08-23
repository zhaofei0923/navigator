"""Read-only, bilingual endpoints for the accelerated internal demo tools."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from navigator_api.database import get_session
from navigator_api.demo_service import (
    assistant_preview,
    feasibility_report_preview,
    get_tool_tender,
    globe_markers,
    list_tool_tenders,
    solar_storage_preview,
)
from navigator_api.localization import disclaimer_for
from navigator_api.schemas import (
    AssistantPreview,
    AssistantPreviewRequest,
    ComparisonResult,
    DemoComparisonRequest,
    DemoMeta,
    DemoResponse,
    FeasibilityReportPreview,
    FeasibilityReportPreviewRequest,
    GlobeMarker,
    Locale,
    SolarStoragePreview,
    SolarStoragePreviewRequest,
    TenderItem,
)
from navigator_api.service import compare_countries

router = APIRouter(prefix="/demo", tags=["demo-expansion-tools"])
SessionDependency = Annotated[Session, Depends(get_session)]
CountryFilter = Annotated[
    str | None,
    Query(pattern=r"^[A-Za-z]{3}$", description="Optional ISO-style demo country code."),
]
ShortFilter = Annotated[str | None, Query(min_length=1, max_length=60)]
KeywordFilter = Annotated[str | None, Query(min_length=1, max_length=80)]
Limit = Annotated[int, Query(ge=1, le=100)]


def _meta(locale: Locale, result_count: int) -> DemoMeta:
    return DemoMeta(locale=locale, disclaimer=disclaimer_for(locale), result_count=result_count)


@router.get(
    "/globe-markers",
    response_model=DemoResponse[list[GlobeMarker]],
    operation_id="API-DEMO-GLOBE-001",
)
def get_globe_markers(
    session: SessionDependency, locale: Locale = "zh-CN"
) -> DemoResponse[list[GlobeMarker]]:
    data = globe_markers(session, locale)
    return DemoResponse(meta=_meta(locale, len(data)), data=data)


@router.post(
    "/country-comparisons",
    response_model=DemoResponse[ComparisonResult],
    operation_id="API-DEMO-COMPARE-001",
)
def create_demo_country_comparison(
    request: DemoComparisonRequest,
    session: SessionDependency,
    locale: Locale = "zh-CN",
) -> DemoResponse[ComparisonResult]:
    data = compare_countries(session, request.country_codes, locale)
    return DemoResponse(meta=_meta(locale, len(data.countries)), data=data)


@router.post(
    "/tools/assistant/preview",
    response_model=DemoResponse[AssistantPreview],
    operation_id="API-DEMO-ASSISTANT-PREVIEW-001",
)
def create_assistant_preview(
    request: AssistantPreviewRequest,
    session: SessionDependency,
    locale: Locale = "zh-CN",
) -> DemoResponse[AssistantPreview]:
    data = assistant_preview(session, request, locale)
    return DemoResponse(meta=_meta(locale, 1), data=data)


@router.post(
    "/tools/solar-storage/preview",
    response_model=DemoResponse[SolarStoragePreview],
    operation_id="API-DEMO-SOLAR-STORAGE-PREVIEW-001",
)
def create_solar_storage_preview(
    request: SolarStoragePreviewRequest,
    session: SessionDependency,
    locale: Locale = "zh-CN",
) -> DemoResponse[SolarStoragePreview]:
    data = solar_storage_preview(session, request, locale)
    return DemoResponse(meta=_meta(locale, 1), data=data)


@router.post(
    "/tools/feasibility-report/preview",
    response_model=DemoResponse[FeasibilityReportPreview],
    operation_id="API-DEMO-FEASIBILITY-PREVIEW-001",
)
def create_feasibility_report_preview(
    request: FeasibilityReportPreviewRequest,
    session: SessionDependency,
    locale: Locale = "zh-CN",
) -> DemoResponse[FeasibilityReportPreview]:
    data = feasibility_report_preview(session, request, locale)
    return DemoResponse(meta=_meta(locale, 1), data=data)


@router.get(
    "/tools/tenders",
    response_model=DemoResponse[list[TenderItem]],
    operation_id="API-DEMO-TENDER-LIST-001",
)
def get_demo_tenders(
    session: SessionDependency,
    country_code: CountryFilter = None,
    sector: ShortFilter = None,
    stage: ShortFilter = None,
    keyword: KeywordFilter = None,
    limit: Limit = 50,
    locale: Locale = "zh-CN",
) -> DemoResponse[list[TenderItem]]:
    data = list_tool_tenders(
        session,
        locale,
        country_code=country_code,
        sector=sector,
        stage=stage,
        keyword=keyword,
        limit=limit,
    )
    return DemoResponse(meta=_meta(locale, len(data)), data=data)


@router.get(
    "/tools/tenders/{tender_id}",
    response_model=DemoResponse[TenderItem],
    operation_id="API-DEMO-TENDER-DETAIL-001",
)
def get_demo_tender(
    tender_id: str, session: SessionDependency, locale: Locale = "zh-CN"
) -> DemoResponse[TenderItem]:
    data = get_tool_tender(session, tender_id, locale)
    return DemoResponse(meta=_meta(locale, 1), data=data)
