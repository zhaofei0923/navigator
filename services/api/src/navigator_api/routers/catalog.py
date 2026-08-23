"""Read-only synthetic demo catalog endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from navigator_api.database import get_session
from navigator_api.localization import disclaimer_for
from navigator_api.models import Opportunity, Partner, Policy, RiskRecord, Tender
from navigator_api.schemas import (
    DemoMeta,
    DemoResponse,
    Locale,
    OpportunityItem,
    PartnerItem,
    PolicyItem,
    RiskItem,
    TenderItem,
)
from navigator_api.service import (
    list_catalog,
    opportunity_item,
    partner_item,
    policy_item,
    risk_item,
    tender_item,
)

router = APIRouter(tags=["market-intelligence"])
SessionDependency = Annotated[Session, Depends(get_session)]
CountryFilter = Annotated[
    str | None,
    Query(pattern=r"^[A-Za-z]{3}$", description="Optional ISO-style demo country code."),
]
Limit = Annotated[int, Query(ge=1, le=100)]


def _meta(locale: Locale, result_count: int) -> DemoMeta:
    return DemoMeta(locale=locale, disclaimer=disclaimer_for(locale), result_count=result_count)


@router.get(
    "/policies",
    response_model=DemoResponse[list[PolicyItem]],
    operation_id="API-POLICY-001",
)
def get_policies(
    session: SessionDependency,
    country_code: CountryFilter = None,
    limit: Limit = 50,
    locale: Locale = "zh-CN",
) -> DemoResponse[list[PolicyItem]]:
    rows = list_catalog(session, Policy, Policy.country_code, Policy.policy_id, country_code, limit)
    data = [policy_item(row, locale) for row in rows]
    return DemoResponse(meta=_meta(locale, len(data)), data=data)


@router.get(
    "/risks",
    response_model=DemoResponse[list[RiskItem]],
    operation_id="API-RISK-001",
)
def get_risks(
    session: SessionDependency,
    country_code: CountryFilter = None,
    limit: Limit = 50,
    locale: Locale = "zh-CN",
) -> DemoResponse[list[RiskItem]]:
    rows = list_catalog(
        session,
        RiskRecord,
        RiskRecord.country_code,
        RiskRecord.risk_id,
        country_code,
        limit,
    )
    data = [risk_item(row, locale) for row in rows]
    return DemoResponse(meta=_meta(locale, len(data)), data=data)


@router.get(
    "/opportunities",
    response_model=DemoResponse[list[OpportunityItem]],
    operation_id="API-OPPORTUNITY-001",
)
def get_opportunities(
    session: SessionDependency,
    country_code: CountryFilter = None,
    limit: Limit = 50,
    locale: Locale = "zh-CN",
) -> DemoResponse[list[OpportunityItem]]:
    rows = list_catalog(
        session,
        Opportunity,
        Opportunity.country_code,
        Opportunity.opportunity_id,
        country_code,
        limit,
    )
    data = [opportunity_item(row, locale) for row in rows]
    return DemoResponse(meta=_meta(locale, len(data)), data=data)


@router.get(
    "/tenders",
    response_model=DemoResponse[list[TenderItem]],
    operation_id="API-TENDER-001",
)
def get_tenders(
    session: SessionDependency,
    country_code: CountryFilter = None,
    limit: Limit = 50,
    locale: Locale = "zh-CN",
) -> DemoResponse[list[TenderItem]]:
    rows = list_catalog(session, Tender, Tender.country_code, Tender.tender_id, country_code, limit)
    data = [tender_item(row, locale) for row in rows]
    return DemoResponse(meta=_meta(locale, len(data)), data=data)


@router.get(
    "/partners",
    response_model=DemoResponse[list[PartnerItem]],
    operation_id="API-PARTNER-001",
)
def get_partners(
    session: SessionDependency,
    country_code: CountryFilter = None,
    limit: Limit = 50,
    locale: Locale = "zh-CN",
) -> DemoResponse[list[PartnerItem]]:
    rows = list_catalog(
        session,
        Partner,
        Partner.country_code,
        Partner.partner_id,
        country_code,
        limit,
    )
    data = [partner_item(row, locale) for row in rows]
    return DemoResponse(meta=_meta(locale, len(data)), data=data)
