"""Strict JSON contract consumed by the BASIC60 database importer."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SHA256_LENGTH = 64
METRIC_CODES = frozenset(
    {
        "population_total",
        "land_area_sq_km",
        "gdp_current_usd",
        "gdp_growth_pct",
        "gdp_per_capita_current_usd",
        "inflation_cpi_pct",
        "official_exchange_rate_lcu_per_usd",
        "fdi_net_inflows_usd",
        "electricity_installed_capacity_mw",
        "electricity_generation_gwh",
        "renewable_capacity_mw",
        "renewable_generation_gwh",
        "renewable_share_capacity_pct",
        "renewable_share_generation_pct",
        "electricity_demand_gwh",
    }
)


def _sha256(value: str, field_name: str) -> str:
    normalized = value.lower()
    if len(normalized) != SHA256_LENGTH or any(
        character not in "0123456789abcdef" for character in normalized
    ):
        raise ValueError(f"{field_name} must be a SHA-256 digest")
    return normalized


class SeedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReleaseCounts(SeedModel):
    countries: int = Field(ge=1)
    macro_rows: int = Field(ge=0)
    energy_rows: int = Field(ge=0)
    available_metric_values: int = Field(ge=0)
    pending_metric_values: int = Field(ge=0)


class SeedRelease(SeedModel):
    release_id: Literal["BASIC60-PRIVATE-R1"]
    release_profile: Literal["basic60_private"]
    formal_gate_status: Literal["pending"]
    status: Literal["private_trial_ready", "not_ready", "revoked"]
    as_of: date
    source_cutoff: date
    release_bundle_sha256: str
    validation_report_sha256: str
    counts: ReleaseCounts

    @field_validator("release_bundle_sha256", "validation_report_sha256")
    @classmethod
    def validate_digests(cls, value: str, info: object) -> str:
        field_name = getattr(info, "field_name", "digest")
        return _sha256(value, str(field_name))


class ManualUsageFieldScope(SeedModel):
    mode: Literal["all_normalized_basic60_fields"]
    field_count: int = Field(ge=1)
    fields_sha256: str

    @field_validator("fields_sha256")
    @classmethod
    def validate_fields_sha256(cls, value: str) -> str:
        return _sha256(value, "fields_sha256")


class V1RuntimeCapabilities(SeedModel):
    ai_routes_enabled: Literal[False]
    external_model_calls_enabled: Literal[False]
    local_model_service_enabled: Literal[False]
    vector_database_enabled: Literal[False]
    embedding_enabled: Literal[False]
    reranking_enabled: Literal[False]
    full_text_search_enabled: Literal[False]


class ManualUsageAuthorization(SeedModel):
    """The one human permission decision carried by an importable release."""

    permission_basis: Literal["PBD-BASIC60-PRIVATE-001-A1"]
    permission_authority: Literal["project_owner_manual_decision"]
    field_scope: ManualUsageFieldScope
    allowed_uses: tuple[
        Literal["internal_learning_and_exchange"],
        Literal["private_display"],
        Literal["internal_ai_processing"],
        Literal["local_model_processing"],
        Literal["controlled_external_model_processing"],
    ]
    prohibited_uses: tuple[
        Literal["public_release"],
        Literal["model_training"],
    ]
    v1_runtime_capabilities: V1RuntimeCapabilities


class SeedArtifactReference(SeedModel):
    path: str = Field(min_length=1)
    sha256: str

    @field_validator("sha256")
    @classmethod
    def validate_sha256(cls, value: str) -> str:
        return _sha256(value, "sha256")


class AIUsagePolicySummary(SeedModel):
    """Machine projection of A1; this is not a second permission decision."""

    projection_type: Literal["machine_generated_all_field_scope_projection"]
    permission_basis: Literal["PBD-BASIC60-PRIVATE-001-A1"]
    policy_reference: SeedArtifactReference
    seed_sha256: str
    field_count: int = Field(ge=1)
    fields_sha256: str

    @field_validator("seed_sha256", "fields_sha256")
    @classmethod
    def validate_digests(cls, value: str, info: object) -> str:
        field_name = getattr(info, "field_name", "digest")
        return _sha256(value, str(field_name))


class SourceSnapshotArtifact(SeedModel):
    snapshot_ref: str = Field(min_length=1, max_length=180)
    captured_at: datetime
    content_sha256: str
    retrieval_uri: str = Field(min_length=1)
    media_type: str = Field(min_length=1, max_length=120)

    @field_validator("captured_at")
    @classmethod
    def validate_captured_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("captured_at must be timezone-aware")
        return value

    @field_validator("content_sha256")
    @classmethod
    def validate_content_sha256(cls, value: str) -> str:
        return _sha256(value, "content_sha256")


class SourceArtifact(SeedModel):
    source_ref: str = Field(min_length=1, max_length=120)
    provider: str = Field(min_length=1, max_length=160)
    dataset: str = Field(min_length=1, max_length=240)
    data_domain: Literal["country_identity", "macro", "energy"]
    source_role: Literal["primary"]
    status: Literal["active"]
    terms_uri: str = Field(min_length=1)
    evidence_sha256: str
    access_method: str = Field(min_length=1, max_length=80)
    rate_limit: str | None = Field(default=None, max_length=160)
    snapshots: list[SourceSnapshotArtifact] = Field(min_length=1)

    @field_validator("evidence_sha256")
    @classmethod
    def validate_evidence_sha256(cls, value: str) -> str:
        return _sha256(value, "evidence_sha256")


class RawRecordArtifact(SeedModel):
    record_ref: str = Field(min_length=1, max_length=180)
    source_ref: str = Field(min_length=1, max_length=120)
    source_snapshot_ref: str = Field(min_length=1, max_length=180)
    country_code: str | None = Field(default=None, min_length=3, max_length=3)
    object_key: str = Field(min_length=1)
    payload_sha256: str
    media_type: str = Field(min_length=1, max_length=120)

    @field_validator("country_code")
    @classmethod
    def normalize_country_code(cls, value: str | None) -> str | None:
        return value.upper() if value is not None else None

    @field_validator("payload_sha256")
    @classmethod
    def validate_payload_sha256(cls, value: str) -> str:
        return _sha256(value, "payload_sha256")


class ProvenancedArtifact(SeedModel):
    source_ref: str = Field(min_length=1, max_length=120)
    source_snapshot_ref: str = Field(min_length=1, max_length=180)
    raw_record_ref: str = Field(min_length=1, max_length=180)


class LocalizedTextArtifact(ProvenancedArtifact):
    field_code: Literal["short_name", "official_name", "local_name"]
    locale: str = Field(min_length=2, max_length=40)
    text: str = Field(min_length=1)
    preferred: bool = False
    translation_status: Literal["reviewed", "source", "pending"]
    source_text_sha256: str
    valid_from: date | None = None
    valid_to: date | None = None

    @field_validator("source_text_sha256")
    @classmethod
    def validate_source_text_sha256(cls, value: str) -> str:
        return _sha256(value, "source_text_sha256")


class CapitalArtifact(ProvenancedArtifact):
    name: str = Field(min_length=1, max_length=160)
    role: Literal["official", "administrative", "legislative", "judicial", "de_facto"]
    display_order: int = Field(ge=1)
    valid_from: date | None = None
    valid_to: date | None = None


class LanguageArtifact(ProvenancedArtifact):
    code: str = Field(min_length=2, max_length=40)
    name_en: str = Field(min_length=1, max_length=120)
    name_local: str | None = Field(default=None, max_length=160)
    status: Literal["official", "co_official", "recognized"]


class CurrencyArtifact(ProvenancedArtifact):
    code: str = Field(min_length=3, max_length=3)
    name_en: str = Field(min_length=1, max_length=120)
    legal_tender: bool
    valid_from: date | None = None
    valid_to: date | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.upper()


class TimezoneArtifact(ProvenancedArtifact):
    iana_code: str = Field(min_length=3, max_length=80)
    primary: bool = False


class AdminStructureArtifact(ProvenancedArtifact):
    admin_level: int = Field(ge=1)
    unit_type: str = Field(min_length=1, max_length=120)
    unit_count: int = Field(ge=0)
    as_of_year: int = Field(ge=1900, le=2200)
    status: Literal["reviewed", "pending"]


class MetricValueArtifact(ProvenancedArtifact):
    metric_code: str = Field(min_length=1, max_length=80)
    period_start: date
    period_end: date
    period_label: str = Field(min_length=1, max_length=40)
    original_value: Decimal | None = None
    original_unit: str = Field(min_length=1, max_length=40)
    normalized_value: Decimal | None = None
    normalized_unit: str = Field(min_length=1, max_length=40)
    value_status: Literal["available", "pending", "unavailable"]
    null_reason: str | None = Field(default=None, max_length=240)
    quality_status: Literal["reviewed", "machine_validated", "pending"]
    freshness_status: Literal["current", "aging", "stale", "pending"]
    reviewed_at: datetime | None = None

    @model_validator(mode="after")
    def validate_value_semantics(self) -> MetricValueArtifact:
        if self.period_start > self.period_end:
            raise ValueError("period_start cannot be after period_end")
        if self.value_status == "available":
            if self.normalized_value is None or self.null_reason is not None:
                raise ValueError("available values require a normalized value and no null reason")
        elif self.normalized_value is not None or not self.null_reason:
            raise ValueError("non-available values require a null reason and no normalized value")
        if self.reviewed_at is not None and (
            self.reviewed_at.tzinfo is None or self.reviewed_at.utcoffset() is None
        ):
            raise ValueError("reviewed_at must be timezone-aware")
        return self


class CountryArtifact(SeedModel):
    iso3: str = Field(min_length=3, max_length=3)
    iso2: str = Field(min_length=2, max_length=2)
    region_code: str = Field(min_length=1, max_length=40)
    coverage_status: Literal["covered"]
    coverage_level: Literal["Basic"]
    opportunity_level: Literal["pending"]
    policy_friendliness_level: Literal["pending"]
    risk_assessment_status: Literal["unknown"]
    risk_level: None = None
    last_reviewed_at: datetime | None = None
    localized_texts: list[LocalizedTextArtifact] = Field(min_length=2)
    capitals: list[CapitalArtifact] = Field(min_length=1)
    languages: list[LanguageArtifact] = Field(min_length=1)
    currencies: list[CurrencyArtifact] = Field(min_length=1)
    timezones: list[TimezoneArtifact] = Field(min_length=1)
    admin_structures: list[AdminStructureArtifact] = Field(min_length=1)
    metrics: list[MetricValueArtifact] = Field(min_length=1)

    @field_validator("iso3", "iso2")
    @classmethod
    def normalize_codes(cls, value: str) -> str:
        if not value.isalpha():
            raise ValueError("country codes must contain only letters")
        return value.upper()

    @model_validator(mode="after")
    def validate_display_names(self) -> CountryArtifact:
        preferred_names = {
            item.locale
            for item in self.localized_texts
            if item.field_code == "short_name"
            and item.preferred
            and item.translation_status == "reviewed"
        }
        if not {"zh-CN", "en"}.issubset(preferred_names):
            raise ValueError("each country requires reviewed preferred zh-CN and en short names")
        return self


class MetricDefinitionArtifact(SeedModel):
    metric_code: str = Field(min_length=1, max_length=80)
    label_zh: str = Field(min_length=1, max_length=160)
    label_en: str = Field(min_length=1, max_length=160)
    data_domain: Literal["identity", "macro", "energy"]
    canonical_unit: str = Field(min_length=1, max_length=40)
    period_type: Literal["year", "date", "latest"]
    display_precision: int = Field(ge=0, le=8)
    normalization_rule: str = Field(min_length=1)


class Basic60SeedArtifact(SeedModel):
    schema_version: Literal["basic60.seed.v1"]
    release: SeedRelease
    manual_usage_authorization: ManualUsageAuthorization
    ai_usage_policy: AIUsagePolicySummary
    sources: list[SourceArtifact] = Field(min_length=3)
    raw_records: list[RawRecordArtifact] = Field(min_length=1)
    metric_definitions: list[MetricDefinitionArtifact] = Field(min_length=15)
    countries: list[CountryArtifact] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_cross_references(self) -> Basic60SeedArtifact:
        field_scope = self.manual_usage_authorization.field_scope
        if (
            self.ai_usage_policy.permission_basis
            != self.manual_usage_authorization.permission_basis
        ):
            raise ValueError("AI usage policy must bind the A1 manual permission basis")
        if (
            self.ai_usage_policy.field_count != field_scope.field_count
            or self.ai_usage_policy.fields_sha256 != field_scope.fields_sha256
        ):
            raise ValueError("AI usage policy field scope must match the A1 manual authorization")

        source_refs = [source.source_ref for source in self.sources]
        if len(source_refs) != len(set(source_refs)):
            raise ValueError("source_ref values must be unique")

        domain_roles = {(source.data_domain, source.source_role) for source in self.sources}
        required_roles = {
            (domain, role)
            for domain in ("country_identity", "macro", "energy")
            for role in ("primary",)
        }
        if domain_roles != required_roles or len(self.sources) != len(required_roles):
            raise ValueError("each data domain requires exactly one active primary source")

        snapshot_keys = {
            (source.source_ref, snapshot.snapshot_ref)
            for source in self.sources
            for snapshot in source.snapshots
        }
        raw_records = {record.record_ref: record for record in self.raw_records}
        if len(raw_records) != len(self.raw_records):
            raise ValueError("raw record references must be unique")
        for record in self.raw_records:
            if (record.source_ref, record.source_snapshot_ref) not in snapshot_keys:
                raise ValueError(f"raw record {record.record_ref} references an unknown snapshot")

        metric_codes = [definition.metric_code for definition in self.metric_definitions]
        if len(metric_codes) != len(set(metric_codes)):
            raise ValueError("metric definition codes must be unique")
        if set(metric_codes) != METRIC_CODES:
            raise ValueError("metric definitions must equal the fixed BASIC60 V1 metric set")

        iso3_codes = [country.iso3 for country in self.countries]
        iso2_codes = [country.iso2 for country in self.countries]
        if len(iso3_codes) != len(set(iso3_codes)) or len(iso2_codes) != len(set(iso2_codes)):
            raise ValueError("country ISO codes must be unique")

        available_count = 0
        pending_count = 0
        for country in self.countries:
            for item in [
                *country.localized_texts,
                *country.capitals,
                *country.languages,
                *country.currencies,
                *country.timezones,
                *country.admin_structures,
                *country.metrics,
            ]:
                raw = raw_records.get(item.raw_record_ref)
                if raw is None:
                    raise ValueError(f"unknown raw_record_ref: {item.raw_record_ref}")
                if item.source_ref != raw.source_ref:
                    raise ValueError(f"source_ref mismatch for {item.raw_record_ref}")
                if item.source_snapshot_ref != raw.source_snapshot_ref:
                    raise ValueError(f"source snapshot mismatch for {item.raw_record_ref}")
            for metric in country.metrics:
                if metric.metric_code not in METRIC_CODES:
                    raise ValueError(f"unknown metric code: {metric.metric_code}")
                if metric.value_status == "available":
                    available_count += 1
                elif metric.value_status == "pending":
                    pending_count += 1

        counts = self.release.counts
        if counts.countries != len(self.countries):
            raise ValueError("declared country count does not match artifact")
        if counts.available_metric_values != available_count:
            raise ValueError("declared available metric count does not match artifact")
        if counts.pending_metric_values != pending_count:
            raise ValueError("declared pending metric count does not match artifact")
        return self
