"""Explicitly bounded demo maintenance endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from navigator_api.database import get_session
from navigator_api.localization import disclaimer_for
from navigator_api.schemas import DemoMeta, DemoResponse, Locale, ResetResult
from navigator_api.seed import seed_database

router = APIRouter(prefix="/demo", tags=["demo-maintenance"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post(
    "/reset",
    response_model=DemoResponse[ResetResult],
    operation_id="API-DEMO-RESET-001",
)
def reset_demo(session: SessionDependency, locale: Locale = "zh-CN") -> DemoResponse[ResetResult]:
    counts = seed_database(session, force=True)
    data = ResetResult(country_count=counts["countries"], record_counts=counts)
    return DemoResponse(
        meta=DemoMeta(locale=locale, disclaimer=disclaimer_for(locale), result_count=1), data=data
    )
