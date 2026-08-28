"""Normalized, release-scoped SQLAlchemy models for the BASIC60 private trial.

The BASIC60 metadata is deliberately separate from the bounded synthetic-demo
metadata in :mod:`navigator_api.models`.  A BASIC60 deployment therefore uses a
different database and migration chain and cannot accidentally expose or mutate
the demo tables.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> UUID:
    return uuid4()


class Basic60Base(DeclarativeBase):
    """Dedicated metadata for the real-data private-trial database."""


class Basic60Release(Basic60Base):
    __tablename__ = "basic60_release_snapshots"
    __table_args__ = (
        CheckConstraint("release_profile = 'basic60_private'", name="ck_basic60_release_profile"),
        CheckConstraint("formal_gate_status = 'pending'", name="ck_basic60_formal_gate_pending"),
        CheckConstraint(
            "status IN ('private_trial_ready', 'not_ready', 'revoked')",
            name="ck_basic60_release_status",
        ),
        CheckConstraint(
            "NOT is_active OR status = 'private_trial_ready'",
            name="ck_basic60_active_release_ready",
        ),
        CheckConstraint(
            "length(manual_usage_authorization_sha256) = 64",
            name="ck_basic60_manual_usage_authorization_sha256",
        ),
    )

    release_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    release_profile: Mapped[str] = mapped_column(
        String(32), nullable=False, default="basic60_private", server_default="basic60_private"
    )
    formal_gate_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending", server_default="pending"
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    as_of: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    source_cutoff: Mapped[date] = mapped_column(Date, nullable=False)
    artifact_schema_version: Mapped[str] = mapped_column(String(40), nullable=False)
    artifact_sha256: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    release_bundle_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    validation_report_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    declared_counts: Mapped[dict[str, int]] = mapped_column(JSON, nullable=False)
    manual_usage_authorization: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    manual_usage_authorization_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    sources: Mapped[list[Basic60SourceRegistry]] = relationship(
        back_populates="release", cascade="all, delete-orphan"
    )
    countries: Mapped[list[Basic60Country]] = relationship(
        back_populates="release", cascade="all, delete-orphan"
    )
    metric_definitions: Mapped[list[Basic60MetricDefinition]] = relationship(
        back_populates="release", cascade="all, delete-orphan"
    )


class Basic60SourceRegistry(Basic60Base):
    __tablename__ = "basic60_source_registry"
    __table_args__ = (
        UniqueConstraint("release_id", "source_ref", name="uq_basic60_source_release_ref"),
        CheckConstraint(
            "data_domain IN ('country_identity', 'macro', 'energy')",
            name="ck_basic60_source_domain",
        ),
        CheckConstraint("source_role IN ('primary', 'alternate')", name="ck_basic60_source_role"),
        CheckConstraint(
            "status IN ('active', 'revoked')",
            name="ck_basic60_source_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    release_id: Mapped[str] = mapped_column(
        ForeignKey("basic60_release_snapshots.release_id"), nullable=False, index=True
    )
    source_ref: Mapped[str] = mapped_column(String(120), nullable=False)
    provider: Mapped[str] = mapped_column(String(160), nullable=False)
    dataset: Mapped[str] = mapped_column(String(240), nullable=False)
    data_domain: Mapped[str] = mapped_column(String(32), nullable=False)
    source_role: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    terms_uri: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    access_method: Mapped[str] = mapped_column(String(80), nullable=False)
    rate_limit: Mapped[str | None] = mapped_column(String(160))

    release: Mapped[Basic60Release] = relationship(back_populates="sources")
    snapshots: Mapped[list[Basic60SourceSnapshot]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )


class Basic60SourceSnapshot(Basic60Base):
    __tablename__ = "basic60_source_snapshots"
    __table_args__ = (
        UniqueConstraint("source_id", "snapshot_ref", name="uq_basic60_source_snapshot_ref"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    source_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_source_registry.id"), nullable=False, index=True
    )
    snapshot_ref: Mapped[str] = mapped_column(String(180), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    retrieval_uri: Mapped[str | None] = mapped_column(Text)
    media_type: Mapped[str] = mapped_column(String(120), nullable=False)

    source: Mapped[Basic60SourceRegistry] = relationship(back_populates="snapshots")
    raw_records: Mapped[list[Basic60RawRecord]] = relationship(back_populates="source_snapshot")


class Basic60Country(Basic60Base):
    __tablename__ = "basic60_countries"
    __table_args__ = (
        UniqueConstraint("release_id", "iso3", name="uq_basic60_country_release_iso3"),
        UniqueConstraint("release_id", "iso2", name="uq_basic60_country_release_iso2"),
        CheckConstraint("length(iso3) = 3", name="ck_basic60_country_iso3"),
        CheckConstraint("length(iso2) = 2", name="ck_basic60_country_iso2"),
        CheckConstraint("coverage_status = 'covered'", name="ck_basic60_country_covered"),
        CheckConstraint("coverage_level = 'Basic'", name="ck_basic60_country_level"),
        CheckConstraint("opportunity_level = 'pending'", name="ck_basic60_country_opportunity"),
        CheckConstraint("policy_friendliness_level = 'pending'", name="ck_basic60_country_policy"),
        CheckConstraint(
            "risk_assessment_status = 'unknown'", name="ck_basic60_country_risk_status"
        ),
        CheckConstraint("risk_level IS NULL", name="ck_basic60_country_risk_null"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    release_id: Mapped[str] = mapped_column(
        ForeignKey("basic60_release_snapshots.release_id"), nullable=False, index=True
    )
    iso3: Mapped[str] = mapped_column(String(3), nullable=False, index=True)
    iso2: Mapped[str] = mapped_column(String(2), nullable=False)
    region_code: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    coverage_status: Mapped[str] = mapped_column(String(24), nullable=False)
    coverage_level: Mapped[str] = mapped_column(String(16), nullable=False)
    opportunity_level: Mapped[str] = mapped_column(String(24), nullable=False)
    policy_friendliness_level: Mapped[str] = mapped_column(String(24), nullable=False)
    risk_assessment_status: Mapped[str] = mapped_column(String(24), nullable=False)
    risk_level: Mapped[str | None] = mapped_column(String(24))
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    release: Mapped[Basic60Release] = relationship(back_populates="countries")
    localized_texts: Mapped[list[Basic60LocalizedText]] = relationship(
        back_populates="country", cascade="all, delete-orphan"
    )
    capitals: Mapped[list[Basic60Capital]] = relationship(
        back_populates="country", cascade="all, delete-orphan"
    )
    languages: Mapped[list[Basic60CountryLanguage]] = relationship(
        back_populates="country", cascade="all, delete-orphan"
    )
    currencies: Mapped[list[Basic60CountryCurrency]] = relationship(
        back_populates="country", cascade="all, delete-orphan"
    )
    timezones: Mapped[list[Basic60CountryTimezone]] = relationship(
        back_populates="country", cascade="all, delete-orphan"
    )
    admin_structures: Mapped[list[Basic60AdminStructure]] = relationship(
        back_populates="country", cascade="all, delete-orphan"
    )
    metric_values: Mapped[list[Basic60MetricValue]] = relationship(
        back_populates="country", cascade="all, delete-orphan"
    )


class Basic60LocalizedText(Basic60Base):
    __tablename__ = "basic60_localized_texts"
    __table_args__ = (
        UniqueConstraint(
            "country_id", "field_code", "locale", "text", name="uq_basic60_localized_text"
        ),
        CheckConstraint(
            "translation_status IN ('reviewed', 'source', 'pending')",
            name="ck_basic60_translation_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    country_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_countries.id"), nullable=False, index=True
    )
    field_code: Mapped[str] = mapped_column(String(40), nullable=False)
    locale: Mapped[str] = mapped_column(String(40), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    preferred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    translation_status: Mapped[str] = mapped_column(String(24), nullable=False)
    source_text_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    source_ref: Mapped[str] = mapped_column(String(120), nullable=False)

    country: Mapped[Basic60Country] = relationship(back_populates="localized_texts")


class Basic60Capital(Basic60Base):
    __tablename__ = "basic60_country_capitals"
    __table_args__ = (
        UniqueConstraint("country_id", "name", "role", name="uq_basic60_capital_role"),
        CheckConstraint(
            "role IN ('official', 'administrative', 'legislative', 'judicial', 'de_facto')",
            name="ck_basic60_capital_role",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    country_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_countries.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(24), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    source_ref: Mapped[str] = mapped_column(String(120), nullable=False)

    country: Mapped[Basic60Country] = relationship(back_populates="capitals")


class Basic60CountryLanguage(Basic60Base):
    __tablename__ = "basic60_country_languages"
    __table_args__ = (
        UniqueConstraint("country_id", "language_code", name="uq_basic60_country_language"),
        CheckConstraint(
            "status IN ('official', 'co_official', 'recognized')",
            name="ck_basic60_language_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    country_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_countries.id"), nullable=False, index=True
    )
    language_code: Mapped[str] = mapped_column(String(40), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_local: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(120), nullable=False)

    country: Mapped[Basic60Country] = relationship(back_populates="languages")


class Basic60CountryCurrency(Basic60Base):
    __tablename__ = "basic60_country_currencies"
    __table_args__ = (
        UniqueConstraint("country_id", "currency_code", name="uq_basic60_country_currency"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    country_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_countries.id"), nullable=False, index=True
    )
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    legal_tender: Mapped[bool] = mapped_column(Boolean, nullable=False)
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    source_ref: Mapped[str] = mapped_column(String(120), nullable=False)

    country: Mapped[Basic60Country] = relationship(back_populates="currencies")


class Basic60CountryTimezone(Basic60Base):
    __tablename__ = "basic60_country_timezones"
    __table_args__ = (
        UniqueConstraint("country_id", "iana_code", name="uq_basic60_country_timezone"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    country_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_countries.id"), nullable=False, index=True
    )
    iana_code: Mapped[str] = mapped_column(String(80), nullable=False)
    primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_ref: Mapped[str] = mapped_column(String(120), nullable=False)

    country: Mapped[Basic60Country] = relationship(back_populates="timezones")


class Basic60AdminStructure(Basic60Base):
    __tablename__ = "basic60_admin_structures"
    __table_args__ = (
        UniqueConstraint(
            "country_id", "admin_level", "unit_type", "as_of_year", name="uq_basic60_admin"
        ),
        CheckConstraint("admin_level >= 1", name="ck_basic60_admin_level"),
        CheckConstraint("unit_count >= 0", name="ck_basic60_admin_count"),
        CheckConstraint("status IN ('reviewed', 'pending')", name="ck_basic60_admin_status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    country_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_countries.id"), nullable=False, index=True
    )
    admin_level: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_type: Mapped[str] = mapped_column(String(120), nullable=False)
    unit_count: Mapped[int] = mapped_column(Integer, nullable=False)
    as_of_year: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(120), nullable=False)

    country: Mapped[Basic60Country] = relationship(back_populates="admin_structures")


class Basic60MetricDefinition(Basic60Base):
    __tablename__ = "basic60_metric_definitions"
    __table_args__ = (
        UniqueConstraint("release_id", "metric_code", name="uq_basic60_metric_release_code"),
        CheckConstraint(
            "data_domain IN ('identity', 'macro', 'energy')",
            name="ck_basic60_metric_domain",
        ),
        CheckConstraint("period_type IN ('year', 'date', 'latest')", name="ck_basic60_period_type"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    release_id: Mapped[str] = mapped_column(
        ForeignKey("basic60_release_snapshots.release_id"), nullable=False, index=True
    )
    metric_code: Mapped[str] = mapped_column(String(80), nullable=False)
    label_zh: Mapped[str] = mapped_column(String(160), nullable=False)
    label_en: Mapped[str] = mapped_column(String(160), nullable=False)
    data_domain: Mapped[str] = mapped_column(String(16), nullable=False)
    canonical_unit: Mapped[str] = mapped_column(String(40), nullable=False)
    period_type: Mapped[str] = mapped_column(String(16), nullable=False)
    display_precision: Mapped[int] = mapped_column(Integer, nullable=False)
    normalization_rule: Mapped[str] = mapped_column(Text, nullable=False)

    release: Mapped[Basic60Release] = relationship(back_populates="metric_definitions")
    values: Mapped[list[Basic60MetricValue]] = relationship(back_populates="definition")


class Basic60MetricValue(Basic60Base):
    __tablename__ = "basic60_metric_values"
    __table_args__ = (
        UniqueConstraint(
            "country_id",
            "metric_definition_id",
            "period_start",
            "period_end",
            name="uq_basic60_metric_observation",
        ),
        CheckConstraint("period_start <= period_end", name="ck_basic60_metric_period"),
        CheckConstraint(
            "value_status IN ('available', 'pending', 'unavailable')",
            name="ck_basic60_metric_value_status",
        ),
        CheckConstraint(
            "(value_status = 'available' AND normalized_value IS NOT NULL AND null_reason IS NULL) "
            "OR (value_status <> 'available' AND normalized_value IS NULL "
            "AND null_reason IS NOT NULL)",
            name="ck_basic60_metric_value_null_semantics",
        ),
        CheckConstraint(
            "quality_status IN ('reviewed', 'machine_validated', 'pending')",
            name="ck_basic60_metric_quality",
        ),
        CheckConstraint(
            "freshness_status IN ('current', 'aging', 'stale', 'pending')",
            name="ck_basic60_metric_freshness",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    country_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_countries.id"), nullable=False, index=True
    )
    metric_definition_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_metric_definitions.id"), nullable=False, index=True
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    period_label: Mapped[str] = mapped_column(String(40), nullable=False)
    original_value: Mapped[Decimal | None] = mapped_column(Numeric(30, 8))
    original_unit: Mapped[str] = mapped_column(String(40), nullable=False)
    normalized_value: Mapped[Decimal | None] = mapped_column(Numeric(30, 8))
    normalized_unit: Mapped[str] = mapped_column(String(40), nullable=False)
    value_status: Mapped[str] = mapped_column(String(24), nullable=False)
    null_reason: Mapped[str | None] = mapped_column(String(240))
    source_ref: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    source_snapshot_ref: Mapped[str] = mapped_column(String(180), nullable=False)
    raw_record_ref: Mapped[str] = mapped_column(String(180), nullable=False)
    quality_status: Mapped[str] = mapped_column(String(32), nullable=False)
    freshness_status: Mapped[str] = mapped_column(String(24), nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    country: Mapped[Basic60Country] = relationship(back_populates="metric_values")
    definition: Mapped[Basic60MetricDefinition] = relationship(back_populates="values")


class Basic60RawRecord(Basic60Base):
    __tablename__ = "basic60_raw_records"
    __table_args__ = (
        UniqueConstraint("release_id", "record_ref", name="uq_basic60_raw_release_ref"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    release_id: Mapped[str] = mapped_column(
        ForeignKey("basic60_release_snapshots.release_id"), nullable=False, index=True
    )
    source_snapshot_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_source_snapshots.id"), nullable=False, index=True
    )
    record_ref: Mapped[str] = mapped_column(String(180), nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(3), index=True)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    media_type: Mapped[str] = mapped_column(String(120), nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    source_snapshot: Mapped[Basic60SourceSnapshot] = relationship(back_populates="raw_records")
    provenance: Mapped[list[Basic60FieldProvenance]] = relationship(back_populates="raw_record")


class Basic60FieldProvenance(Basic60Base):
    __tablename__ = "basic60_field_provenance"
    __table_args__ = (
        UniqueConstraint(
            "release_id",
            "entity_type",
            "entity_key",
            "field_path",
            "source_ref",
            name="uq_basic60_field_provenance",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    release_id: Mapped[str] = mapped_column(
        ForeignKey("basic60_release_snapshots.release_id"), nullable=False, index=True
    )
    raw_record_id: Mapped[UUID] = mapped_column(
        ForeignKey("basic60_raw_records.id"), nullable=False, index=True
    )
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_key: Mapped[str] = mapped_column(String(200), nullable=False)
    field_path: Mapped[str] = mapped_column(String(240), nullable=False)
    source_field: Mapped[str] = mapped_column(String(240), nullable=False)
    transform_ref: Mapped[str | None] = mapped_column(String(160))
    source_ref: Mapped[str] = mapped_column(String(120), nullable=False)
    quality_status: Mapped[str] = mapped_column(String(32), nullable=False)

    raw_record: Mapped[Basic60RawRecord] = relationship(back_populates="provenance")


class Basic60DataRecordVersion(Basic60Base):
    __tablename__ = "basic60_data_record_versions"
    __table_args__ = (
        UniqueConstraint(
            "release_id",
            "entity_type",
            "entity_key",
            "version_number",
            name="uq_basic60_record_version",
        ),
        CheckConstraint("version_number >= 1", name="ck_basic60_record_version_positive"),
        CheckConstraint(
            "record_status IN ('published', 'pending', 'revoked')",
            name="ck_basic60_record_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    release_id: Mapped[str] = mapped_column(
        ForeignKey("basic60_release_snapshots.release_id"), nullable=False, index=True
    )
    raw_record_id: Mapped[UUID | None] = mapped_column(ForeignKey("basic60_raw_records.id"))
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_key: Mapped[str] = mapped_column(String(200), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    record_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    record_status: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
