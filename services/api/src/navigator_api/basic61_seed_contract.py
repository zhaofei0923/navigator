"""Explicit Zambia extension contract; the original BASIC60 contract stays frozen."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from navigator_api.basic60_seed_contract import (
    METRIC_CODES,
    AIUsagePolicySummary,
    CountryArtifact,
    ManualUsageAuthorization,
    MetricDefinitionArtifact,
    RawRecordArtifact,
    ReleaseCounts,
    SeedModel,
    SourceArtifact,
    _sha256,
)

RELEASE_ID = "BASIC61-PRIVATE-R1"
SCHEMA_VERSION = "basic61.seed.v1"
EXPECTED_COUNTS = {
    "countries": 61,
    "macro_rows": 305,
    "energy_rows": 61,
    "available_metric_values": 2317,
    "pending_metric_values": 62,
}
ADDED_SOURCE_REFS = {
    "country_identity": "SRC-BASIC61-ZMB-IDENTITY",
    "macro": "SRC-BASIC61-ZMB-MACRO",
    "energy": "SRC-BASIC61-ZMB-ENERGY",
}


def _canonical_sha256(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    ).hexdigest()


class Basic61SeedRelease(SeedModel):
    release_id: Literal["BASIC61-PRIVATE-R1"]
    release_profile: Literal["basic60_private"]
    formal_gate_status: Literal["pending"]
    status: Literal["private_trial_ready"]
    as_of: date
    source_cutoff: date
    release_bundle_sha256: str
    validation_report_sha256: str
    counts: ReleaseCounts

    @field_validator("release_bundle_sha256", "validation_report_sha256")
    @classmethod
    def validate_digest(cls, value: str, info: Any) -> str:
        return _sha256(value, str(info.field_name))

    @model_validator(mode="after")
    def validate_release(self) -> Basic61SeedRelease:
        if self.counts.model_dump() != EXPECTED_COUNTS:
            raise ValueError("BASIC61 counts must match the approved single-country extension")
        if self.source_cutoff > self.as_of:
            raise ValueError("source_cutoff cannot be after the release information date")
        return self


class CountryExtensionBinding(SeedModel):
    schema_version: Literal["navigator.country-extension-release-binding.v1"]
    extension_id: str = Field(pattern=r"^COUNTRY-EXT-ZMB-\d{8}-R[1-9]\d*$")
    added_country_code: Literal["ZMB"]
    parent_release_id: Literal["BASIC60-PRIVATE-R1"]
    parent_seed_sha256: str
    parent_country_sha256: dict[str, str] = Field(min_length=60, max_length=60)
    candidate_sha256: str
    workbook_sha256: str
    confirmation_sha256: str
    added_source_refs: dict[str, str]

    @field_validator(
        "parent_seed_sha256", "candidate_sha256", "workbook_sha256", "confirmation_sha256"
    )
    @classmethod
    def validate_digest(cls, value: str, info: Any) -> str:
        return _sha256(value, str(info.field_name))

    @field_validator("parent_country_sha256")
    @classmethod
    def validate_country_hashes(cls, value: dict[str, str]) -> dict[str, str]:
        if "CHN" not in value or "ZMB" in value:
            raise ValueError(
                "the archived parent includes China and must not already include Zambia"
            )
        for code, digest in value.items():
            if len(code) != 3 or not code.isascii() or not code.isalpha() or code != code.upper():
                raise ValueError("parent country keys must be uppercase ISO3 codes")
            if _sha256(digest, f"parent_country_sha256.{code}") != digest:
                raise ValueError("parent country hashes must be canonical lowercase SHA-256")
        return value

    @field_validator("added_source_refs")
    @classmethod
    def validate_added_sources(cls, value: dict[str, str]) -> dict[str, str]:
        if value != ADDED_SOURCE_REFS:
            raise ValueError("BASIC61 must identify the three dedicated Zambia source collections")
        return value


class Basic61SeedArtifact(SeedModel):
    schema_version: Literal["basic61.seed.v1"]
    release: Basic61SeedRelease
    manual_usage_authorization: ManualUsageAuthorization
    ai_usage_policy: AIUsagePolicySummary
    sources: list[SourceArtifact] = Field(min_length=6, max_length=6)
    raw_records: list[RawRecordArtifact] = Field(min_length=1)
    metric_definitions: list[MetricDefinitionArtifact] = Field(min_length=15, max_length=15)
    countries: list[CountryArtifact] = Field(min_length=61, max_length=61)
    extension: CountryExtensionBinding

    @model_validator(mode="before")
    @classmethod
    def validate_parent_content(cls, value: Any) -> Any:
        """Hash the original JSON values before Decimal/date parsing changes representation."""
        if not isinstance(value, dict):
            raise ValueError("BASIC61 seed must be a JSON object")
        binding = value.get("extension")
        countries = value.get("countries")
        if not isinstance(binding, dict) or not isinstance(countries, list):
            raise ValueError("BASIC61 seed requires its extension binding and country records")
        hashes = binding.get("parent_country_sha256")
        if not isinstance(hashes, dict):
            raise ValueError("BASIC61 seed requires the immutable parent country hashes")
        parent_records = [
            item for item in countries if isinstance(item, dict) and item.get("iso3") != "ZMB"
        ]
        if len(parent_records) != 60 or {item.get("iso3") for item in parent_records} != set(
            hashes
        ):
            raise ValueError("BASIC61 must preserve every archived parent country exactly once")
        for country in parent_records:
            if _canonical_sha256(country) != hashes[country["iso3"]]:
                raise ValueError("BASIC61 must not change an existing parent country record")
        return value

    @model_validator(mode="after")
    def validate_cross_references(self) -> Basic61SeedArtifact:
        scope = self.manual_usage_authorization.field_scope
        if (
            self.ai_usage_policy.permission_basis
            != self.manual_usage_authorization.permission_basis
            or self.ai_usage_policy.field_count != scope.field_count
            or self.ai_usage_policy.fields_sha256 != scope.fields_sha256
        ):
            raise ValueError("BASIC61 field scope must match the inherited manual usage decision")

        source_refs = {source.source_ref for source in self.sources}
        if len(source_refs) != len(self.sources):
            raise ValueError("BASIC61 source references must be unique")
        added_refs = set(ADDED_SOURCE_REFS.values())
        for is_added in (False, True):
            sources = [
                source for source in self.sources if (source.source_ref in added_refs) == is_added
            ]
            if len(sources) != 3 or {source.data_domain for source in sources} != set(
                ADDED_SOURCE_REFS
            ):
                raise ValueError("parent and added sources must each cover the three Basic domains")
            if is_added and any(
                ADDED_SOURCE_REFS[source.data_domain] != source.source_ref for source in sources
            ):
                raise ValueError("Zambia source collections must match their declared data domains")

        snapshot_keys = [
            (source.source_ref, snapshot.snapshot_ref)
            for source in self.sources
            for snapshot in source.snapshots
        ]
        if len(snapshot_keys) != len(set(snapshot_keys)):
            raise ValueError("BASIC61 source snapshots must be unique within each source")
        snapshot_set = set(snapshot_keys)
        raw_records = {record.record_ref: record for record in self.raw_records}
        if len(raw_records) != len(self.raw_records):
            raise ValueError("BASIC61 raw record references must be unique")
        for record in self.raw_records:
            if (record.source_ref, record.source_snapshot_ref) not in snapshot_set:
                raise ValueError("BASIC61 raw record references an unknown source snapshot")

        codes = [definition.metric_code for definition in self.metric_definitions]
        if len(set(codes)) != len(codes) or set(codes) != METRIC_CODES:
            raise ValueError("BASIC61 retains exactly the existing Basic metric definitions")
        iso3 = [country.iso3 for country in self.countries]
        iso2 = [country.iso2 for country in self.countries]
        if len(set(iso3)) != len(iso3) or len(set(iso2)) != len(iso2):
            raise ValueError("BASIC61 country codes must be unique")
        if "ZMB" not in iso3 or "CHN" not in iso3:
            raise ValueError("BASIC61 must add Zambia and retain the archived China record")

        counts = {"available": 0, "pending": 0}
        for country in self.countries:
            for item in (
                *country.localized_texts,
                *country.capitals,
                *country.languages,
                *country.currencies,
                *country.timezones,
                *country.admin_structures,
                *country.metrics,
            ):
                raw = raw_records.get(item.raw_record_ref)
                if raw is None or (item.source_ref, item.source_snapshot_ref) != (
                    raw.source_ref,
                    raw.source_snapshot_ref,
                ):
                    raise ValueError(
                        "BASIC61 field provenance must match its original source record"
                    )
                if country.iso3 == "ZMB" and item.source_ref not in added_refs:
                    raise ValueError("Zambia fields require their dedicated reviewed sources")
                if country.iso3 != "ZMB" and item.source_ref in added_refs:
                    raise ValueError("Zambia sources must not replace an existing country source")
            observed = set()
            for metric in country.metrics:
                key = (metric.metric_code, metric.period_start, metric.period_end)
                if metric.metric_code not in METRIC_CODES or key in observed:
                    raise ValueError(
                        "BASIC61 observations require known metrics and unique periods"
                    )
                observed.add(key)
                if metric.value_status not in counts:
                    raise ValueError(
                        "BASIC61 only contains the reviewed available and pending values"
                    )
                counts[metric.value_status] += 1
        if counts != {"available": 2317, "pending": 62}:
            raise ValueError("BASIC61 observed value counts do not match the approved extension")
        return self
