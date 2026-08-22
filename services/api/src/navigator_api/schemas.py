"""Pydantic request and response contracts for the internal demo API."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from navigator_api.constants import DATA_ORIGIN, DISCLAIMER


class DemoMeta(BaseModel):
    data_origin: Literal["synthetic_demo"] = DATA_ORIGIN
    disclaimer: Literal["演示数据 / 非正式结论"] = DISCLAIMER
    result_count: int | None = Field(default=None, ge=0)


class DemoResponse[T](BaseModel):
    meta: DemoMeta
    data: T


class SyntheticItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    data_origin: Literal["synthetic_demo"] = DATA_ORIGIN


class CountryScores(BaseModel):
    market_attractiveness: int = Field(ge=0, le=100)
    policy_certainty: int = Field(ge=0, le=100)
    project_activity: int = Field(ge=0, le=100)
    partner_maturity: int = Field(ge=0, le=100)
    risk_controllability: int = Field(ge=0, le=100)
    readiness: int = Field(ge=0, le=100)
    opportunity: int = Field(ge=0, le=100)
    risk: int = Field(ge=0, le=100)


class CountrySummary(SyntheticItem):
    code: str
    name_zh: str
    name_en: str
    region: str
    currency: str
    summary: str
    scores: CountryScores
    dimension_deltas: dict[str, float]


class SignalItem(SyntheticItem):
    signal_id: str
    country_code: str
    category: str
    title: str
    value: float
    unit: str
    trend: str
    confidence: int = Field(ge=0, le=100)
    occurred_at: date
    summary: str


class ReasonItem(SyntheticItem):
    reason_id: str
    country_code: str
    kind: str
    title: str
    detail: str
    rank: int = Field(ge=1)


class ActionItem(SyntheticItem):
    action_id: str
    country_code: str
    priority: int = Field(ge=1)
    title: str
    detail: str
    owner_hint: str


class RiskItem(SyntheticItem):
    risk_id: str
    country_code: str
    title: str
    category: str
    severity: int = Field(ge=1, le=5)
    likelihood: int = Field(ge=1, le=5)
    detail: str
    mitigation: str


class CountryDetail(CountrySummary):
    signals: list[SignalItem]
    reasons: list[ReasonItem]
    risks: list[RiskItem]
    actions: list[ActionItem]


class PolicyItem(SyntheticItem):
    policy_id: str
    country_code: str
    title: str
    category: str
    status: str
    published_at: date
    summary: str


class OpportunityItem(SyntheticItem):
    opportunity_id: str
    country_code: str
    title: str
    category: str
    score: int = Field(ge=0, le=100)
    detail: str
    next_step: str


class TenderItem(SyntheticItem):
    tender_id: str
    country_code: str
    title: str
    sector: str
    stage: str
    budget_min_million: float = Field(ge=0)
    budget_max_million: float = Field(ge=0)
    currency: str
    deadline: date
    summary: str


class PartnerItem(SyntheticItem):
    partner_id: str
    country_code: str
    name: str
    partner_type: str
    capabilities: list[str]
    fit_score: int = Field(ge=0, le=100)
    summary: str


class ComparisonRequest(BaseModel):
    country_codes: list[str] = Field(min_length=2, max_length=4)

    @field_validator("country_codes")
    @classmethod
    def normalize_and_validate_codes(cls, value: list[str]) -> list[str]:
        normalized = [code.strip().upper() for code in value]
        if any(len(code) != 3 or not code.isalpha() for code in normalized):
            raise ValueError("country_codes 必须是三个字母的国家代码")
        if len(set(normalized)) != len(normalized):
            raise ValueError("country_codes 不能重复")
        return normalized


class ComparisonCountry(SyntheticItem):
    rank: int = Field(ge=1)
    country_code: str
    name_zh: str
    scores: CountryScores
    dimension_deltas: dict[str, float]
    trend: str
    overall_score: float = Field(ge=0, le=100)
    reason: str


class ComparisonResult(SyntheticItem):
    comparison_id: str
    countries: list[ComparisonCountry]
    recommendation: str
    methodology: str


class DemoInfo(SyntheticItem):
    name: str
    baseline_decision: str
    mode: Literal["bounded_internal_demo"]
    country_codes: list[str]
    external_calls_enabled: Literal[False] = False
    real_data_enabled: Literal[False] = False


class ResetResult(SyntheticItem):
    reset: Literal[True] = True
    country_count: int = Field(ge=0)
    record_counts: dict[str, int]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ready"]
    data_origin: Literal["synthetic_demo"] = DATA_ORIGIN
    disclaimer: Literal["演示数据 / 非正式结论"] = DISCLAIMER
    seeded_country_count: int = Field(ge=0)
