"""Read-only synthetic demo catalog endpoints."""

from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from navigator_api.database import get_session
from navigator_api.models import Opportunity, Partner, Policy, RiskRecord, Tender
from navigator_api.schemas import (
    DemoMeta,
    DemoResponse,
    OpportunityItem,
    PartnerItem,
    PolicyItem,
    RiskItem,
    TenderItem,
)
from navigator_api.service import list_catalog

router = APIRouter(tags=["market-intelligence"])
SessionDependency = Annotated[Session, Depends(get_session)]
CountryFilter = Annotated[
    str | None,
    Query(pattern=r"^[A-Za-z]{3}$", description="Optional ISO-style demo country code."),
]
Limit = Annotated[int, Query(ge=1, le=100)]


def _response[SchemaT: BaseModel](
    rows: Sequence[object], schema: type[SchemaT]
) -> DemoResponse[list[SchemaT]]:
    data = [schema.model_validate(row) for row in rows]
    return DemoResponse(meta=DemoMeta(result_count=len(data)), data=data)


@router.get(
    "/policies",
    response_model=DemoResponse[list[PolicyItem]],
    operation_id="API-POLICY-001",
)
def get_policies(
    session: SessionDependency, country_code: CountryFilter = None, limit: Limit = 50
) -> DemoResponse[list[PolicyItem]]:
    return _response(
        list_catalog(session, Policy, Policy.country_code, Policy.policy_id, country_code, limit),
        PolicyItem,
    )


@router.get(
    "/risks",
    response_model=DemoResponse[list[RiskItem]],
    operation_id="API-RISK-001",
)
def get_risks(
    session: SessionDependency, country_code: CountryFilter = None, limit: Limit = 50
) -> DemoResponse[list[RiskItem]]:
    return _response(
        list_catalog(
            session,
            RiskRecord,
            RiskRecord.country_code,
            RiskRecord.risk_id,
            country_code,
            limit,
        ),
        RiskItem,
    )


@router.get(
    "/opportunities",
    response_model=DemoResponse[list[OpportunityItem]],
    operation_id="API-OPPORTUNITY-001",
)
def get_opportunities(
    session: SessionDependency, country_code: CountryFilter = None, limit: Limit = 50
) -> DemoResponse[list[OpportunityItem]]:
    return _response(
        list_catalog(
            session,
            Opportunity,
            Opportunity.country_code,
            Opportunity.opportunity_id,
            country_code,
            limit,
        ),
        OpportunityItem,
    )


@router.get(
    "/tenders",
    response_model=DemoResponse[list[TenderItem]],
    operation_id="API-TENDER-001",
)
def get_tenders(
    session: SessionDependency, country_code: CountryFilter = None, limit: Limit = 50
) -> DemoResponse[list[TenderItem]]:
    return _response(
        list_catalog(session, Tender, Tender.country_code, Tender.tender_id, country_code, limit),
        TenderItem,
    )


@router.get(
    "/partners",
    response_model=DemoResponse[list[PartnerItem]],
    operation_id="API-PARTNER-001",
)
def get_partners(
    session: SessionDependency, country_code: CountryFilter = None, limit: Limit = 50
) -> DemoResponse[list[PartnerItem]]:
    return _response(
        list_catalog(
            session,
            Partner,
            Partner.country_code,
            Partner.partner_id,
            country_code,
            limit,
        ),
        PartnerItem,
    )
