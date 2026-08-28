"""Public read-only API contracts for the BASIC60 private trial."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from navigator_api.basic60_seed_contract import METRIC_CODES

type CoverageLevel = Literal["Basic"]
type ValueStatus = Literal["available", "pending", "unavailable"]


class Basic60Meta(BaseModel):
    release_id: str
    release_profile: Literal["basic60_private"] = "basic60_private"
    formal_gate_status: Literal["pending"] = "pending"
    coverage_level: CoverageLevel = "Basic"
    as_of: date
    result_count: int = Field(ge=0)
    next_cursor: str | None = None


class Basic60Response[T](BaseModel):
    meta: Basic60Meta
    data: T


class MetricPeriod(BaseModel):
    start: date
    end: date
    label: str


class MetricObservation(BaseModel):
    metric_code: str
    label: str
    value: float | None
    unit: str
    period: MetricPeriod
    value_status: ValueStatus
    null_reason: str | None
    quality_status: str
    freshness_status: str


class CountryBase(BaseModel):
    code: str
    iso2: str
    name_zh: str
    name_en: str
    region_code: str
    coverage_level: CoverageLevel
    last_reviewed_at: datetime | None
    opportunity_level: Literal["pending"]
    policy_friendliness_level: Literal["pending"]
    risk_assessment_status: Literal["unknown"]
    risk_level: None


class CountrySummary(CountryBase):
    latest_metrics: list[MetricObservation]


class LocalName(BaseModel):
    locale: str
    text: str
    preferred: bool
    translation_status: str


class Capital(BaseModel):
    name: str
    role: str
    display_order: int
    valid_from: date | None
    valid_to: date | None


class Language(BaseModel):
    code: str
    name_en: str
    name_local: str | None
    status: str


class Currency(BaseModel):
    code: str
    name_en: str
    legal_tender: bool
    valid_from: date | None
    valid_to: date | None


class Timezone(BaseModel):
    iana_code: str
    primary: bool


class AdminStructure(BaseModel):
    admin_level: int
    unit_type: str
    unit_count: int
    as_of_year: int
    status: str


class CountryDetail(CountryBase):
    local_names: list[LocalName] | None = None
    capitals: list[Capital] | None = None
    languages: list[Language] | None = None
    currencies: list[Currency] | None = None
    timezones: list[Timezone] | None = None
    admin_structures: list[AdminStructure] | None = None
    macro: list[MetricObservation] | None = None
    energy: list[MetricObservation] | None = None


class CountryComparisonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    country_codes: list[str] = Field(min_length=2, max_length=4)
    metric_codes: list[str] | None = Field(default=None, min_length=1)
    as_of: date | None = None

    @field_validator("country_codes")
    @classmethod
    def normalize_country_codes(cls, value: list[str]) -> list[str]:
        normalized = [code.strip().upper() for code in value]
        if any(len(code) != 3 or not code.isalpha() for code in normalized):
            raise ValueError("country_codes must contain three-letter country codes")
        if len(normalized) != len(set(normalized)):
            raise ValueError("country_codes cannot contain duplicates")
        return normalized

    @field_validator("metric_codes")
    @classmethod
    def validate_metric_codes(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalized = [code.strip() for code in value]
        if len(normalized) != len(set(normalized)):
            raise ValueError("metric_codes cannot contain duplicates")
        unknown = sorted(set(normalized) - METRIC_CODES)
        if unknown:
            raise ValueError(f"unknown BASIC60 metric codes: {', '.join(unknown)}")
        return normalized


class ComparisonCountry(BaseModel):
    code: str
    name_zh: str
    name_en: str
    metrics: list[MetricObservation]


class CountryComparisonResult(BaseModel):
    countries: list[ComparisonCountry]
    common_metric_codes: list[str]
    excluded_metric_codes: list[str]


class Basic60HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ready"]
    release_profile: Literal["basic60_private"] = "basic60_private"
    formal_gate_status: Literal["pending"] = "pending"
    release_id: str
    release_status: Literal["private_trial_ready"]
    country_count: int = Field(ge=0)
    external_calls_enabled: Literal[False] = False
    ai_enabled: Literal[False] = False
