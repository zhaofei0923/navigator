"""Public market overviews and read-only legacy archive contracts.

Only ``CountryMarketOverview`` is accepted for new candidates and public responses.
The older analysis/report models remain solely to validate immutable archived objects.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

type MarketLocale = Literal["zh-CN", "en"]
type Business = Literal["equipment_export", "epc", "project_investment"]
type Technology = Literal["solar_pv", "wind", "storage"]
type AssessmentLevel = Literal["low", "medium", "high", "insufficient"]
type SectionId = Literal[
    "overview",
    "renewable_policy",
    "investment_policy",
    "trade_policy",
    "entry_path",
    "risk_response",
]


def _nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("market content strings must not be blank")
    return value


def _calendar_date(value: object) -> object:
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return value
    if type(value) is date:
        return value
    raise ValueError("market content dates must be ISO calendar dates")


Text = Annotated[
    str, Field(min_length=1, max_length=100_000, strict=True), AfterValidator(_nonblank)
]
Identifier = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_\-]{0,79}$", strict=True)]
BUSINESSES = ("equipment_export", "epc", "project_investment")
TECHNOLOGIES = ("solar_pv", "wind", "storage")
SECTION_IDS = (
    "overview",
    "renewable_policy",
    "investment_policy",
    "trade_policy",
    "entry_path",
    "risk_response",
)


class MarketModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def reject_blank_text(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            raise ValueError("market content strings must not be blank")
        return value


class MarketSummary(MarketModel):
    market_character: Text
    opportunity: Text
    barrier: Text
    next_action: Text


class MarketSection(MarketModel):
    id: SectionId
    title: Text
    paragraphs: list[Text] = Field(min_length=1, max_length=100)


class EntryAssessment(MarketModel):
    business: Business
    technology: Technology
    level: AssessmentLevel
    rationale: Text
    path: Text
    verified_on: date

    @field_validator("verified_on", mode="before")
    @classmethod
    def require_date_only(cls, value: object) -> object:
        return _calendar_date(value)


class MarketRisk(MarketModel):
    id: Identifier
    title: Text
    level: AssessmentLevel
    businesses: list[Business] = Field(min_length=1, max_length=3)
    technologies: list[Technology] = Field(min_length=1, max_length=3)
    rationale: Text
    mitigation: Text
    verified_on: date

    @field_validator("verified_on", mode="before")
    @classmethod
    def require_date_only(cls, value: object) -> object:
        return _calendar_date(value)

    @model_validator(mode="after")
    def unique_scope(self) -> MarketRisk:
        if len(self.businesses) != len(set(self.businesses)) or len(self.technologies) != len(
            set(self.technologies)
        ):
            raise ValueError("risk business and technology scopes must be unique")
        return self


class MarketAnalysis(MarketModel):
    summary: MarketSummary
    sections: list[MarketSection] = Field(min_length=6, max_length=6)
    entry_assessments: list[EntryAssessment] = Field(min_length=9, max_length=9)
    risks: list[MarketRisk] = Field(max_length=100)
    gaps: list[Text] = Field(max_length=100)
    disclaimer: Text

    @model_validator(mode="after")
    def complete_structure(self) -> MarketAnalysis:
        if {section.id for section in self.sections} != set(SECTION_IDS):
            raise ValueError("analysis requires the six distinct supported sections")
        actual = {(item.business, item.technology) for item in self.entry_assessments}
        expected = {
            (business, technology) for business in BUSINESSES for technology in TECHNOLOGIES
        }
        if actual != expected:
            raise ValueError("analysis requires each of the nine business/technology assessments")
        if len({risk.id for risk in self.risks}) != len(self.risks):
            raise ValueError("risk identifiers must be unique")
        return self


class MarketReportChapter(MarketModel):
    id: Identifier
    title: Text
    paragraphs: list[Text] = Field(min_length=1, max_length=200)
    actions: list[Text] = Field(max_length=100)


class MarketReport(MarketModel):
    title: Text
    introduction: Text
    chapters: list[MarketReportChapter] = Field(min_length=1, max_length=50)
    disclaimer: Text

    @model_validator(mode="after")
    def unique_chapters(self) -> MarketReport:
        if len({chapter.id for chapter in self.chapters}) != len(self.chapters):
            raise ValueError("report chapter identifiers must be unique")
        return self


class LocalizedMarketContent(MarketModel):
    analysis: MarketAnalysis
    report: MarketReport


class CountryMarketContent(MarketModel):
    """Retired analysis/report schema, supported only for historical storage reads."""

    schema_version: Literal["navigator.market-content.v1"]
    country_code: Annotated[str, Field(pattern=r"^[A-Z]{3}$", strict=True)]
    content_version: Annotated[
        str, Field(pattern=r"^MARKET-[A-Z]{3}-\d{8}-R[1-9]\d*$", max_length=80, strict=True)
    ]
    as_of: date
    locales: dict[MarketLocale, LocalizedMarketContent]

    @field_validator("as_of", mode="before")
    @classmethod
    def require_date_only(cls, value: object) -> object:
        return _calendar_date(value)

    @model_validator(mode="after")
    def matching_content(self) -> CountryMarketContent:
        if self.country_code == "CHN":
            raise ValueError("China is not an outbound target market")
        if not self.content_version.startswith(f"MARKET-{self.country_code}-"):
            raise ValueError("content version must identify the same country")
        version_date = self.content_version.split("-")[2]
        version_day = date.fromisoformat(
            f"{version_date[:4]}-{version_date[4:6]}-{version_date[6:]}"
        )
        if version_day < self.as_of:
            raise ValueError("content as_of cannot be later than the version's calendar date")
        if set(self.locales) != {"zh-CN", "en"}:
            raise ValueError("both zh-CN and en content are required")
        for localized in self.locales.values():
            dated: list[EntryAssessment | MarketRisk] = [
                *localized.analysis.entry_assessments,
                *localized.analysis.risks,
            ]
            if any(item.verified_on > self.as_of for item in dated):
                raise ValueError("verification dates cannot be later than content as_of")
        zh = self.locales["zh-CN"]
        en = self.locales["en"]
        zh_entries = {
            (item.business, item.technology): (item.level, item.verified_on)
            for item in zh.analysis.entry_assessments
        }
        en_entries = {
            (item.business, item.technology): (item.level, item.verified_on)
            for item in en.analysis.entry_assessments
        }
        if zh_entries != en_entries:
            raise ValueError("bilingual entry levels and verification dates must agree")
        zh_risks = {
            item.id: (
                item.level,
                item.verified_on,
                frozenset(item.businesses),
                frozenset(item.technologies),
            )
            for item in zh.analysis.risks
        }
        en_risks = {
            item.id: (
                item.level,
                item.verified_on,
                frozenset(item.businesses),
                frozenset(item.technologies),
            )
            for item in en.analysis.risks
        }
        if zh_risks != en_risks:
            raise ValueError("bilingual risk IDs, levels, dates and scopes must agree")
        if {item.id for item in zh.report.chapters} != {item.id for item in en.report.chapters}:
            raise ValueError("bilingual report chapter IDs must agree")
        return self


def overview_character_count(text: str) -> int:
    """Count Unicode characters except whitespace, retaining punctuation and numbers."""
    return len(re.sub(r"\s", "", text))


class LocalizedMarketOverview(MarketModel):
    title: Text
    paragraphs: list[Text] = Field(min_length=6, max_length=8)
    disclaimer: Text


class CountryMarketOverview(MarketModel):
    schema_version: Literal["navigator.market-overview.v1"]
    country_code: Annotated[str, Field(pattern=r"^[A-Z]{3}$", strict=True)]
    content_version: Annotated[
        str, Field(pattern=r"^OVERVIEW-[A-Z]{3}-\d{8}-R[1-9]\d*$", max_length=80, strict=True)
    ]
    as_of: date
    locales: dict[MarketLocale, LocalizedMarketOverview]

    @field_validator("as_of", mode="before")
    @classmethod
    def require_date_only(cls, value: object) -> object:
        return _calendar_date(value)

    @model_validator(mode="after")
    def matching_overview(self) -> CountryMarketOverview:
        if self.country_code == "CHN":
            raise ValueError("China is not an outbound target market")
        if not self.content_version.startswith(f"OVERVIEW-{self.country_code}-"):
            raise ValueError("overview version must identify the same country")
        version_date = self.content_version.split("-")[2]
        version_day = date.fromisoformat(
            f"{version_date[:4]}-{version_date[4:6]}-{version_date[6:]}"
        )
        if version_day < self.as_of:
            raise ValueError("overview as_of cannot be later than the version's calendar date")
        if set(self.locales) != {"zh-CN", "en"}:
            raise ValueError("both zh-CN and en overviews are required")
        zh = self.locales["zh-CN"]
        en = self.locales["en"]
        if len(zh.paragraphs) != len(en.paragraphs):
            raise ValueError("bilingual overviews must have the same number of paragraphs")
        length = overview_character_count("".join(zh.paragraphs))
        if not 1500 <= length <= 2000:
            raise ValueError(
                "Chinese overview body must contain 1500 to 2000 non-whitespace characters"
            )
        return self


class MarketContentMeta(MarketModel):
    country_code: str
    content_version: str
    as_of: date
    locale: MarketLocale


class MarketContentResponse[T](MarketModel):
    meta: MarketContentMeta
    data: T
