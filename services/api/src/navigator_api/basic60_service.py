"""Read-only release-scoped queries and DTO mapping for BASIC60."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql.elements import ColumnElement

from navigator_api.basic60_errors import Basic60APIError
from navigator_api.basic60_models import (
    Basic60Country,
    Basic60LocalizedText,
    Basic60MetricValue,
    Basic60Release,
    Basic60SourceRegistry,
)
from navigator_api.basic60_schemas import (
    AdminStructure,
    Capital,
    ComparisonCountry,
    CountryComparisonResult,
    CountryDetail,
    CountrySummary,
    Currency,
    Language,
    LocalName,
    MetricObservation,
    MetricPeriod,
    Timezone,
)

COUNTRY_LOAD_OPTIONS = (
    selectinload(Basic60Country.localized_texts),
    selectinload(Basic60Country.capitals),
    selectinload(Basic60Country.languages),
    selectinload(Basic60Country.currencies),
    selectinload(Basic60Country.timezones),
    selectinload(Basic60Country.admin_structures),
    selectinload(Basic60Country.metric_values).selectinload(Basic60MetricValue.definition),
)


def get_active_release(session: Session, authorized_release_id: str) -> Basic60Release:
    release = session.scalar(
        select(Basic60Release).where(
            Basic60Release.release_id == authorized_release_id,
            Basic60Release.is_active.is_(True),
            Basic60Release.status == "private_trial_ready",
            Basic60Release.release_profile == "basic60_private",
            Basic60Release.formal_gate_status == "pending",
        )
    )
    if release is None:
        raise Basic60APIError(
            status_code=503,
            code="BASIC60_NO_ACTIVE_RELEASE",
            message="BASIC60 没有经过授权且处于活动状态的私有试用发布。",
        )
    return release


def get_active_source_refs(session: Session, release_id: str) -> frozenset[str]:
    """Return the active source references used to filter publishable values."""

    return frozenset(
        session.scalars(
            select(Basic60SourceRegistry.source_ref).where(
                Basic60SourceRegistry.release_id == release_id,
                Basic60SourceRegistry.status == "active",
            )
        )
    )


def _visible_short_name(
    locale: str,
    active_source_refs: frozenset[str],
) -> ColumnElement[bool]:
    return Basic60Country.localized_texts.any(
        and_(
            Basic60LocalizedText.field_code == "short_name",
            Basic60LocalizedText.locale == locale,
            Basic60LocalizedText.preferred.is_(True),
            Basic60LocalizedText.translation_status == "reviewed",
            Basic60LocalizedText.source_ref.in_(active_source_refs),
        )
    )


def _outbound_target_market() -> ColumnElement[bool]:
    """Keep China in the immutable source release, not in overseas market queries."""

    return Basic60Country.iso3 != "CHN"


def _preferred_name(
    country: Basic60Country,
    locale: str,
    active_source_refs: frozenset[str],
) -> str:
    candidates = [
        item
        for item in country.localized_texts
        if item.field_code == "short_name"
        and item.locale == locale
        and item.source_ref in active_source_refs
    ]
    preferred = next((item for item in candidates if item.preferred), None)
    if preferred is None and candidates:
        preferred = candidates[0]
    return preferred.text if preferred is not None else country.iso3


def _metric_item(value: Basic60MetricValue, locale: str) -> MetricObservation:
    return MetricObservation(
        metric_code=value.definition.metric_code,
        label=(value.definition.label_en if locale == "en" else value.definition.label_zh),
        value=float(value.normalized_value) if value.normalized_value is not None else None,
        unit=value.normalized_unit,
        period=MetricPeriod(
            start=value.period_start,
            end=value.period_end,
            label=value.period_label,
        ),
        value_status=value.value_status,  # type: ignore[arg-type]
        null_reason=value.null_reason,
        quality_status=value.quality_status,
        freshness_status=value.freshness_status,
    )


def _metric_values_as_of(
    country: Basic60Country,
    as_of: date,
    active_source_refs: frozenset[str],
    *,
    domain: str | None = None,
) -> list[Basic60MetricValue]:
    return [
        item
        for item in country.metric_values
        if item.period_end <= as_of
        and item.source_ref in active_source_refs
        and (domain is None or item.definition.data_domain == domain)
    ]


def _latest_metric_values(
    country: Basic60Country,
    as_of: date,
    active_source_refs: frozenset[str],
) -> list[Basic60MetricValue]:
    latest: dict[str, Basic60MetricValue] = {}
    for item in _metric_values_as_of(country, as_of, active_source_refs):
        code = item.definition.metric_code
        current = latest.get(code)
        if current is None or (item.period_end, item.period_start) > (
            current.period_end,
            current.period_start,
        ):
            latest[code] = item
    return [latest[code] for code in sorted(latest)]


def country_summary(
    country: Basic60Country,
    as_of: date,
    locale: str,
    active_source_refs: frozenset[str],
) -> CountrySummary:
    return CountrySummary(
        code=country.iso3,
        iso2=country.iso2,
        name_zh=_preferred_name(country, "zh-CN", active_source_refs),
        name_en=_preferred_name(country, "en", active_source_refs),
        region_code=country.region_code,
        coverage_level="Basic",
        last_reviewed_at=country.last_reviewed_at,
        opportunity_level="pending",
        policy_friendliness_level="pending",
        risk_assessment_status="unknown",
        risk_level=None,
        latest_metrics=[
            _metric_item(item, locale)
            for item in _latest_metric_values(country, as_of, active_source_refs)
        ],
    )


def list_countries(
    session: Session,
    *,
    release: Basic60Release,
    query: str | None,
    region: str | None,
    cursor: str | None,
    limit: int,
    active_source_refs: frozenset[str],
) -> tuple[list[Basic60Country], str | None]:
    statement = select(Basic60Country).where(
        Basic60Country.release_id == release.release_id,
        _outbound_target_market(),
        _visible_short_name("zh-CN", active_source_refs),
        _visible_short_name("en", active_source_refs),
    )
    if query:
        pattern = f"%{query.strip()}%"
        statement = statement.where(
            or_(
                Basic60Country.iso3.ilike(pattern),
                Basic60Country.iso2.ilike(pattern),
                Basic60Country.localized_texts.any(
                    and_(
                        Basic60LocalizedText.text.ilike(pattern),
                        Basic60LocalizedText.source_ref.in_(active_source_refs),
                    )
                ),
            )
        )
    if region:
        statement = statement.where(Basic60Country.region_code == region)
    if cursor:
        statement = statement.where(Basic60Country.iso3 > cursor.upper())
    statement = (
        statement.order_by(Basic60Country.iso3).limit(limit + 1).options(*COUNTRY_LOAD_OPTIONS)
    )
    rows = list(session.scalars(statement).all())
    next_cursor = rows[limit - 1].iso3 if len(rows) > limit else None
    return rows[:limit], next_cursor


def get_country(
    session: Session,
    *,
    release: Basic60Release,
    country_code: str,
    active_source_refs: frozenset[str],
) -> Basic60Country:
    statement = (
        select(Basic60Country)
        .where(
            Basic60Country.release_id == release.release_id,
            Basic60Country.iso3 == country_code.upper(),
            _outbound_target_market(),
            _visible_short_name("zh-CN", active_source_refs),
            _visible_short_name("en", active_source_refs),
        )
        .options(*COUNTRY_LOAD_OPTIONS)
    )
    country = session.scalar(statement)
    if country is None:
        raise Basic60APIError(
            status_code=404,
            code="COUNTRY_NOT_FOUND",
            message=f"BASIC60 私有试用的出海目标市场范围内不存在国家代码 {country_code.upper()}。",
        )
    return country


def country_detail(
    session: Session,
    *,
    release: Basic60Release,
    country: Basic60Country,
    as_of: date,
    locale: str,
    expansions: set[str],
    active_source_refs: frozenset[str],
) -> CountryDetail:
    summary = country_summary(country, as_of, locale, active_source_refs)
    identity = "identity" in expansions
    return CountryDetail(
        **summary.model_dump(exclude={"latest_metrics"}),
        local_names=(
            [
                LocalName(
                    locale=item.locale,
                    text=item.text,
                    preferred=item.preferred,
                    translation_status=item.translation_status,
                )
                for item in sorted(
                    country.localized_texts, key=lambda row: (row.field_code, row.locale, row.text)
                )
                if item.field_code == "local_name" and item.source_ref in active_source_refs
            ]
            if identity
            else None
        ),
        capitals=(
            [
                Capital(
                    name=item.name,
                    role=item.role,
                    display_order=item.display_order,
                    valid_from=item.valid_from,
                    valid_to=item.valid_to,
                )
                for item in sorted(country.capitals, key=lambda row: row.display_order)
                if item.source_ref in active_source_refs
            ]
            if identity
            else None
        ),
        languages=(
            [
                Language(
                    code=item.language_code,
                    name_en=item.name_en,
                    name_local=item.name_local,
                    status=item.status,
                )
                for item in sorted(country.languages, key=lambda row: row.language_code)
                if item.source_ref in active_source_refs
            ]
            if identity
            else None
        ),
        currencies=(
            [
                Currency(
                    code=item.currency_code,
                    name_en=item.name_en,
                    legal_tender=item.legal_tender,
                    valid_from=item.valid_from,
                    valid_to=item.valid_to,
                )
                for item in sorted(country.currencies, key=lambda row: row.currency_code)
                if item.source_ref in active_source_refs
            ]
            if identity
            else None
        ),
        timezones=(
            [
                Timezone(
                    iana_code=item.iana_code,
                    primary=item.primary,
                )
                for item in sorted(
                    country.timezones, key=lambda row: (not row.primary, row.iana_code)
                )
                if item.source_ref in active_source_refs
            ]
            if identity
            else None
        ),
        admin_structures=(
            [
                AdminStructure(
                    admin_level=item.admin_level,
                    unit_type=item.unit_type,
                    unit_count=item.unit_count,
                    as_of_year=item.as_of_year,
                    status=item.status,
                )
                for item in sorted(
                    country.admin_structures,
                    key=lambda row: (row.admin_level, row.as_of_year, row.unit_type),
                )
                if item.source_ref in active_source_refs
            ]
            if identity
            else None
        ),
        macro=(
            [
                _metric_item(item, locale)
                for item in sorted(
                    _metric_values_as_of(
                        country,
                        as_of,
                        active_source_refs,
                        domain="macro",
                    ),
                    key=lambda row: (row.definition.metric_code, row.period_start),
                )
            ]
            if "macro" in expansions
            else None
        ),
        energy=(
            [
                _metric_item(item, locale)
                for item in sorted(
                    _metric_values_as_of(
                        country,
                        as_of,
                        active_source_refs,
                        domain="energy",
                    ),
                    key=lambda row: (row.definition.metric_code, row.period_start),
                )
            ]
            if "energy" in expansions
            else None
        ),
    )


def compare_countries(
    session: Session,
    *,
    release: Basic60Release,
    country_codes: Sequence[str],
    metric_codes: Sequence[str] | None,
    as_of: date,
    locale: str,
) -> CountryComparisonResult:
    active_source_refs = get_active_source_refs(session, release.release_id)
    countries = [
        get_country(
            session,
            release=release,
            country_code=code,
            active_source_refs=active_source_refs,
        )
        for code in country_codes
    ]
    latest_by_country = {
        country.iso3: {
            item.definition.metric_code: item
            for item in _latest_metric_values(country, as_of, active_source_refs)
            if item.value_status == "available"
        }
        for country in countries
    }
    common = set.intersection(*(set(values) for values in latest_by_country.values()))
    requested = list(metric_codes) if metric_codes is not None else sorted(common)
    common_ordered = [code for code in requested if code in common]
    excluded = [code for code in requested if code not in common]
    return CountryComparisonResult(
        countries=[
            ComparisonCountry(
                code=country.iso3,
                name_zh=_preferred_name(country, "zh-CN", active_source_refs),
                name_en=_preferred_name(country, "en", active_source_refs),
                metrics=[
                    _metric_item(latest_by_country[country.iso3][code], locale)
                    for code in common_ordered
                ],
            )
            for country in countries
        ],
        common_metric_codes=common_ordered,
        excluded_metric_codes=excluded,
    )


def effective_as_of(release: Basic60Release, requested: date | None) -> date:
    return min(requested, release.as_of) if requested is not None else release.as_of


def validated_expansions(raw: str) -> set[str]:
    expansions = {item.strip() for item in raw.split(",") if item.strip()}
    supported = {"identity", "macro", "energy"}
    unknown = expansions - supported
    if unknown:
        raise Basic60APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="expand 包含不支持的分组。",
            details=[{"unsupported_expansions": sorted(unknown)}],
        )
    return expansions
