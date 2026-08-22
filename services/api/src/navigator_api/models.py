"""SQLAlchemy 2 models for repository-owned synthetic demo records."""

from __future__ import annotations

from datetime import date

from sqlalchemy import JSON, CheckConstraint, Date, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from navigator_api.constants import DATA_ORIGIN


class Base(DeclarativeBase):
    pass


class SyntheticOriginMixin:
    data_origin: Mapped[str] = mapped_column(
        String(32), nullable=False, default=DATA_ORIGIN, server_default=DATA_ORIGIN
    )


class Country(SyntheticOriginMixin, Base):
    __tablename__ = "countries"
    __table_args__ = (
        CheckConstraint("data_origin = 'synthetic_demo'", name="ck_countries_synthetic_origin"),
        CheckConstraint("readiness_score BETWEEN 0 AND 100", name="ck_country_readiness"),
        CheckConstraint("opportunity_score BETWEEN 0 AND 100", name="ck_country_opportunity"),
        CheckConstraint("risk_score BETWEEN 0 AND 100", name="ck_country_risk"),
        CheckConstraint(
            "market_attractiveness BETWEEN 0 AND 100", name="ck_country_market_attractiveness"
        ),
        CheckConstraint("policy_certainty BETWEEN 0 AND 100", name="ck_country_policy_certainty"),
        CheckConstraint("project_activity BETWEEN 0 AND 100", name="ck_country_project_activity"),
        CheckConstraint("partner_maturity BETWEEN 0 AND 100", name="ck_country_partner_maturity"),
        CheckConstraint(
            "risk_controllability BETWEEN 0 AND 100", name="ck_country_risk_controllability"
        ),
    )

    code: Mapped[str] = mapped_column(String(3), primary_key=True)
    name_zh: Mapped[str] = mapped_column(String(80), nullable=False)
    name_en: Mapped[str] = mapped_column(String(80), nullable=False)
    region: Mapped[str] = mapped_column(String(80), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    readiness_score: Mapped[int] = mapped_column(Integer, nullable=False)
    opportunity_score: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    market_attractiveness: Mapped[int] = mapped_column(Integer, nullable=False)
    policy_certainty: Mapped[int] = mapped_column(Integer, nullable=False)
    project_activity: Mapped[int] = mapped_column(Integer, nullable=False)
    partner_maturity: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_controllability: Mapped[int] = mapped_column(Integer, nullable=False)
    dimension_deltas: Mapped[dict[str, float]] = mapped_column(JSON, nullable=False)

    signals: Mapped[list[CountrySignal]] = relationship(
        back_populates="country", cascade="all, delete-orphan", lazy="selectin"
    )
    reasons: Mapped[list[CountryReason]] = relationship(
        back_populates="country", cascade="all, delete-orphan", lazy="selectin"
    )
    actions: Mapped[list[CountryAction]] = relationship(
        back_populates="country", cascade="all, delete-orphan", lazy="selectin"
    )
    risks: Mapped[list[RiskRecord]] = relationship(
        back_populates="country", cascade="all, delete-orphan", lazy="selectin"
    )


class CountrySignal(SyntheticOriginMixin, Base):
    __tablename__ = "country_signals"
    __table_args__ = (
        CheckConstraint("data_origin = 'synthetic_demo'", name="ck_signals_synthetic_origin"),
        CheckConstraint("confidence BETWEEN 0 AND 100", name="ck_signal_confidence"),
    )

    signal_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), index=True)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    trend: Mapped[str] = mapped_column(String(20), nullable=False)
    confidence: Mapped[int] = mapped_column(Integer, nullable=False)
    occurred_at: Mapped[date] = mapped_column(Date, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)

    country: Mapped[Country] = relationship(back_populates="signals")


class CountryReason(SyntheticOriginMixin, Base):
    __tablename__ = "country_reasons"
    __table_args__ = (
        CheckConstraint("data_origin = 'synthetic_demo'", name="ck_reasons_synthetic_origin"),
    )

    reason_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), index=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)

    country: Mapped[Country] = relationship(back_populates="reasons")


class CountryAction(SyntheticOriginMixin, Base):
    __tablename__ = "country_actions"
    __table_args__ = (
        CheckConstraint("data_origin = 'synthetic_demo'", name="ck_actions_synthetic_origin"),
    )

    action_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), index=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    owner_hint: Mapped[str] = mapped_column(String(80), nullable=False)

    country: Mapped[Country] = relationship(back_populates="actions")


class Policy(SyntheticOriginMixin, Base):
    __tablename__ = "policies"
    __table_args__ = (
        CheckConstraint("data_origin = 'synthetic_demo'", name="ck_policies_synthetic_origin"),
    )

    policy_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), index=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    published_at: Mapped[date] = mapped_column(Date, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)


class RiskRecord(SyntheticOriginMixin, Base):
    __tablename__ = "risks"
    __table_args__ = (
        CheckConstraint("data_origin = 'synthetic_demo'", name="ck_risks_synthetic_origin"),
        CheckConstraint("severity BETWEEN 1 AND 5", name="ck_risk_severity"),
        CheckConstraint("likelihood BETWEEN 1 AND 5", name="ck_risk_likelihood"),
    )

    risk_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), index=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[int] = mapped_column(Integer, nullable=False)
    likelihood: Mapped[int] = mapped_column(Integer, nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    mitigation: Mapped[str] = mapped_column(Text, nullable=False)

    country: Mapped[Country] = relationship(back_populates="risks")


class Opportunity(SyntheticOriginMixin, Base):
    __tablename__ = "opportunities"
    __table_args__ = (
        CheckConstraint("data_origin = 'synthetic_demo'", name="ck_opportunities_synthetic_origin"),
        CheckConstraint("score BETWEEN 0 AND 100", name="ck_opportunity_score"),
    )

    opportunity_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), index=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    next_step: Mapped[str] = mapped_column(Text, nullable=False)


class Tender(SyntheticOriginMixin, Base):
    __tablename__ = "tenders"
    __table_args__ = (
        CheckConstraint("data_origin = 'synthetic_demo'", name="ck_tenders_synthetic_origin"),
        CheckConstraint("budget_min_million >= 0", name="ck_tender_budget_min"),
        CheckConstraint("budget_max_million >= budget_min_million", name="ck_tender_budget_order"),
    )

    tender_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), index=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    sector: Mapped[str] = mapped_column(String(60), nullable=False)
    stage: Mapped[str] = mapped_column(String(40), nullable=False)
    budget_min_million: Mapped[float] = mapped_column(Float, nullable=False)
    budget_max_million: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    deadline: Mapped[date] = mapped_column(Date, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)


class Partner(SyntheticOriginMixin, Base):
    __tablename__ = "partners"
    __table_args__ = (
        CheckConstraint("data_origin = 'synthetic_demo'", name="ck_partners_synthetic_origin"),
        CheckConstraint("fit_score BETWEEN 0 AND 100", name="ck_partner_fit"),
    )

    partner_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"), index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    partner_type: Mapped[str] = mapped_column(String(60), nullable=False)
    capabilities: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    fit_score: Mapped[int] = mapped_column(Integer, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
