"""Typed query and mapping operations for demo endpoints."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import InstrumentedAttribute, Session, selectinload

from navigator_api.constants import DATA_ORIGIN
from navigator_api.errors import DemoAPIError
from navigator_api.models import (
    Base,
    Country,
)
from navigator_api.schemas import (
    ActionItem,
    ComparisonCountry,
    ComparisonResult,
    CountryDetail,
    CountryScores,
    CountrySummary,
    ReasonItem,
    RiskItem,
    SignalItem,
)

DIMENSION_FIELDS = (
    "market_attractiveness",
    "policy_certainty",
    "project_activity",
    "partner_maturity",
    "risk_controllability",
)


def country_scores(country: Country) -> CountryScores:
    return CountryScores(
        market_attractiveness=country.market_attractiveness,
        policy_certainty=country.policy_certainty,
        project_activity=country.project_activity,
        partner_maturity=country.partner_maturity,
        risk_controllability=country.risk_controllability,
        readiness=country.readiness_score,
        opportunity=country.opportunity_score,
        risk=country.risk_score,
    )


def country_summary(country: Country) -> CountrySummary:
    return CountrySummary(
        code=country.code,
        name_zh=country.name_zh,
        name_en=country.name_en,
        region=country.region,
        currency=country.currency,
        summary=country.summary,
        scores=country_scores(country),
        dimension_deltas=country.dimension_deltas,
        data_origin=DATA_ORIGIN,
    )


def country_detail(country: Country) -> CountryDetail:
    summary = country_summary(country)
    return CountryDetail(
        **summary.model_dump(),
        signals=[
            SignalItem.model_validate(signal)
            for signal in sorted(country.signals, key=lambda item: item.signal_id)
        ],
        reasons=[
            ReasonItem.model_validate(reason)
            for reason in sorted(country.reasons, key=lambda item: (item.rank, item.reason_id))
        ],
        risks=[
            RiskItem.model_validate(risk)
            for risk in sorted(country.risks, key=lambda item: item.risk_id)
        ],
        actions=[
            ActionItem.model_validate(action)
            for action in sorted(country.actions, key=lambda item: (item.priority, item.action_id))
        ],
    )


def list_countries(session: Session) -> list[Country]:
    statement = select(Country).order_by(Country.code)
    return list(session.scalars(statement).all())


def get_country_detail(session: Session, country_code: str) -> Country:
    statement = (
        select(Country)
        .where(Country.code == country_code.upper())
        .options(
            selectinload(Country.signals),
            selectinload(Country.reasons),
            selectinload(Country.risks),
            selectinload(Country.actions),
        )
    )
    country = session.scalar(statement)
    if country is None:
        raise DemoAPIError(
            status_code=404,
            code="COUNTRY_NOT_FOUND",
            message=f"合成演示库中不存在国家代码 {country_code.upper()}。",
        )
    return country


def _overall_score(country: Country) -> float:
    return round(
        country.market_attractiveness * 0.25
        + country.policy_certainty * 0.20
        + country.project_activity * 0.20
        + country.partner_maturity * 0.15
        + country.risk_controllability * 0.20,
        1,
    )


def compare_countries(session: Session, country_codes: Sequence[str]) -> ComparisonResult:
    statement = select(Country).where(Country.code.in_(country_codes))
    country_by_code = {country.code: country for country in session.scalars(statement).all()}
    missing = [code for code in country_codes if code not in country_by_code]
    if missing:
        raise DemoAPIError(
            status_code=404,
            code="COUNTRIES_NOT_FOUND",
            message="部分国家不在合成演示库中。",
            details=[{"missing_country_codes": missing}],
        )

    selected = [country_by_code[code] for code in country_codes]
    averages = {
        field: sum(float(getattr(country, field)) for country in selected) / len(selected)
        for field in DIMENSION_FIELDS
    }
    ranked = sorted(selected, key=lambda item: (-_overall_score(item), item.code))
    comparison_rows: list[ComparisonCountry] = []
    for rank, country in enumerate(ranked, start=1):
        overall = _overall_score(country)
        delta = overall - sum(_overall_score(item) for item in selected) / len(selected)
        trend = "above_group" if delta >= 2 else "below_group" if delta <= -2 else "near_group"
        comparison_rows.append(
            ComparisonCountry(
                rank=rank,
                country_code=country.code,
                name_zh=country.name_zh,
                scores=country_scores(country),
                dimension_deltas={
                    field: round(float(getattr(country, field)) - averages[field], 1)
                    for field in DIMENSION_FIELDS
                },
                trend=trend,
                overall_score=overall,
                reason=(
                    "五维合成评分在本次选择中最高。"
                    if rank == 1
                    else "五维合成评分用于展示相对排序。"
                ),
                data_origin=DATA_ORIGIN,
            )
        )

    winner = comparison_rows[0]
    return ComparisonResult(
        comparison_id="CMP-" + "-".join(sorted(country_codes)),
        countries=comparison_rows,
        recommendation=f"内部演示排序首位为 {winner.name_zh}；不得作为专业或投资结论。",
        methodology=(
            "合成五维加权：市场吸引力25%、政策确定性20%、项目活跃度20%、"
            "合作伙伴成熟度15%、风险可控性20%。"
        ),
        data_origin=DATA_ORIGIN,
    )


def list_catalog[CatalogModelT: Base](
    session: Session,
    model: type[CatalogModelT],
    country_column: InstrumentedAttribute[str],
    id_column: InstrumentedAttribute[str],
    country_code: str | None,
    limit: int,
) -> list[CatalogModelT]:
    statement = select(model)
    if country_code:
        statement = statement.where(country_column == country_code.upper())
    statement = statement.order_by(country_column, id_column).limit(limit)
    return list(session.scalars(statement).all())
